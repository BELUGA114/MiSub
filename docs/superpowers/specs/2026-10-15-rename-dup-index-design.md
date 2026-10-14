# rename 算子「仅重名时编号」设计

## 背景与目标

结构化 rename 的模板重写（`functions/utils/operator-runner.js` 的 `opRename`，`:140-175`）已支持 `indexScope: 'name'`，配合模板 `{name}-{index}` 能做到“同名节点组内递增编号”（2026-10-10 设计批次一 1B）。

但它是**无条件渲染**模板的：分组大小 = 1 时同样输出 `-1`。现有测试固化了这一行为：

```
tests/unit/operator-runner.test.js:439-450
输入 [香港, 香港, 日本] + 模板 {name}-{index} + indexScope='name'
断言 ['香港-1', '香港-2', '日本-1']     <- 唯一的「日本」也带了 -1
```

用户需求是**只有当名字真的重复时才需要区分**：3 个「香港01」要编成 `香港01-1/2/3`，而唯一的「日本01」应保持 `日本01` 不加后缀。DSL 脚本算子也补不上这个缺口——`opScript` 的 `rename` 动作 ctx 只有全局 `index`（`:352`），没有任何分组计数，`pick()`/`len()` 无法凑出分组大小。

**目标**：在不改变存量配置与已上线订阅输出的前提下，让结构化 rename 支持“仅对重名分组编号”。

## 已确认决策

1. 落点＝**扩展 rename 算子**，不新增独立算子，也不扩展 DSL/模板占位符。
2. 两种分组方式**都要**：按同名、按同名+协议。
3. 分组大小 ≥ 2 → 组内全部编号；分组大小 = 1 → **完全不套模板**，保持原名。
4. 判定基准＝**进入该算子时的当前 `name` 精确匹配**（区分大小写、不 trim）；不用 `metadata.cleanName`。
5. 现有 `indexScope: 'name'`（cleanName 兜底）语义**不动**，新能力走新增 scope 值。

## 设计

### 1. 新增两个分组键（`nodeGroupKey`）

`nodeGroupKey`（`operator-runner.js:88-94`）当前是 rename 的 `indexScope` 与 limit 的 `groupBy` 共用的分组键计算函数：

```js
if (scope === 'name') return `n:${record.metadata?.cleanName || record.name}`;
```

新增两个取值：

```js
if (scope === 'nameExact') return `ne:${record.name}`;
if (scope === 'nameProtocolExact') return `np:${record.name}|${record.protocol}`;
```

- `nameExact` 用当前 `record.name` 原样作键：不读 `cleanName`，不做大小写归一与 trim。理由是**显示名完全一致才需要区分**——`香港01 3x` 与 `香港01 5x` 在客户端里本就是两个不同的名字，不该共享序号。
- `nameProtocolExact` 在名称之外并入 `record.protocol`：同名的 vless 与 trojan 各自成组、各自从 1 递增。
- 两者都只读 `record.name`/`record.protocol`，不读 `enriched.regionZh`；但预扫描仍按主循环同样的方式富化，保证两次算出的分组键逐字一致。

`limit` 算子复用同一函数但前端不下拉暴露新值，故 limit 行为零变化。

### 2. `opRename` 的跳过逻辑

模板阶段（`operator-runner.js:140-175`）新增参数 `template.onlyWhenDuplicated`（布尔，默认 falsy）：

```
if (template?.enabled && template.template) {
    const scope = template.indexScope || template.scope || 'region';
    const skipUnique = template.onlyWhenDuplicated === true;

    // 开关开启时先扫描一遍分组大小；只读不改，不写回节点
    const groupSizes = new Map();
    if (skipUnique) {
        for (const r of result) {
            const key = nodeGroupKey(r, NodeUtils.ensureRegionInfo(r, enableEmoji), scope);
            groupSizes.set(key, (groupSizes.get(key) || 0) + 1);
        }
    }

    result = result.map((r, index) => {
        const enriched = NodeUtils.ensureRegionInfo(r, enableEmoji);
        const groupKey = nodeGroupKey(r, enriched, scope);

        // 唯一分组：整条模板都不套用，原名原样返回
        if (skipUnique && (groupSizes.get(groupKey) || 0) < 2) return r;

        ... 现有计数器、vars、renderTemplate、写回 url 逻辑不变
    });
}
```

关键点：

- **是“跳过”而不是“渲染空 index”**。模板里除 `{index}` 外还可能有 `{emoji}{region}{protocol}`，若只把 `{index}` 渲染成空串，唯一节点会被重命名成 `日本-VLESS-`（悬空分隔符），且与“保持原订阅名字”的预期不符。整条跳过最简单也最可预期。
- 计数器（`counters`，定义在 map 之前的闭包中）只在通过跳过判断的节点上递增。被跳过的分组大小恒为 1，其本身也只会被计入一次，故跳过与否对任何分组的计数都没有影响。
- `offset`/`indexStart` 起始值语义不变（`:161`），组内计数仍从 1 开始再加偏移。
- 顺序仍是**当前数组顺序**，不重排；需要确定顺序时把 `sort` 放在 rename 之前。

### 3. 前端

**`src/components/features/Operators/components/RenameEditor.vue`**

- `indexScopeOptions`（`:69-75`）新增两项：`nameExact` →「同名」、`nameProtocolExact` →「同名+协议」。选项列表共 7 项，所有取值始终可见可选。
- 模板区（`:201-214`）在「索引分组」一行旁新增开关「仅重名时编号」，写入 `template.onlyWhenDuplicated`。
- **开关打开时，该行只渲染 `[同名] [同名+协议]` 两项**；关闭时渲染全部 7 项。理由：全局/地区/协议/地区+协议 这几种分组下“重名”没有定义，七个按钮并列也会让「按名称」与「同名」含义相近、用户分不清。
- **开关打开时，若当前 `indexScope` 不在两项之内，立即写入 `nameExact`。** 必须真正写回：若只做 UI 回落而保存值仍是 `region`，会出现“界面高亮同名、后端按地区分组”的错配。写回由用户勾选开关这一主动动作触发，不构成对存量配置的意外改写；关闭开关不回退该值（`nameExact` 在完整列表里是合法选项，选中态与保存值始终一致）。

**`src/i18n/messages.js`**：zh-CN 与 en-US 各新增 3 条文案（两个 scope 标签 + 一个开关标签）与 1 条提示（说明“唯一节点保持原名”）。文案必须同时进两个 locale，否则 `tests/unit/operator-chain-i18n.test.js` 的 `expectNoChineseOrKeys` 契约会失败。

### 4. 文档

`docs/OPERATOR_CHAIN_GUIDE.md` 第 2 节 Rename 段（`:29-36`，现有 `{index}` 索引分组说明处）补充“仅重名时编号”开关与两个新分组方式的说明，并给出范式：

```
去重 -> 过滤 -> 重命名(模板 {name}-{index}，分组=同名，勾选仅重名时编号) -> 排序
```

## 测试

`tests/unit/operator-runner.test.js`，扩展现有 `describe('rename indexScope=name 同名编号')`（`:439`）块：

1. `nameExact` + 开关开：`[香港, 香港, 香港, 日本01]` → `[香港-1, 香港-2, 香港-3, 日本01]`。
2. `nameProtocolExact` + 开关开：同名的 vless×2 与 trojan×1 → vless 得到 `-1/-2`，trojan 组内唯一不加后缀。
3. **整条模板跳过**：模板用 `{emoji}{region}-{protocol}-{index}`（不带 `{name}`），唯一节点输出必须等于**原订阅里的名字**，以此区分“跳过模板”与“渲染空 index”。
4. 开关关闭（或字段缺失）时行为不变：现有 `:445` 用例断言 `['香港-1', '香港-2', '日本-1']` 原样保留，作为回归。
5. `offset` 协同：`{offset: 10}` + 同名组 → `香港-10, 香港-11`。
6. 精确匹配边界：`香港01 3x` 与 `香港01 5x` 在 `nameExact` 下各自成组、均不加序号（证明未走 `cleanName`）。

## 非目标

- 不给 DSL 脚本算子注入分组计数（不新增 `{dupIndex}` 之类模板函数）。
- 不改现有 `indexScope: 'name'`（`cleanName` 兜底）的语义与现有测试断言。
- 不给 `limit` 的 `groupBy` 前端暴露 `nameExact`/`nameProtocolExact`。
- 不改遗留 `applyNodeTransformPipeline`（`functions/utils/node-transformer.js:995-1032`）与 `getIndexGroupKey`（`:713-719`，无 `name` 分支）。该路径前端已无入口（`OperatorChain.vue:48-56` 只做旧配置→算子的单向转换），且 `adaptLegacyTransform` 会先把旧模板配置转成算子。

## 兼容性

- 纯新增：新参数 `template.onlyWhenDuplicated` 缺省 falsy，存量算子配置的渲染结果逐字节不变。
- `nodeGroupKey` 仅新增分支，既有 scope 取值行为不变。

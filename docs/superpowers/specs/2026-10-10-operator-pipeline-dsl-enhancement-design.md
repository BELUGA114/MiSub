# 操作符链与 DSL 增强设计

## 背景与目标

节点后处理由两层组成：**操作符链层**（`functions/utils/operator-runner.js` 的 `runOperatorChain`，含 `filter`/`rename`/`sort`/`dedup`/`script` 独立算子）与 **DSL 层**（`script` 算子内的声明式 JSON，由 `opScript` 分发、`functions/utils/expression-dsl.js` 求值，安全边界为零 `eval`/`new Function`）。

当前缺口（按真实用例梳理）：

- 无法“每组只保留 N 个”（如每地区留 3 个），链层与 DSL 都没有限量能力。
- “同名节点组内递增编号”做不到：DSL 的 `{index}` 是全局序号；结构化 `rename` 的 `indexScope` 只有 `region`/`protocol`/`regionProtocol`，缺 `name`。
- DSL 对象条件只有 `eq`/`ne`/`contains`/`not_contains`/`match`/`regex`/`in`，缺数值/顺序比较与前后缀匹配；模板函数缺字符串切分、长度、显式转数值。

**目标**：在不破坏零 eval 安全模型、不改变存量配置与已上线订阅输出的前提下，补齐上述缺口。

## 设计原则

- 集合级操作（排序/去重/限量/分组计数）留在**链算子层**；逐节点声明式判断/改写留在 **DSL**。
- 不在 DSL 里重做链层已有的 `sort`/`dedup`。
- 新函数一律走手写解析器，保持零 `eval`/`new Function`。

## 已确认决策

1. `limit` 的 `groupBy` 默认 `none`（全局前 N）。
2. rename `name` 分组键用 `metadata.cleanName || name`。
3. 本批同时做前端 `OperatorChain.vue` 可视化编辑（`limit` 算子卡 + rename 的 `name` scope）。
4. 前端 DSL 编辑器（`ScriptDslEditor.vue`）只校验“是不是 JSON 数组”、不对 `op`/`action` 做白名单，故新增 op/函数**无需改编辑器**。

## 分期

- **批次一（链算子层，集合级）**：新增 `limit` 链算子；结构化 `rename` 增加 `name` 分组键。
- **批次二（DSL 层，逐节点表达力）**：对象条件补 `gt`/`lt`/`gte`/`lte` 与 `starts_with`/`ends_with`；模板函数补 `split`/`len`/`number`。

两批相互独立，可分别实现、分别发布。

## 批次一：集合级能力补全（链算子层）

### 1A. 新增 `limit` 链算子

**落点**：`runOperatorChain` 的 `switch (type)`（`operator-runner.js:421`）增加 `case 'limit'`。

**参数**：

```jsonc
{ "type": "limit", "params": { "count": 3, "groupBy": "region", "keepOrder": true } }
```

- `count`：正整数。非法（≤0、非整数、缺失）→ 跳过并 `console.warn`，**不清空节点**（沿用 DSL 护栏风格）。
- `groupBy`：`none`（默认，全局前 N）| `region` | `protocol` | `regionProtocol` | `name`。
- `keepOrder`：保留组内相对顺序，默认 `true`。

**语义**：按**当前数组顺序**，每组保留前 `count` 个，其余丢弃；组间相对顺序不变。放在 `sort` 之后使用才有确定意义（文档需强调）。

**实现要点**：

- 分组键复用结构化 rename 的现有逻辑（`operator-runner.js:137-139`）：region 用 `regionZh || 'Other'`，protocol 用 `protocol`，regionProtocol 用两者拼接，name 用 `metadata.cleanName || name`。
- `groupBy` 含 region 时需先 `ensureRegionInfo`（与 `sort` 分支一致，`operator-runner.js:433-436`）。
- 用 `Map<groupKey, count>` 计数，边遍历边保留，保证稳定顺序。

**测试**（`tests/unit/operator-runner.test.js`）：全局限量取前 N；按地区各留 N；count 非法时原样返回；空数组安全；分组键与 region 富化协同。

**前端**：`OperatorChain.vue` 新增 `limit` 算子卡（count 输入 + groupBy 下拉）；i18n 文案需过 `operator-chain-i18n.test.js` 契约。

### 1B. 结构化 rename 增加 `name` 分组键

**落点**：`opRename` template 模式的 scope 分支（`operator-runner.js:130-142`）。

**变更**：`indexScope`（别名 `scope`）增加取值 `name`：

```js
else if (scope === 'name') groupKey = `n:${enriched.metadata?.cleanName || r.name}`;
```

**效果**：模板 `{name}_{index}` 配 `indexScope: 'name'` → 同名节点组内各自从 1 递增，实现“同名加序号”。与现有 `offset`/`indexStart` 偏移协同（`operator-runner.js:152`）。

**DSL 边界**：DSL 的 `{index}` **保持全局序号语义不变**（分组计数已由结构化 rename 承担，不在 DSL 重做）。“DSL 条件筛选 + 同名编号”的组合范式：DSL `script` 做 `filter`/`discard` → 其后接结构化 `rename`（`indexScope: 'name'`）。文档需给出该范式示例。

**测试**（`tests/unit/operator-runner.test.js`）：同名分组各自递增；`cleanName` 优先于原始 `name`；不同名互不干扰；与 `offset` 协同。

## 批次二：DSL 逐节点表达力（链层无等价物）

### 2A. 对象条件补数值/顺序比较

**落点**：`matchesOp`（`expression-dsl.js:101-113`）新增四个运算符：

```js
case 'gt':  return Number(actual) >  Number(expected);
case 'gte': return Number(actual) >= Number(expected);
case 'lt':  return Number(actual) <  Number(expected);
case 'lte': return Number(actual) <= Number(expected);
```

- **NaN 处理**：任一侧 `Number()` 得 `NaN` → 返回 `false`（不命中、不报错）。
- **数组 value**：并入 `matchesDslCondition` 的正向 OR 分支（`expression-dsl.js:130`），语义为 `actual` 与数组任一元素比较成立即真。
- 字符串表达式里 `> >= < <=` 本已由 `parseCmp` 支持（`expression-dsl.js:257-264`），此项仅补**对象形式**缺口。

### 2B. 条件补 `starts_with` / `ends_with`

**落点**：`matchesOp` 新增两项，**不区分大小写**（与 `contains` 一致）：

```js
case 'starts_with': return String(actual||'').toLowerCase().startsWith(String(expected||'').toLowerCase());
case 'ends_with':   return String(actual||'').toLowerCase().endsWith(String(expected||'').toLowerCase());
```

- **数组 value**：并入正向 OR 分支。
- 暂不做 `not_starts_with`/`not_ends_with`（需要可后续再加，归入反向 AND 分支）。

### 2C. 模板函数补充

**落点**：`FUNCTIONS` map（`expression-dsl.js:145-159`）。注意该语法**无数组类型**，函数只能返回标量，故不加 `join`。

```js
split:  a => { const parts = String(a[0]||'').split(String(a[1]??'')); const i = Number(a[2])||0; return parts[i] ?? ''; },
len:    a => String(a[0]??'').length,
number: a => { const n = Number(a[0]); return Number.isNaN(n) ? '' : n; },
```

- `split(s, sep, i)`：按 `sep` 切分取第 `i` 段（默认 0），替代硬写 `extract` 正则；越界取空串。
- `len(s)`：长度（数字），配合 `pick`/比较做“名字过长截断”。
- `number(s)`：显式转数值，规避 `+` 的拼接/相加歧义（`parseAdd`，`expression-dsl.js:253`）；非数值得空串。

**测试**（`tests/unit/expression-dsl.test.js`）：各 op 正例反例；数组 value 的 OR；NaN 兜底；`split` 越界/缺分隔符；`number` 非数值返回空串；函数名大小写不敏感（经 `tk.v.toLowerCase()`，`expression-dsl.js:233`）。

## 跨批次收尾

- **文档**（`docs/OPERATOR_DSL_GUIDE.md`）：
  - 运算符表（第 4.1 节、速查表）加 `gt`/`lt`/`gte`/`lte`/`starts_with`/`ends_with`。
  - 函数表（第 5.2 节）加 `split`/`len`/`number`。
  - 新增 `limit` 链算子与 rename `name` scope 的说明；补“DSL filter + 结构化 rename(name) 做同名编号”范式示例。
  - 另见 `docs/OPERATOR_CHAIN_GUIDE.md` 同步 `limit` 算子。
- **安全边界不变**：新增 op/函数均走手写解析器，无 `eval`/`new Function`；非法输入一律兜底为“不命中”或空串，不中断订阅生成。
- **兼容性**：仅新增，不改动既有 op/函数/scope 行为与默认值；存量配置与已上线订阅输出不受影响。

## 非目标

- 不把 `sort`/`dedup` 搬进 DSL（链层已有）。
- 不放开 `set-field` 改写 `protocol`。
- 不引入脚本沙箱或新依赖。
- 不改 DSL 编辑器校验逻辑（它只校验 JSON 数组）。



# MiSub 处理规则 DSL 指南

订阅组（或全局默认）里的"脚本"操作符，用一段 **处理规则 (DSL JSON)** 来声明式地过滤、丢弃、改名和改写节点。

> 这是一套 **声明式、受限** 的领域特定语言：由服务端解释执行，**不运行任意 JavaScript**（`eval` / `new Function` 均被禁用），因此比传统脚本更安全、更可预测。旧的 `code` / `url` 自定义脚本字段已停用（会被忽略并打印警告）。

实现位置：
- `functions/utils/operator-runner.js` — `opScript` 动作分发
- `functions/utils/expression-dsl.js` — 条件、表达式、模板求值（手写解析器，零 eval）
- `functions/utils/node-transformer.js` — `setNodeName` / `setNodeHostPort` 等 URL 回写

---

## 1. 快速上手

编辑框（组件 `ScriptDslEditor.vue`）里填的内容 **必须是一个 JSON 数组**，每个元素是一个"动作对象"，数组即一条 **流水线**，按书写顺序执行，上一步输出是下一步输入：

```json
[
  { "action": "filter",  "when": { "field": "protocol", "op": "in", "value": ["vless", "hysteria2"] } },
  { "action": "discard", "when": { "field": "name", "op": "contains", "value": ["过期", "剩余"] } },
  { "action": "rename",  "when": { "field": "name", "op": "regex", "value": ["香港", "HK"] }, "template": "🇭🇰 {regionZh}-{index}" },
  { "action": "set-field", "when": "protocol === 'vless'", "set": { "port": 8443 } }
]
```

上例这条链依次做四件事：① 只保留 `vless` / `hysteria2` 协议的节点；② 丢弃名字含“过期”“剩余”的节点；③ 把名字匹配“香港/HK”的改名为 国旗+地区中文+序号（如 `🇭🇰 香港-1`）；④ 再把其中的 `vless` 节点端口统一改成 `8443`。

- 空数组 `[]` 或空文本 = 不做任何处理。
- 非数组（例如直接写一个对象）会被编辑器判为"JSON 无效：需为动作数组"。
- 未知的 `action` 会被安全忽略。

> **继承机制**：订阅组若配置了自己的操作符链，会 **完全覆盖** 全局默认；不配置则继承全局默认链。

## 2. 记录对象与可用字段

DSL 里的条件和模板，都是针对每个节点的一份 **记录对象 (record)** 求值的。一条节点 URL 例如：

```text
vless://uuid@cf.example.com:443?type=xhttp&security=tls&sni=a.example.com&mode=stream-one#🇭🇰香港01
```

会被解析成这样一份记录（进入 DSL 前 `regionZh` / `region` / `emoji` 已自动补全）：

```jsonc
{
  "protocol": "vless",            // 协议头
  "server": "cf.example.com",     // 连接主机（user@ 与 :port 之间）
  "port": "443",                  // 端口
  "name": "🇭🇰香港01",            // # 之后的备注
  "url": "vless://…#🇭🇰香港01",   // 原始完整 URL
  "originalName": "🇭🇰香港01",    // 重命名前的备注
  "regionZh": "香港",             // 地区中文名（自动补全）
  "region": "Hong Kong",          // 地区英文名
  "emoji": "🇭🇰",                // 国旗（自动补全）
  "metadata": { "cleanName": "香港01", "multiplier": 1, "tags": [] }
}
```

### 可用字段速查

| 字段 | 含义 | filter / discard | rename | set-query.when | set-field |
| --- | --- | :---: | :---: | :---: | :---: |
| `name` | 备注（`#` 之后） | ✅ | ✅ | ✅ | ✅ |
| `protocol` | 协议：`vless`/`vmess`/`ss`/`trojan`/`hysteria2`… | ✅ | ✅ | ✅ | ✅ |
| `server` | 连接主机 | ✅ | ✅ | ✅ | ✅ |
| `port` | 端口 | ✅ | ✅ | ✅ | ✅ |
| `url` | 原始完整 URL | ✅ | ✅ | ✅ | ✅ |
| `originalName` | 重命名前的备注 | ✅ | ✅ | ✅ | ✅ |
| `regionZh` / `region` / `emoji` | 地区与国旗（自动补全） | ✅ | ✅ | ✅ | ✅ |
| `metadata.*` | `cleanName` / `multiplier` / `tags` … | ✅ | ✅ | ✅ | ✅ |
| `index` | **当前步骤**列表中的序号（从 1 开始） | ✅ | ✅ | ✅ | ✅ |
| `target` | 目标客户端格式（`clash`/`singbox`/`base64`…） | — | ✅ | ✅ | ✅ |
| `query.<参数>` | URL 查询参数（`query.type` / `query.sni`…） | — | — | ✅ | — |

> `query.` 子对象只在执行 `set-query` 时临时从该节点 URL 解析，因此 **仅 `set-query.when` 可用**；其余动作里写 `query.xxx` 只会取到空字符串。要"按某个 URL 参数筛选/判断"，放进 `set-query.when` 里做。
>
> 取字段用安全的点路径解析：路径不存在时 **返回空字符串，不报错**。注意区分 `server`（连接主机）、`query.sni`（TLS SNI）、`query.host`（传输层 Host），三者不同。

## 3. 五个动作

| `action` | 作用 | 条件 |
| --- | --- | --- |
| `filter` | 保留命中条件的节点，其余丢弃 | 条件即选择器 |
| `discard` | 丢弃命中条件的节点（filter 的反操作） | 条件即选择器 |
| `rename` | 按模板重命名节点 | 可选 `when`（省略=全部改名） |
| `set-query` | 改写 URL 的 query 参数 | 可选 `when` |
| `set-field` | 改写结构字段（name / server / port / metadata） | 可选 `when` |

`action` 大小写不敏感。变更类动作（rename / set-query / set-field）省略 `when` 时对全部节点生效，写了 `when` 只作用于命中的节点、其余原样透传。

### 3.1 `filter` — 保留匹配

条件可直接内联写在动作对象上，或放进 `when`（两者等价，`when` 优先）。保留使条件成立的节点。

```json
{ "action": "filter", "when": { "field": "name", "op": "regex", "value": ["香港", "台湾", "日本"] } }
```

上例：只保留名字里含“香港”“台湾”“日本”任一关键字的节点，其余全部丢弃。

- "且（AND）"：写多个 `filter` 步逐步收窄，或在 `when` 里用条件数组 / `&&` 表达式。
- "或（OR）"：`value` 用数组（见第 4 节），或用 `|` 正则、`||` 表达式。

### 3.2 `discard` — 丢弃匹配

`filter` 的反操作，丢弃命中条件的节点。与 `filter` 一样支持 `when` 或内联条件。

```json
{ "action": "discard", "when": { "field": "name", "op": "contains", "value": ["过期", "官网", "剩余流量"] } }
```

上例：丢弃名字里含“过期”“官网”“剩余流量”任一关键字的节点（不区分大小写），其余保留。

> 安全约束：**完全没有条件**的 `discard`（既无 `when` 也无 `field/op/value`）会被跳过，不会清空全部节点。若确实要清空全部，写一个**恒真条件**（如 `"when": "true"`，见第 4 节）——护栏只拦“无条件”，不拦“恒真”。

### 3.3 `rename` — 套模板改名

对命中的节点套用模板改名，同步更新 URL 的 `#` 备注与 `metadata.cleanName`。

```json
{ "action": "rename", "when": { "field": "name", "op": "regex", "value": ["香港", "HK"] }, "template": "{emoji}{regionZh}-{index}" }
```

上例：把名字匹配“香港/HK”的节点，改名为 国旗+地区中文+序号（如 `🇭🇰香港-1`）。

- `template` 与 `expression` 同义；都缺省则该步跳过。
- 无 `when` 时对全部节点改名；也可把判断写进模板函数，例如 `"{pick(match(name,'IPLC'), '专线-', '')}{name}"`。
- 结果示例：`🇭🇰香港-1`。

### 3.4 `set-query` — 改写 query 参数

只重写 URL 的 **query 段**，协议、主机、端口、路径、`#备注` 全部原样保留。

```json
{
  "action": "set-query",
  "when": [{ "field": "query.type", "op": "eq", "value": "xhttp" }],
  "set": { "mode": "packet-up", "alpn": "h3", "fp": null }
}
```

上例：把 URL 参数 `type=xhttp` 的节点，`mode` 改成 `packet-up`、`alpn` 设为 `h3`，并删除 `fp` 参数（值为 `null` 即删除）。

- `when` 省略则对全部节点生效；这里可以用 `query.` 字段。
- `set` 里键已存在则覆盖、不存在则追加；值为 `null` 则删除该参数；值必须是基本类型（字符串/数字/布尔），对象/数组会被忽略并告警。

### 3.5 `set-field` — 改写结构字段

改写节点的 **结构字段**：`name`、`server`、`port`、`metadata.*`（**不支持 `protocol`**）。

```json
{
  "action": "set-field",
  "when": { "field": "server", "op": "regex", "value": "\\.old\\.com$" },
  "set": { "server": "new.example.com", "port": 8443, "name": "{regionZh}-{index}", "metadata.group": "A" }
}
```

上例：把 `server` 以 `.old.com` 结尾的节点，主机改成 `new.example.com`、端口改成 `8443`、按 地区中文+序号 改名，并打上 `metadata.group=A` 标记。

- `set` 的值当作 **模板字符串**（含 `{}` 时按模板渲染，见第 5 节）或字面量。
- `name` → 改名并同步 URL 的 `#备注` 与 `metadata.cleanName`。
- `server` / `port` → 按协议重建 URL（VMess 改 JSON 里的 `add`/`port`；VLESS/Trojan/Hysteria2/TUIC/Snell 等改 `host:port`；SS 兼容两种格式）。`port` 会做 **数值校验（1–65535）**，非法则跳过并告警。
- `metadata.*` → 只写到记录上（影响后续排序/去重/展示），不进 URL。
- **兜底**：无法安全重建的协议（如 SSR）或重建失败时 **保留原节点**，绝不产出坏 URL。

---

## 4. 条件 (condition)

`filter` / `discard` 的条件、以及各动作的 `when`，都支持三种写法：

### 4.1 对象形式 `{ field, op, value, flags }`

```json
{ "field": "server", "op": "regex", "value": "^cf[0-9]?\\.example\\.com$", "flags": "i" }
```

上例：匹配 `server` 形如 `cf.example.com`、`cf1.example.com`（`cf` 后可跟一位数字）的节点；`flags: "i"` 表示忽略大小写。

运算符 `op`：

| `op` | 含义 | 说明 |
| --- | --- | --- |
| `eq` / `equals` | 相等 | 按字符串精确比较（区分大小写） |
| `ne` / `not_equals` | 不等 | 按字符串比较 |
| `contains` | 包含 | 不区分大小写 |
| `not_contains` | 不包含 | 不区分大小写 |
| `match` / `regex` | 正则匹配 | 用 `value` 作正则，`flags` 默认 `"i"` |
| `in` | 属于集合 | `value` 为数组，精确匹配任一 |

缺省 `field` = `name`，缺省 `op` = `contains`。

**`value` 为数组时的语义**：
- 正向 `eq` / `contains` / `match` / `regex`：命中 **任意一个** 即真（OR）。这直接实现"字段命中数组里任一关键字"，无需手拼 `香港|HK` 正则。
- 反向 `ne` / `not_contains`：需对 **所有** 元素都不命中（AND）。

### 4.2 数组形式（AND）

数组里每个条件都成立才算命中：

```json
"when": [
  { "field": "server",     "op": "regex", "value": "\\.example\\.com$" },
  { "field": "query.type", "op": "eq",    "value": "xhttp" }
]
```

上例：两条同时成立才命中——`server` 以 `.example.com` 结尾，且 URL 参数 `type` 等于 `xhttp`。

### 4.3 字符串表达式形式

直接写一行布尔表达式（见第 5 节语法）：

```json
"when": "(protocol === 'vless' || protocol === 'vmess') && contains(name, '香港')"
```

上例：匹配协议为 `vless` 或 `vmess`、且名字含“香港”的节点。

> **恒真条件（无差别匹配全部）**：`filter` / `discard` 的条件与任意 `when`，想命中所有节点就写一个恒真条件——`"true"`、空表达式 `""`、或缺省 `op`（默认 `contains` 空串，“包含空串”对任何值都成立）都恒为真。由此：`filter` 恒真 = 保留全部（等于不筛选）；`discard` 恒真 = 清空全部（需显式写，见 3.2）。变更类动作（`rename` / `set-query` / `set-field`）要作用于全部节点则直接省略 `when`（见第 3 节开头），无需写条件。

## 5. 表达式与模板

字符串表达式（`when`）和模板（`rename` 的 `template`、`set-field` 的值）共用同一套受限求值器（手写解析器，零 `eval`）。模板里 `{...}` 会被求值替换，结果两端自动去空格。

### 5.1 语法

- **字面量**：字符串 `'x'` / `"x"`、数字 `443`、`true` / `false` / `null`。
- **字段**：直接写字段路径，如 `name`、`server`、`metadata.cleanName`、`query.type`（`query.` 仅 `set-query.when` 有值）。
- **比较**：`===`、`!==`（按字符串）；`>`、`>=`、`<`、`<=`（按数字）。
- **逻辑**：`&&`、`||`、`!`（取反）。
- **算术**：`+`、`-`、`*`、`/`、`%`；`+` 在两侧都是数字（含纯数字字符串）时按数值相加，否则按字符串拼接——要强制拼接数字样字符串请用 `concat()`。
- **分组**：`( )` 改变优先级。
- **优先级**（高→低）：`! 一元-` > `* / %` > `+ -` > `> >= < <=` > `=== !==` > `&&` > `||`。

```json
"when": "port >= 443 && !contains(name, '测试')"
```

上例：匹配端口 ≥ 443、且名字不含“测试”的节点。

> 运算符两侧不再强制空格（`a===1&&b===2` 与 `a === 1 && b === 2` 等价）。
>
> 在模板 `{}` 里，`||` / `&&` 得到的是 **布尔值**（不是操作数本身）；要按"取第一个非空"做取值兜底，请用 `fallback()` / `pick()`，例如 `{fallback(regionZh, '其他')}`。

### 5.2 函数

| 函数 | 说明 |
| --- | --- |
| `upper(s)` / `lower(s)` / `title(s)` / `trim(s)` | 大小写与去空格 |
| `contains(s, sub)` | 是否包含（不区分大小写） |
| `match(s, 正则, flags?)` | 正则匹配，`flags` 默认 `i` |
| `replace(s, 正则, 替换, flags?)` | 正则替换，替换串支持 `$1` 反向引用 |
| `extract(s, 正则, 组号?)` | 取第 N 个捕获组（默认 1） |
| `slice(s, start, end?)` | 字符串切片 |
| `padstart(s, 长度, 填充?)` | 左填充（长度上限 1024） |
| `concat(...)` | 依次拼接为字符串 |
| `fallback(a, b, …)` | 取第一个非空值 |
| `pick(cond, a, b)` | 三元：`cond` 为真取 `a` 否则 `b` |

函数名大小写不敏感。示例：`{upper(protocol)}`、`{extract(name, '(\\d+)$', 1)}`、`{padstart(index, 3, '0')}`、`{fallback(regionZh, '其他')}`。

---

## 6. 完整示例

**只保留 vless/hysteria2，去掉过期节点，按地区改名：**

```json
[
  { "action": "filter",  "when": { "field": "protocol", "op": "in", "value": ["vless", "hysteria2"] } },
  { "action": "discard", "when": { "field": "name", "op": "contains", "value": ["过期", "剩余"] } },
  { "action": "rename",  "template": "{emoji}{regionZh}-{index}" }
]
```

上例：节点集合先缩到 `vless`/`hysteria2` → 去掉名字含“过期”“剩余”的 → 剩下的全部改名为 国旗+地区中文+序号（如 `🇭🇰香港-1`、`🇯🇵日本-2`）。

**名字命中数组关键字才加后缀（原名 + 后缀）：**

```json
[
  { "action": "rename", "when": { "field": "name", "op": "regex", "value": ["香港", "HK", "🇭🇰"] }, "template": "{name} [专线]" }
]
```

上例：名字含“香港”“HK”“🇭🇰”任一的节点变成 `原名 [专线]`，其余节点原样不动。

**给某机场的 xhttp 节点切换 mode 并加 alpn：**

```json
[
  {
    "action": "set-query",
    "when": [
      { "field": "server",     "op": "regex", "value": "\\.example\\.com$" },
      { "field": "query.type", "op": "eq",    "value": "xhttp" }
    ],
    "set": { "mode": "packet-up", "alpn": "h3" }
  }
]
```

上例：只有 `server` 以 `.example.com` 结尾且 `type=xhttp` 的节点，被设成 `mode=packet-up`、`alpn=h3`；其余节点不动。

**统一改端口、按序号补零改名：**

```json
[
  { "action": "set-field", "when": "protocol === 'vless'", "set": { "port": 8443, "name": "{regionZh}-{padstart(index, 2, '0')}" } }
]
```

上例：把所有 `vless` 节点端口改成 `8443`，并改名为 地区中文+两位序号——`padstart(index, 2, '0')` 会把序号补足两位（如 `香港-01`、`日本-02`）。

---

## 7. 安全与注意事项

- **顺序敏感**：动作按数组顺序执行；`index` 是"当前步"的序号，`filter`/`discard` 改变节点集合后重新从 1 数起。
- **取字段不报错**：路径不存在返回空字符串，不中断整条链。
- **`contains` / 正则默认不区分大小写**；`eq` / `===` 区分大小写。
- **安全边界**：不执行任意脚本，`eval` / `new Function` 被禁用；正则、`padstart` 等均有兜底，不会因用户输入让订阅生成中断；旧的 `code` / `url` 脚本字段已停用。

### 速查表

- **动作**：`filter`（保留）、`discard`（丢弃）、`rename`（改名）、`set-query`（改 query）、`set-field`（改 name/server/port/metadata）。
- **字段**：`name`、`protocol`、`server`、`port`、`url`、`originalName`、`regionZh`/`region`/`emoji`、`metadata.*`、`index`、`target`；`query.*` 仅 `set-query.when`。
- **运算符**：`eq`/`ne`/`contains`/`not_contains`/`match`(`regex`)/`in`；`value` 为数组时正向=OR、反向=全部不命中。
- **表达式**：`=== !== > >= < <=`、`&& || !`、算术 `+ - * / %`、`( )`；函数 `upper/lower/title/trim/contains/match/replace/extract/slice/padstart/concat/fallback/pick`。

如需操作符链总览与节点数据模型，另见 `docs/OPERATOR_CHAIN_GUIDE.md` 与 `docs/data-model.md`。





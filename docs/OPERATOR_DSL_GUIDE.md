# MiSub 处理规则 DSL JSON 完全指南

本文档介绍订阅组（或全局设置）里"脚本"操作符所使用的 **处理规则 (DSL JSON)** 的完整写法。

> 这是一套**声明式、受限**的领域特定语言（DSL）：它由服务端解释执行，**不会运行任意 JavaScript**（`eval` / `new Function` 均被禁用），因此比传统脚本更安全、更可预测。旧版的 `code` / `url` 自定义脚本字段已停用。

对应的实现文件：
- `functions/utils/operator-runner.js`（`opScript` 动作分发）
- `functions/utils/expression-dsl.js`（条件表达式、模板、字段取值）

---

## 1. 它在哪里、长什么样

在"订阅组编辑 → 操作符链 → 脚本"或"全局设置 → 默认操作符"里，有一个名为 **`处理规则 (DSL JSON)`** 的文本框（组件 `ScriptDslEditor.vue`）。

框里填的内容**必须是一个 JSON 数组**，数组的每个元素是一个"动作对象"：

```json
[
  { "action": "filter",    "field": "protocol", "op": "in", "value": ["vless", "vmess"] },
  { "action": "rename",    "template": "{emoji}{regionZh}-{index}" },
  { "action": "set-query", "when": [{ "field": "query.type", "op": "eq", "value": "xhttp" }], "set": { "mode": "packet-up" } }
]
```

- 数组 = 一条**流水线**，动作**按书写顺序依次执行**，上一步的输出是下一步的输入。
- 空数组 `[]` 或空文本 = 不做任何处理。
- 非数组（例如直接写一个对象）会被编辑器判为"JSON 无效：需为动作数组"。

> **继承机制**：订阅组若配置了自己的操作符链，会**完全覆盖**全局默认；不配置则继承全局默认链。

---

## 2. 三种动作总览

| `action` | 作用 | 是否支持条件 | 关键字段 |
| --- | --- | --- | --- |
| `filter` | 按条件**保留**节点（不匹配的丢弃） | 条件直接写在动作对象上（单条件） | `field` / `op` / `value` / `flags` |
| `rename` | 按模板**重命名**节点 | 无条件（对全部节点生效，可用模板函数做条件） | `template`（或 `expression`） |
| `set-query` | **改写节点 URL 的 query 参数** | `when`（支持多条件、字符串表达式） | `when` / `set` |

`action` 大小写不敏感（内部会转小写）。未知的 `action` 会被忽略。

---

## 3. 结构字段 与 `query.` 参数

DSL 里的条件和模板，都是针对每个节点的一份**记录对象 (record)** 求值的。要写对 `field`，先要理解这份记录的形状。

一条节点 URL，例如：

```text
vless://uuid@cf.example.com:443?type=xhttp&security=tls&sni=a.example.com&fp=chrome&path=%2Fcdn&mode=stream-one#🇭🇰香港01
```

会被解析引擎（`nodeUrlsToRecords`）拆成这样一份记录：

```jsonc
{
  "protocol": "vless",           // 协议（scheme）
  "server": "cf.example.com",    // 主机（URL 中 user@ 与 :port 之间的部分）
  "port": "443",                 // 端口
  "name": "🇭🇰香港01",           // 备注（URL 末尾 # 之后的部分）
  "url": "vless://…#🇭🇰香港01",  // 原始完整 URL
  "regionZh": "香港",            // 地区（中文，脚本算子运行前自动补全）
  "emoji": "🇭🇰",               // 国旗 emoji（自动补全）
  "metadata": { "cleanName": "香港01", "multiplier": 1, "tags": [], "flag": "🇭🇰" }
  // 注意：这里【没有】mode / type / sni / fp 这些字段
}
```

解析引擎会把 URL 里**位置固定、含义明确**的几样东西"提取"成记录的**顶层结构字段**：

- `protocol` ← URL 的协议头（`vless://`）
- `server` ← 主机名（`user@` 和 `:port` 之间）
- `port` ← 端口
- `name` ← `#` 之后的备注

而 `?` 之后 `#` 之前的那一串 `key=value`（`type`、`security`、`sni`、`fp`、`path`、`mode`、`alpn`…）是**协议相关、数量不定、开放式**的查询参数。它们**不会**被逐个提到顶层，而是**整体解析成一个名为 `query` 的子对象**：

```jsonc
"query": {
  "type": "xhttp", "security": "tls", "sni": "a.example.com",
  "fp": "chrome", "path": "/cdn", "mode": "stream-one"
}
```

所以要访问某个查询参数，就要走**点路径**穿进这个子对象：`query.mode`、`query.type`、`query.sni`、`query.alpn`……前缀 `query.` 表示"这是 URL 查询串里的原始参数"。

同理，注意区分几个容易混淆的"主机"：

- `server` = URL 里的连接主机（`cf.example.com`）；
- `query.sni` = 查询参数 `sni`（TLS 握手用的 SNI）；
- `query.host` = 查询参数 `host`（传输层 Host 头）。

它们是三个不同的值，不要用 `server` 去匹配 `sni`。

### 3.1 `query.` 只在 `set-query` 里可用

`query` 子对象是**在执行 `set-query` 动作时，临时从该节点 URL 现解析出来的**（`parseUrlQuery`）。因此：

- ✅ 在 `set-query` 的 `when` 里可以用 `query.mode`、`query.type` 等；
- ❌ 在 `filter` / `rename` 里**没有** `query` 对象，写 `query.xxx` 只会取到空字符串。

也就是说，**"按某个 URL 参数筛选/判断"这件事要放在 `set-query` 的 `when` 里做**（而修改该参数本来也正是 `set-query` 的职责）。`filter` / `rename` 只能用顶层结构字段（`name` / `server` / `protocol` …）。

> 取字段用的是安全的点路径解析（`getField`）：路径不存在时**返回空字符串，不报错**。

### 3.2 可用字段速查

| 字段 | 含义 | filter | rename | set-query.when |
| --- | --- | :---: | :---: | :---: |
| `name` | 节点备注（`#` 之后） | ✅ | ✅ | ✅ |
| `protocol` | 协议：`vless`/`vmess`/`ss`/`trojan`/`hysteria2`… | ✅ | ✅ | ✅ |
| `server` | 连接主机（域名/IP） | ✅ | ✅ | ✅ |
| `port` | 端口 | ✅ | ✅ | ✅ |
| `url` | 原始完整节点 URL | ✅ | ✅ | ✅ |
| `originalName` | 重命名前的原始备注 | ✅ | ✅ | ✅ |
| `regionZh` | 地区中文名（自动补全，如 `香港`） | ✅ | ✅ | ✅ |
| `emoji` | 国旗 emoji（自动补全） | ✅ | ✅ | ✅ |
| `metadata.cleanName` | 去掉倍率/标签后的干净名 | ✅ | ✅ | ✅ |
| `metadata.multiplier` | 倍率（如 `2.0`） | ✅ | ✅ | ✅ |
| `metadata.tags` | 标签数组 | ✅ | ✅ | ✅ |
| `index` | **当前步骤**列表中的序号（从 1 开始） | ✅ | ✅ | ✅ |
| `target` | 目标客户端格式（如 `clash`/`singbox`/`base64`） | — | ✅ | ✅ |
| `query.<参数>` | URL 查询参数（`query.mode`、`query.type`…） | — | — | ✅ |

> `regionZh` / `emoji` 由脚本算子在运行 DSL **之前**自动补全，所以三种动作里都能用。若地区识别不准，用 `name` / `server` 的正则匹配更可靠。

---

## 4. 动作详解

### 4.1 `filter`（过滤：保留匹配的节点）

条件**直接写在动作对象上**（`field` / `op` / `value` / `flags`），**保留**使条件成立的节点，其余丢弃。

```json
{ "action": "filter", "field": "protocol", "op": "in", "value": ["vless", "hysteria2"] }
```

- 一个 `filter` 步只能表达**一个**条件对象（不支持在 `filter` 上写条件数组或字符串表达式）。
- 想要"**且**（AND）"：写**多个** `filter` 步，逐步收窄。
- 想要"**或**（OR）"：用 `op: "regex"` 加正则的 `|`，例如 `{ "field": "name", "op": "regex", "value": "香港|台湾|日本" }`。
- 省略 `field` 默认 `name`，省略 `op` 默认 `contains`。

### 4.2 `rename`（重命名：套模板改名）

对**所有**节点套用模板；模板里用 `{...}` 包裹表达式（详见第 6 节）。改名后会**同步更新 URL 里的 `#` 备注**，并刷新 `metadata.cleanName`。

```json
{ "action": "rename", "template": "{emoji}{regionZh} {index}" }
```

- `template` 与 `expression` 同义（任写其一）；都缺省则该步跳过。
- `rename` 本身没有 `when`。要"有条件地改名"，把判断写进模板函数，例如只给香港节点加前缀：
  ```json
  { "action": "rename", "template": "{pick(match(name,'香港'), '🇭🇰 ', '')}{name}" }
  ```

### 4.3 `set-query`（改写 URL 查询参数）

只重写 URL 的 **query 段**；**协议、主机、端口、路径、`#备注` 全部原样保留**。

```json
{
  "action": "set-query",
  "when": [{ "field": "query.type", "op": "eq", "value": "xhttp" }],
  "set": { "mode": "packet-up", "alpn": "h3", "fp": null }
}
```

- `when`：命中条件的节点才改写；**省略 `when` 则对全部节点生效**。`when` 支持对象、条件数组（AND）、字符串表达式三种写法（见第 5 节）。
- `set`：要写入的 `键: 值`。
  - 键已存在 → **覆盖**其值；键不存在 → **追加**。
  - 值为 `null`（或 `undefined`）→ **删除**该参数。
  - 值必须是**基本类型**（字符串/数字/布尔）；对象/数组会被忽略并打印警告。
  - URL 原本没有 `?` 时会自动补上查询串。

---

## 5. 条件 (condition) 的三种写法

`filter` 的条件（写在动作对象上）只支持下面的**对象形式**；`set-query` 的 `when` 三种形式都支持。

### 5.1 对象形式：`{ field, op, value, flags }`

```json
{ "field": "server", "op": "regex", "value": "^cf[0-9]?\\.example\\.com$", "flags": "i" }
```

运算符 `op` 一览：

| `op` | 含义 | 说明 |
| --- | --- | --- |
| `eq` / `equals` | 相等 | 按**字符串**精确比较（区分大小写） |
| `ne` / `not_equals` | 不等 | 按字符串比较 |
| `contains` | 包含 | **不区分大小写** |
| `not_contains` | 不包含 | 不区分大小写 |
| `match` / `regex` | 正则匹配 | 用 `value` 作正则，`flags` 默认 `"i"` |
| `in` | 属于集合 | `value` 必须是**数组**，如 `["vless","vmess"]` |

- 缺省 `field` = `name`，缺省 `op` = `contains`。
- 数值比较（`>`、`<` 等）请用第 5.3 节的字符串表达式。

### 5.2 数组形式：多条件 AND（仅 `set-query.when`）

数组里的每个对象都要成立（**AND**）才算命中：

```json
"when": [
  { "field": "server",     "op": "regex", "value": "\\.example\\.com$" },
  { "field": "query.type", "op": "eq",    "value": "xhttp" }
]
```

需要 **OR** 逻辑时，改用第 5.3 节的字符串表达式（`||`）。

### 5.3 字符串表达式形式（仅 `set-query.when`）

直接写一行类 JS 的布尔表达式：

```json
"when": "server === 'cf.example.com' && query.type === 'xhttp'"
```

支持的语法：

- **比较**：`===`、`!==`（按字符串比较）；`>`、`>=`、`<`、`<=`（按数字比较）。
- **逻辑**：`&&`、`||`。⚠️ **`&&` / `||` 两侧必须有空格**（`a===1 && b===2`，不能写 `a===1&&b===2`）。
- **字面量**：字符串 `'x'` / `"x"`、数字 `443`、`true` / `false` / `null`。
- **字段**：直接写字段路径，如 `server`、`query.mode`、`metadata.cleanName`。
- **函数**：`upper(s)`、`lower(s)`、`title(s)`、`trim(s)`、`replace(s, 正则, 替换, flags)`、`contains(s, 子串)`（不区分大小写）、`match(s, 正则, flags)`、`fallback(a, b, …)`（取第一个非空）、`pick(cond, a, b)`（三元）。

例：`"contains(name, '香港') || match(server, '^hk', 'i')"`。

---

## 6. 模板 (template) 写法（`rename` 用）

模板是一段普通文本，其中 `{...}` 会被求值替换。花括号里可以放**字段、字面量、函数**（与第 5.3 节的表达式求值规则一致），结果两端会自动去空格。

```json
{ "action": "rename", "template": "{emoji}{regionZh}-{protocol}-{index}" }
```

常用占位符：

- `{name}`、`{protocol}`、`{server}`、`{port}`
- `{regionZh}`（中文地区名）、`{emoji}`（国旗）、`{region}`
- `{index}`：当前列表中的序号（从 1 开始）
- 函数形式，例如 `{upper(protocol)}`、`{replace(name, '\\s+', '_')}`、`{fallback(regionZh, '其他')}`、`{pick(match(name,'IPLC'), '专线-', '')}`

示例结果：`🇭🇰香港-vless-1`。

> 提示：`rename` 会重算 URL 的 `#` 备注，因此建议把它放在 `filter` 之后、`sort` 之前。

---

## 7. 执行模型与注意事项

- **顺序敏感**：动作数组按顺序执行。惯例是先 `filter` 收窄，再 `rename`、`set-query`。
- **`index` 是"当前步"的序号**：`filter` 删掉节点后，后续步骤的 `index` 会重新从 1 数起。
- **地区已预补全**：进入 DSL 前每个节点已补好 `regionZh` / `region` / `emoji`，可直接匹配。
- **取字段不报错**：字段路径不存在时返回空字符串（`''`）。所以 `query.mode`（在 filter 里）或拼错的字段都只是"取到空"，不会中断整条链。
- **`contains` / 正则默认不区分大小写**；`eq` / `===` 区分大小写。
- **`set-query` 只动 query 段**：不会改协议、主机、端口、路径和 `#备注`。
- **安全边界**：DSL 不执行任意脚本，`eval` / `new Function` 被禁用；旧的 `code` / `url` 脚本字段已停用（会打印警告并忽略）。

---

## 8. 完整示例

### 8.1 把 `mode=stream-one` 的节点改成 `mode=stream-up`

```json
[
  {
    "action": "set-query",
    "when": [{ "field": "query.mode", "op": "eq", "value": "stream-one" }],
    "set": { "mode": "stream-up" }
  }
]
```

### 8.2 只给某机场的 xhttp 节点切换 `mode` 并加 `alpn=h3`

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

### 8.3 过滤 + 重命名 组合

```json
[
  { "action": "filter", "field": "protocol", "op": "in", "value": ["vless", "hysteria2"] },
  { "action": "filter", "field": "name", "op": "not_contains", "value": "过期" },
  { "action": "rename", "template": "{emoji}{regionZh}-{index}" }
]
```

### 8.4 删除某个查询参数（值设为 `null`）

```json
[
  { "action": "set-query", "when": "query.fp === 'randomized'", "set": { "fp": null } }
]
```

---

## 9. 速查表

- **顶层结构字段**（三种动作可用）：`name`、`protocol`、`server`、`port`、`url`、`originalName`、`regionZh`、`emoji`、`metadata.*`、`index`。
- **`query.<参数>`**：URL 查询参数，**仅 `set-query.when` 可用**（`query.mode` / `query.type` / `query.sni` / `query.alpn` …）。
- **`target`**：目标客户端格式，`rename` / `set-query` 可用。
- **运算符**：`eq`/`equals`、`ne`/`not_equals`、`contains`、`not_contains`、`match`/`regex`（`flags` 默认 `i`）、`in`（`value` 为数组）。
- **表达式**：`=== !== > >= < <=`、`&& ||`（两侧留空格）、函数 `upper/lower/title/trim/replace/contains/match/fallback/pick`。
- **动作**：`filter`（单条件、保留匹配）、`rename`（模板改名、无 `when`）、`set-query`（`when` + `set`，`null` 删参数）。

如需按字段类型更深入的说明，另见 `docs/OPERATOR_CHAIN_GUIDE.md`（操作符链总览）与 `docs/data-model.md`（节点数据模型）。

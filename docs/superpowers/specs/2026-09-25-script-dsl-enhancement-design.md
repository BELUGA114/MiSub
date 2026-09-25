# 脚本操作符 DSL 增强设计

## 背景与目标

订阅组（或全局默认）里的"脚本"操作符使用一套**声明式、受限**的 DSL JSON：由 `functions/utils/operator-runner.js` 的 `opScript` 分发动作，由 `functions/utils/expression-dsl.js` 提供条件、表达式与模板求值；安全边界是**零 `eval`/`new Function`、不执行任意 JS**。

当前能力偏简：只有 3 个动作（`filter`/`rename`/`set-query`）；`filter` 仅支持单个条件对象；`rename` 无法按条件生效（只能在模板里塞 `pick()`）；只能改写 URL 的 query 段；表达式求值器是"按 `||`/`&&` 朴素切分"，不支持括号分组、`!` 取反和算术。

**目标**：在**不破坏现有安全模型、不改变存量配置与已上线订阅链接输出**的前提下，扩展 DSL 的条件逻辑、动作类型（新增 `discard`/`set-field`）、可改写字段（含 `server`/`port`）与表达式能力（算术/分组/取反/新函数）。

**锚点用例**（用户提出）：节点名命中某个数组里的任一关键字时才重命名（改成固定名或"原名+后缀"），以及按条件丢弃节点。

## 范围

- **动作集**：保留 `filter`/`rename`/`set-query`，新增 `discard`、`set-field`。`sort`/`dedup` 仍作为操作符链上的独立算子，不进脚本 DSL。
- **统一 `when`**：`rename`/`set-query`/`set-field` 支持可选 `when`；省略=全部生效，有=仅命中节点生效、其余透传。
- **条件语法**：`filter`/`discard`/任意 `when` 三处统一支持 对象 / 数组(AND) / 字符串表达式；`value` 为数组时 `eq`/`contains`/`match`/`regex` 表示"命中任意一个"(OR)。
- **`set-field`**：可写 `name`、`server`、`port`、`metadata.*`（tags/multiplier/cleanName）。**不含 `protocol`**。
- **表达式**：括号分组、一元 `!`、一元 `-`、算术 `+ - * / %`（`+` 两侧为字符串时作拼接）；新增函数 `slice`/`padStart`/`extract`/`concat`。
- **非目标**：不引入脚本沙箱或新依赖；不放开 `protocol` 改写；不改 `sort`/`dedup`；不改前端 DSL 编辑器的校验逻辑（它只校验"是不是 JSON 数组"、不白名单动作）。

## 分期

- **一期（零解析器风险）**：统一 `when`（rename/set-query/set-field）+ 数组 OR + `discard` + `set-field` 的 name/metadata + 不依赖布尔解析器的新函数（extract/slice/padStart/concat）。完整覆盖锚点用例。
- **二期**：`set-field` 的 server/port + `setNodeHostPort` + 表达式解析器重写（括号/`!`/算术）。

## 动作模型

DSL 仍是"JSON 动作数组"，按书写顺序执行。动作集：

| action | 作用 | when |
|---|---|---|
| `filter` | 保留命中的节点 | 条件即选择器（兼容旧内联 `{field,op,value}`，也接受 `when`） |
| `discard` | **新增**，丢弃命中的节点 | 条件即选择器 |
| `rename` | 模板改名 | **新增可选 `when`** |
| `set-query` | 改写 query 参数 | 已有 |
| `set-field` | **新增**，改写结构字段 | 可选 `when` |

变更类动作（rename/set-query/set-field）省略 `when` 对全部生效，有 `when` 只作用于命中节点、其余透传。

锚点用例落地：

```json
{ "action": "rename", "when": { "field": "name", "op": "regex", "value": ["香港", "HK"] }, "template": "{name} [专线]" }
```

## 条件语法

`filter` / `discard` / 任意 `when` 三处统一支持三种写法：

- 对象 `{ field, op, value, flags }`
- 数组 = AND（每项都成立）
- 字符串表达式（见"表达式引擎"）

运算符：`eq`/`equals`、`ne`/`not_equals`、`contains`、`not_contains`、`match`/`regex`（`flags` 默认 `i`）、`in`（数组精确匹配）。

**新增语义**：当 `value` 是数组时，`eq`/`contains`/`match`/`regex` 表示"命中任意一个"（OR）。这直接实现"字段命中数组中任一关键字"，无需手拼 `香港|HK` 正则。此前数组值在这些 op 上会被 `String()` 成 `"香港,HK"` 而几乎不可能合理命中，故重定义为 OR 是向后安全的。

## 表达式引擎（expression-dsl.js）

把现有"按 `||`/`&&` 朴素切分"的求值器替换为**手写词法分析 + 递归下降解析器**，仍然**零 `eval`/`new Function`**：

- 括号分组 `(a || b) && c`；一元 `!`、一元 `-`
- 算术 `+ - * / %`；`+` 在两侧均为字符串时作拼接
- 优先级：`! 一元-` > `* / %` > `+ -` > 比较 `=== !== > >= < <=` > `&&` > `||`
- 比较沿用现语义：`===`/`!==` 按字符串；`> >= < <=` 按数字
- **新增函数**（函数调用路径已存在，加函数本身不依赖解析器重写，可在一期落地）：
  - `slice(s, start, end)` 字符串切片
  - `padStart(s, len, pad)` 左填充
  - `extract(s, 正则, 组号)` 取第 N 个捕获组（默认 1）
  - `concat(...)` 字符串拼接
  - 并在文档中说明现有 `replace(name, '(\\d+)$', '$1')` 已能用 `$1` 反向引用取捕获组
- 保留现有函数：`upper/lower/title/trim/replace/contains/match/fallback/pick`
- 正则一律包 `try/catch`，非法正则返回安全默认值（不抛错）

## set-field 与 URL 重建

```json
{ "action": "set-field", "when": { … }, "set": { "name": "{regionZh}-{index}", "server": "new.host.com", "port": 8443 } }
```

- **可写字段**：`name`、`server`、`port`、`metadata.*`（tags/multiplier/cleanName）。不含 `protocol`。
- `set` 的值当作**模板字符串**（`{}` 表达式生效，与 rename 一致）或字面量；`port` 渲染后**强制数值校验（1–65535）**，非法则跳过该字段并告警。
- **回写 URL**：
  - `name` → 复用现有 `setNodeName`。
  - `server`/`port` → 新增 `setNodeHostPort(url, protocol, { server, port })`（`functions/utils/node-transformer.js`）：VMess 走 JSON-Base64 改 `add`/`port` 再重编码；VLESS/Trojan/Hysteria2/TUIC/Snell 等改 authority 段的 `host:port`；SS 兼容 SIP002（authority 形）与旧式（`base64(method:pass@host:port)` 内嵌形）两种。
  - `metadata.*` → 只落在 record 上（影响排序/去重/展示，不进 URL）。
- **兜底**：任一协议的 server/port 重建失败一律**保留原节点**，绝不输出坏 URL。
- 实现上 `set-field` 像 `set-query` 一样在动作步内**直接改 `node.url`**，绕过 `recordsToNodeUrls`"只回写 name"的现状限制。

## discard

`{ "action": "discard", "when": { … } }` → 丢弃命中 `when` 的节点（`filter` 的反操作），复用统一条件求值。

## 错误处理与安全

- 未知 `action` 仍被忽略；旧的单条件 `filter` 与既有 `set-query` 行为不变 → 存量配置与已上线订阅链接不受影响。
- 数组值语义变更（见"条件语法"）向后安全。
- `port` 数值校验；`set-field` server/port 的 URL 重建失败保留原节点。
- 新解析器是手写 tokenizer，无动态执行；正则包 `try/catch`。安全模型保持不变。
- 旧的 `code`/`url` 脚本字段仍停用（打印警告并忽略）。

## 测试

- `expression-dsl`：数组 OR 命中/未命中；新函数 `extract`/`slice`/`padStart`/`concat`；二期加解析器（优先级、括号分组、`!` 取反、算术、字符串 `+` 拼接）。
- `operator-runner`：每个动作的 `when`（命中改/未命中透传）；`discard`；`set-field` 的 name/metadata；二期加 `set-field` 的 server/port 分协议 round-trip（vmess/vless/trojan/ss-sip002/ss-legacy/hysteria2）。
- `node-transformer`：`setNodeHostPort` 分协议 round-trip（改后 server/port 变、协议/查询/`#备注`原样）。
- 回归：现有 DSL 测试全绿；`recordsToNodeUrls` 行为不受影响。
- 每步先跑定向测试，收尾跑 `npm run test:run` 与 `npm run build`。

## 影响文件

- `functions/utils/expression-dsl.js`：统一条件求值、数组 OR、新函数、（二期）解析器重写。
- `functions/utils/operator-runner.js`：`opScript` 动作分发接入 `when`、新增 `discard`/`set-field`。
- `functions/utils/node-transformer.js`：新增 `setNodeHostPort`（二期）。
- `docs/OPERATOR_DSL_GUIDE.md`：文档更新（新动作、when-everywhere、数组 OR、新函数、算术/分组）。
- 测试：`tests/unit/operator-runner.test.js`、`tests/unit/node-transformer.test.js`，并新增 `tests/unit/expression-dsl.test.js`。
- 前端 `src/components/features/Operators/components/ScriptDslEditor.vue`：功能零改动（仅可选补充示例占位）。


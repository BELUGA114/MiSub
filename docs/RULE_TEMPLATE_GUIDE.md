# MiSub 自定义规则模板指南

在"设置 → 服务集成"里，除了内置模板与远程模板，你还能维护一份本地的**自定义规则模板**：用一段 **INI（ACL4SSR / subconverter 风格）** 声明式地定义策略组与分流规则，由内置引擎翻译成各客户端（Clash / Sing-Box / Surge / Loon / Quantumult X / Egern）对应的语法。

> 这是 subconverter/ACL4SSR 那套 `.ini` 配置的一个**受限子集**：由服务端解析、翻译并生成，**不下载也不执行任何外部脚本**。它只描述“**策略组 + 规则**”，节点由订阅本身提供，模板里**不写节点**。与"远程模板"（填一个 URL）不同，自定义模板**保存在本地存储**，通过 `custom:<id>` 引用；与"内置模板"不同，它的内容完全由你掌控。

实现位置：
- `functions/modules/rule-template-handler.js` — 模板的读写、校验与解析（`normalizeCustomRuleTemplates` / `listRuleTemplates` / `resolveRuleTemplateSource`）
- `functions/modules/subscription/template-parsers/ini-template-parser.js` — INI 文本 → 统一模板模型（`parseIniTemplate`）
- `functions/modules/subscription/template-renderers/*` — 统一模型 → 各客户端格式（`render-clash.js` / `render-singbox.js` …）
- `functions/modules/subscription/builtin-rules-provider.js` — `RULE-SET` 内置标识符与远程源映射（`REMOTE_SOURCES`）
- `src/components/settings/sections/ServiceSettings/RuleTemplateManager.vue` — 服务集成里的编辑界面

---

## 1. 快速上手

在 **设置 → 服务集成 → 自定义规则模板** 里点“新建”，填三样东西再保存：

- **名称**：给人看的标题（≤80 字）。
- **模板 ID**：机器引用用的标识，只保留字母、数字、`-`、`_`（其它字符会被规范成 `-`，≤80 字）。别处以 **`custom:<id>`** 引用它。
- **INI 模板内容**：下面各节介绍的 `.ini` 文本。

保存后，在**订阅组的“核心配置 / 配置模板”选择器**或**全局默认规则来源**里选中它即可套用。一份最小可用模板：

```ini
[custom]
ruleset=🎯 全球直连,[]GEOIP,CN
ruleset=🛑 广告拦截,https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/BanAD.list
ruleset=🐟 漏网之鱼,[]FINAL

custom_proxy_group=🚀 节点选择`select`[]♻️ 自动选择`[]DIRECT
custom_proxy_group=♻️ 自动选择`url-test`.*`http://www.gstatic.com/generate_204`300,,50
custom_proxy_group=🎯 全球直连`select`[]DIRECT`[]🚀 节点选择
custom_proxy_group=🛑 广告拦截`select`[]REJECT`[]DIRECT
custom_proxy_group=🐟 漏网之鱼`select`[]🚀 节点选择`[]DIRECT
```

上例定义了 4 个策略组和 3 条分流：中国大陆 IP 直连、拉取远程广告列表拦截、其余流量走“漏网之鱼→节点选择”。`♻️ 自动选择` 用 `.*` 收纳全部节点做延迟测速。

**保存门槛（会被静默丢弃或拒绝的情况）**：
- 内容**必须包含** `[custom]`、`[proxy group]`、`[rule]`、`[ruleset]`、`[proxy]` 之一的段头（`hasIniShape` 校验），否则该条不会被保存。
- 单个模板内容 ≤ **128 KB**；模板总数 ≤ **50** 个（超出的被截断）。
- `enabled` 关闭的模板可以保存，但**引用时会被跳过**（`custom:<id>` 解析不到）。

## 2. 模板的整体结构

模板按 `[段名]` 分节；段头前的行归入默认的 `[custom]` 段。**只有下面三个段会被真正解析**，其余段（如 `[proxy]`）只用于通过保存校验，不参与生成：

| 段 | 作用 | 语法风格 |
| --- | --- | --- |
| `[custom]` | 策略组 + 分流规则（**推荐**） | ACL4SSR：`custom_proxy_group=` / `ruleset=` |
| `[proxy group]` | 策略组 | 原生：`名称=类型,成员,...` |
| `[rule]` | 分流规则 | 原生 Clash 规则行：`DOMAIN-SUFFIX,t.me,策略组` |

> **注意**：裸写的 Clash 规则行（如直接写 `DOMAIN-SUFFIX,t.me,DIRECT` 而不放进 `[rule]` 段，也不写成 `[custom]` 里的 `ruleset=`）**不会被解析**，默认段是 `[custom]`，而 `[custom]` 只认 `custom_proxy_group=` 和 `ruleset=` 两种前缀。
>
> `[custom]` 段里的 `enable_rule_generator` / `overwrite_original_rules` 等 subconverter 开关会被**接受但当前忽略**（仅为兼容旧模板文本保留），不影响生成结果。

## 3. `[custom]` 段（ACL4SSR / subconverter 风格）

推荐写法。段内只有两类有效行，其余行被忽略。

### 3.1 `custom_proxy_group=` — 定义策略组

用**反引号** `` ` `` 分隔字段，格式为 `名称\`类型\`片段1\`片段2…`：

```ini
custom_proxy_group=♻️ 自动选择`url-test`.*`http://www.gstatic.com/generate_204`300,,50
```

上例定义一个名为 `♻️ 自动选择`、类型为 `url-test` 的组，用 `.*` 匹配全部节点，测速地址 `http://www.gstatic.com/generate_204`，间隔 `300` 秒、容差 `50` ms。

反引号后每个“片段”按内容自动归类：

| 片段形态 | 含义 | 例 |
| --- | --- | :--- |
| `[]xxx` | **成员**（引用另一个组或 `DIRECT`/`REJECT`） | `[]♻️ 自动选择`、`[]DIRECT` |
| `.*` 或 `(...)` | **过滤器**（正则，按名字筛选节点入组） | `.*`、`(HK\|TW\|SG)` |
| `http(s)://…` | 测速/健康检查 **URL** | `http://www.gstatic.com/generate_204` |
| 纯数字 / `间隔,,容差` | **间隔**与**容差**（见下） | `300`、`300,,50` |

- 多个 `[]成员` 按书写顺序排列；`.*` 表示“把所有节点放进这个组”。
- 括号过滤器 `(HK|TW)` 里的括号会被剥掉，多个过滤器最终以 `|` 合并成一条正则（`filter`）。
- `url-test` / `fallback` / `load-balance` 组里若混入 `DIRECT`/`REJECT` 成员，Clash 输出时会自动剔除（测速组不应含固定策略）。
- **数字段只有两个值：间隔、容差，都可省略。** MiSub 只按位置取头两个数字当 `[间隔, 容差]`，**没有独立的“超时”字段**。因此不要写满 ACL4SSR 的三段式 `间隔,超时,容差`（如 `300,5,50`），那样 MiSub 会把“超时”误当成容差。正确写法：`300`（只设间隔）或 `300,50`（间隔+容差）。`300,,50` 因中间空字段被滤掉而等价于 `300,50`，只是为兼容直接从 ACL4SSR 复制来的模板。省略整段时用默认值（间隔约 `300` 秒，容差随客户端而定）。

### 3.2 `ruleset=` — 定义分流规则

格式 `ruleset=策略组,规则来源`。“规则来源”有两种：

```ini
ruleset=🎯 全球直连,[]GEOIP,CN
ruleset=🐟 漏网之鱼,[]FINAL
ruleset=🛑 广告拦截,https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/BanAD.list
```

上例三条依次是：内联规则 `GEOIP,CN` 命中大陆 IP → `🎯 全球直连`；内联兜底 `FINAL` → `🐟 漏网之鱼`；远程列表拉取后整体 → `🛑 广告拦截`。

- **内联规则**：来源以 `[]` 开头，后面是一条标准规则体，如 `[]GEOIP,CN`、`[]DOMAIN-SUFFIX,local`、`[]DOMAIN-KEYWORD,google`。
- **兜底**：`[]FINAL`（等价于 Clash 的 `MATCH` / Surge 的 `FINAL`），命中所有未匹配流量。
- **远程规则集**：来源是一个 `http(s)://` URL，内置引擎按目标客户端转换成 rule-provider / rule-set / RULE-SET 引用。来源里的 `clash-classic:` / `surge:` / `singbox:` 等前缀会被自动清理。

## 4. `[proxy group]` 与 `[rule]` 原生段

如果你更习惯直白的写法，也可以不用 `[custom]`，改用两个原生段。二者可与 `[custom]` 混用（解析后合并）。

**`[proxy group]`**：`名称=类型,片段,...`，用逗号分隔；`[]成员` 与过滤器规则同 3.1，选项写成 `key=value`。

```ini
[proxy group]
🚀 节点选择=select,[]♻️ 自动选择,[]DIRECT
♻️ 自动选择=url-test,.*,url=http://www.gstatic.com/generate_204,interval=300
```

**`[rule]`**：每行一条**标准 Clash 规则**，`类型,匹配值,策略组[,额外参数]`：

```ini
[rule]
DOMAIN-SUFFIX,t.me,🚀 节点选择
DOMAIN-KEYWORD,telegram,🚀 节点选择
GEOIP,CN,DIRECT
MATCH,🚀 节点选择
```

上例把 Telegram 相关域名走“节点选择”、大陆 IP 直连、其余兜底到“节点选择”。这些规则会由内置引擎按客户端翻译（例如 Quantumult X 下 `DOMAIN-SUFFIX` 自动变 `HOST-SUFFIX`）。

## 5. 策略组类型

`类型`（`custom_proxy_group` 反引号第二段，或 `[proxy group]` 第一个逗号段）大小写不敏感，支持四种；未知类型一律回退为 `select`：

| 类型 | 作用 | 相关选项 |
| --- | --- | --- |
| `select` | 手动选择入口 | 成员列表 |
| `url-test` | 自动选延迟最低 | `url`（测速地址）、间隔、`tolerance` 容差 |
| `fallback` | 故障转移到首个可用 | `url`、间隔 |
| `load-balance` | 负载均衡 | `url`、间隔 |

- 各客户端的原生能力不同，内置引擎会按目标翻译：如 Quantumult X 无原生 `url-test`，映射为 `url-latency-benchmark`；`load-balance` 在部分客户端降级为最接近的可用类型。
- 未显式给测速 `url` 时默认 `http://www.gstatic.com/generate_204`；未给间隔时默认 `300` 秒。
- `select` 组里可放固定策略成员（`DIRECT`/`REJECT`）；测速类组会自动剔除它们（见 3.1）。

## 6. 规则类型与 `RULE-SET` 内置标识符

规则行的常见类型：`DOMAIN`、`DOMAIN-SUFFIX`、`DOMAIN-KEYWORD`、`IP-CIDR`、`GEOIP`、`MATCH`/`FINAL`（兜底），以及 `RULE-SET`（引用规则集）。这些会被翻译到目标客户端的等价语法。

`RULE-SET,<标识符>,<策略组>` 里的 `<标识符>` 可以是内置名。**只有下列内置标识符有效**，其余未知标识符会被丢弃（不产出坏规则）：

| 标识符 | 含义 | 备注 |
| --- | --- | --- |
| `ADS` | 广告拦截 | 常配 `REJECT` |
| `AI` | 智能 AI（OpenAI 等） | |
| `STREAM` | 流媒体（Netflix 等） | |
| `SOCIAL` | 社交（Telegram 等） | |
| `APPLE` | 苹果服务 | |
| `MICROSOFT` | 微软服务 | |
| `geoip-cn` | 中国大陆 IP（GeoIP） | 主要供 Sing-Box 使用 |

```ini
[rule]
RULE-SET,ADS,🛑 广告拦截
RULE-SET,AI,🤖 智能 AI
RULE-SET,STREAM,🎬 流媒体
```

上例引用三个内置规则集，分别导向对应策略组。内置引擎会按客户端把它们展开成 rule-provider（Clash）、rule_set（Sing-Box）或 `RULE-SET`/`filter_remote`（Surge/Loon/Quantumult X）。

> 引用了 `RULE-SET,AI,🤖 智能 AI` 之类的规则时，请确保 `[custom]`/`[proxy group]` 里**存在同名策略组**（`🤖 智能 AI`），否则规则会指向一个不存在的组。

## 7. 与其它模板来源的关系

“配置模板”选择器里的取值前缀决定来源类型（`resolveTemplateSource`）：

| 取值 | 来源 `kind` | 含义 |
| --- | --- | --- |
| 空 | `none` | 不套模板，仅按规则等级生成 |
| `builtin:<名>` | `builtin` | MiSub 内置模板 |
| `custom:<id>` | `custom` | **本节的自定义规则模板** |
| 其它（URL） | `remote` | 远程模板 URL |

- **优先级**：订阅组自身的“核心配置”覆盖全局默认；不填则继承全局。
- **关闭内置规则等级**：一旦使用 `custom`（或 `remote`）模板，内置规则等级会被强制设为 `none`，即**不再叠加** `std`/`full` 那套内置分流，最终规则**完全以你的模板为准**。所以自定义模板要自带兜底（`[]FINAL` 或 `MATCH`），否则未匹配流量无归属。
- 自定义模板对 **Clash / Sing-Box / Surge / Loon / Quantumult X / Egern** 六种内置目标都生效；`base64` / `v2ray` 等纯节点列表目标不使用模板。

## 8. 完整示例

**基础分流（大陆直连、广告拦截、AI 固定出口、兜底）：**

```ini
[custom]
ruleset=🛑 广告拦截,https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/BanAD.list
ruleset=🤖 AI 服务,[]DOMAIN-SUFFIX,openai.com
ruleset=🤖 AI 服务,[]DOMAIN-SUFFIX,anthropic.com
ruleset=🎯 全球直连,[]GEOIP,CN
ruleset=🐟 漏网之鱼,[]FINAL

custom_proxy_group=🚀 节点选择`select`[]♻️ 自动选择`[]🇭🇰 香港`[]DIRECT
custom_proxy_group=♻️ 自动选择`url-test`.*`http://www.gstatic.com/generate_204`300,,50
custom_proxy_group=🇭🇰 香港`url-test`(香港|HK|🇭🇰)`http://www.gstatic.com/generate_204`300
custom_proxy_group=🤖 AI 服务`select`[]🚀 节点选择`[]🇭🇰 香港
custom_proxy_group=🛑 广告拦截`select`[]REJECT`[]DIRECT
custom_proxy_group=🎯 全球直连`select`[]DIRECT`[]🚀 节点选择
custom_proxy_group=🐟 漏网之鱼`select`[]🚀 节点选择`[]DIRECT
```

上例：广告走远程列表拦截；OpenAI/Anthropic 走“AI 服务”组；大陆 IP 直连；其余兜底到“漏网之鱼”。`🇭🇰 香港` 组用正则 `(香港|HK|🇭🇰)` 自动收纳港区节点。

**用内置规则集精简配置：**

```ini
[custom]
custom_proxy_group=🚀 节点选择`select`[]♻️ 自动选择`[]DIRECT
custom_proxy_group=♻️ 自动选择`url-test`.*`http://www.gstatic.com/generate_204`300,,50
custom_proxy_group=🛑 广告拦截`select`[]REJECT
custom_proxy_group=🤖 智能 AI`select`[]🚀 节点选择`[]♻️ 自动选择

[rule]
RULE-SET,ADS,🛑 广告拦截
RULE-SET,AI,🤖 智能 AI
GEOIP,CN,DIRECT
MATCH,🚀 节点选择
```

上例：混用 `[custom]` 定义策略组、`[rule]` 用内置规则集与原生规则；`ADS` 拦截、`AI` 走智能组、大陆直连、其余兜底“节点选择”。

## 9. 安全与注意事项

- **本地存储、无脚本**：模板保存在 KV/D1，不下载执行任何脚本；远程 `ruleset=`/`RULE-SET` 只在生成时按客户端转换成规则引用。
- **策略组名必须一致**：规则里引用的策略组名（含 Emoji）要与你定义的组**完全一致**，否则规则指向空组。
- **务必自带兜底**：自定义模板会关闭内置规则等级，缺少 `[]FINAL` / `MATCH` 时未匹配流量无归属。
- **兜底不产坏配置**：未知 `RULE-SET` 标识符、无法翻译的行会被安全丢弃，不会中断订阅生成。
- **跨客户端自动翻译**：同一份模板对六种内置目标各自翻译（如 `DOMAIN-SUFFIX`→Quantumult X 的 `HOST-SUFFIX`），无需为每个客户端各写一份。

### 速查表

- **段**：`[custom]`（推荐，`custom_proxy_group=` / `ruleset=`）、`[proxy group]`（原生组）、`[rule]`（原生规则行）。
- **策略组类型**：`select` / `url-test` / `fallback` / `load-balance`（未知回退 `select`）。
- **`custom_proxy_group` 片段**：`[]成员`、`.*`/`(正则)` 过滤器、`http(s)://` 测速 URL、`间隔` / `间隔,,容差`。
- **`ruleset=` 来源**：`[]内联规则`（如 `[]GEOIP,CN`、`[]FINAL`）或 `http(s)://` 远程列表。
- **`RULE-SET` 内置标识符**：`ADS` / `AI` / `STREAM` / `SOCIAL` / `APPLE` / `MICROSOFT` / `geoip-cn`。
- **引用**：`custom:<id>`；使用后内置规则等级强制为 `none`，规则以模板为准，需自带兜底。

如需节点级过滤/改名/改写，另见 `docs/OPERATOR_DSL_GUIDE.md`；模板与生成流程总览见 `docs/architecture.md` 与 `docs/subscription-request-flow.md`。

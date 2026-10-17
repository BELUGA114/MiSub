# VLESS xHTTP extra 补全设计（基于上游 4952c16）

> 目标代码基线：imzyb/MiSub `4952c16`（2026-10-14）。下行继承补偿见同目录 `2026-10-17-xhttp-download-settings-inheritance-design.md`。

## 背景与目标

上游对 VLESS + XHTTP 的 `extra` 支持目前只有两次不完整的改动：

- #455 / `8f18021`：补上 `xhttp-opts` 的 `path`/`host`/`mode` 在 Clash → URL 方向的往返。
- #451 / `8f58818`：在 `functions/utils/url-to-clash.js:168-264` 内联解析 `extra`，但只取 5 个 `xPadding*` 字段（最初用于修复 FLClash/Mihomo 因 padding 丢失导致的 Timeout）。

其余字段（session/seq/uplinkData 的 placement 与 key、sessionID 形态、上行分包节奏、`headers`、`xmux`、`downloadSettings`）仍被静默丢弃。后果：

- 节点失去请求混淆与 XMUX 调优，部分 CDN/WAF 场景重新出现 403、Timeout 或限速。
- 上下行分离（`downloadSettings`）整个丢失，下行回落到上行地址，CDN 拆分与域前置失效。
- Clash 配置源反向导入为 VLESS URL 时同样丢失这些字段。

mihomo 侧已有完整承载能力：`adapter/outbound/vless.go` 的 `XHTTPOptions` 覆盖本 spec 列出的全部上行字段；`common/convert/v.go` 的 `parseXHTTPExtra` 是官方 camelCase → kebab-case 参考映射。目标是在上游基线上补全双向映射，同时保持 #451 的既有行为。

## 范围

- 新增纯函数模块 `functions/utils/xhttp-extra.js`，负责 `extra` 与 mihomo `xhttp-opts` 的双向映射。
- 改 `functions/utils/url-to-clash.js` 的 `parseVlessUrl`：xhttp 分支改用该模块，保留 `path`/`host`/`mode` 与 Host 头合并逻辑。
- 改 `functions/utils/clash-to-url.js` 的 vless 分支：写回 `extra=`。
- 其余生成器不动：`builtin-clash-generator.js` 用 `js-yaml` 整体 dump，`xhttp-opts` 自动透传；Loon/QuanX/sing-box/Surge 生成器只读各自认识的字段；base64/v2ray 输出透传原始链接。
- 下行继承补偿单独一份 spec，本阶段不实现。

## 架构

新建 `functions/utils/xhttp-extra.js`（ESM，遵循仓库 Prettier 配置：4 空格、单引号、分号）：

- `parseXhttpExtra(extra)`：Xray `xhttpSettings.extra` JSON → mihomo `xhttp-opts` 的附加字段（kebab-case，含 `reuse-settings`、`download-settings`）。输入非对象或无有效字段时返回 `{}`。
- `serializeXhttpExtra(xhttpOpts)`：mihomo `xhttp-opts` → Xray `extra` JSON（camelCase，含 `xmux`、`downloadSettings`）。无任何可表达字段时返回 `null`。
- 内部辅助：`xmuxToReuseSettings` / `reuseSettingsToXmux`、`parseDownloadSettings` / `serializeDownloadSettings`。

调用点：

- `url-to-clash.js` `parseVlessUrl`（`168` 行起）：
  - 保留现有 `path`/`host`/`mode` 解析与 `headers = { Host: host }` 的既有行为。
  - 用 `parseXhttpExtra` 替换现有 5 个 `xPadding*` 的内联映射；结果中除 `headers` 外的字段直接并入 `xhttpOpts`。
  - `extra.headers` 与 URL 推断出的 `headers` 合并，URL 推断值（`Host`）优先，不整体覆盖。
  - `extra` 解析失败时保持现状：`console.warn` 后继续输出只有 `path`/`host`/`mode` 的节点。
- `clash-to-url.js` vless 分支（`212-217` 行）：在写完 `path`/`host`/`mode` 后调用 `serializeXhttpExtra`，非 `null` 时追加 `extra=<encodeURIComponent(JSON.stringify(obj))>`。

## 字段映射（extra → xhttp-opts）

### 上行字段

| Xray extra | mihomo xhttp-opts | 规则 |
|---|---|---|
| `headers` | `headers` | 仅接受对象；与 URL 推断的 Host 合并 |
| `noGRPCHeader` | `no-grpc-header` | 仅 `true` 时写入 |
| `xPaddingBytes` | `x-padding-bytes` | 字符串 |
| `xPaddingObfsMode` | `x-padding-obfs-mode` | 布尔 |
| `xPaddingKey` / `xPaddingHeader` / `xPaddingPlacement` / `xPaddingMethod` | `x-padding-key` / `x-padding-header` / `x-padding-placement` / `x-padding-method` | 字符串 |
| `uplinkHTTPMethod` | `uplink-http-method` | 字符串 |
| `sessionIDPlacement`（回退 `sessionPlacement`） | `session-placement` | 字符串 |
| `sessionIDKey`（回退 `sessionKey`） | `session-key` | 字符串 |
| `sessionIDTable` | `session-table` | 字符串 |
| `sessionIDLength` | `session-length` | 字符串；数字转十进制字符串 |
| `seqPlacement` / `seqKey` | `seq-placement` / `seq-key` | 字符串 |
| `uplinkDataPlacement` / `uplinkDataKey` | `uplink-data-placement` / `uplink-data-key` | 字符串 |
| `uplinkChunkSize` | `uplink-chunk-size` | 字符串或数字；数字转十进制字符串 |
| `scMaxEachPostBytes` | `sc-max-each-post-bytes` | 同上 |
| `scMinPostsIntervalMs` | `sc-min-posts-interval-ms` | 同上 |
| `xmux` | `reuse-settings` | 见下 |

`uplinkChunkSize` / `scMaxEachPostBytes` / `scMinPostsIntervalMs` 在 mihomo 配置 schema 中是字符串（运行时 `ParseRange` 接受单值或区间），因此同时接受 Xray 实际会出现的字符串区间和数字两种形态。mihomo 的 URL 转换器只认数字，这里按其配置层对齐，不跟随 `v.go` 的窄行为。

`xmux` → `reuse-settings`：

| xmux | reuse-settings |
|---|---|
| `maxConnections` / `maxConcurrency` / `cMaxReuseTimes` / `hMaxRequestTimes` / `hMaxReusableSecs` | `max-connections` / `max-concurrency` / `c-max-reuse-times` / `h-max-request-times` / `h-max-reusable-secs`，字符串或数字转十进制字符串 |
| `hKeepAlivePeriod` | `h-keep-alive-period`，整数 |

`xmux` 各项均为 0 时仍原样输出（mihomo 自己按默认值处理），不在转换层做“全 0 视为省略”的推断。

### downloadSettings → download-settings

| downloadSettings | download-settings | 规则 |
|---|---|---|
| `address` | `server` | 字符串 |
| `port` | `port` | 整数 |
| `security` | `tls` | `tls`/`reality` 时 `tls: true`；其余情况本 spec 不写（继承补偿见另一份 spec） |
| `tlsSettings.serverName` | `servername` | 字符串 |
| `tlsSettings.fingerprint` | `client-fingerprint` | 字符串 |
| `tlsSettings.alpn` | `alpn` | 字符串数组 |
| `tlsSettings.allowInsecure` | `skip-cert-verify` | 仅 `true` 时写入 |
| `realitySettings.publicKey` / `shortId` | `reality-opts.public-key` / `reality-opts.short-id` | `security=reality` 时映射，空值不写 |
| `realitySettings.serverName` | `servername` | `security=reality` 时优先于 `tlsSettings.serverName` |
| `realitySettings.fingerprint` | `client-fingerprint` | `security=reality` 时优先于 `tlsSettings.fingerprint` |
| `xhttpSettings.path` / `host` / `headers` | `path` / `host` / `headers` | 与上行同名字段一致 |
| `xhttpSettings.extra.xmux` | `reuse-settings` | 与上行 xmux 同一映射 |

### 下行 REALITY 的 SNI / 指纹优先级

Xray 侧的实际行为：

- `security=reality` 时，splithttp 的拨号闭包先判断 `realityConfig`，命中后直接 `reality.UClient`，`tlsConfig` 不参与（`dialer.go:133-140`）；HTTP 版本判定也因 REALITY 恒为 H2（`dialer.go:82-85`）。
- `reality.UClient` 只读取 `reality.Config` 的 `server_name` 与 `Fingerprint`：`server_name` 为空时回退到目标地址（`reality.go:129-130`）；`Fingerprint` 为空时 `tls.GetFingerprint("")` 返回 Chrome（`tls.go:187-191`）。
- 因此 `security=reality` 下 `tlsSettings.serverName` / `tlsSettings.fingerprint` / `tlsSettings.alpn` 都不生效。

mihomo 侧则没有嵌套结构：`XHTTPDownloadSettings` 是扁平字段，REALITY 握手实际消费 `servername` 与 `client-fingerprint`（`adapter/outbound/vless.go` 传给 `vmess.TLSConfig`；`transport/vmess/tls.go:114-116` 走 `GetRealityConn`，`130-132` 强制要求非空指纹）。所以必须把 `realitySettings` 的值写进这两个扁平字段。

取值阶梯（空字符串一律视为“未提供”，与 mihomo `setStr` 只接受非空串一致）：

| 目标字段 | `security=reality` | `security=tls` |
|---|---|---|
| `servername` | `realitySettings.serverName` 非空 → `tlsSettings.serverName` 非空 → 补偿阶段写 `''` | `tlsSettings.serverName` 非空 → 补偿阶段写 `''` |
| `client-fingerprint` | `realitySettings.fingerprint` 非空 → `tlsSettings.fingerprint` 非空 → 补偿阶段写 `'chrome'` | `tlsSettings.fingerprint` 非空 → 补偿阶段写 `'chrome'` |
| `alpn` | 恒为 `[]`（Xray 对 REALITY 强制 H2，同时避免继承上行 `[h3]`） | `tlsSettings.alpn` → 补偿阶段写 `[]` |

说明：

- 冲突时 `realitySettings` 优先，绝不反向。
- 回退到 `tlsSettings` 是兼容性扩展，不是 Xray 语义：Xray 在 REALITY 下完全忽略 `tlsSettings`。该级回退只在 `realitySettings` 对应项缺失或为空时生效，用于兼容把指纹/SNI 只写进 `tlsSettings` 的非规范分享链接；若严格照搬 Xray，此时 SNI 会退化为目标地址、指纹退化为 Chrome。如果实现评审倾向 strict，可以删掉这一级回退，其余规则不变。
- `publicKey` / `shortId` 同理只从 `realitySettings` 取，不读 `tlsSettings`。
- mihomo 的 `support-x25519mlkem768` 在 Xray 侧没有对应字段，下行按上行 URL 的既有策略处理（默认不写入），不在本表内。

### 实现位置取舍：为什么新建模块而不是继续内联

PR #451 的内联实现是当时范围内的正确选择：只有 5 个字段、只有 URL → Clash 一个方向、只有 `parseVlessUrl` 一个调用点，内联的 diff 最小、语义最直接。

本次需求已经变成约 20 个字段 × 双向 × 两个文件：

- 继续内联会让 `parseVlessUrl`（`url-to-clash.js:113-337`）再增约 200 行，把 URL 解析、xhttp 字段映射、嵌套 `xmux`/`downloadSettings` 三件事混在一个函数里。
- 反向序列化必须落在 `clash-to-url.js`。若不抽模块，只能把同一张映射表复制一份到另一个文件，后续 mihomo 加字段时两边极易漂移。
- 抽成纯函数后，字段表只有一份，单元测试可以直接断言输入/输出对象，不必为每个字段构造完整分享链接；调用点各自只增加几行。
- 这不是结构性重构：新文件放在既有的 `functions/utils/` 下，只导出两个纯函数，无新依赖、无数据流变化、不影响其他生成器；上游 PR #451 的内联段本身是连续区块，可整体替换，review 时按字段表逐行核对即可。

因此“最小化改动”在这里按“最小语义变更与最小影响面”理解，而不是“最少文件数”：新增一个职责单一的模块，比在一个 1600 行、承载多协议的转换器里继续堆字段更符合仓库现状与最佳实践。只有当字段集很小且永远只需要单向映射时（即 #451 的情形），内联才更优。

### mihomo 承载边界（必须在实现时遵守）

mihomo 的 `XHTTPDownloadSettings`（`adapter/outbound/vless.go:130-153`）只提供：

- xhttp 部分：`path`、`host`、`headers`、`reuse-settings`；
- proxy 部分：`server`、`port`、`tls`、`alpn`、`ech-opts`、`shadow-tls-opts`、`restls-opts`、`jls-opts`、`reality-opts`、`skip-cert-verify`、`name-cert-verify`、`fingerprint`、`certificate`、`private-key`、`servername`、`client-fingerprint`。

因此 `downloadSettings.xhttpSettings.extra` 中除 `xmux` 外的字段没有对应 schema，本 spec 明确不映射：

- padding、`sessionIDPlacement`/`sessionIDKey`、`seqPlacement`/`seqKey`、`uplinkDataPlacement`/`uplinkDataKey`：协议要求上下行一致，mihomo 的下行会继承上行配置，正是所需行为。
- `sessionIDTable`、`sessionIDLength`、`uplinkChunkSize`、`uplinkHTTPMethod`、`noGRPCHeader`、`scMinPostsIntervalMs`：客户端上行字段，与下行无关。
- 服务端字段（`serverMaxHeaderBytes`、`scStreamUpServerSecs`、`scMaxBufferedPosts`、`noSSEHeader`）：分享链接的客户端配置本就不应出现，忽略。

同时忽略：`downloadSettings.method`（必须为 `xhttp`）、`sockopt`、`finalmask`（mihomo 当前无对应配置项，留待后续需要时另开 spec）。

## 反向序列化规则

- `path`/`host`/`mode` 不属于 `extra`，不输出。
- `session-placement`/`session-key`/`session-length` 输出 Xray 规范名 `sessionIDPlacement`/`sessionIDKey`/`sessionIDLength`。
- `no-grpc-header` 仅在 `true` 时输出 `noGRPCHeader: true`。
- `headers` 输出时剔除 `Host`（Host 已由 `host` 参数表达，避免往返漂移）。
- `reuse-settings` → `xmux`，数值以十进制字符串输出；`h-keep-alive-period` → `hKeepAlivePeriod` 整数。
- `download-settings` → `downloadSettings`：
  - 仅输出非空/非默认值：`security` 在 REALITY 时为 `reality`，在 `tls === true` 时为 `tls`，`tls === false` 时不输出；`tlsSettings` 的 `serverName`/`fingerprint`/`alpn` 为空时省略；`allowInsecure` 仅 `true` 时输出。
  - `reality-opts.public-key` 为空字符串时**不视为 REALITY**（这是下行继承补偿注入的清除标记，见另一份 spec）。
- 结果为空对象时返回 `null`，调用方不追加 `extra=`。

## 错误处理

- `extra` 查询参数：沿用上游现有做法，`JSON.parse` 失败时 `console.warn` 并继续，节点按 `path`/`host`/`mode` 正常导入。
- `extra` 为合法 JSON 但非对象（数组、字符串、数字、`null`）：视同无 `extra`。
- 字段类型不符（如 `xPaddingBytes` 是数字、`alpn` 不是数组）：跳过该字段，其余字段照常映射。
- 未知字段：不透传，避免污染输出配置。
- 尾逗号等非标准 JSON 容错：本阶段不处理，保持严格 `JSON.parse`（fork 上的宽松解析属于后续可选增强）。

## 测试

新建 `tests/unit/xhttp-extra.test.js`（vitest，`describe`/`it`/`expect`），只覆盖核心流程：

1. 正向全字段：以 packet-up 的完整 `extra`（padding 6 项、session/seq/uplinkData、sessionID 形态、分包节奏、`headers`、`xmux`）为输入，断言输出的 kebab-case 字段齐全且类型正确。
2. `downloadSettings`：`security=tls` + `tlsSettings` + `xhttpSettings.path/host` + `xhttpSettings.extra.xmux` → `download-settings` 的对应字段。
3. 反向序列化：上述代理对象 → `extra`；断言规范名、`xmux` 数值形态、Host 剔除、空结果返回 `null`。
4. URL → Clash 集成：带 `extra` 的 vless+xhttp 链接解析后 `xhttp-opts` 完整；`extra.headers.Host` 不覆盖 URL 的 `host`；非法 JSON 时节点仍可按 `path`/`host`/`mode` 生成；#451 的 5 个 padding 字段行为不变。
5. Clash → URL 集成：`xhttp-opts` 反向生成含 `extra=` 的链接，解码后与输入一致。

不为服务端专属字段、mihomo 无承载能力的字段、类型不符组合写矩阵式测试。

## 验证

- `npx vitest run tests/unit/xhttp-extra.test.js`
- `npm run test:run`
- `npm run format:check`

## 非目标

- 下行继承补偿（独立 spec）。
- `extra` 宽松 JSON 解析（尾逗号纠错）。
- `src/utils/protocols/converters/vless.js` 等前端转换器：当前运行时链路走 `functions/utils/*`，不在本次范围。
- 其他协议、其他生成器、mihomo 内核改动。

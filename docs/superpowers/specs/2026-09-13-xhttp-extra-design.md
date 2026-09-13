# VLESS xHTTP extra 字段支持设计

## 背景与目标

Xray 的 VLESS 分享链接在 `type=xhttp` 时可通过 `extra` 查询参数携带一份 JSON 配置（xPadding 混淆、session/seq 摆放、xmux 复用、downloadSettings 下载分离等）。MiSub 当前的 URL → Clash 中间格式解析（`functions/utils/url-to-clash.js` 的 `parseVlessUrl`）只提取 `path`/`host`/`mode` 三个字段，`extra` 被静默丢弃。

mihomo 自 v1.19.x 起完整支持这些能力（`adapter/outbound/vless.go` 的 `XHTTPOptions`），并在 `common/convert/v.go` 的 `parseXHTTPExtra` 中提供了 Xray camelCase 字段 → mihomo kebab-case 字段的官方映射。因此本项目的 Clash/Mihomo 输出完全有条件透传这些配置。

目标：按 mihomo 官方映射实现 `extra` 的双向转换，使 vless+xhttp+extra 节点在 MiSub 的 Clash 输出中保留全部调优配置，且 Clash 配置源反向导入（Clash → VLESS URL）时同样不丢失。

## 范围

- **支持完整映射**：基础字段、`xmux` → `reuse-settings`、`downloadSettings` → `download-settings`，与 mihomo `parseXHTTPExtra`（`common/convert/v.go:166-365`）逐字段对齐。
- **完整双向**：
  - 正向：`parseVlessUrl` 解析 `extra` JSON，写入中间对象的 `xhttp-opts`。
  - 反向：`convertClashProxyToUrl`（`functions/utils/clash-to-url.js`）新增 xhttp 分支（当前连 path/host/mode 都会丢失），并把 extra 派生字段逆向序列化回 `extra` JSON。
- **其余生成器不动**：sing-box / Loon / QuanX 的 xhttp 实现没有这些字段，各生成器只读取自己认识的字段，多余字段自然不会外泄；base64/v2ray 输出走原始链接透传，天然保留。

## 架构（方案 A：独立映射模块 + 解析期转换）

新建 `functions/utils/xhttp-extra.js`，单向职责的纯函数模块：

- `parseXhttpExtra(extraObj)` — Xray extra JSON 对象 → mihomo `xhttp-opts` 附加字段（kebab-case，含 `reuse-settings`、`download-settings`）。空对象/无有效字段时返回 `{}`。
- `serializeXhttpExtra(xhttpOpts)` — mihomo `xhttp-opts` → Xray extra JSON 对象（camelCase，含 `xmux`、`downloadSettings`）。不含任何 extra 派生字段时返回 `null`。

调用点：

- `functions/utils/url-to-clash.js` `parseVlessUrl` 的 xhttp 分支：`params.get('extra')` 存在且 `JSON.parse` 成功时调用 `parseXhttpExtra`，结果合并进 `xhttp-opts`（path/host/mode 已先写入，二者字段名不冲突）。JSON 解析失败时静默忽略——与 mihomo `v.go:152-157` 行为一致。
- `functions/utils/clash-to-url.js` vless 分支：新增 xhttp 处理，输出 `path`/`host`/`mode` 与 `extra=<encodeURIComponent(JSON)>`。

中间对象上的 extra 派生字段随现有透传机制自动进入最终 Clash YAML（`builtin-clash-generator.js` 只剥离内部 `metadata` 字段），Clash 生成器无需改动。

## 字段映射表

### 基础字段（extra → xhttp-opts）

| Xray extra | mihomo xhttp-opts | 类型 |
|---|---|---|
| noGRPCHeader（仅 true） | no-grpc-header | bool |
| xPaddingBytes | x-padding-bytes | string |
| xPaddingObfsMode | x-padding-obfs-mode | bool |
| xPaddingKey / xPaddingHeader / xPaddingPlacement / xPaddingMethod | x-padding-key / x-padding-header / x-padding-placement / x-padding-method | string |
| uplinkHTTPMethod | uplink-http-method | string |
| sessionIDPlacement（回退 sessionPlacement） | session-placement | string |
| sessionIDKey（回退 sessionKey） | session-key | string |
| sessionIDTable | session-table | string |
| sessionIDLength | session-length | string 或数字（数字转十进制字符串） |
| seqPlacement / seqKey | seq-placement / seq-key | string |
| uplinkDataPlacement / uplinkDataKey | uplink-data-placement / uplink-data-key | string |
| uplinkChunkSize | uplink-chunk-size | number → int |
| scMaxEachPostBytes | sc-max-each-post-bytes | number → int |
| scMinPostsIntervalMs | sc-min-posts-interval-ms | number → int |

反向序列化时，`session-placement`/`session-key`/`session-length` 输出 Xray 规范名 `sessionIDPlacement`/`sessionIDKey`/`sessionIDLength`；`no-grpc-header` 仅在 true 时输出 `noGRPCHeader: true`。

### xmux → reuse-settings

| xmux | reuse-settings | 类型 |
|---|---|---|
| maxConnections / maxConcurrency / cMaxReuseTimes / hMaxRequestTimes / hMaxReusableSecs | max-connections / max-concurrency / c-max-reuse-times / h-max-request-times / h-max-reusable-secs | string；数字格式化为十进制字符串，空串跳过 |
| hKeepAlivePeriod | h-keep-alive-period | number → int |

### downloadSettings → download-settings

| downloadSettings | download-settings | 说明 |
|---|---|---|
| address | server | |
| port | port | int |
| security 为 tls/reality 时 | tls: true | |
| tlsSettings.serverName | servername | |
| tlsSettings.fingerprint | client-fingerprint | |
| tlsSettings.alpn[] | alpn | |
| tlsSettings.allowInsecure（仅 true） | skip-cert-verify: true | |
| security=reality 时 realitySettings.publicKey / shortId | reality-opts.public-key / reality-opts.short-id | |
| xhttpSettings.path / host / headers | path / host / headers | |
| xhttpSettings.extra.xmux | reuse-settings | 同上 xmux 映射 |

反向序列化：`server` → `address`；`reality-opts` 存在时 `security: "reality"`，否则 `tls: true` + `security: "tls"`；`servername` → `tlsSettings.serverName`，`client-fingerprint` → `tlsSettings.fingerprint`，`alpn` → `tlsSettings.alpn`，`skip-cert-verify` → `tlsSettings.allowInsecure`。

## 错误处理

- `extra` 查询参数非合法 JSON：静默忽略，节点仍按 path/host/mode 正常导入（对齐 mihomo 行为）。
- `extra` 为合法 JSON 但非对象（如数组、字符串）：视同解析失败，静默忽略。
- 未知字段：不透传（对齐 mihomo，避免污染输出配置）。
- 类型不符（如 xPaddingBytes 是数字）：跳过该字段（对齐 mihomo 的类型断言失败即跳过）。

## 测试

新文件 `tests/unit/xhttp-extra.test.js`（vitest，仓库现有 `node:test` 风格 describe/it/expect）：

1. 模块单测：正向全字段映射（以用户实例为 fixture）、xmux 数字格式化、downloadSettings 映射、类型不符跳过、空结果返回 `{}`。
2. 模块单测：反向序列化（含 reuse-settings → xmux、download-settings → downloadSettings）、无 extra 字段返回 `null`。
3. 集成：`urlToClashProxy` 解析带 extra 的 vless+xhttp 链接 → `xhttp-opts` 含 kebab-case 字段。
4. 集成：`convertClashProxyToUrl` 对 mihomo xhttp-opts → URL 含 path/host/mode 与 `extra=`。
5. 端到端：`generateProxiesOnly`（Clash 生成器）输出包含 x-padding-bytes / reuse-settings 等字段。

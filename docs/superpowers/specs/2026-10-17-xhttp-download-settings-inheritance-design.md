# xHTTP download-settings 的 TLS / REALITY 映射与继承补偿设计（基于上游 4952c16）

> 目标代码基线：imzyb/MiSub `4952c16`（2026-10-14）。
> extra 字段与非安全部分的映射见同目录 `2026-10-17-xhttp-extra-completion-design.md`；本文档负责 `downloadSettings.security` / `tlsSettings` / `realitySettings` 的取值、默认值与下行继承。

## 背景与目标

Xray 的 `downloadSettings` 是一套独立、完整的下行 `streamSettings`：它不继承上行的 TLS、REALITY、ALPN 等配置，缺省值各自按下行自身默认处理（`xray-core/transport/internet/splithttp/dialer.go:357-370`；`downloadSettings.address` 缺失时 `ToMemoryStreamConfig` 不产生 Destination，后续 `*memory2.Destination` 会直接 panic，说明 address 实际必填）。

Xray 的安全配置还有一条关键规则：`security=reality` 时，`realitySettings` 是唯一生效的安全配置。splithttp 拨号闭包先命中 `realityConfig` 并直接调用 `reality.UClient`，`tlsSettings` 构造出的 `tlsConfig` 不参与（`dialer.go:133-140`）；REALITY 的 SNI 与指纹分别来自 `reality.Config.server_name` 与 `Fingerprint`（`reality.go:129-133`），HTTP 版本也被强制为 H2（`dialer.go:82-85`）。`server_name` 为空时回退到目标地址（`reality.go:129-130`），`Fingerprint` 为空时 `tls.GetFingerprint("")` 返回 Chrome（`tls.go:187-191`）。

mihomo 的实现则相反：`adapter/outbound/vless.go` 构造下载侧时，除 `path`/`host`/`headers`/`reuse-settings` 外，缺省字段全部回退到上行值：

```go
// vless.go:725-735，proxy 部分逐项 lo.FromPtrOr(ds.X, v.option.X)
downloadTLS := lo.FromPtrOr(ds.TLS, v.option.TLS)
downloadServerName := lo.FromPtrOr(ds.ServerName, v.option.ServerName)
downloadClientFingerprint := lo.FromPtrOr(ds.ClientFingerprint, v.option.ClientFingerprint)
...
// vless.go:764-770，REALITY 整份继承
downloadRealityCfg := v.realityConfig
if ds.RealityOpts != nil {
    downloadRealityCfg, err = ds.RealityOpts.Parse()
}
```

而 mihomo 的 `XHTTPDownloadSettings` 是扁平结构，REALITY 握手消费的就是 `servername` 与 `client-fingerprint`（`transport/vmess/tls.go:114-116`），没有独立的“reality SNI / reality 指纹”字段；`client-fingerprint` 为空时直接报 `REALITY is based on uTLS, please set a client-fingerprint`（`tls.go:130-132`）。

目标：把 Xray 的安全配置映射到 mihomo 的扁平字段，并显式切断“下行继承上行”，使生成的 mihomo 配置与 Xray 语义一致；不改 mihomo、不改生成器、不影响没有 `download-settings` 的节点。

## 职责边界

两份 spec 按“extra 字段”与“安全字段”分工，不重叠：

- 补全 spec：`extra` 字段、`downloadSettings` 的 `address`/`port`/`xhttpSettings`。
- 本 spec：`downloadSettings.security` / `tlsSettings` / `realitySettings` 到 `tls` / `servername` / `client-fingerprint` / `alpn` / `skip-cert-verify` / `reality-opts` 的映射、生效值默认化、继承切断，以及反向序列化中的安全键。

实现上可以在同一个 `xhttp-extra.js` 模块内完成，但两份文档各自拥有对应的键与规则。

## 安全块选择与字段映射

| downloadSettings | download-settings | 规则 |
|---|---|---|
| `security` 为 `tls` / `reality` | `tls` | 映射层写 `tls: true`；`false` 由补偿步骤补齐 |
| `tlsSettings.serverName` | `servername` | 仅 `security=tls` 时读取 |
| `tlsSettings.fingerprint` | `client-fingerprint` | 仅 `security=tls` 时读取 |
| `tlsSettings.alpn` | `alpn` | 仅 `security=tls` 时读取 |
| `tlsSettings.allowInsecure` | `skip-cert-verify` | 仅 `security=tls` 且为 `true` 时写入 |
| `realitySettings.publicKey` / `shortId` | `reality-opts.public-key` / `reality-opts.short-id` | 仅 `security=reality` 时读取，空值不写 |
| `realitySettings.serverName` | `servername` | 仅 `security=reality` 时读取 |
| `realitySettings.fingerprint` | `client-fingerprint` | 仅 `security=reality` 时读取 |
| 其余 `security`（缺省或 `none`） | 无 | 不读取任何安全字段 |

规则说明：

- `security` 决定读取哪个安全块，不做跨块回退。`security=reality` 下 `tlsSettings` 不参与，这是 Xray 的实际行为，不是取舍。
- `security=tls` 下不读取 `realitySettings`；`security=none` 下两者都不读。
- 空字符串视为未提供（与 mihomo `setStr` 只接受非空串一致），由补偿步骤补默认值。
- 该规则保证同一目标字段只有一个来源；否则 mihomo 的扁平结构会出现两个块竞争同一字段的问题，或者 REALITY 握手落到上行继承的 SNI 上。

## 失败场景

| 场景 | mihomo 继承结果 | 后果 |
|---|---|---|
| 上行 REALITY，下行 `security=tls` | 下行仍持有上行 REALITY 公钥 | 用上行公钥与 CDN 握手，认证失败；ALPN 为 H3 时报 `xhttp HTTP/3 does not support REALITY` |
| 上行 REALITY，下行无 `security` | `tls` 继承 `true` + REALITY 继承 | 同上报错；即使补 `tls: false`，构造期仍先报 `xhttp download-settings: REALITY requires TLS`（`vless.go:791-793`） |
| 上行 TLS，下行无 `security` | 下行 `tls` 继承 `true` | 对明文回源端口发起 TLS 握手，连接失败 |
| 下行 `security=tls` 但未写 `tlsSettings.serverName` | 继承上行 SNI（常见为 REALITY 伪装域名） | CDN 用错证书/回源到错误站点，证书校验失败 |
| 下行 `security=tls` 但未写 `tlsSettings.fingerprint` | 继承上行 `client-fingerprint`（可能为空或别的指纹） | 与 Xray 默认 `chrome` 不一致；上行指纹为空时退化为 Go TLS |
| 下行 `security=tls` 但未写 `tlsSettings.alpn` | 继承上行 `alpn` | 上行 H3、下行被拖入 H3；Xray 此时默认 H2 |
| 下行未写 `tlsSettings.allowInsecure` | 继承上行 `skip-cert-verify: true` | 下行证书校验被静默关闭 |
| 上行 CDN（无指纹），下行 `security=reality` | `client-fingerprint` 继承空串 | REALITY 基于 uTLS，运行时报 `REALITY is based on uTLS, please set a client-fingerprint`（`transport/vmess/tls.go:130-132`）；Xray 缺省为 `chrome` |
| 下行 REALITY 未写 `alpn` | 继承上行 `alpn`（如 `[h3]`） | mihomo 选择 H3 传输后与 REALITY 冲突；Xray 对 REALITY 强制 H2（`dialer.go:82-85`） |
| 下行 REALITY 未写 `realitySettings.serverName` | 继承上行 SNI | 用错误 SNI 发起 REALITY 握手 |

## 生效值与继承补偿

映射完成后，在 `functions/utils/url-to-clash.js` 的 `parseVlessUrl` 中、`proxy['reality-opts']` 已写入之后、`return proxy` 之前，执行一步补偿。实现可以是一个纯函数：

```js
applyDownloadInheritanceGuard(xhttpOpts, { upstreamReality })
```

`upstreamReality` 表示上行是否存在非空 `reality-opts.public-key`；补偿只操作 `xhttpOpts['download-settings']`，不读取原始 `extra`，也不重新判断安全块来源。

记 `ds = xhttpOpts['download-settings']`，`downlinkReality = ds['reality-opts']?.public-key` 为非空字符串（与 mihomo `RealityOptions.Parse()` 一致：空 `public-key` 解析为 `nil`，不构成 REALITY，`adapter/outbound/reality.go:20-46`）。

1. **始终显式 `tls`**
   - 映射层只在 `security=tls`/`reality` 时写入 `tls: true`；本步骤把缺省情况补成 `false`，并统一收敛为布尔值：`ds.tls = ds.tls === true`。

2. **`reality-opts`**
   - `downlinkReality`：保留映射出的真实 `public-key` / `short-id`。
   - 下行声明 `security=reality` 但 `publicKey` 为空：写入 `{ 'public-key': '' }`，并 `console.warn`。避免继承上行公钥后“看似 REALITY、实际用错密钥”。
   - 下行非 REALITY 且上行是 REALITY：写入 `{ 'public-key': '' }`（唯一能关闭 mihomo 继承的方式；`{}` 会触发 structure 解码报错 `has unset fields: public-key`）。
   - 其余情况不写。

3. **下行 TLS 开启时（`ds.tls === true`），逐项显式覆盖**
   - `servername`：沿用映射值（`security=tls` 来自 `tlsSettings.serverName`，`security=reality` 来自 `realitySettings.serverName`）；未给出时写 `''`。空串是有效覆盖：mihomo 的 `lo.FromPtrOr` 取到 `""` 后不再回退上行，TLS 拨号按 download host 处理，与 Xray “serverName 为空时使用目标地址”一致。
   - `client-fingerprint`：沿用映射值（`security=tls` 来自 `tlsSettings.fingerprint`，`security=reality` 来自 `realitySettings.fingerprint`）；未给出时写 `'chrome'`，因为 Xray 两种 security 的缺省指纹都是 Chrome，且 REALITY 下该字段为空会让 mihomo 直接报错。
   - `alpn`：映射层只在 `security=tls` 时写入 `tlsSettings.alpn`；未给出时写 `[]`。长度为 0 时 mihomo 走 H2 分支，等价于 Xray 的默认 H2 以及 REALITY 强制 H2 的行为，同时避免继承上行的 `[h3]`。
   - `skip-cert-verify`：映射层仅在 `security=tls` 且 `allowInsecure === true` 时写入 `true`；未写入时显式写 `false`。

4. **下行 TLS 关闭时**
   - 只写 `tls: false`，以及第 2 条要求的 REALITY 清除标记；不写其他 TLS 字段。

补偿只写 mihomo `XHTTPDownloadSettings` 已经存在的字段（`adapter/outbound/vless.go:130-153`），不引入新 schema。

## 反向序列化（安全字段）

序列化时，`download-settings` 的安全键按以下规则写回 `downloadSettings`：

- `security`：`reality-opts.public-key` 非空时为 `reality`；否则 `tls === true` 时为 `tls`；`tls === false` 或缺失时不输出（Xray 默认 `none`）。
- `reality-opts.public-key` 为空字符串时不视为 REALITY（空 key 本身不是有效 REALITY 配置，同时它是补偿步骤的清除标记）。
- `realitySettings.publicKey` / `shortId`：仅在 REALITY 时输出非空值。
- `tlsSettings.serverName` / `realitySettings.serverName`：`servername` 非空时按 security 写回对应块；空串省略。
- `tlsSettings.fingerprint` / `realitySettings.fingerprint`：`client-fingerprint` 非空且不为 `'chrome'` 时按 security 写回对应块；`'chrome'` 省略（Xray 两种 security 的缺省指纹都是 Chrome，省略语义等价）。
- `tlsSettings.alpn`：`alpn` 非空时输出；空数组省略。
- `tlsSettings.allowInsecure`：`skip-cert-verify === true` 时输出；`false` 省略。

由此保证：`上行 REALITY + 下行 TLS` 的链接经 Clash→URL 往返后仍是 `security=tls`，不会被改写成 `security=reality`；补偿写入的 `''`、`[]`、`false`、`'chrome'`、空 `public-key` 也都不会固化成显式配置。

## 已知未覆盖的继承差异

以下字段在 mihomo 中同样继承上行，但不在本次 TLS 安全字段范围内，记录为后续可选项：

- `download-settings.host` / `path` / `headers`：Xray 下行缺省为 `host → serverName → address`、`path` 为 `/`、无自定义头；mihomo 会继承上行。分享链接通常会显式给出 `host`/`path`，影响面较小；如需彻底对齐，可用 `host: ''`、`path: ''`、`headers: {}` 覆盖，但需先实测 structure 解码与 mihomo `NormalizedPath()` 的交互。
- `ech-opts`：上游 `url-to-clash.js` 目前不解析 VLESS 的 ECH 参数，上行不会产生 `ech-opts`，暂无继承风险。
- `fingerprint`（证书 pin）、`name-cert-verify`、`certificate` / `private-key`（mTLS）：分享链接的 `extra` 无法表达，暂无继承风险。
- `shadow-tls-opts` / `restls-opts` / `jls-opts`：VLESS URL 链路不会产生，暂无继承风险。
- 下行 xhttp 部分的 padding/session/seq 等：mihomo 继承上行是协议要求（两端必须一致），不是缺陷。

## 测试

追加到 `tests/unit/xhttp-extra.test.js`，覆盖映射与补偿的核心分支：

1. 安全块映射：`security=tls` 时读取 `tlsSettings` 的 serverName/fingerprint/alpn/allowInsecure；`security=reality` 时读取 `realitySettings` 的 serverName/fingerprint/publicKey/shortId，且忽略 `tlsSettings`。
2. 上行 REALITY + 下行 `security=tls`：下行 `reality-opts` 被置为空 `public-key`，`tls: true`，TLS 字段按 `tlsSettings` 映射。
3. 上行 REALITY + 下行无 `security`：`tls: false` 且带空 `public-key`（防止构造期 REALITY 报错）。
4. 上行 TLS + 下行 REALITY：`tls: true`、真实 `reality-opts`，缺省 `client-fingerprint: 'chrome'`，`alpn: []` 不继承上行 H3。
5. 上行 REALITY + 下行 TLS 但 `tlsSettings` 为空：显式写入 `servername: ''`、`alpn: []`、`skip-cert-verify: false`、`client-fingerprint: 'chrome'`。
6. 往返：上述节点经 `convertClashProxyToUrl` 后，下行仍为 `security=tls`，且不含空 `realitySettings` 或空 `tlsSettings` 字段。

## 验证

- `npx vitest run tests/unit/xhttp-extra.test.js`
- `npm run test:run`
- `npm run format:check`
- 手工校验（一次性）：把生成的 Clash 配置交给 mihomo 做配置加载，确认 `alpn: []`、`servername: ''`、`tls: false`、`reality-opts.public-key: ''` 都能覆盖继承而不是报解码错误。

## 非目标

- extra 字段与非安全下载字段的映射（补全 spec）。
- 修改 mihomo 内核或改变其继承实现。
- `host`/`path`/`headers`、ECH、mTLS 等其他继承差异（见上节）。
- 非 VLESS 协议、无 `download-settings` 的节点、`stream-one` 与 `download-settings` 的非法组合（mihomo 与 Xray 都会直接报错，不做兜底改写）。
- `src/utils/protocols` 前端转换器。

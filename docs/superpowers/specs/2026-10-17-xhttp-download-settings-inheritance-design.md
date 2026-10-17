# xHTTP download-settings 下行继承补偿设计（基于上游 4952c16）

> 目标代码基线：imzyb/MiSub `4952c16`。依赖 `2026-10-17-xhttp-extra-completion-design.md` 提供的 `extra` ↔ `xhttp-opts` 映射；本 spec 只处理 mihomo 对下行配置的继承行为。

## 背景与目标

Xray 的 `downloadSettings` 是一套独立、完整的下行 `streamSettings`：它不继承上行的 TLS、REALITY、ALPN 等配置，缺省值各自按下行自身默认处理（`xray-core/transport/internet/splithttp/dialer.go:357-370`；`downloadSettings.address` 缺失时 `ToMemoryStreamConfig` 不产生 Destination，后续 `*memory2.Destination` 会直接 panic，说明 address 实际必填）。

mihomo 的实现相反：`adapter/outbound/vless.go` 在构造下载侧时，除 `path`/`host`/`headers`/`reuse-settings` 外，**缺省字段全部回退到上行值**：

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
// vless.go:811-814，xhttp 部分复制整份 Config 后只覆盖 host/path/headers/reuse
downloadCfg := *cfg
downloadCfg.Host = ...
downloadCfg.Path = ...
downloadCfg.Headers = ...
```

因此，凡 Xray `extra.downloadSettings` 中未显式给出的值，在 mihomo 里都可能变成上行值；而上行与下行通常走完全不同的入口（REALITY 直连 / CDN、不同 CDN、不同 SNI），这些继承会直接导致拨号失败或静默降级。

当前 fork 上只有一条针对“上行 REALITY + 下行普通 TLS”的空 `public-key` 补偿（`1e0bfe1`），上游没有；本 spec 把补偿范围扩展到全部可在分享链接中表达、且存在继承风险的 TLS 安全字段。

目标：在 `url-to-clash.js` 完成 `extra` 映射后，补一步“下行不继承上行”的显式覆盖，使生成的 mihomo 配置与 Xray 语义一致；不改 mihomo、不改生成器、不影响没有 `download-settings` 的节点。

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

## 设计

在 `functions/utils/xhttp-extra.js` 增加一个纯函数：

```js
applyDownloadInheritanceGuard(xhttpOpts, { upstreamReality })
```

- `xhttpOpts` 为 `parseVlessUrl` 合并 `extra` 后的对象；`upstreamReality` 表示上行是否存在非空 `reality-opts.public-key`。
- 仅当存在 `xhttpOpts['download-settings']` 时操作；否则直接返回原对象。
- 调用点：`functions/utils/url-to-clash.js` `parseVlessUrl`，在该分支已写入 `proxy['reality-opts']` 之后、`return proxy` 之前。

### 下行 REALITY 判定

以 `download-settings.reality-opts.public-key` 是否非空为准，与 mihomo `RealityOptions.Parse()`（`adapter/outbound/reality.go:20-46`）一致：空 `public-key` 解析为 `nil`，不构成 REALITY。

### 补偿矩阵

记 `ds = xhttpOpts['download-settings']`，`downlinkReality = ds['reality-opts']?.public-key` 为非空字符串。

1. **始终显式 `tls`**
   - `ds.tls = ds.tls === true`（写成布尔，而不是留给继承）。
   - 下行 `security` 不是 `tls`/`reality` 时为 `false`。

2. **`reality-opts`**
   - `downlinkReality`：保留映射出的真实 `public-key` / `short-id`。
   - 下行声明 `security=reality` 但 `publicKey` 为空：写入 `{ 'public-key': '' }`，并 `console.warn`。避免继承上行公钥后“看似 REALITY、实际用错密钥”。
   - 下行非 REALITY 且上行是 REALITY：写入 `{ 'public-key': '' }`（唯一能关闭 mihomo 继承的方式；`{}` 会触发 structure 解码报错 `has unset fields: public-key`）。
   - 其余情况不写。

3. **下行 TLS 开启时（`ds.tls === true`），逐项显式覆盖**
   - `servername`：`tlsSettings.serverName`（REALITY 时优先 `realitySettings.serverName`）；未给出时写 `''`。空串是有效覆盖：mihomo 的 `lo.FromPtrOr` 取到 `""` 后不再回退上行，TLS 拨号按 download host 处理，与 Xray “serverName 为空时使用目标地址”一致。
   - `client-fingerprint`：非 REALITY 时取 `tlsSettings.fingerprint`，REALITY 时取 `realitySettings.fingerprint`；未给出时写 `'chrome'`。Xray 的 `tls.GetFingerprint("")` 默认就是 Chrome，REALITY 客户端也要求非空指纹。
   - `alpn`：取 `tlsSettings.alpn`；未给出时写 `[]`。长度为 0 时 mihomo 走 H2 分支，等价于 Xray 的默认 H2；REALITY 下由此避免继承上行的 `[h3]`。
   - `skip-cert-verify`：`tlsSettings.allowInsecure === true`，否则显式 `false`。

4. **下行 TLS 关闭时**
   - 只写 `tls: false`，以及第 2 条要求的 REALITY 清除标记；不写其他 TLS 字段。

补偿只写 mihomo `XHTTPDownloadSettings` 已经存在的字段（`adapter/outbound/vless.go:130-153`），不引入新 schema。

## 反向序列化配合

`serializeXhttpExtra` 需要识别补偿产生的“显式空值”，避免往返后把默认值固化成新配置：

- `reality-opts.public-key` 为空 → 不视为 REALITY；`tls === true` 时 `security: 'tls'`，否则不写 `security`（Xray 默认 `none`）。
- `servername === ''`、`alpn` 为空数组、`skip-cert-verify === false`：省略对应 `tlsSettings` 字段。
- `client-fingerprint === 'chrome'`：省略（Xray TLS/REALITY 的缺省指纹即 `chrome`，省略语义等价）。
- `client-fingerprint` 为其它非空值：REALITY 写入 `realitySettings.fingerprint`，普通 TLS 写入 `tlsSettings.fingerprint`。
- `realitySettings.serverName`：从 `servername` 回填；普通 TLS 写入 `tlsSettings.serverName`。

由此保证：`上行 REALITY + 下行 TLS` 的链接经 Clash→URL 往返后仍是 `security=tls`，不会被改写成 `security=reality`。

## 已知未覆盖的继承差异（本 spec 不做）

以下字段在 mihomo 中同样继承上行，但不在本次“TLS 安全字段”范围内，记录为后续可选项：

- `download-settings.host` / `path` / `headers`：Xray 下行缺省为 `host → serverName → address`、`path` 为 `/`、无自定义头；mihomo 会继承上行。分享链接通常会显式给出 `host`/`path`，影响面较小；如需彻底对齐，可用 `host: ''`、`path: ''`、`headers: {}` 覆盖，但需先实测 structure 解码与 mihomo `NormalizedPath()` 的交互。
- `ech-opts`：上游 `url-to-clash.js` 目前不解析 VLESS 的 ECH 参数，上行不会产生 `ech-opts`，暂无继承风险。
- `fingerprint`（证书 pin）、`name-cert-verify`、`certificate` / `private-key`（mTLS）：分享链接的 `extra` 无法表达，暂无继承风险。
- `shadow-tls-opts` / `restls-opts` / `jls-opts`：VLESS URL 链路不会产生，暂无继承风险。
- 下行 xhttp 部分的 padding/session/seq 等：mihomo 继承上行是协议要求（两端必须一致），不是缺陷。

## 测试

追加到 `tests/unit/xhttp-extra.test.js`，只覆盖会真实导致拨号失败的分支：

1. 上行 REALITY + 下行 `security=tls`（含 serverName/fingerprint/alpn/allowInsecure）：下行 `reality-opts` 被置为空 `public-key`，`tls: true`，各 TLS 字段按 extra 映射。
2. 上行 REALITY + 下行无 `security`：`tls: false` 且带空 `public-key`（防止构造期 REALITY 报错）。
3. 上行 TLS + 下行 REALITY（`realitySettings` 含 serverName/fingerprint/publicKey）：`tls: true`、真实 `reality-opts`，`client-fingerprint` 缺省为 `chrome`，`alpn: []` 不继承上行 H3。
4. 上行 REALITY + 下行 TLS 但 `tlsSettings` 为空：显式写入 `servername: ''`、`alpn: []`、`skip-cert-verify: false`、`client-fingerprint: 'chrome'`。
5. 往返：上述节点经 `convertClashProxyToUrl` 后，下行仍为 `security=tls`，且不含空 `realitySettings` 或空 `tlsSettings` 字段。

## 验证

- `npx vitest run tests/unit/xhttp-extra.test.js`
- `npm run test:run`
- `npm run format:check`
- 手工校验（一次性）：把生成的 Clash 配置交给 mihomo 做配置加载，确认 `alpn: []`、`servername: ''`、`tls: false`、`reality-opts.public-key: ''` 都能覆盖继承而不是报解码错误。

## 非目标

- 修改 mihomo 内核或改变其继承实现。
- `host`/`path`/`headers`、ECH、mTLS 等其他继承差异（见上节）。
- 非 VLESS 协议、无 `download-settings` 的节点、`stream-one` 与 `download-settings` 的非法组合（mihomo 与 Xray 都会直接报错，不做兜底改写）。
- `src/utils/protocols` 前端转换器。

# 上游协议字段/转换修复回迁（Stage C）设计

> 分阶段方案 B → A → C 的第三阶段。实现计划见 `docs/superpowers/plans/2026-10-11-stage-c-protocol-field-backport.md`。
> 前序：Stage B `docs/superpowers/specs/2026-10-11-upstream-fix-backport-design.md`（纯 bug/安全修复）、Stage A 凭证槽。

## 背景与目标

当前 fork（BELUGA114）与上游 imzybMiSub 在 `5f60563` 之后分叉，上游分叉后共 173 个提交。本阶段只回迁其中与**协议解析/转换/订阅输出正确性**相关的修复，不引入上游的"带观点新功能"（机场分组、DNS override/private-DNS/geosite、UI/i18n 加固、WireGuard 作为新协议、30 天会话等），也不并上游对订阅主链路的整体重写。

目标：把 9 组在当前 fork 上确有价值、且 fork 确实缺失或只做了一半的上游协议修复，以"逐条手工移植 + 连同往返回归测试一起带入 + 每条一个独立 commit"的方式搬进来；全程不改动与该修复无关的行为。所有缺口已通过本地 fetch 上游 + 两轮子代理逐 commit 对照 fork 现码核验（2026-10-11）。

## 设计原则（沿用 Stage B）

- 逐条手工移植（读上游该 commit 的 diff，在 fork 现码上做等价最小改动），不走 `git cherry-pick`、不加上游 remote（上游对象已在本地 object store，仅作只读参考）。
- 每条修复连同其**往返回归测试**一并带入：订阅内容/URL → clash proxy 对象 → 目标 URL，断言字段存活。符合项目 CLAUDE.md「修复字段丢失 bug 必须补 round-trip 回归测试，并两向都修」的约定。
- 一条修复一个 commit，提交信息沿用项目中文 imperative 风格。
- 不扩大改动面：只改该修复涉及的函数/分支，不顺带重构。
- 冲突文件（两边都改过的）必须先读 fork 现码再移植，用回归测试兜底。

## 关键决策：reality mlkem 采上游「默认开启」语义（用户 2026-10-11 确认）

与 Stage C 其余"纯补缺"不同，mlkem 这条是**有意的行为变更**，经用户确认采用上游 `db5954c` 的默认开启语义，而非 fork 原有的保守语义：

- **解析（url→clash）默认开启**：VLESS/Trojan reality 节点，URL 未显式禁用时，`reality-opts['support-x25519mlkem768']` 置 `true`。
- **显式禁用 = URL 加 `&mlkem=0`**（或 `mlkem=false`），与 fork 原有 `mlkem` token 一致；此时置 `false`（显式存 `false`，不省略，保证往返可还原）。
- **token 覆盖**：解析端识别 `mlkem`（主）、`support-x25519mlkem768`、`sxm`（上游别名）。
- **往返契约（emit 规则）**：`support-x25519mlkem768 === false` 时 clash→url 输出 `mlkem=0`；为 `true`/缺省时**不输出任何 mlkem 参数**（靠解析端默认开启还原）。即"只有禁用才在 URL 上留痕"，与用户心智一致，且 url→clash→url 稳定。
- **影响面**：此后由 URL 解析出的 reality 节点，Mihomo/clash YAML 输出会带 `support-x25519mlkem768: true`，等于默认给所有 reality 节点开 mlkem。用户已接受此代价（新版 Xray-core/3x-ui 服务端兼容，旧版可逐节点 `&mlkem=0` 关闭）。
- **node-parser（Surge/QX）不默认开启**：仅在显式键存在时按值置真/假（对齐上游 node-parser 行为），避免对非 URL 入口过度默认。

## 范围（9 组，按价值排序）

### C1. 裸 IPv6 服务器加方括号（上游 bad1d1e）— 最高价值

- 问题：`functions/utils/clash-to-url.js` 的 ss/trojan/vless/hy2/hysteria/socks5/http/snell/anytls/tuic 分支都用 `${server}:${port}` 直拼，IPv6 字面量服务器会生成 `...@2001:db8::1:443` 这种不可解析 URL；仅 wireguard 分支（`:319-320`）做了加括号。此路径在"吃 Clash 格式机场订阅"时（`node-parser.extractValidNodes`→`convertClashProxyToUrl`）是热路径，故 IPv6 节点每次刷新都在入库时被改坏。
- 移植：抽共享 `formatUriServer(server)`（复用 wireguard 现有逻辑：含 `:` 且不以 `[` 开头则包 `[]`），应用到所有协议分支拼 server 处；wireguard 分支改用该 helper。
- 冲突：中（碰每个协议 return）。测试：`url↔clash` 往返，IPv6 服务器存活且可再解析。

### C2. sing-box 去除非法 udp_relay_mode + 规则 trim（上游 10053b3 + 8ad6a32）

拆为「可直接做」与「须先裁决」两半：

**C2a（可直接做，无争议）**
- sing-box VMess 出站带了无效的 `udp_relay_mode`（`render-singbox.js:69` 的 `udp_relay_mode: proxy['udp-relay-mode'] || 'native'`，builtin 路径本就干净）——VMess 出站无此字段，删除。
- `operator-runner.js:16/24` 规则拆分只 `filter` 不 `trim`，带空格的规则（`" proto:vless "`）匹配不中——两处由 `.filter(x=>x.trim()!=='')` 改为 `.map(x=>x.trim()).filter(Boolean)`。
- 测试：带入上游 `8ad6a32` 的 VMess 模板断言 + `10053b3` 的 operator-runner alternation 断言。
- 冲突：低。VMess 的 `congestion_control` 同属非标但上游未动，保持现状不扩面。

**C2b（搁置，须用户裁决）：sing-box TUIC 的 `udp_relay_mode`**
- 上游 `10053b3` 删除 TUIC 的 `udp_relay_mode`（`builtin-singbox-generator.js:154` 与 `render-singbox.js:203`），理由注释「sing-box TUIC schema has no udp_relay_mode field」。
- **但本 fork 有一条刻意的既有测试与之直接矛盾**：`tests/unit/builtin-singbox-generator.test.js` 的 `'should map TUIC extended parameters documented by sing-box'` 断言 `tuicNode?.udp_relay_mode).toBe('quic')`，测试名明确称该字段「documented by sing-box」。
- 两边对「sing-box TUIC 是否支持 udp_relay_mode」判断相反，属事实分歧而非 fork 缺口。应先核对 sing-box 当前 TUIC schema（官方文档/版本）再决定；在裁决前不盲目删除，否则等于悄悄推翻 fork 既有的有测试保障的行为。本计划将其列为 BLOCKED，不在本阶段默认执行。

### C3. Hysteria2 mport 导入 + hop-interval 双向（上游 4829dde + 510323e）

- 问题：`url-to-clash.js` 的 `parseHysteria2Url`（`:748`）只认 `ports`，不认客户端常见导出字段 `mport`；`hop-interval`（端口跳跃间隔）两向都丢（`clash-to-url.js` hy2 块 `:193` 不输出、parse 不读）。
- 移植：parse 处 `ports = params.get('ports') || params.get('mport')`；两向补 `hop-interval`。
- 冲突：低。测试：hy2 `mport` → `proxy.ports`；`hop-interval` url↔clash 往返。

### C4. anytls 前端转换器 + builtin-loon 分支（上游 168da32 + fbb3b27）

- 问题：前端 `src/utils/protocols/clash.js` switch 无 `anytls` 分支（命中 `default: return null`），缺 `converters/anytls.js`；`builtin-loon-generator.js` 无 anytls 分支（quanx/singbox/surge/egern 已有、后端 clash-to-url 已有）。
- 移植：新增前端 `converters/anytls.js` + `clash.js` 加 `case 'anytls'`（上游原样）；`builtin-loon-generator.js` 在 snell 分支前加 anytls 分支（上游原样，复用 `appendTlsParams`）。
- 冲突：低。测试：前端 anytls 代理→URL 非 null；builtin-loon 输出含 anytls 行。

### C5. Stash 客户端兼容（上游 aa35870）

- 问题：hy2 代理对 Stash 不吐 `auth` 字段（Stash 读 `auth`、Clash/Mihomo 读 `password`），Stash 读不到密码；Stash UA 的 Clash 输出缺 `#SUBSCRIBED <managedConfigUrl>` 头，无法自动更新订阅。
- 移植：hy2 proxy 同时带 `password` 与 `auth`（`auth` 被 Clash/Mihomo 忽略，对非 Stash 中性）；`builtin-clash-generator.js` 在 Stash UA 时于 YAML 前置 `#SUBSCRIBED <url>`。**上游该 commit 捆绑了全仓 prettier 重排，只手取这 ~3 处逻辑 hunk，绝不照搬格式化。**
- 冲突：低（逻辑小）但须先读现码确认序列化不剔除 `auth`、确认 generator 返回点。测试：hy2 输出含 `auth`；Stash UA 输出首行 `#SUBSCRIBED`。

### C6. 前端 vless.js 补 xhttp（上游 8f18021 前端半）

- 问题：前端 `src/utils/protocols/converters/vless.js` 的 network switch 无 `case 'xhttp'`，前端 clash→url 丢 xhttp path/host/mode（后端 `clash-to-url.js:153-161` + `xhttp-extra.js` 已覆盖，无需动）。
- 移植：前端 vless.js switch 加 `case 'xhttp'`，取 `xhttp-opts` 的 path/host/mode。
- 冲突：低。测试：前端带 xhttp-opts 的 vless 代理→URL 含 path/host/mode。

### C7. reality mlkem 往返补全 + Trojan reality（上游 db5954c，采默认开启，见上文决策）

- 现状：fork 仅 `url-to-clash.js:232` 入站 VLESS 一半（且为保守语义）。
- 移植（VLESS）：`parseVlessUrl` reality 块改默认开启（见决策）；`clash-to-url.js` vless reality 块（`:163-171`）+ 前端 `converters/vless.js`（`:117-127`）补 mlkem emit（仅 `false` 时输出 `mlkem=0`）；`node-parser.js`（`:130-137` 后）补 Surge/QX 显式键解析。
- 移植（Trojan reality，fork 现完全缺失）：`parseTrojanUrl`（`:398` 前）加 `security===reality` 分支（含 mlkem 默认开启）；`clash-to-url.js` trojan 分支（`:102-127`）补 reality emit；前端 `converters/trojan.js` reality 判定由 `proxy.reality` 对齐为 `proxy['reality-opts'] || proxy.reality` 并补 mlkem。
- 冲突：中（fork reality 块有 encryption/xhttp download-settings 等自有逻辑在邻近，务必先读现码）。测试：VLESS + Trojan 的 url→clash→url 往返，默认开启、`&mlkem=0` 禁用两种都断言。

### C8. HTTP 代理节点簇（上游 7c1aa70 + 103279e + cda96fb）— 相关性偏低

- 问题：plain `http(s)://user:pass@host:port` 代理节点被整条链路丢弃/误判成订阅——`url-to-clash.js parseHttpsUrl`（`:1161`）硬编码 `type:'https'` 且 dispatcher（`:1413`）无 `http://` 分支；前端 `useBulkImportLogic.js`（`:11` 滤掉 http/https、`:72` 把所有 `http(s)://` 当订阅）；后端 `profile-handler.js:116/127`、`subscription-service.js:364/396`、`REAL_PROXY_PROTOCOLS` 以 `startsWith('http')` 粗判。
- 移植：`parseHttpsUrl(url, isTls=true)` 支持 `http://`→`type:'http'`；dispatcher 加 `http://` 分支；bulk-import 用 `host:port 无路径` 正则区分代理节点与订阅 URL（crux，须对 `createProtocolRegex` 验证）；`REAL_PROXY_PROTOCOLS` 加 http/https/naive；clash-to-url 补 `type==='https'` emit。
- 冲突：中（profile-handler 已分叉）。**本 fork 当前节点全为 vless，相关性低，列为按需。** 测试：http(s) 代理节点往返、bulk-import 分类。

### C9. WireGuard IPv6 本地地址（上游 fc206df + 66e6868；5bc8606 并入）— niche

- 问题：wireguard `address` 解析（`url-to-clash.js:985`）把 IPv6 本地隧道地址塞进 `proxy.ip` 数组、不拆 `proxy.ipv6`、不去 `/CIDR`；emit（`clash-to-url.js:306-309`）从不输出 `proxy.ipv6`。
- 移植：parse 按 `:` 拆 ipv4→`proxy.ip`/ipv6→`proxy.ipv6` 并去 CIDR；emit 合并 ip+ipv6 去重进 `address=`。（上游 `5bc8606` 修的 loon `interface-ipV6` 行 fork 不存在——fork loon wireguard 不输出 ipv6 接口地址；若需 loon 侧 IPv6 一并补，否则该 commit 无可照搬内容。）
- 冲突：低。测试：wireguard IPv6 本地地址 url↔clash 往返。

## 已排除（核验后确认不迁）

- **429b78f（Hiddify 默认返回 sing-box JSON）**：与 fork 刻意的 Hiddify→Clash 兼容层（`builtin-clash-generator.js:143 isHiddifyClient` + `tests/unit/hiddify-clash-compatibility.test.js`）直接冲突，迁入等于推翻该投入。不迁。
- **8f58818（XHTTP extra Padding）**：fork 自有 `functions/utils/xhttp-extra.js` 已双向覆盖上游全部 5 个 xPadding 字段且更多（反而是 fork 该推给上游），无缺口。
- **c48ccd3（可视协议过滤生效）**：fork 用 `proto:` 前缀预设（`SubscriptionEditModal.vue`）已独立实现等价能力，无需迁。
- **上游新功能大类**：机场分组/折叠、DNS override/private-DNS/geosite、UI/i18n/无障碍加固、TG/WebDAV/IP 微调、WireGuard 作为新协议、30 天会话——均"带观点"，与 fork 已分叉的 UI/链路冲突，不在本阶段。

## 验证策略

- 每条修复：先让其往返回归测试在未改实现时失败（确认测试有效），再实现至通过。
- 窄测试先行，顺序即 C1→C9；每条独立 commit。
- 收尾全量：`npm run test:run` + `npm run build`。
- C5/C8 为冲突/低相关项，先读 fork 现码再落点，以回归测试为准，不照抄上游行号。

## 非目标

- 不加上游 remote、不 `git cherry-pick`、不整体 merge 上游。
- 不引入上游新功能或新依赖。
- 不改与上述 9 组修复无关的行为、不顺带重构。
- 不回迁"已排除"四项。

# 上游协议字段/转换修复回迁（Stage C）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 从上游 imzybMiSub 逐条手工移植 9 组协议解析/转换/订阅输出修复，连同往返回归测试一并带入，每条一个独立 commit；reality mlkem 采上游"默认开启、`&mlkem=0` 禁用"语义，其余为纯补缺。

**Architecture:** 不加上游 remote、不 cherry-pick。每条修复：先带入/写其往返回归测试 → 跑测试确认失败 → 按本计划内联代码移植 → 跑测试确认通过 → 提交。设计见 `docs/superpowers/specs/2026-10-11-stage-c-protocol-field-backport-design.md`。

**Tech Stack:** Cloudflare Pages Functions / JavaScript ESM / Vue 3 前端 / Vitest（`npm run test:run`）/ Vite（`npm run build`）。上游仓库在 `E:\Code\TS\imzybMiSub`（只读参考，命令用 `git -C "E:/Code/TS/imzybMiSub" ...`）。测试放 `tests/unit/`，import 形如 `../../functions/...`。

---

## 涉及文件

- `functions/utils/clash-to-url.js` — C1 新增 `formatUriServer` 并应用各协议；C3 hy2 补 `hop-interval`；C7 vless/trojan reality 补 mlkem emit + trojan reality 块；C9 wireguard 补 ipv6；C8 补 `type==='https'`。
- `functions/utils/url-to-clash.js` — C3 `parseHysteria2Url` 补 mport/hop-interval；C7 `parseVlessUrl`/`parseTrojanUrl` reality 默认开启；C8 `parseHttpsUrl`+dispatcher 支持 http；C9 wireguard address 拆 ipv4/ipv6。
- `functions/modules/utils/node-parser.js` — C7 Surge/QX 显式 mlkem 键解析。
- `functions/utils/operator-runner.js` — C2 `normalizeRules` 两处 trim。
- `functions/modules/subscription/builtin-singbox-generator.js` / `template-renderers/render-singbox.js` — C2 删 TUIC/VMess 的 `udp_relay_mode`。
- `functions/modules/subscription/builtin-loon-generator.js` — C4 anytls 分支。
- `functions/modules/subscription/builtin-clash-generator.js` — C5 Stash `#SUBSCRIBED` 头。
- `src/utils/protocols/clash.js` + `src/utils/protocols/converters/anytls.js` — C4 前端 anytls。
- `src/utils/protocols/converters/vless.js` — C6 xhttp case；C7 mlkem emit。
- `src/utils/protocols/converters/trojan.js` — C7 reality 判定对齐 + mlkem emit。
- `src/composables/useBulkImportLogic.js` — C8 http(s) 节点分类。
- `functions/modules/subscription/profile-handler.js` / `functions/services/subscription-service.js` — C8 http(s) 节点 vs 订阅区分。
- 新测试：`tests/unit/` 下按任务新增（见各 Task）。

---

### Task 1: C1 — 裸 IPv6 服务器加方括号（上游 bad1d1e）

**Files:**
- Modify: `functions/utils/clash-to-url.js`（新增 `formatUriServer`；各协议分支 server 拼接改用它）
- Create: `tests/unit/ipv6-server-roundtrip.test.js`

- [ ] **Step 1: 写失败测试**

```javascript
import { describe, it, expect } from 'vitest';
import { convertClashProxyToUrl } from '../../functions/utils/clash-to-url.js';
import { urlToClashProxy } from '../../functions/utils/url-to-clash.js';

describe('IPv6 字面量服务器往返', () => {
    const cases = [
        { type: 'vless', server: '2001:db8::1', port: 443, uuid: '11111111-1111-1111-1111-111111111111', network: 'tcp', tls: true, servername: 'a.com' },
        { type: 'hysteria2', server: '2606:4700::1', port: 8443, password: 'pw' },
        { type: 'ss', server: 'fe80::1', port: 8388, cipher: 'aes-128-gcm', password: 'pw' }
    ];
    for (const proxy of cases) {
        it(`${proxy.type} 的 IPv6 server 加括号且可再解析`, () => {
            const url = convertClashProxyToUrl({ name: 'n', ...proxy });
            expect(url).toContain(`[${proxy.server}]:${proxy.port}`);
            const parsed = urlToClashProxy(url);
            expect(parsed).not.toBeNull();
            expect(parsed.server).toBe(proxy.server);
            expect(parsed.port).toBe(proxy.port);
        });
    }
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm run test:run -- tests/unit/ipv6-server-roundtrip.test.js`
Expected: FAIL —— 现 URL 为 `...@2001:db8::1:443`（无括号），`toContain('[...]')` 不成立，且再解析端口/server 错位。

- [ ] **Step 3: 移植实现**

在 `functions/utils/clash-to-url.js` 顶部（`base64UrlSafeEncode` 之后、`appendHysteria2RealmParams` 之前）新增 helper：

```javascript
// 裸 IPv6 字面量服务器须包方括号，否则 host:port 拼出的 URL 无法解析（与 wireguard 分支原有逻辑一致）。
function formatUriServer(server) {
    const s = String(server ?? '');
    if (s.includes(':') && !s.startsWith('[')) return `[${s}]`;
    return s;
}
```

在 `convertClashProxyToUrl` 内 `if (!server || !port) return null;` 之后新增：

```javascript
        const uriServer = formatUriServer(server);
```

把各协议分支里拼接 server 的 `${server}` 改为 `${uriServer}`：ss（`:32`）、trojan（`:126`）、vless（`:182`）、hysteria2（`:200`）、hysteria（`:212`）、socks5（`:217`）、http（`:222`）、snell（`:238`）、anytls（`:266`）、tuic（`:299`）。wireguard 分支（`:319-320`）删掉自有的 `if (serverAddr.includes(':')...)` 两行，改为 `const serverAddr = formatUriServer(proxy.server);`。ssr 分支（`:51`，server 嵌在 base64 体内，mihomo 侧按原样解析）保持不动。

- [ ] **Step 4: 跑测试确认通过**

Run: `npm run test:run -- tests/unit/ipv6-server-roundtrip.test.js`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add functions/utils/clash-to-url.js tests/unit/ipv6-server-roundtrip.test.js
git commit -m "fix(conversion): 裸 IPv6 服务器输出加方括号，修复各协议 clash→url 往返"
```

### Task 2: C2a — sing-box VMess 去 udp_relay_mode + 规则 trim（上游 8ad6a32 + 10053b3 的无争议部分）

> ⚠️ **C2b（sing-box TUIC 的 `udp_relay_mode`）BLOCKED，不在本任务**：上游 `10053b3` 以「sing-box TUIC schema 无此字段」为由删除 TUIC 的 `udp_relay_mode`，但 fork 既有测试 `tests/unit/builtin-singbox-generator.test.js` 的 `'should map TUIC extended parameters documented by sing-box'` 刻意断言 `tuicNode?.udp_relay_mode).toBe('quic')`，称其「documented by sing-box」。两边事实判断相反，须先核对 sing-box 当前 TUIC schema 再决定，裁决前不动 TUIC。详见 spec C2b。

**Files:**
- Modify: `functions/modules/subscription/template-renderers/render-singbox.js`（删 VMess 的 `udp_relay_mode` 行，约 `:69`）
- Modify: `functions/utils/operator-runner.js`（`normalizeRules` 两处 trim，`:16`/`:24`）
- Modify: `tests/unit/template-pipeline.test.js`、`tests/unit/operator-runner.test.js`（追加上游断言）

- [ ] **Step 1: 追加回归测试（按上游语义，追加不覆盖）**

在 `tests/unit/template-pipeline.test.js` 的 `describe` 内追加：

```javascript
    it('omits Clash-only VMess udp_relay_mode from sing-box template output', () => {
        const rendered = renderSingboxFromIniTemplate(
            '[Proxy Group]\nNode = select, VMessNode\n[Rule]\nMATCH,Node',
            {
                proxies: [{ name: 'VMessNode', type: 'vmess', server: 'vmess.example.com', port: 443, uuid: 'safe-uuid', cipher: 'auto', 'udp-relay-mode': 'native' }],
                targetFormat: 'singbox',
            }
        );
        const parsed = JSON.parse(rendered);
        const vmess = parsed.outbounds.find((outbound) => outbound.tag === 'VMessNode');
        expect(vmess?.udp_relay_mode).toBeUndefined();
    });
```

在 `tests/unit/operator-runner.test.js` 的 `describe('operator runner', ...)` 内追加：

```javascript
    it('applies alternation regex include rules and a separate exclude rule', async () => {
        const urls = [
            'ss://YWVzLTEyOC1nY206cGFzcw@example.com:8388#HK-01',
            'ss://YWVzLTEyOC1nY206cGFzcw@example.com:8389#US-01',
            'ss://YWVzLTEyOC1nY206cGFzcw@example.com:8390#JP-01',
        ];
        const result = await runOperatorChain(urls, [
            { type: 'filter', params: { include: { enabled: true, rules: ['HK|US'] }, exclude: { enabled: true, rules: ['US'] } } },
        ]);
        expect(result).toHaveLength(1);
        expect(decodeURIComponent(result[0])).toContain('#HK-01');
    });
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm run test:run -- tests/unit/template-pipeline.test.js tests/unit/operator-runner.test.js`
Expected: FAIL —— VMess 仍输出 `udp_relay_mode: 'native'`；alternation 规则因未 trim 子项而命中异常（或新用例未通过）。

- [ ] **Step 3: 移植实现**

`functions/modules/subscription/template-renderers/render-singbox.js` 的 VMess outbound 字面量（约 `:69`）删除这一行：

```javascript
            udp_relay_mode: proxy['udp-relay-mode'] || 'native',
```

`functions/utils/operator-runner.js` 的 `normalizeRules`：把 `:16` 的

```javascript
        if (typeof rules === 'string') return rules.split(/\r?\n/).filter(line => line.trim() !== '');
```

改为

```javascript
        if (typeof rules === 'string') return rules.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
```

把 `:24` 的

```javascript
            const parts = rule.split(/\r?\n/).filter(p => p.trim() !== '');
```

改为

```javascript
            const parts = rule.split(/\r?\n/).map(p => p.trim()).filter(Boolean);
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm run test:run -- tests/unit/template-pipeline.test.js tests/unit/operator-runner.test.js`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add functions/modules/subscription/template-renderers/render-singbox.js functions/utils/operator-runner.js tests/unit/template-pipeline.test.js tests/unit/operator-runner.test.js
git commit -m "fix(singbox): VMess 去除无效 udp_relay_mode；operator 规则拆分补 trim"
```

### Task 3: C3 — Hysteria2 mport 导入 + hop-interval 双向（上游 4829dde + 510323e）

**Files:**
- Modify: `functions/utils/url-to-clash.js`（`parseHysteria2Url`，约 `:748`）
- Modify: `functions/utils/clash-to-url.js`（hy2 分支，约 `:193`）
- Create: `tests/unit/hysteria2-ports-roundtrip.test.js`

- [ ] **Step 1: 写失败测试**

```javascript
import { describe, it, expect } from 'vitest';
import { convertClashProxyToUrl } from '../../functions/utils/clash-to-url.js';
import { urlToClashProxy } from '../../functions/utils/url-to-clash.js';

describe('Hysteria2 端口跳跃往返', () => {
    it('mport 作为 ports 的回退被导入', () => {
        const p = urlToClashProxy('hysteria2://pw@h.com:443?mport=1000-2000#n');
        expect(p.ports).toBe('1000-2000');
    });
    it('ports 优先于 mport', () => {
        const p = urlToClashProxy('hysteria2://pw@h.com:443?ports=3000-4000&mport=1000-2000#n');
        expect(p.ports).toBe('3000-4000');
    });
    it('hop-interval 双向存活', () => {
        const url = convertClashProxyToUrl({ name: 'n', type: 'hysteria2', server: 'h.com', port: 443, password: 'pw', ports: '1000-2000', 'hop-interval': 30 });
        expect(url).toContain('hop-interval=30');
        const p = urlToClashProxy(url);
        expect(p['hop-interval']).toBe(30);
        expect(p.ports).toBe('1000-2000');
    });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm run test:run -- tests/unit/hysteria2-ports-roundtrip.test.js`
Expected: FAIL —— 现 parse 不认 `mport`、两向不带 `hop-interval`。

- [ ] **Step 3: 移植实现**

`functions/utils/url-to-clash.js` 的 `parseHysteria2Url`，把 `:748` 的

```javascript
        if (params.get('ports')) proxy.ports = params.get('ports');
```

改为（mport 回退 + hop-interval 读取）：

```javascript
        const portsParam = params.get('ports') || params.get('mport');
        if (portsParam) proxy.ports = portsParam;
        const hopInterval = params.get('hop-interval') || params.get('hop_interval');
        if (hopInterval) {
            const n = parseInt(hopInterval, 10);
            proxy['hop-interval'] = Number.isFinite(n) ? n : hopInterval;
        }
```

`functions/utils/clash-to-url.js` 的 hy2 分支，在 `:193` 的 `if (proxy.ports !== undefined) ...` 之后新增：

```javascript
            if (proxy['hop-interval'] !== undefined) params.push(`hop-interval=${encodeURIComponent(proxy['hop-interval'])}`);
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm run test:run -- tests/unit/hysteria2-ports-roundtrip.test.js`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add functions/utils/url-to-clash.js functions/utils/clash-to-url.js tests/unit/hysteria2-ports-roundtrip.test.js
git commit -m "fix(conversion): Hysteria2 支持 mport 导入与 hop-interval 双向往返"
```

### Task 4: C4 — anytls 前端转换器 + builtin-loon 分支（上游 168da32 + fbb3b27）

**Files:**
- Create: `src/utils/protocols/converters/anytls.js`（上游原样）
- Modify: `src/utils/protocols/clash.js`（import + `case 'anytls'`）
- Modify: `functions/modules/subscription/builtin-loon-generator.js`（snell 分支前加 anytls 分支）
- Create: `tests/unit/anytls-converter-and-loon.test.js`

- [ ] **Step 1: 写失败测试**

```javascript
import { describe, it, expect } from 'vitest';
import { convertClashProxyToUrl } from '../../src/utils/protocols/clash.js';
import { generateBuiltinLoonConfig } from '../../functions/modules/subscription/builtin-loon-generator.js';

describe('anytls 前端转换与 builtin-loon', () => {
    it('前端 clash→url 支持 anytls（不再 return null）', () => {
        const url = convertClashProxyToUrl({ name: 'Any', type: 'anytls', server: 'a.com', port: 443, password: 'pw', sni: 'a.com' });
        expect(url).toBeTruthy();
        expect(url.startsWith('anytls://')).toBe(true);
        expect(url).toContain('sni=a.com');
    });
    it('builtin-loon 输出含 anytls 行', () => {
        const result = generateBuiltinLoonConfig('anytls://pw@a.com:443?sni=a.com#AnyNode');
        expect(result).toContain('= anytls');
        expect(result).toContain('a.com');
    });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm run test:run -- tests/unit/anytls-converter-and-loon.test.js`
Expected: FAIL —— 前端 `clash.js` 命中 `default: return null`（converters/anytls.js 不存在导致 import 报错前先建文件，见 Step 3）；builtin-loon 无 anytls 分支，输出不含 `= anytls`。

- [ ] **Step 3a: 带入前端 anytls 转换器（上游原样）**

```bash
git -C "E:/Code/TS/imzybMiSub" show 168da32:src/utils/protocols/converters/anytls.js > src/utils/protocols/converters/anytls.js
```

该文件与 fork 其余 converter 风格一致（SNI/ALPN/allowInsecure，raw server），无需改动。

- [ ] **Step 3b: `src/utils/protocols/clash.js` 挂接**

在 `import { convertHysteriaToUrl } from './converters/hysteria.js';` 之后加：

```javascript
import { convertAnytlsToUrl } from './converters/anytls.js';
```

在 `switch` 的 `case 'hysteria2': return convertHysteriaToUrl(proxy);` 之后加：

```javascript
        case 'anytls':
            return convertAnytlsToUrl(proxy);
```

- [ ] **Step 3c: `functions/modules/subscription/builtin-loon-generator.js` 加 anytls 分支**

在 wireguard 分支结束、`} else if (type === 'snell') {` 之前插入（上游 fbb3b27 原样）：

```javascript
    } else if (type === 'anytls') {
        parts.push(`${name} = anytls`);
        parts.push(server);
        parts.push(String(port));
        parts.push(loonQuote(proxy.password || ''));
        appendTlsParams(parts, proxy);
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm run test:run -- tests/unit/anytls-converter-and-loon.test.js`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/utils/protocols/converters/anytls.js src/utils/protocols/clash.js functions/modules/subscription/builtin-loon-generator.js tests/unit/anytls-converter-and-loon.test.js
git commit -m "fix(anytls): 前端 clash→url 与 builtin-loon 补齐 anytls 支持"
```

### Task 5: C5 — Stash 客户端兼容（上游 aa35870，仅取逻辑 hunk）

> ⚠️ 上游 `aa35870` 捆绑了全仓 prettier 重排（百余文件），**只手取 hy2 `auth` + `#SUBSCRIBED` 两处逻辑，绝不照搬格式化**。落在 clash 输出层（Stash 被服务 Clash 格式，`user-agent-utils.js:97` 已 `['stash','clash']`），不动 parse，避免 `auth` 外溢到其它格式。

**Files:**
- Modify: `functions/modules/subscription/builtin-clash-generator.js`（`generateBuiltinClashConfig`，hy2 补 `auth`、Stash UA 前置 `#SUBSCRIBED`）
- Create: `tests/unit/stash-clash-compatibility.test.js`

- [ ] **Step 1: 写失败测试**

```javascript
import { describe, it, expect } from 'vitest';
import { generateBuiltinClashConfig } from '../../functions/modules/subscription/builtin-clash-generator.js';

describe('Stash 兼容', () => {
    it('hysteria2 同时输出 password 与 auth', () => {
        const out = generateBuiltinClashConfig('hysteria2://pw@h.com:443?sni=h.com#Hy', { userAgent: 'Stash/2.0' });
        expect(out).toContain('auth: pw');
        expect(out).toContain('password: pw');
    });
    it('Stash UA 首行是 #SUBSCRIBED，非 Stash 不带', () => {
        const stash = generateBuiltinClashConfig('hysteria2://pw@h.com:443#Hy', { userAgent: 'Stash/2.0', managedConfigUrl: 'https://x.com/sub' });
        expect(stash.split('\n')[0]).toBe('#SUBSCRIBED https://x.com/sub');
        const clash = generateBuiltinClashConfig('hysteria2://pw@h.com:443#Hy', { userAgent: 'clash.meta', managedConfigUrl: 'https://x.com/sub' });
        expect(clash.startsWith('#SUBSCRIBED')).toBe(false);
    });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm run test:run -- tests/unit/stash-clash-compatibility.test.js`
Expected: FAIL —— 现 hy2 不输出 `auth`，Stash UA 无 `#SUBSCRIBED` 头。

- [ ] **Step 3a: 先读 fork 现码**

读 `functions/modules/subscription/builtin-clash-generator.js` 的 `generateBuiltinClashConfig`（约 `:132-245`）。已核实：`userAgent` 在 `:139` 解构、`options.managedConfigUrl` 在 `:222` 使用、`let publicProxies = stripInternalProxyFields(proxies);` 在 `:191`（`stripInternalProxyFields` 只删 `metadata`，故 `auth` 可随 yaml.dump 输出）、结尾 `return cleanControlChars(yamlStr);` 在 `:239`。若行号漂移，按下列锚点语义落点。

- [ ] **Step 3b: hy2 双写 auth**

在 `let publicProxies = stripInternalProxyFields(proxies);`（`:191`）之后、`if (levelKey === 'RELAY' ...` 之前插入：

```javascript
        // Stash 读取 hysteria2 的 auth 字段；Clash/Mihomo 读 password 并忽略 auth，双写互不影响。
        publicProxies = publicProxies.map(p => {
            const t = (p.type || '').toLowerCase();
            if ((t === 'hysteria2' || t === 'hy2') && p.password !== undefined && p.auth === undefined) {
                return { ...p, auth: p.password };
            }
            return p;
        });
```

- [ ] **Step 3c: Stash UA 前置 #SUBSCRIBED**

把结尾的 `return cleanControlChars(yamlStr);`（`:239`）替换为：

```javascript
        if (/stash/i.test(userAgent || '') && options.managedConfigUrl) {
            yamlStr = `#SUBSCRIBED ${options.managedConfigUrl}\n${yamlStr}`;
        }
        return cleanControlChars(yamlStr);
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm run test:run -- tests/unit/stash-clash-compatibility.test.js`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add functions/modules/subscription/builtin-clash-generator.js tests/unit/stash-clash-compatibility.test.js
git commit -m "feat(stash): hysteria2 双写 auth 字段并为 Stash UA 加 #SUBSCRIBED 头"
```

### Task 6: C6 — 前端 vless.js 补 xhttp（上游 8f18021 前端半）

**Files:**
- Modify: `src/utils/protocols/converters/vless.js`（network switch 加 `case 'xhttp'`）
- Create: `tests/unit/vless-xhttp-frontend.test.js`

> 后端 `clash-to-url.js:153-161` + `functions/utils/xhttp-extra.js` 已覆盖 xhttp，无需动；本任务仅补前端浏览器预览/导入路径。

- [ ] **Step 1: 写失败测试**

```javascript
import { describe, it, expect } from 'vitest';
import { convertVlessToUrl } from '../../src/utils/protocols/converters/vless.js';

describe('前端 vless xhttp', () => {
    it('xhttp 的 path/host/mode 进入 URL', () => {
        const url = convertVlessToUrl({ name: 'n', type: 'vless', server: 'a.com', port: 443, uuid: '11111111-1111-1111-1111-111111111111', network: 'xhttp', 'xhttp-opts': { path: '/p', host: 'h.com', mode: 'auto' } });
        const qs = new URLSearchParams(url.split('?')[1].split('#')[0]);
        expect(qs.get('type')).toBe('xhttp');
        expect(qs.get('path')).toBe('/p');
        expect(qs.get('host')).toBe('h.com');
        expect(qs.get('mode')).toBe('auto');
    });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm run test:run -- tests/unit/vless-xhttp-frontend.test.js`
Expected: FAIL —— switch 无 `xhttp` 分支，path/host/mode 全缺。

- [ ] **Step 3: 移植实现**

在 `src/utils/protocols/converters/vless.js` 的 network `switch` 中（`case 'splithttp'` 之后、`case 'tcp'` 之前）加：

```javascript
            case 'xhttp':
                if (proxy['xhttp-opts']) {
                    if (proxy['xhttp-opts'].path) params.set('path', proxy['xhttp-opts'].path);
                    if (proxy['xhttp-opts'].host) params.set('host', proxy['xhttp-opts'].host);
                    if (proxy['xhttp-opts'].mode) params.set('mode', proxy['xhttp-opts'].mode);
                }
                break;
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm run test:run -- tests/unit/vless-xhttp-frontend.test.js`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/utils/protocols/converters/vless.js tests/unit/vless-xhttp-frontend.test.js
git commit -m "fix(vless): 前端 clash→url 补 xhttp 的 path/host/mode"
```

### Task 7: C7 — reality mlkem 往返（默认开启）+ Trojan reality（上游 db5954c）

> 采「默认开启、`&mlkem=0` 禁用」语义（用户确认）。往返契约：`support-x25519mlkem768===false` 才在 URL 输出 `mlkem=0`，否则不输出；解析端缺省即开启。node-parser（Surge/QX）只按显式键取值，不默认开启。

**Files:**
- Modify: `functions/utils/url-to-clash.js`（`parseVlessUrl` reality 默认开启；`parseTrojanUrl` 加 reality 分支）
- Modify: `functions/utils/clash-to-url.js`（vless reality 补 mlkem emit；trojan 补整个 reality emit）
- Modify: `functions/modules/utils/node-parser.js`（Surge/QX 显式 mlkem 键）
- Modify: `src/utils/protocols/converters/vless.js`、`src/utils/protocols/converters/trojan.js`
- Create: `tests/unit/reality-mlkem-roundtrip.test.js`

- [ ] **Step 1: 写失败测试**

```javascript
import { describe, it, expect } from 'vitest';
import { convertClashProxyToUrl } from '../../functions/utils/clash-to-url.js';
import { urlToClashProxy } from '../../functions/utils/url-to-clash.js';

const V = '11111111-1111-1111-1111-111111111111';
describe('reality mlkem 往返（默认开启）', () => {
    it('VLESS 未显式禁用 → 默认开启，URL 不留 mlkem 痕', () => {
        const p = urlToClashProxy(`vless://${V}@a.com:443?encryption=none&security=reality&pbk=KEY&sid=01#n`);
        expect(p['reality-opts']['support-x25519mlkem768']).toBe(true);
        const url = convertClashProxyToUrl(p);
        expect(url).not.toContain('mlkem');
        expect(urlToClashProxy(url)['reality-opts']['support-x25519mlkem768']).toBe(true);
    });
    it('VLESS &mlkem=0 → 关闭并往返保留 mlkem=0', () => {
        const p = urlToClashProxy(`vless://${V}@a.com:443?encryption=none&security=reality&pbk=KEY&mlkem=0#n`);
        expect(p['reality-opts']['support-x25519mlkem768']).toBe(false);
        const url = convertClashProxyToUrl(p);
        expect(url).toContain('mlkem=0');
        expect(urlToClashProxy(url)['reality-opts']['support-x25519mlkem768']).toBe(false);
    });
    it('Trojan reality 往返（默认开启）', () => {
        const p = urlToClashProxy('trojan://pw@a.com:443?security=reality&pbk=KEY&sid=01#n');
        expect(p['reality-opts']['public-key']).toBe('KEY');
        expect(p['reality-opts']['support-x25519mlkem768']).toBe(true);
        const url = convertClashProxyToUrl(p);
        expect(url).toContain('security=reality');
        expect(url).toContain('pbk=KEY');
        expect(url).not.toContain('mlkem');
    });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm run test:run -- tests/unit/reality-mlkem-roundtrip.test.js`
Expected: FAIL —— VLESS 现为保守（无 mlkem 时不置真）；clash→url 不吐 mlkem；Trojan 根本无 reality 解析/输出。

- [ ] **Step 3a: `parseVlessUrl` reality 改默认开启（url-to-clash.js:230-236）**

把 reality 块里 `if (Object.keys(realityOpts).length > 0) { ... }` 内的 mlkem 部分（现 `const mlkemFlag ... if (mlkemFlag === '1' ...)` 三行 + 注释）替换为：

```javascript
                // X25519-MLKEM768 抗量子密钥交换默认开启（兼容新版 Xray-core/3x-ui，向下兼容旧版），
                // 仅当 URL 显式 mlkem=0 / false 时关闭；显式存 false 以保证 clash→url 往返可还原。
                const mlkemFlag = params.get('mlkem') ?? params.get('support-x25519mlkem768') ?? params.get('sxm');
                realityOpts['support-x25519mlkem768'] = !(mlkemFlag === '0' || mlkemFlag === 'false');
```

> 保留该块外层 `if (Object.keys(realityOpts).length > 0)` 与 `proxy['reality-opts'] = realityOpts;` 不变。

- [ ] **Step 3b: `clash-to-url.js` vless reality 补 mlkem emit（:168 后）**

在 vless 分支 reality 块里 `if (realityOpts['spider-x']) ...`（`:168`）之后加：

```javascript
                const sxm = realityOpts['support-x25519mlkem768'] ?? realityOpts.support_x25519mlkem768;
                if (sxm === false || sxm === 'false' || sxm === 0 || sxm === '0') params.push('mlkem=0');
```

- [ ] **Step 3c: 前端 `converters/vless.js` 补 mlkem emit（:124-126 后）**

在 `if (proxy['reality-opts'])` 块内 spider-x 之后加：

```javascript
                const sxm = proxy['reality-opts']['support-x25519mlkem768'] ?? proxy['reality-opts'].support_x25519mlkem768;
                if (sxm === false || sxm === 'false' || sxm === 0 || sxm === '0') {
                    params.set('mlkem', '0');
                }
```

- [ ] **Step 3d: `node-parser.js` Surge/QX 显式 mlkem 键（:137 后）**

在 `reality-hex-shortid`/`reality-shortid` 分支（`:134-137`）之后加（只按显式键取值，不默认开启）：

```javascript
                    if (k === 'reality-support-x25519mlkem768' || k === 'support-x25519mlkem768') {
                        proxy['reality-opts'] = proxy['reality-opts'] || {};
                        proxy['reality-opts']['support-x25519mlkem768'] = v === 'true' || v === '1';
                    }
```

- [ ] **Step 3e: `parseTrojanUrl` 加 reality 分支（url-to-clash.js，`:398` 的 dialer-proxy 之前）**

在 `// [重要] dialer-proxy 链式代理` 之前插入：

```javascript
        // Reality 配置（Trojan Reality，默认开启 mlkem，与 VLESS 一致）
        if (params.get('security') === 'reality') {
            proxy.tls = true;
            const realityOpts = {};
            if (params.get('pbk')) realityOpts['public-key'] = params.get('pbk');
            if (params.get('sid')) realityOpts['short-id'] = params.get('sid');
            if (params.get('spx')) realityOpts['spider-x'] = params.get('spx');
            const sxm = params.get('mlkem') ?? params.get('support-x25519mlkem768') ?? params.get('sxm');
            realityOpts['support-x25519mlkem768'] = !(sxm === '0' || sxm === 'false');
            if (Object.keys(realityOpts).length > 0) proxy['reality-opts'] = realityOpts;
        }
```

- [ ] **Step 3f: `clash-to-url.js` trojan 补 reality emit（grpcOpts 块 `:115` 之后、sni `:116` 之前）**

```javascript
            const realityOpts = proxy['reality-opts'];
            if (realityOpts) {
                params.push('security=reality');
                if (realityOpts['public-key']) params.push(`pbk=${encodeURIComponent(realityOpts['public-key'])}`);
                if (realityOpts['short-id']) params.push(`sid=${encodeURIComponent(realityOpts['short-id'])}`);
                if (realityOpts['spider-x']) params.push(`spx=${encodeURIComponent(realityOpts['spider-x'])}`);
                const sxm = realityOpts['support-x25519mlkem768'] ?? realityOpts.support_x25519mlkem768;
                if (sxm === false || sxm === 'false' || sxm === 0 || sxm === '0') params.push('mlkem=0');
            }
```

- [ ] **Step 3g: 前端 `converters/trojan.js` 对齐 reality 判定 + mlkem（:64）**

把 `if (proxy.reality) {`（`:64`）改为 `if (proxy['reality-opts'] || proxy.reality) {`；在该块内 spider-x（`:73-75`）之后加：

```javascript
                const sxm = proxy['reality-opts']['support-x25519mlkem768'] ?? proxy['reality-opts'].support_x25519mlkem768;
                if (sxm === false || sxm === 'false' || sxm === 0 || sxm === '0') {
                    params.set('mlkem', '0');
                }
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm run test:run -- tests/unit/reality-mlkem-roundtrip.test.js`
Expected: PASS

> 顺带回归：`npm run test:run -- tests/unit/protocol-conversion-fixtures.test.js tests/unit/protocolConverter.test.js`，确认 reality 既有用例未因默认开启而破（现有 VLESS reality 用例若断言「无 mlkem 字段」需按新默认同步更新）。

- [ ] **Step 5: 提交**

```bash
git add functions/utils/url-to-clash.js functions/utils/clash-to-url.js functions/modules/utils/node-parser.js src/utils/protocols/converters/vless.js src/utils/protocols/converters/trojan.js tests/unit/reality-mlkem-roundtrip.test.js
git commit -m "feat(reality): mlkem 默认开启(可 &mlkem=0 禁用)并补全 VLESS/Trojan reality 往返"
```

### Task 8: C8 — HTTP(S) 代理节点簇（上游 7c1aa70 + 103279e + cda96fb）— 按需 / 冲突，先读现码

> ⚠️ 相关性低（本 fork 当前节点全为 vless），且 `profile-handler.js`/`subscription-service.js` 已与上游分叉。按 Stage B B4 做法：**先读 fork 现码，按语义落点，以回归测试为准，不照抄上游行号**。http(s) URL 天然歧义（订阅 vs 代理节点），区分的 crux 是「无路径的 host:port」正则，务必对 `createProtocolRegex` 验证。可独立于其余任务择期执行。

**Files（预计）:**
- Modify: `functions/utils/url-to-clash.js`（`parseHttpsUrl` 支持 `http://`；dispatcher 加 `http://` 分支）
- Modify: `functions/utils/clash-to-url.js`（补 `type==='https'` emit）
- Modify: `src/composables/useBulkImportLogic.js`（http(s) 节点不再一律当订阅）
- Modify: `functions/modules/subscription/profile-handler.js`、`functions/services/subscription-service.js`（节点 vs 订阅区分；`REAL_PROXY_PROTOCOLS` 加 http/https/naive）
- Create: `tests/unit/http-proxy-node-roundtrip.test.js`

- [ ] **Step 1: 写失败测试（后端往返最小集）**

```javascript
import { describe, it, expect } from 'vitest';
import { convertClashProxyToUrl } from '../../functions/utils/clash-to-url.js';
import { urlToClashProxy } from '../../functions/utils/url-to-clash.js';

describe('plain HTTP 代理节点往返', () => {
    it('http:// 节点被解析为 type:http 并可回转', () => {
        const p = urlToClashProxy('http://user:pass@h.com:8080#n');
        expect(p).not.toBeNull();
        expect(p.type).toBe('http');
        expect(convertClashProxyToUrl(p).startsWith('http://')).toBe(true);
    });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm run test:run -- tests/unit/http-proxy-node-roundtrip.test.js`
Expected: FAIL —— dispatcher 无 `http://` 分支，`urlToClashProxy` 返回 null。

- [ ] **Step 3a: 先读现码**

读 `url-to-clash.js` 的 `parseHttpsUrl`（`:1161`）与 dispatcher（`:1407-1413` 的 `else if (lowerUrl.startsWith('https://'))`）；读 `useBulkImportLogic.js:11/72`；读 `profile-handler.js:109-140`、`subscription-service.js` 的 `REAL_PROXY_PROTOCOLS`（`:29-42`）与 `:364/396` 的 `startsWith('http')` 判定。

- [ ] **Step 3b: 实现（按语义，锚点可能漂移）**

- `parseHttpsUrl(url, isTls = true)`：`type` 由 `isTls ? 'https' : 'http'`；dispatcher 在 `https://` 分支前加 `else if (lowerUrl.startsWith('http://')) return parseHttpsUrl(url, false);`。
- `clash-to-url.js`：在 `type==='http'`（`:220`）旁补 `type==='https'` 分支（输出 `https://`，带 auth）。
- `useBulkImportLogic.js`：`http(s)://` 行仅当匹配「host:port 无路径」节点正则时按节点处理，否则仍按订阅；`BULK_IMPORT_NODE_PROTOCOLS` 的 http/https 过滤相应放开。
- `profile-handler.js`/`subscription-service.js`：以「无路径」区分 http(s) 代理节点与订阅 URL；`REAL_PROXY_PROTOCOLS` 增补 `http://`/`https://`/`naive+`。

- [ ] **Step 4: 跑测试确认通过 + 补 bulk-import 分类用例**

Run: `npm run test:run -- tests/unit/http-proxy-node-roundtrip.test.js`
Expected: PASS。另对 `useBulkImportLogic` 的「http(s) 节点 vs 订阅」分类补前端用例。

- [ ] **Step 5: 提交**

```bash
git add -A
git commit -m "fix(http): 识别并保留 plain HTTP(S) 代理节点，区分订阅 URL"
```

### Task 9: C9 — WireGuard IPv6 本地地址（上游 fc206df + 66e6868）— niche

> `5bc8606`（loon `interface-ipV6` 大小写）在 fork 无对应行（fork loon wireguard 不输出 ipv6 接口地址），无可照搬内容，故不含；若将来补 loon 侧 IPv6 再议。

**Files:**
- Modify: `functions/utils/url-to-clash.js`（wireguard address 解析，约 `:985-988`）
- Modify: `functions/utils/clash-to-url.js`（wireguard address emit，约 `:306-309`）
- Create: `tests/unit/wireguard-ipv6-roundtrip.test.js`

- [ ] **Step 1: 写失败测试**

```javascript
import { describe, it, expect } from 'vitest';
import { convertClashProxyToUrl } from '../../functions/utils/clash-to-url.js';
import { urlToClashProxy } from '../../functions/utils/url-to-clash.js';

describe('WireGuard IPv6 本地地址往返', () => {
    it('address 拆 ip/ipv6 并去 CIDR，双向保留', () => {
        const p = urlToClashProxy('wireguard://cHJpdmtleQ==@h.com:51820?publickey=UFVC&address=10.0.0.2/32,fd00::2/128');
        expect(p.ip).toEqual(['10.0.0.2']);
        expect(p.ipv6).toEqual(['fd00::2']);
        const url = convertClashProxyToUrl(p);
        const addr = new URLSearchParams(url.split('?')[1].split('#')[0]).get('address');
        expect(addr.split(',')).toEqual(['10.0.0.2', 'fd00::2']);
    });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm run test:run -- tests/unit/wireguard-ipv6-roundtrip.test.js`
Expected: FAIL —— 现 parse 把两者塞进 `proxy.ip`、不留 `ipv6`、不去 CIDR；emit 从不输出 ipv6。

- [ ] **Step 3a: parse 拆分（url-to-clash.js:985-988）**

把 `const address = params.get('address'); if (address) { proxy.ip = address.split(',').map(a => a.trim()); }` 替换为：

```javascript
        const address = params.get('address');
        if (address) {
            const addrs = address.split(',').map(a => a.trim().replace(/\/\d+$/, '')).filter(Boolean);
            const v4 = addrs.filter(a => !a.includes(':'));
            const v6 = addrs.filter(a => a.includes(':'));
            if (v4.length) proxy.ip = v4;
            if (v6.length) proxy.ipv6 = v6;
        }
```

- [ ] **Step 3b: emit 合并（clash-to-url.js:306-309）**

把 wireguard 分支里 `if (proxy.ip || proxy['local-address']) { ... params.set('address', addr); }` 替换为：

```javascript
            const v4addr = proxy.ip || proxy['local-address'];
            const addrParts = [];
            if (v4addr) addrParts.push(...(Array.isArray(v4addr) ? v4addr : [v4addr]));
            if (proxy.ipv6) addrParts.push(...(Array.isArray(proxy.ipv6) ? proxy.ipv6 : [proxy.ipv6]));
            if (addrParts.length) params.set('address', [...new Set(addrParts)].join(','));
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm run test:run -- tests/unit/wireguard-ipv6-roundtrip.test.js`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add functions/utils/url-to-clash.js functions/utils/clash-to-url.js tests/unit/wireguard-ipv6-roundtrip.test.js
git commit -m "fix(wireguard): 本地地址拆分 IPv4/IPv6 并去 CIDR，双向保留 ipv6"
```

### Task 10: 全量验证

- [ ] **Step 1: 跑全量测试**

Run: `npm run test:run`
Expected: 全部通过。重点关注本阶段牵动的既有用例：
- Task 7 的默认开启可能触及 `protocol-conversion-fixtures.test.js` / `protocolConverter.test.js` 里既有 reality 断言（若断言「reality 节点无 mlkem 字段」，按新默认同步更新为 `support-x25519mlkem768: true`）。
- Task 1 的 IPv6 加括号可能触及既有 IPv6 相关断言，确认未回退。

- [ ] **Step 2: 构建**

Run: `npm run build`
Expected: 构建成功。

> 本阶段均为协议/转换后端+前端修复，无用户可见文案变化；若 mlkem 默认开启需在用户文档说明，另起 docs 提交，不混入本计划。Task 10 不产生代码提交。

---

## 自查对照（Spec Coverage）

- C1 裸 IPv6 加括号（bad1d1e）：Task 1。✅
- C2a sing-box VMess 去 udp_relay_mode + 规则 trim（8ad6a32 + 10053b3 无争议部分）：Task 2。✅
- C2b sing-box TUIC udp_relay_mode（10053b3 争议部分）：**BLOCKED**，Task 2 顶注说明，不建执行任务，待裁决。✅
- C3 Hysteria2 mport + hop-interval（4829dde + 510323e）：Task 3。✅
- C4 anytls 前端 + builtin-loon（168da32 + fbb3b27）：Task 4。✅
- C5 Stash 兼容（aa35870 逻辑 hunk）：Task 5。✅
- C6 前端 vless xhttp（8f18021 前端半）：Task 6。✅
- C7 reality mlkem 默认开启 + Trojan reality（db5954c）：Task 7。✅
- C8 HTTP(S) 代理节点簇（7c1aa70 + 103279e + cda96fb）：Task 8（读现码/按需）。✅
- C9 WireGuard IPv6 本地地址（fc206df + 66e6868；5bc8606 N/A）：Task 9。✅
- 已排除 429b78f / 8f58818 / c48ccd3：spec「已排除」说明，不建任务。✅

## 风险与注意

- Task 1 改 `clash-to-url.js` 所有协议 server 拼接，是本阶段触面最广处；回归务必跑既有协议转换 fixtures。
- Task 7 是**有意行为变更**（默认开启 mlkem），非纯补缺；既有 reality 断言需同步。往返契约见 spec「关键决策」。
- Task 2b（TUIC）与 Task 8（HTTP 簇）为 BLOCKED/按需，可不随主序执行。
- 全程不加上游 remote、不 cherry-pick（verbatim 文件用 `git -C "E:/Code/TS/imzybMiSub" show` 只读抽取，仅 Task 4 anytls.js 一处）。
- 每条独立 commit，提交信息中文 imperative；冲突文件（Task 5/7/8）先读 fork 现码再落点。











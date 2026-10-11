# 手动节点凭证槽（Stage A）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 手动节点定义一份作为共享模板、各挂一个凭证槽；Profile 用 `credentials:{槽→值}` 按槽覆盖凭证，输出时按协议注入 url；无槽/无覆盖则回落模板自带的基准凭证。向后兼容、不产空凭证、不新建实体。

**Architecture:** 核心是 `functions/utils/node-transformer.js` 新增 `setNodeCredential`（重写 url 的 `@` 前 userinfo，复用私有 `splitUrlParts`）与 `applyCredentialOverride`（按槽取值并调用前者）。两条输出路径各接一行注入：真实订阅输出（`subscription-service.js` 手动节点循环）与公开预览（`profile-handler.js`）。保存链路整对象存储，新字段自动持久化，无需改保存端。前端在手动节点编辑加"凭证槽"输入、ProfileForm 加"凭证"分区。设计见 `docs/superpowers/specs/2026-10-11-manual-node-credential-slot-design.md`。

**Tech Stack:** Cloudflare Pages Functions / Vue 3 / JavaScript ESM / Vitest（`npm run test:run`）/ Vite（`npm run build`）。

---

## 涉及文件

- `functions/utils/node-transformer.js` — 新增并导出 `setNodeCredential`、`applyCredentialOverride`（Task 1）。
- `functions/modules/subscription/main-handler.js` — generationSettings 透传 `credentials`（Task 2）。
- `functions/services/subscription-service.js` — 手动节点循环注入（Task 2）。
- `functions/modules/subscription/profile-handler.js` — 预览路径注入（Task 3）。
- `src/components/modals/ManualNodeEditModal.vue` — 凭证槽输入（Task 5）。
- `src/components/modals/ProfileModal.vue` — 默认对象加 `credentials`（Task 5）。
- `src/components/modals/ProfileModal/ProfileForm.vue` — 凭证分区（Task 6）。
- `src/utils/credentialSlots.js`（新建） — 槽汇总 + 基准凭证提取纯函数（Task 6）。
- 测试：`tests/unit/node-transformer.test.js`、`tests/unit/misub-request-regression.test.js`、新建 `tests/unit/credential-slot.test.js`、`tests/unit/credential-slots-util.test.js`。
- 文档：`docs/data-model.md`（Task 7）。

> 注：recon 发现 `url-to-clash.js:1385` 的 `urlToClashProxy` 无 `hysteria://`(v1) 解析分支（仅 hysteria2/hy2）。本功能的注入是 **url 字符串级**改写，不依赖该解析，故 hysteria v1 凭证注入不受影响；该解析缺口只影响 hysteria v1 的内置 clash 渲染，超出本计划范围。

### Task 1: `setNodeCredential` + `applyCredentialOverride` 工具（后端核心）

**Files:**
- Modify: `functions/utils/node-transformer.js`（在 `setNodeHostPort` 之后新增两个导出函数，复用私有 `splitUrlParts`）
- Test: `tests/unit/node-transformer.test.js`（追加 describe）

- [ ] **Step 1: 写失败测试**

在 `tests/unit/node-transformer.test.js` 顶部补 import（若未导入）：`import { setNodeCredential, applyCredentialOverride } from '../../functions/utils/node-transformer.js';`，并追加：

```javascript
describe('setNodeCredential 按协议改写 @ 前凭证', () => {
  const uuidOf = (url) => url.split('://')[1].split('@')[0];
  it('vless 覆盖 uuid，query 与 #备注 原样', () => {
    const out = setNodeCredential('vless://OLD-UUID@h.example.com:443?type=ws&security=tls#HK-01', 'vless', 'NEW-UUID');
    expect(uuidOf(out)).toBe('NEW-UUID');
    expect(out).toContain('type=ws&security=tls');
    expect(out).toContain('#HK-01');
  });
  it('trojan 覆盖 password', () => {
    expect(uuidOf(setNodeCredential('trojan://oldpass@h:443?sni=a#x', 'trojan', 'newpass'))).toBe('newpass');
  });
  it('hysteria2 覆盖 password', () => {
    expect(uuidOf(setNodeCredential('hysteria2://old@h:443?insecure=1#x', 'hysteria2', 'np'))).toBe('np');
  });
  it('空凭证 / 未知协议 / 无 @ 结构 → 原样返回', () => {
    const u = 'vless://OLD@h:443#x';
    expect(setNodeCredential(u, 'vless', '')).toBe(u);
    expect(setNodeCredential('ss://base64body@h:443#x', 'ss', 'np')).toBe('ss://base64body@h:443#x');
    expect(setNodeCredential('vless://nohostonly', 'vless', 'np')).toBe('vless://nohostonly');
  });
});

describe('applyCredentialOverride 按槽取值注入', () => {
  const url = 'vless://BASE@h:443#x';
  it('有槽且 map 有值 → 覆盖', () => {
    expect(applyCredentialOverride(url, 'vps1', { vps1: 'U1' }).split('@')[0]).toBe('vless://U1');
  });
  it('无槽 / 槽无值 / map 为空 → 原样（回落基准）', () => {
    expect(applyCredentialOverride(url, '', { vps1: 'U1' })).toBe(url);
    expect(applyCredentialOverride(url, 'vps2', { vps1: 'U1' })).toBe(url);
    expect(applyCredentialOverride(url, 'vps1', {})).toBe(url);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm run test:run -- tests/unit/node-transformer.test.js`
Expected: FAIL（两个函数未定义）。

- [ ] **Step 3: 实现**

在 `functions/utils/node-transformer.js` 的 `setNodeHostPort`（约 389-412）之后新增（复用同文件私有 `splitUrlParts`，约 330）：

```javascript
// 凭证在 @ 前的 userinfo（单字段）的协议——本期支持的注入范围。
// vmess(凭证在 base64 JSON)、ss/ssr(内嵌 base64)、tuic(uuid:password 复合) 暂不处理，原样返回。
const CREDENTIAL_USERINFO_PROTOCOLS = new Set(['vless', 'trojan', 'hysteria', 'hysteria2', 'hy2']);

/**
 * 按协议把新凭证写回节点 URL（凭证在 @ 前 userinfo）。
 * 仅处理 vless/trojan/hysteria/hysteria2；其余协议、空凭证、异常或无 userinfo 结构一律返回原 url，绝不产坏节点。
 */
export function setNodeCredential(url, protocol, cred) {
    const text = String(url || '');
    const credential = (cred === undefined || cred === null) ? '' : String(cred).trim();
    if (!text || !credential) return url;
    const proto = String(protocol || text.split('://')[0] || '').toLowerCase();
    if (!CREDENTIAL_USERINFO_PROTOCOLS.has(proto)) return url;
    try {
        const parts = splitUrlParts(text);
        if (!parts) return url;
        const atIndex = parts.authority.lastIndexOf('@');
        if (atIndex === -1) return url; // 无 userinfo，结构异常，保守返回
        const hostport = parts.authority.slice(atIndex + 1);
        // uuid 本就只含 [0-9a-f-]，encodeURIComponent 对其无副作用；password 需编码，统一处理。
        const newAuthority = `${encodeURIComponent(credential)}@${hostport}`;
        return `${parts.scheme}${newAuthority}${parts.query}${parts.hash}`;
    } catch (e) {
        console.warn('[NodeUtils] setNodeCredential failed:', e);
        return url;
    }
}

/**
 * 按"凭证槽"从 Profile 的 credentials 映射取值注入；无槽/无值/映射为空则原样返回（回落基准凭证）。
 */
export function applyCredentialOverride(url, credentialSlot, credentialsMap = {}) {
    const slot = typeof credentialSlot === 'string' ? credentialSlot.trim() : '';
    if (!slot) return url;
    const cred = credentialsMap && typeof credentialsMap === 'object' ? credentialsMap[slot] : '';
    if (cred === undefined || cred === null || String(cred).trim() === '') return url;
    const proto = (String(url || '').split('://')[0] || '').toLowerCase();
    return setNodeCredential(url, proto, cred);
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm run test:run -- tests/unit/node-transformer.test.js`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add functions/utils/node-transformer.js tests/unit/node-transformer.test.js
git commit -m "feat(nodes): 新增 setNodeCredential/applyCredentialOverride 按协议改写凭证"
```

### Task 2: 真实订阅输出路径接线（main-handler + subscription-service）

**Files:**
- Modify: `functions/modules/subscription/main-handler.js`（generationSettings 透传 credentials，约 663-672）
- Modify: `functions/services/subscription-service.js`（import + 手动节点循环注入，约 310-388）
- Test: `tests/unit/misub-request-regression.test.js`（追加一条 profile 模式用例）

- [ ] **Step 1: 写失败测试**

先读 `tests/unit/misub-request-regression.test.js` 里一条既有的 **profile 模式** 用例，照其构造方式（mock env/storage、seed subscriptions+profiles、发请求、取输出文本）追加一条：

构造：一个手动节点 `{ id:'n1', enabled:true, url:'vless://BASE-UUID@h.example.com:443?type=ws#N1', credentialSlot:'vps1' }`；两个 profile 都 `manualNodes:['n1']`，profileA 不含 credentials、profileB `credentials:{ vps1:'UUID-B' }`。请求各自订阅输出（节点 URL 形态 target，便于断言原始 uuid）。

断言：
```javascript
// profileB 输出里该节点 uuid 被覆盖为 UUID-B
expect(outputB).toContain('vless://UUID-B@h.example.com:443');
expect(outputB).not.toContain('BASE-UUID');
// profileA 未覆盖 → 回落基准
expect(outputA).toContain('vless://BASE-UUID@h.example.com:443');
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm run test:run -- tests/unit/misub-request-regression.test.js`
Expected: FAIL（未接线，profileB 仍输出 BASE-UUID）。

- [ ] **Step 3: 实现**

3a. `functions/modules/subscription/main-handler.js`：读该文件约 640 行取得 `activeProfile`、663-672 构建 `generationSettings` 的位置，在该对象里加一项：
```javascript
            credentials: activeProfile?.credentials || {},
```

3b. `functions/services/subscription-service.js`：
- 顶部 import 处加入 `applyCredentialOverride`（与现有从 `../utils/node-transformer.js` 的 import 合并；若无则新增 `import { applyCredentialOverride } from '../utils/node-transformer.js';`，注意本文件相对路径）。
- 在读取 `profilePrefixSettings` 处（约 310-326）取出：`const profileCredentials = profilePrefixSettings?.credentials || {};`
- 在手动节点循环（约 364-380）里、`fixNodeUrlEncoding(...)` 得到 `processedUrl` 之后（约 369 行之后）、`applyManualNodeName`/`prependNodeName`/`applySubscriptionTransforms` 之前，插入：
```javascript
            // 凭证槽：若该手动节点挂了槽且 Profile 覆盖了该槽，则按协议改写凭证；否则保持基准
            processedUrl = applyCredentialOverride(processedUrl, sub?.credentialSlot, profileCredentials);
```

> 先读实际代码确认变量名（`processedUrl`/`sub`/`profilePrefixSettings` 是 recon 给出的名字）；若不同，按实际名接线，保持"注入在解析成节点、进 operators/前缀之前"的时机不变。

- [ ] **Step 4: 跑测试确认通过**

Run: `npm run test:run -- tests/unit/misub-request-regression.test.js`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add functions/modules/subscription/main-handler.js functions/services/subscription-service.js tests/unit/misub-request-regression.test.js
git commit -m "feat(sub): 订阅输出按 Profile.credentials 的凭证槽覆盖手动节点凭证"
```

### Task 3: 公开预览/统计路径接线（profile-handler）

**Files:**
- Modify: `functions/modules/subscription/profile-handler.js`（import + 手动节点 map 内注入，约 140-159）
- Test: `tests/unit/credential-slot.test.js`（新建）

- [ ] **Step 1: 写失败测试**

新建 `tests/unit/credential-slot.test.js`，用仓库既有的 KV mock 模式（可参照其他测试里的 `createKv`）构造一个最小 env：seed `misub_subscriptions_v1` 含一个 slotted 手动节点、`misub_profiles_v1` 含一个带 credentials 的 profile、`worker_settings_v1` 为 `{}`，调用 `handleProfileMode(request, env, profileId, userAgent)`（`applyTransform` 用默认 false），断言返回的 `nodes` 里该节点 url 已被覆盖：

```javascript
import { describe, it, expect } from 'vitest';
import { handleProfileMode } from '../../functions/modules/subscription/profile-handler.js';
// createKv: 按仓库既有模式实现（get 返回 JSON 字符串，put/delete/list 齐备）

it('预览路径按 Profile.credentials 覆盖手动节点凭证', async () => {
  const kv = createKv({
    misub_subscriptions_v1: JSON.stringify([
      { id:'n1', enabled:true, name:'N1', url:'vless://BASE-UUID@h.example.com:443?type=ws#N1', credentialSlot:'vps1' }
    ]),
    misub_profiles_v1: JSON.stringify([
      { id:'p1', enabled:true, name:'P1', subscriptions:[], manualNodes:['n1'], credentials:{ vps1:'UUID-B' } }
    ]),
    worker_settings_v1: JSON.stringify({})
  });
  const req = new Request('https://example.com/profiles/p1');
  const res = await handleProfileMode(req, { MISUB_KV: kv }, 'p1', 'clash-meta/1.0');
  const urls = (res.nodes || []).map(n => n.url).join('\n');
  expect(urls).toContain('vless://UUID-B@h.example.com:443');
  expect(urls).not.toContain('BASE-UUID');
});
```

> 若 `handleProfileMode` 的返回节点字段名或 KV 读取方式与此不符，按实际结构调整断言取 url 的方式（关键是证明覆盖生效）。

- [ ] **Step 2: 跑测试确认失败**

Run: `npm run test:run -- tests/unit/credential-slot.test.js`
Expected: FAIL（预览未注入，仍是 BASE-UUID）。

- [ ] **Step 3: 实现**

`functions/modules/subscription/profile-handler.js`：
- 顶部 import 加 `applyCredentialOverride`：`import { applyNodeTransformPipeline } from '../../utils/node-transformer.js';` 已存在，改为一并引入 `applyCredentialOverride`（同文件导出）。
- 在手动节点 map（约 140-159）里，`const customName = ...` 之前，对 `node.url` 先注入：
```javascript
    const manualNodeResults = targetManualNodes.map(node => {
        const baseUrl = applyCredentialOverride(node.url, node?.credentialSlot, profile?.credentials || {});
        const customName = typeof node.name === 'string' ? node.name.trim() : '';
        const effectiveUrl = customName ? applyManualNodeName(baseUrl, customName) : baseUrl;
        // ...其余不变（parseNodeInfo(effectiveUrl) 等）
```
把该 map 内后续原本用 `node.url` 的地方都改成基于 `baseUrl`/`effectiveUrl`（原逻辑已用 effectiveUrl，无需额外改）。

- [ ] **Step 4: 跑测试确认通过**

Run: `npm run test:run -- tests/unit/credential-slot.test.js`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add functions/modules/subscription/profile-handler.js tests/unit/credential-slot.test.js
git commit -m "feat(sub): 公开预览路径同样按凭证槽覆盖手动节点凭证"
```

### Task 4: 前端 — 手动节点"凭证槽"输入 + Profile 默认 credentials

**Files:**
- Modify: `src/components/modals/ManualNodeEditModal.vue`（name/group 两栏 grid，约 198-248）
- Modify: `src/components/modals/ProfileModal.vue`（新建默认对象约 227-243；编辑态补默认约 222 附近）

- [ ] **Step 1: 加凭证槽输入（ManualNodeEditModal）**

在 name/group 的 grid 区（约 198-248）内新增一个输入项（与现有项同样式）：
```html
<div>
  <label class="...与相邻 label 同类...">凭证槽（可选）</label>
  <input v-model="editingNode.credentialSlot" type="text" placeholder="如 vps1，留空则不参与凭证覆盖"
         class="...与相邻 input 同类..." />
</div>
```
`editingNode` 是 `props.editingNode`，整对象双向绑定、保存时随 `emit('confirm')` 上抛（recon 确认 `useManualNodes` 整对象回写、无字段白名单）。沿用该文件既有的 label/input class，不要自造样式。

- [ ] **Step 2: Profile 默认带 credentials（ProfileModal）**

- 新建默认 profile 对象（约 227-243）加一项：`credentials: {},`
- 编辑既有 profile 的分支（约 222 附近，类似 `profileCopy.operators = Array.isArray(...) ? ... : []`）补：
```javascript
      profileCopy.credentials = (profileCopy.credentials && typeof profileCopy.credentials === 'object' && !Array.isArray(profileCopy.credentials)) ? profileCopy.credentials : {};
```

- [ ] **Step 3: 构建验证**

Run: `npm run build`
Expected: 构建成功（模板/绑定无语法错误）。

- [ ] **Step 4: 提交**

```bash
git add src/components/modals/ManualNodeEditModal.vue src/components/modals/ProfileModal.vue
git commit -m "feat(ui): 手动节点加凭证槽输入，Profile 默认带 credentials"
```

### Task 5: 前端 — 凭证汇总纯函数 + ProfileForm "凭证"分区

**Files:**
- Create: `src/utils/credentialSlots.js`（纯函数，可单测）
- Test: `tests/unit/credential-slots-util.test.js`（新建）
- Modify: `src/components/modals/ProfileModal/ProfileForm.vue`（showAdvanced 块末尾，约 378-383 之后）

- [ ] **Step 1: 写纯函数失败测试**

新建 `tests/unit/credential-slots-util.test.js`：
```javascript
import { describe, it, expect } from 'vitest';
import { extractCredentialFromUrl, collectUsedSlots } from '../../src/utils/credentialSlots.js';

describe('extractCredentialFromUrl', () => {
  it('取 vless/trojan 的 @ 前凭证，未知协议返回空', () => {
    expect(extractCredentialFromUrl('vless://U1@h:443?x=1#n')).toBe('U1');
    expect(extractCredentialFromUrl('trojan://p%40ss@h:443#n')).toBe('p@ss');
    expect(extractCredentialFromUrl('ss://body@h:443')).toBe('');
    expect(extractCredentialFromUrl('')).toBe('');
  });
});

describe('collectUsedSlots', () => {
  const nodes = [
    { id:'a', url:'vless://UA@h1:443#a', credentialSlot:'vps1' },
    { id:'b', url:'vless://UB@h2:443#b', credentialSlot:'vps2' },
    { id:'c', url:'vless://UC@h1:443#c', credentialSlot:'vps1' },
    { id:'d', url:'vless://UD@h3:443#d' }
  ];
  it('按槽去重、忽略无槽节点、带基准', () => {
    const slots = collectUsedSlots(['a','b','c','d'], nodes);
    expect(slots.map(s => s.slot).sort()).toEqual(['vps1','vps2']);
    expect(slots.find(s => s.slot==='vps1').baseline).toBe('UA'); // 首个命中
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm run test:run -- tests/unit/credential-slots-util.test.js`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现纯函数**

新建 `src/utils/credentialSlots.js`：
```javascript
const USERINFO_PROTOS = new Set(['vless', 'trojan', 'hysteria', 'hysteria2', 'hy2']);

/** 从节点 URL 的 @ 前 userinfo 取基准凭证；仅支持 userinfo 协议，其余/异常返回空串。 */
export function extractCredentialFromUrl(url) {
    const text = String(url || '');
    const proto = (text.split('://')[0] || '').toLowerCase();
    if (!USERINFO_PROTOS.has(proto)) return '';
    try {
        const afterScheme = text.slice(text.indexOf('://') + 3);
        const authority = afterScheme.split(/[?#]/)[0];
        const at = authority.lastIndexOf('@');
        if (at === -1) return '';
        return decodeURIComponent(authority.slice(0, at));
    } catch {
        return '';
    }
}

/** 汇总一个 Profile 选中的手动节点用到的凭证槽（按槽去重，带首个命中的基准凭证）。 */
export function collectUsedSlots(manualNodeIds = [], allManualNodes = []) {
    const byId = new Map((allManualNodes || []).map(n => [n.id, n]));
    const slots = new Map();
    for (const id of (manualNodeIds || [])) {
        const node = byId.get(id);
        const slot = node && typeof node.credentialSlot === 'string' ? node.credentialSlot.trim() : '';
        if (!slot || slots.has(slot)) continue;
        slots.set(slot, { slot, baseline: extractCredentialFromUrl(node.url) });
    }
    return Array.from(slots.values());
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm run test:run -- tests/unit/credential-slots-util.test.js`
Expected: PASS

- [ ] **Step 5: ProfileForm 加"凭证"分区**

在 `src/components/modals/ProfileModal/ProfileForm.vue` 的 `showAdvanced` 块末尾（OperatorChain 约 378-381 之后）新增分区。script 里：
```javascript
import { collectUsedSlots } from '@/utils/credentialSlots.js';
const usedSlots = computed(() => collectUsedSlots(localProfile.value?.manualNodes || [], props.allManualNodes || []));
function ensureCred() { if (!localProfile.value.credentials || typeof localProfile.value.credentials !== 'object') localProfile.value.credentials = {}; }
function fillFromBaseline() { ensureCred(); for (const s of usedSlots.value) { if (!localProfile.value.credentials[s.slot]) localProfile.value.credentials[s.slot] = s.baseline; } }
```
template（沿用本文件既有 label/input class）：
```html
<div v-if="usedSlots.length" class="...区块容器类...">
  <div class="flex items-center justify-between">
    <label class="...">凭证（按槽覆盖手动节点凭证）</label>
    <button type="button" @click="fillFromBaseline" class="...次要按钮类...">用基准填充</button>
  </div>
  <div v-for="s in usedSlots" :key="s.slot" class="...">
    <label class="...">{{ s.slot }}</label>
    <input :value="localProfile.credentials?.[s.slot] || ''"
           @input="e => { ensureCred(); localProfile.credentials[s.slot] = e.target.value; }"
           type="password" :placeholder="s.baseline ? '留空＝用基准：' + '••••' : '留空＝用基准'"
           class="..." />
    <p v-if="!(localProfile.credentials?.[s.slot])" class="text-xs text-amber-500">未覆盖，将使用模板基准凭证</p>
  </div>
</div>
```
> `localProfile`、`props.allManualNodes`、`computed` 按本文件既有写法（recon 指出 `localProfile` 为 ref、`allManualNodes` 为 prop）。class 一律复用本文件现有同类元素，不自造。

- [ ] **Step 6: 构建验证并提交**

Run: `npm run build` → 成功。
```bash
git add src/utils/credentialSlots.js tests/unit/credential-slots-util.test.js src/components/modals/ProfileModal/ProfileForm.vue
git commit -m "feat(ui): ProfileForm 新增凭证分区，按槽覆盖并可用基准一键填充"
```

### Task 6: 持久化守卫测试 + 文档 + 全量验证

**Files:**
- Test: `tests/unit/credential-slot.test.js`（追加一条持久化守卫）
- Modify: `docs/data-model.md`

- [ ] **Step 1: 持久化守卫测试（应在不改保存端的情况下通过）**

recon 已确认保存链路整对象存储、仅剔除运行时字段 `isUpdating`，故新字段本应自动持久化。追加一条守卫，锁定这一点、防止将来有人给保存端加字段白名单：挑最便宜的 seam（后端 `handleMisubsSave` + mock storage，或存储适配器 put/get 往返），断言一个带 `credentials` 的 Profile 与一个带 `credentialSlot` 的手动节点经"保存→读取"后两字段仍在。

Run: `npm run test:run -- tests/unit/credential-slot.test.js`
Expected: PASS（无需改实现）。若 FAIL，说明保存端有白名单剔除了未知字段——在该处把 `credentialSlot`/`credentials` 加入保留集。

- [ ] **Step 2: 更新数据模型文档**

在 `docs/data-model.md` 补：
- 第 3 节"订阅源与手动节点模型"手动节点字段加 `credentialSlot`：可选，凭证槽标签；输出时若所属 Profile 的 `credentials` 覆盖了该槽则按协议改写凭证，否则用 url 自带基准凭证。
- 第 4 节"订阅组 Profile 模型"字段加 `credentials`：`{槽→凭证值}`，按槽覆盖手动节点凭证；仅作用于手动节点，机场订阅不参与；空槽回落基准。

- [ ] **Step 3: 全量验证**

Run: `npm run test:run` → 全绿（含本阶段新增用例）。
Run: `npm run build` → 成功。

- [ ] **Step 4: 提交**

```bash
git add tests/unit/credential-slot.test.js docs/data-model.md
git commit -m "test+docs: 凭证槽持久化守卫与数据模型文档"
```

---

## 自查对照（Spec Coverage）

- 数据模型 `credentialSlot`/`credentials`：Task 1（语义）+ Task 4/5（前端录入）+ Task 6（文档/持久化）。✅
- 凭证注入 `setNodeCredential` + 回落基准：Task 1。✅
- 真实输出路径注入：Task 2。✅
- 公开预览路径注入：Task 3。✅
- 永不产空凭证（缺值回落、异常返回原 url）：Task 1（函数兜底）+ Task 2/3（缺值回落）。✅
- 前端：节点凭证槽输入（Task 4）、Profile 凭证分区+未覆盖提示+基准填充（Task 5）。✅
- 处理/输出配置保留 Profile 级覆盖：不改既有字段，天然保留（无任务改动它）。✅
- 机场订阅不参与：注入仅在手动节点循环/手动节点 map 内，不碰 http 订阅路径。✅
- 测试：setNodeCredential 单测（T1）、端到端覆盖/回落（T2/T3）、纯函数（T5）、持久化（T6）。✅
- 非目标（不建实体/不动 token/不做 ss-tuic 复合/不改机场节点/不自动迁移/不强制共享预设）：全程未触及。✅

## 风险与注意

- Task 2/3 需先读实际代码确认变量名（`processedUrl`/`sub`/`profilePrefixSettings`/`activeProfile` 为 recon 给出名），按实际接线、保持注入时机。
- `setNodeCredential` 对 vless 用 encodeURIComponent 对 uuid 无副作用（uuid 仅含 `[0-9a-f-]`），对 trojan/hy2 password 为必要编码，与生成端一致。
- 前端 class 一律复用对应组件现有同类元素，不自造样式；凭证输入用 password 型并打码。
- hysteria v1 的 `urlToClashProxy` 解析缺口不影响本功能（url 字符串级注入），仅内置 clash 渲染相关，超范围。
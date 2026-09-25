# 脚本操作符 DSL 增强实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 扩展订阅组"脚本"操作符的声明式 DSL：统一 `when` 条件、条件 `value` 数组表示 OR、新增 `discard`/`set-field` 动作、可改写 server/port，并把朴素表达式求值器升级为支持括号/取反/算术的手写解析器——全程零 `eval`、不改存量配置与已上线订阅输出。

**Architecture:** DSL 由 `functions/utils/operator-runner.js` 的 `opScript` 分发动作、`functions/utils/expression-dsl.js` 做条件/表达式/模板求值、`functions/utils/node-transformer.js` 提供 URL 回写。一期在这两个文件里增量扩展（零解析器风险）；二期新增 `setNodeHostPort` 并重写表达式求值器。设计见 `docs/superpowers/specs/2026-09-25-script-dsl-enhancement-design.md`。

**Tech Stack:** Cloudflare Pages Functions / JavaScript ESM / Vitest（`npm run test:run`）/ Vite（`npm run build`）。

**约定：** 测试用 vitest（`import { describe, it, expect } from 'vitest'`）。opScript 动作走端到端 `runOperatorChain`（URL 进、URL 出）；表达式与 URL 回写走导出函数单测。每个任务跑定向测试，全程收尾再跑 `npm run test:run` + `npm run build`。

---

## 一期：条件逻辑 + discard + set-field(name/metadata) + 新函数（零解析器风险）

### Task 1: 条件 `value` 为数组时的 OR 语义

**Files:**
- Modify: `functions/utils/expression-dsl.js`（`matchesDslCondition`，约 174-194 行）
- Test: `tests/unit/expression-dsl.test.js`（新建）

- [ ] **Step 1: 写失败测试**

新建 `tests/unit/expression-dsl.test.js`：

```javascript
import { describe, it, expect } from 'vitest';
import { matchesDslCondition } from '../../functions/utils/expression-dsl.js';

describe('matchesDslCondition 数组 value = OR', () => {
  it('regex + 数组命中任意一个', () => {
    const rec = { name: '香港01' };
    expect(matchesDslCondition(rec, { field: 'name', op: 'regex', value: ['香港', 'HK'] })).toBe(true);
    expect(matchesDslCondition(rec, { field: 'name', op: 'regex', value: ['日本', 'JP'] })).toBe(false);
  });
  it('contains + 数组命中任意一个', () => {
    expect(matchesDslCondition({ name: 'Tokyo-Premium' }, { op: 'contains', value: ['Premium', 'IPLC'] })).toBe(true);
  });
  it('not_contains + 数组需全部不命中', () => {
    expect(matchesDslCondition({ name: '过期-01' }, { op: 'not_contains', value: ['过期', 'expire'] })).toBe(false);
    expect(matchesDslCondition({ name: '正常-01' }, { op: 'not_contains', value: ['过期', 'expire'] })).toBe(true);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm run test:run -- tests/unit/expression-dsl.test.js`
Expected: FAIL（`not_contains` 数组与 regex 数组分支未实现，断言不符）

- [ ] **Step 3: 实现**

编辑 `functions/utils/expression-dsl.js`，把 `matchesDslCondition` 的 `switch` 抽成单值匹配 `matchesOp`，并在数组 value 时按 op 正反语义分派：

```javascript
function matchesOp(actual, op, expected, flags) {
    switch (op) {
        case 'eq':
        case 'equals': return String(actual) === String(expected);
        case 'ne':
        case 'not_equals': return String(actual) !== String(expected);
        case 'contains': return String(actual || '').toLowerCase().includes(String(expected || '').toLowerCase());
        case 'not_contains': return !String(actual || '').toLowerCase().includes(String(expected || '').toLowerCase());
        case 'match':
        case 'regex': return safeMatch(actual, expected, flags);
        default: return false;
    }
}

export function matchesDslCondition(record, condition = {}) {
    // 数组条件为 AND 语义：全部满足才算匹配
    if (Array.isArray(condition)) return condition.every(item => matchesDslCondition(record, item));
    if (typeof condition === 'string') return evaluateDslExpression(condition, record);
    if (!condition || typeof condition !== 'object') return true;
    const actual = getField(record, condition.field || 'name');
    const expected = condition.value ?? '';
    const op = String(condition.op || 'contains').toLowerCase();
    const flags = condition.flags || 'i';

    if (op === 'in') return Array.isArray(expected) && expected.map(String).includes(String(actual));

    if (Array.isArray(expected)) {
        // 正向 op：命中任意一个即真（OR）
        if (op === 'eq' || op === 'equals' || op === 'contains' || op === 'match' || op === 'regex') {
            return expected.some(v => matchesOp(actual, op, v, flags));
        }
        // 反向 op：需对所有元素都不命中（AND）
        if (op === 'ne' || op === 'not_equals' || op === 'not_contains') {
            return expected.every(v => matchesOp(actual, op, v, flags));
        }
        return false;
    }

    return matchesOp(actual, op, expected, flags);
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm run test:run -- tests/unit/expression-dsl.test.js`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add functions/utils/expression-dsl.js tests/unit/expression-dsl.test.js
git commit -m "feat(dsl): 条件 value 为数组时支持 OR 命中语义"
```

### Task 2: `filter` 接入 `when` + 新增 `discard` 动作

**Files:**
- Modify: `functions/utils/operator-runner.js`（`opScript` 动作循环，约 257-287 行）
- Test: `tests/unit/operator-runner.test.js`

- [ ] **Step 1: 写失败测试**

在 `tests/unit/operator-runner.test.js` 追加：

```javascript
describe('opScript filter/discard 条件增强', () => {
  const urls = [
    'trojan://p@hk1.example.com:443#HK-01',
    'trojan://p@jp1.example.com:443#JP-01',
    'trojan://p@sg1.example.com:443#SG-过期'
  ];
  it('filter 用 when + 数组只保留香港/日本', async () => {
    const out = await runOperatorChain(urls, [{
      type: 'script',
      params: { dsl: [{ action: 'filter', when: { field: 'name', op: 'regex', value: ['HK', 'JP'] } }] }
    }], { target: 'clash' });
    expect(out).toHaveLength(2);
  });
  it('discard 丢弃名字含"过期"的节点', async () => {
    const out = await runOperatorChain(urls, [{
      type: 'script',
      params: { dsl: [{ action: 'discard', when: { field: 'name', op: 'contains', value: '过期' } }] }
    }], { target: 'clash' });
    expect(out).toHaveLength(2);
    expect(out.join('|')).not.toContain('%E8%BF%87%E6%9C%9F');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm run test:run -- tests/unit/operator-runner.test.js`
Expected: FAIL（`filter` 未读取 `when`；`discard` 未实现，节点数不符）

- [ ] **Step 3: 实现**

编辑 `functions/utils/operator-runner.js` 的 `opScript`，把 `filter` 分支改为优先读 `when`，并新增 `discard` 分支（放在 `filter` 分支之后）：

```javascript
        if (action === 'filter') {
            const cond = step.when !== undefined ? step.when : step;
            result = result.filter((node, index) => matchesDslCondition({ ...node, index: index + 1 }, cond));
            continue;
        }
        if (action === 'discard') {
            // 无 when 的 discard 会清空全部，视为无意义，直接跳过
            if (step.when === undefined) continue;
            result = result.filter((node, index) => !matchesDslCondition({ ...node, index: index + 1 }, step.when));
            continue;
        }
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm run test:run -- tests/unit/operator-runner.test.js`
Expected: PASS（含原有用例）

- [ ] **Step 5: 提交**

```bash
git add functions/utils/operator-runner.js tests/unit/operator-runner.test.js
git commit -m "feat(dsl): filter 支持 when 条件并新增 discard 动作"
```

### Task 3: `rename` 接入 `when`（锚点用例）

**Files:**
- Modify: `functions/utils/operator-runner.js`（`opScript` 的 `rename` 分支，约 263-276 行）
- Test: `tests/unit/operator-runner.test.js`

- [ ] **Step 1: 写失败测试**

追加：

```javascript
describe('opScript rename 条件化', () => {
  const urls = [
    'trojan://p@hk1.example.com:443#HK-01',
    'trojan://p@jp1.example.com:443#JP-01'
  ];
  it('只给命中数组的节点加后缀，其余原样', async () => {
    const out = await runOperatorChain(urls, [{
      type: 'script',
      params: { dsl: [{
        action: 'rename',
        when: { field: 'name', op: 'regex', value: ['HK', '香港'] },
        template: '{name} [专线]'
      }] }
    }], { target: 'clash' });
    const names = out.map(u => decodeURIComponent(u.slice(u.lastIndexOf('#') + 1)));
    expect(names).toContain('HK-01 [专线]');
    expect(names).toContain('JP-01');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm run test:run -- tests/unit/operator-runner.test.js`
Expected: FAIL（`rename` 无视 `when`，JP 节点也被改名）

- [ ] **Step 3: 实现**

把 `opScript` 的 `rename` 分支替换为（在 map 内先判 `when`，未命中原样返回）：

```javascript
        if (action === 'rename') {
            const template = step.template || step.expression;
            if (!template) continue;
            result = result.map((node, index) => {
                const ctx = { ...node, index: index + 1, target: context?.target || '' };
                if (step.when !== undefined && !matchesDslCondition(ctx, step.when)) return node;
                const nextName = renderDslTemplate(template, ctx) || node.name;
                if (nextName === node.name) return node;
                return {
                    ...node,
                    name: nextName,
                    url: NodeUtils.setNodeName(node.url, node.protocol, nextName),
                    metadata: node.metadata ? { ...node.metadata, cleanName: nextName } : node.metadata
                };
            });
            continue;
        }
```

> 说明：`rename` 的 `when` 只能用顶层结构字段（无 `query.`），与既有文档一致；`query.` 仍仅 `set-query.when` 可用。

- [ ] **Step 4: 跑测试确认通过**

Run: `npm run test:run -- tests/unit/operator-runner.test.js`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add functions/utils/operator-runner.js tests/unit/operator-runner.test.js
git commit -m "feat(dsl): rename 支持 when 条件，仅命中节点改名"
```

### Task 4: 新增 `set-field` 动作（name / metadata）

**Files:**
- Modify: `functions/utils/operator-runner.js`（新增两个模块级 helper + `opScript` 新增分支）
- Test: `tests/unit/operator-runner.test.js`

- [ ] **Step 1: 写失败测试**

追加：

```javascript
describe('opScript set-field（name/metadata）', () => {
  const urls = ['trojan://p@hk1.example.com:443#HK-01'];
  it('按模板改名并写 metadata 标签', async () => {
    const out = await runOperatorChain(urls, [{
      type: 'script',
      params: { dsl: [{ action: 'set-field', set: { name: '[HK] {name}' } }] }
    }], { target: 'clash' });
    expect(decodeURIComponent(out[0].slice(out[0].lastIndexOf('#') + 1))).toBe('[HK] HK-01');
  });
  it('when 未命中则原样透传', async () => {
    const out = await runOperatorChain(urls, [{
      type: 'script',
      params: { dsl: [{ action: 'set-field', when: { field: 'name', op: 'contains', value: 'JP' }, set: { name: 'X' } }] }
    }], { target: 'clash' });
    expect(decodeURIComponent(out[0].slice(out[0].lastIndexOf('#') + 1))).toBe('HK-01');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm run test:run -- tests/unit/operator-runner.test.js`
Expected: FAIL（`set-field` 未实现，名字未变）

- [ ] **Step 3: 实现**

在 `functions/utils/operator-runner.js` 顶部（`opScript` 之前）新增两个 helper：

```javascript
/**
 * set-field 的字段值：含 {} 的按模板渲染，否则当字面量。
 */
function renderFieldValue(rawValue, ctx) {
    if (typeof rawValue !== 'string') return rawValue;
    return rawValue.includes('{') ? renderDslTemplate(rawValue, ctx) : rawValue;
}

/**
 * 按 set 改写节点的结构字段。一期支持 name 与 metadata.*；server/port 见二期。
 */
function applySetField(node, set, ctx) {
    let next = { ...node };
    let changed = false;
    for (const [rawKey, rawValue] of Object.entries(set)) {
        const key = String(rawKey);
        const value = renderFieldValue(rawValue, ctx);
        if (key === 'name') {
            const name = String(value ?? '').trim();
            if (!name || name === next.name) continue;
            next = {
                ...next,
                name,
                url: NodeUtils.setNodeName(next.url, next.protocol, name),
                metadata: next.metadata ? { ...next.metadata, cleanName: name } : next.metadata
            };
            changed = true;
        } else if (key.startsWith('metadata.')) {
            const metaKey = key.slice(9);
            if (!metaKey) continue;
            next = { ...next, metadata: { ...(next.metadata || {}), [metaKey]: value } };
            changed = true;
        }
        // 其它字段（含二期的 server/port）在此忽略
    }
    return changed ? next : node;
}
```

在 `opScript` 动作循环里 `set-query` 分支之后新增：

```javascript
        if (action === 'set-field') {
            const set = step.set && typeof step.set === 'object' && !Array.isArray(step.set) ? step.set : null;
            if (!set || Object.keys(set).length === 0) continue;
            result = result.map((node, index) => {
                const ctx = { ...node, index: index + 1, target: context?.target || '' };
                if (step.when !== undefined && !matchesDslCondition(ctx, step.when)) return node;
                return applySetField(node, set, ctx);
            });
            continue;
        }
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm run test:run -- tests/unit/operator-runner.test.js`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add functions/utils/operator-runner.js tests/unit/operator-runner.test.js
git commit -m "feat(dsl): 新增 set-field 动作（name/metadata）"
```

### Task 5: 新增表达式函数 `extract` / `slice` / `padstart` / `concat`

**Files:**
- Modify: `functions/utils/expression-dsl.js`（`evalValue` 的函数分派，约 119-135 行；新增 `safeExtract`）
- Test: `tests/unit/expression-dsl.test.js`

- [ ] **Step 1: 写失败测试**

在 `tests/unit/expression-dsl.test.js` 追加：

```javascript
import { renderDslTemplate } from '../../functions/utils/expression-dsl.js';

describe('新增表达式函数', () => {
  it('extract 取正则捕获组', () => {
    expect(renderDslTemplate('{extract(name, "(\\\\d+)$", 1)}', { name: '香港01' })).toBe('01');
  });
  it('slice 字符串切片', () => {
    expect(renderDslTemplate('{slice(name, 0, 2)}', { name: '香港01' })).toBe('香港');
  });
  it('padstart 左填充', () => {
    expect(renderDslTemplate('{padstart(index, 3, "0")}', { index: 5 })).toBe('005');
  });
  it('concat 拼接', () => {
    expect(renderDslTemplate('{concat(regionZh, "-", name)}', { regionZh: '香港', name: '01' })).toBe('香港-01');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm run test:run -- tests/unit/expression-dsl.test.js`
Expected: FAIL（四个函数未定义，返回空串）

- [ ] **Step 3: 实现**

在 `functions/utils/expression-dsl.js` 新增 `safeExtract`（放在 `safeReplace` 附近）：

```javascript
function safeExtract(value, pattern, groupIndex) {
    try {
        const m = String(value || '').match(new RegExp(String(pattern || '')));
        if (!m) return '';
        const n = Number.isFinite(Number(groupIndex)) ? Number(groupIndex) : 1;
        return m[n] ?? '';
    } catch {
        return '';
    }
}
```

把 `evalValue` 里 `const [, fn, rawArgs] = call;` 之后的 `switch (fn)` 改为大小写不敏感并补四个函数：

```javascript
        const name = String(fn).toLowerCase();
        switch (name) {
            case 'upper': return String(args[0] || '').toUpperCase();
            case 'lower': return String(args[0] || '').toLowerCase();
            case 'title': return safeTitle(args[0]);
            case 'trim': return String(args[0] || '').trim();
            case 'replace': return safeReplace(args[0], args[1], args[2], args[3]);
            case 'contains': return String(args[0] || '').toLowerCase().includes(String(args[1] || '').toLowerCase());
            case 'match': return safeMatch(args[0], args[1], args[2] || 'i');
            case 'fallback': return fallback(...args);
            case 'pick': return pick(Boolean(args[0]), args[1], args[2] ?? '');
            case 'slice': return String(args[0] || '').slice(Number(args[1]) || 0, args[2] === undefined ? undefined : Number(args[2]));
            case 'padstart': return String(args[0] ?? '').padStart(Number(args[1]) || 0, args[2] === undefined ? ' ' : String(args[2]));
            case 'concat': return args.map(a => String(a ?? '')).join('');
            case 'extract': return safeExtract(args[0], args[1], args[2]);
            default: return '';
        }
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm run test:run -- tests/unit/expression-dsl.test.js`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add functions/utils/expression-dsl.js tests/unit/expression-dsl.test.js
git commit -m "feat(dsl): 新增 extract/slice/padstart/concat 表达式函数"
```

---

## 二期：set-field 的 server/port + 表达式解析器重写

### Task 6: `setNodeHostPort` 按协议重建 URL

**Files:**
- Modify: `functions/utils/node-transformer.js`（新增导出 `setNodeHostPort` 及内部 helper，放在 `setNodeName` 之后，约 320 行处）
- Test: `tests/unit/node-transformer.test.js`

- [ ] **Step 1: 写失败测试**

在 `tests/unit/node-transformer.test.js` 追加（顶部补 import）：

```javascript
import { setNodeHostPort } from '../../functions/utils/node-transformer.js';
import { parseNodeInfo } from '../../functions/modules/utils/geo-utils.js';

describe('setNodeHostPort 分协议 round-trip', () => {
  const hp = (url) => { const i = parseNodeInfo(url); return { server: i.server, port: String(i.port) }; };
  it('trojan 改 server/port，query 与 #备注 原样', () => {
    const out = setNodeHostPort('trojan://pass@hk1.example.com:443?sni=a.com#HK-01', 'trojan', { server: 'new.host', port: 8443 });
    expect(hp(out)).toEqual({ server: 'new.host', port: '8443' });
    expect(out).toContain('sni=a.com');
    expect(out).toContain('#HK-01');
  });
  it('vmess 改 add/port', () => {
    const url = 'vmess://eyJ2IjoiMiIsInBzIjoi8J+HuvCfh7ggVVMgTm9kZSAwMSIsImFkZCI6InVzMS5leGFtcGxlLmNvbSIsInBvcnQiOiI0NDMiLCJpZCI6IjAwMDAwMDAwLTAwMDAtMDAwMC0wMDAwLTAwMDAwMDAwMDAwMSIsImFpZCI6MCwibmV0IjoidGNwIiwidHlwZSI6Im5vbmUiLCJob3N0IjoiIiwicGF0aCI6IiIsInRscyI6InRscyJ9';
    expect(hp(setNodeHostPort(url, 'vmess', { server: 'new.host', port: 9443 }))).toEqual({ server: 'new.host', port: '9443' });
  });
  it('ss 旧式 base64(method:pass@host:port)', () => {
    const out = setNodeHostPort('ss://YWVzLTI1Ni1nY206cGFzc0AxMjcuMC4wLjE6ODM4OA==#node', 'ss', { server: '10.0.0.1', port: 9000 });
    expect(hp(out)).toEqual({ server: '10.0.0.1', port: '9000' });
    expect(out).toContain('#node');
  });
  it('只改 port 时 server 不变', () => {
    expect(hp(setNodeHostPort('trojan://p@hk.example.com:443#x', 'trojan', { port: 8080 }))).toEqual({ server: 'hk.example.com', port: '8080' });
  });
  it('ssr 等无法安全重建时保留原 URL', () => {
    expect(setNodeHostPort('ssr://abc', 'ssr', { port: 1 })).toBe('ssr://abc');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm run test:run -- tests/unit/node-transformer.test.js`
Expected: FAIL（`setNodeHostPort` 未定义）

- [ ] **Step 3: 实现**

`functions/utils/node-transformer.js` 中新增以下内容（`base64EncodeUtf8` 已 import；`normalizeBase64` 已在本文件定义）：

```javascript
function tryDecodeBase64(text) {
    try {
        const binary = atob(normalizeBase64(String(text || '')));
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        return new TextDecoder('utf-8').decode(bytes);
    } catch { return ''; }
}

function splitUrlParts(text) {
    const schemeEnd = text.indexOf('://');
    if (schemeEnd === -1) return null;
    const scheme = text.slice(0, schemeEnd + 3);
    let rest = text.slice(schemeEnd + 3);
    let hash = '';
    const hIndex = rest.indexOf('#');
    if (hIndex !== -1) { hash = rest.slice(hIndex); rest = rest.slice(0, hIndex); }
    let query = '';
    const qIndex = rest.indexOf('?');
    if (qIndex !== -1) { query = rest.slice(qIndex); rest = rest.slice(0, qIndex); }
    return { scheme, authority: rest, query, hash };
}

function replaceHostPort(authority, nextServer, nextPort) {
    const atIndex = authority.lastIndexOf('@');
    const userinfo = atIndex !== -1 ? authority.slice(0, atIndex + 1) : '';
    const hostport = atIndex !== -1 ? authority.slice(atIndex + 1) : authority;
    let host = '', port = '';
    if (hostport.startsWith('[')) {
        const close = hostport.indexOf(']');
        host = hostport.slice(0, close + 1);
        const after = hostport.slice(close + 1);
        port = after.startsWith(':') ? after.slice(1) : '';
    } else {
        const colon = hostport.lastIndexOf(':');
        if (colon !== -1) { host = hostport.slice(0, colon); port = hostport.slice(colon + 1); }
        else { host = hostport; }
    }
    if (nextServer !== null) host = /:/.test(nextServer) && !nextServer.startsWith('[') ? `[${nextServer}]` : nextServer;
    if (nextPort !== null) port = nextPort;
    return `${userinfo}${host}${port !== '' ? ':' + port : ''}`;
}

function setAuthorityHostPort(text, nextServer, nextPort) {
    const parts = splitUrlParts(text);
    if (!parts) return text;
    return `${parts.scheme}${replaceHostPort(parts.authority, nextServer, nextPort)}${parts.query}${parts.hash}`;
}

function setSsHostPort(text, nextServer, nextPort) {
    const parts = splitUrlParts(text);
    if (!parts) return text;
    if (parts.authority.includes('@')) {
        // SIP002 / 明文形：host:port 在明文 authority 里
        return `${parts.scheme}${replaceHostPort(parts.authority, nextServer, nextPort)}${parts.query}${parts.hash}`;
    }
    // 旧式：base64(method:pass@host:port)
    const decoded = tryDecodeBase64(parts.authority);
    if (!decoded || !decoded.includes('@')) return text;
    const at = decoded.lastIndexOf('@');
    const rebuilt = `${decoded.slice(0, at + 1)}${replaceHostPort(decoded.slice(at + 1), nextServer, nextPort)}`;
    return `${parts.scheme}${base64EncodeUtf8(rebuilt)}${parts.query}${parts.hash}`;
}

/**
 * 按协议把新的 server/port 写回节点 URL；协议/查询/#备注 原样保留。
 * 任一步失败（如 ssr、异常）返回原 URL，绝不产出坏节点。
 */
export function setNodeHostPort(url, protocol, patch = {}) {
    const text = String(url || '');
    if (!text) return url;
    const proto = String(protocol || '').toLowerCase();
    const nextServer = patch.server !== undefined && patch.server !== null ? String(patch.server) : null;
    const nextPort = patch.port !== undefined && patch.port !== null ? String(patch.port) : null;
    if (nextServer === null && nextPort === null) return url;
    try {
        if (proto === 'vmess') {
            let safeBody = text.replace('vmess://', '').replace(/-/g, '+').replace(/_/g, '/');
            while (safeBody.length % 4) safeBody += '=';
            const config = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(safeBody), c => c.charCodeAt(0))));
            if (nextServer !== null) config.add = nextServer;
            if (nextPort !== null) config.port = nextPort;
            return 'vmess://' + base64EncodeUtf8(JSON.stringify(config));
        }
        if (proto === 'ss') return setSsHostPort(text, nextServer, nextPort);
        if (proto === 'ssr') return url; // host/port 内嵌 base64，暂不支持，保留原节点
        return setAuthorityHostPort(text, nextServer, nextPort);
    } catch (e) {
        console.warn('[NodeUtils] setNodeHostPort failed:', e);
        return url;
    }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm run test:run -- tests/unit/node-transformer.test.js`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add functions/utils/node-transformer.js tests/unit/node-transformer.test.js
git commit -m "feat(dsl): 新增 setNodeHostPort 按协议重建 server/port"
```

### Task 7: `set-field` 接入 server / port

**Files:**
- Modify: `functions/utils/operator-runner.js`（Task 4 的 `applySetField`）
- Test: `tests/unit/operator-runner.test.js`

- [ ] **Step 1: 写失败测试**

追加：

```javascript
describe('opScript set-field（server/port）', () => {
  const urls = ['trojan://p@old.example.com:443?sni=a.com#HK-01'];
  it('改写 server 与 port，query/#备注 原样', async () => {
    const out = await runOperatorChain(urls, [{
      type: 'script',
      params: { dsl: [{ action: 'set-field', set: { server: 'new.example.com', port: 8443 } }] }
    }], { target: 'clash' });
    expect(out[0]).toContain('new.example.com:8443');
    expect(out[0]).toContain('sni=a.com');
    expect(out[0]).toContain('#HK-01');
  });
  it('非法 port 被跳过（端口保持原值）', async () => {
    const out = await runOperatorChain(urls, [{
      type: 'script',
      params: { dsl: [{ action: 'set-field', set: { port: 70000 } }] }
    }], { target: 'clash' });
    expect(out[0]).toContain('old.example.com:443');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm run test:run -- tests/unit/operator-runner.test.js`
Expected: FAIL（`applySetField` 尚未处理 server/port）

- [ ] **Step 3: 实现**

把 `applySetField` 替换为下面版本（新增 server/port 收集 + 端口校验 + 调 `setNodeHostPort`）：

```javascript
function applySetField(node, set, ctx) {
    let next = { ...node };
    let changed = false;
    let nextServer = null;
    let nextPort = null;
    for (const [rawKey, rawValue] of Object.entries(set)) {
        const key = String(rawKey);
        const value = renderFieldValue(rawValue, ctx);
        if (key === 'name') {
            const name = String(value ?? '').trim();
            if (!name || name === next.name) continue;
            next = {
                ...next,
                name,
                url: NodeUtils.setNodeName(next.url, next.protocol, name),
                metadata: next.metadata ? { ...next.metadata, cleanName: name } : next.metadata
            };
            changed = true;
        } else if (key.startsWith('metadata.')) {
            const metaKey = key.slice(9);
            if (!metaKey) continue;
            next = { ...next, metadata: { ...(next.metadata || {}), [metaKey]: value } };
            changed = true;
        } else if (key === 'server') {
            const server = String(value ?? '').trim();
            if (server) nextServer = server;
        } else if (key === 'port') {
            const portNum = Number(value);
            if (Number.isInteger(portNum) && portNum >= 1 && portNum <= 65535) nextPort = String(portNum);
            else console.warn(`[Operator] set-field: invalid port "${value}", skipped.`);
        }
    }
    if (nextServer !== null || nextPort !== null) {
        const nextUrl = NodeUtils.setNodeHostPort(next.url, next.protocol, { server: nextServer, port: nextPort });
        if (nextUrl !== next.url) {
            next = {
                ...next,
                url: nextUrl,
                server: nextServer !== null ? nextServer : next.server,
                port: nextPort !== null ? nextPort : next.port
            };
            changed = true;
        }
    }
    return changed ? next : node;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm run test:run -- tests/unit/operator-runner.test.js`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add functions/utils/operator-runner.js tests/unit/operator-runner.test.js
git commit -m "feat(dsl): set-field 支持改写 server/port（含端口校验）"
```

### Task 8: 表达式解析器重写（括号 / `!` / 算术）

把 `expression-dsl.js` 里"按 `||`/`&&` 朴素切分"的 `evaluateDslExpression` 与 `evalValue` 替换为**手写词法 + 递归下降解析器**，支持括号分组、`!`、一元 `-`、算术 `+ - * / %`，并把所有函数（含 Task 5 的 slice/padstart/concat/extract）收敛到统一 `FUNCTIONS` 表。仍然零 `eval`。

**Files:**
- Modify: `functions/utils/expression-dsl.js`（替换 `evalValue` + `evaluateDslExpression` + `renderDslTemplate`；删除 `splitArgs`）
- Test: `tests/unit/expression-dsl.test.js`

- [ ] **Step 1: 写失败测试**

追加：

```javascript
describe('表达式解析器：分组/取反/算术', () => {
  const ctx = { name: '香港01', port: '443', protocol: 'vless' };
  it('括号改变优先级', () => {
    expect(evaluateDslExpression("(protocol === 'vless' || protocol === 'vmess') && contains(name, '香港')", ctx)).toBe(true);
  });
  it('&& 优先级高于 ||', () => {
    expect(evaluateDslExpression("protocol === 'vless' || protocol === 'x' && contains(name, '日本')", ctx)).toBe(true);
  });
  it('! 取反', () => {
    expect(evaluateDslExpression("!contains(name, '日本')", ctx)).toBe(true);
  });
  it('数字比较与算术', () => {
    expect(evaluateDslExpression('port > 400', ctx)).toBe(true);
    expect(renderDslTemplate('{1 + 2 * 3}', {})).toBe('7');
  });
  it('字符串 + 拼接', () => {
    expect(renderDslTemplate("{regionZh + '-' + name}", { regionZh: '香港', name: '01' })).toBe('香港-01');
  });
  it('保留既有语义', () => {
    expect(evaluateDslExpression("name === '香港01'", ctx)).toBe(true);
    expect(evaluateDslExpression('', ctx)).toBe(true);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm run test:run -- tests/unit/expression-dsl.test.js`
Expected: FAIL（括号/`!`/算术未支持）

- [ ] **Step 3: 实现**

在 `functions/utils/expression-dsl.js` 里，删除 `evalValue` 与 `splitArgs`，新增以下内容（`safeExtract` 已在 Task 5 加入；`safeTitle/safeMatch/safeReplace/fallback/pick/getField/unquote` 保留复用）：

```javascript
const FUNCTIONS = {
    upper: a => String(a[0] || '').toUpperCase(),
    lower: a => String(a[0] || '').toLowerCase(),
    title: a => safeTitle(a[0]),
    trim: a => String(a[0] || '').trim(),
    replace: a => safeReplace(a[0], a[1], a[2], a[3]),
    contains: a => String(a[0] || '').toLowerCase().includes(String(a[1] || '').toLowerCase()),
    match: a => safeMatch(a[0], a[1], a[2] || 'i'),
    fallback: a => fallback(...a),
    pick: a => pick(Boolean(a[0]), a[1], a[2] ?? ''),
    slice: a => String(a[0] || '').slice(Number(a[1]) || 0, a[2] === undefined ? undefined : Number(a[2])),
    padstart: a => String(a[0] ?? '').padStart(Number(a[1]) || 0, a[2] === undefined ? ' ' : String(a[2])),
    concat: a => a.map(x => String(x ?? '')).join(''),
    extract: a => safeExtract(a[0], a[1], a[2]),
};

function truthy(v) {
    if (typeof v === 'boolean') return v;
    if (v === null || v === undefined) return false;
    if (typeof v === 'number') return v !== 0 && !Number.isNaN(v);
    return String(v) !== '';
}

function isNumeric(v) {
    if (typeof v === 'number') return !Number.isNaN(v);
    if (typeof v !== 'string') return false;
    return v.trim() !== '' && !Number.isNaN(Number(v));
}

function tokenize(input) {
    const tokens = [];
    const src = String(input);
    let i = 0;
    while (i < src.length) {
        const c = src[i];
        if (/\s/.test(c)) { i++; continue; }
        if (c === "'" || c === '"') {
            let j = i + 1, str = '';
            while (j < src.length && src[j] !== c) {
                if (src[j] === '\\' && j + 1 < src.length) { str += src[j] + src[j + 1]; j += 2; continue; }
                str += src[j]; j++;
            }
            tokens.push({ t: 'str', v: unquote(c + str + c) }); i = j + 1; continue;
        }
        if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] || ''))) {
            let j = i, num = '';
            while (j < src.length && /[0-9.]/.test(src[j])) { num += src[j]; j++; }
            tokens.push({ t: 'num', v: Number(num) }); i = j; continue;
        }
        if (/[a-zA-Z_]/.test(c)) {
            let j = i, id = '';
            while (j < src.length && /[a-zA-Z0-9_.]/.test(src[j])) { id += src[j]; j++; }
            tokens.push({ t: 'ident', v: id }); i = j; continue;
        }
        const three = src.slice(i, i + 3);
        if (three === '===' || three === '!==') { tokens.push({ t: 'op', v: three }); i += 3; continue; }
        const two = src.slice(i, i + 2);
        if (['&&', '||', '>=', '<='].includes(two)) { tokens.push({ t: 'op', v: two }); i += 2; continue; }
        if ('+-*/%<>!(),'.includes(c)) { tokens.push({ t: 'op', v: c }); i++; continue; }
        i++; // 未知字符容错跳过
    }
    return tokens;
}
```

继续新增递归下降求值器（优先级：`! 一元-` > `* / %` > `+ -` > 比较 > `===/!==` > `&&` > `||`）：

```javascript
function parseExpression(tokens, ctx) {
    let pos = 0;
    const peek = () => tokens[pos];
    const isOp = v => peek() && peek().t === 'op' && peek().v === v;
    const eat = v => { if (isOp(v)) { pos++; return true; } return false; };

    function parsePrimary() {
        const tk = peek();
        if (!tk) return '';
        if (isOp('(')) { pos++; const val = parseOr(); eat(')'); return val; }
        if (isOp('!')) { pos++; return !truthy(parsePrimary()); }
        if (isOp('-')) { pos++; return -Number(parsePrimary()); }
        if (tk.t === 'num') { pos++; return tk.v; }
        if (tk.t === 'str') { pos++; return tk.v; }
        if (tk.t === 'ident') {
            pos++;
            if (tk.v === 'true') return true;
            if (tk.v === 'false') return false;
            if (tk.v === 'null') return null;
            if (isOp('(')) {
                pos++;
                const args = [];
                if (!isOp(')')) { args.push(parseOr()); while (eat(',')) args.push(parseOr()); }
                eat(')');
                const fn = FUNCTIONS[tk.v.toLowerCase()];
                return fn ? fn(args) : '';
            }
            return getField(ctx, tk.v);
        }
        pos++; return '';
    }
    function parseMul() {
        let left = parsePrimary();
        while (peek() && peek().t === 'op' && ['*', '/', '%'].includes(peek().v)) {
            const op = tokens[pos++].v, r = Number(parsePrimary()), l = Number(left);
            left = op === '*' ? l * r : op === '/' ? l / r : l % r;
        }
        return left;
    }
    function parseAdd() {
        let left = parseMul();
        while (peek() && peek().t === 'op' && (peek().v === '+' || peek().v === '-')) {
            const op = tokens[pos++].v, right = parseMul();
            if (op === '-') left = Number(left) - Number(right);
            else left = (isNumeric(left) && isNumeric(right)) ? Number(left) + Number(right) : String(left) + String(right);
        }
        return left;
    }
    function parseCmp() {
        let left = parseAdd();
        while (peek() && peek().t === 'op' && ['>', '>=', '<', '<='].includes(peek().v)) {
            const op = tokens[pos++].v, r = Number(parseAdd()), l = Number(left);
            left = op === '>' ? l > r : op === '>=' ? l >= r : op === '<' ? l < r : l <= r;
        }
        return left;
    }
    function parseEq() {
        let left = parseCmp();
        while (peek() && peek().t === 'op' && (peek().v === '===' || peek().v === '!==')) {
            const op = tokens[pos++].v, right = parseCmp();
            left = op === '===' ? String(left) === String(right) : String(left) !== String(right);
        }
        return left;
    }
    function parseAnd() {
        let left = parseEq();
        while (isOp('&&')) { pos++; const right = parseEq(); left = truthy(left) && truthy(right); }
        return left;
    }
    function parseOr() {
        let left = parseAnd();
        while (isOp('||')) { pos++; const right = parseAnd(); left = truthy(left) || truthy(right); }
        return left;
    }
    return parseOr();
}
```

最后把两个导出函数改为走解析器（`matchesDslCondition` 不变）：

```javascript
export function evaluateDslExpression(expression, ctx = {}) {
    const expr = String(expression || '').trim();
    if (!expr) return true;
    try {
        return truthy(parseExpression(tokenize(expr), ctx));
    } catch {
        return false;
    }
}

export function renderDslTemplate(template, ctx = {}) {
    return String(template || '').replace(/\{([^{}]+)\}/g, (_, inner) => {
        try {
            const value = parseExpression(tokenize(inner), ctx);
            return value == null ? '' : String(value);
        } catch {
            return '';
        }
    }).trim();
}
```

> 删除后确认文件里不再有对 `evalValue` / `splitArgs` 的引用（`grep -n "evalValue\|splitArgs" functions/utils/expression-dsl.js` 应无输出）。Task 5 加入的 slice/padstart/concat/extract 已并入 `FUNCTIONS`，其测试应继续通过。

- [ ] **Step 4: 跑测试确认通过（含全部既有 DSL 测试）**

Run: `npm run test:run -- tests/unit/expression-dsl.test.js tests/unit/operator-runner.test.js`
Expected: PASS（新解析器不破坏既有条件/模板语义）

- [ ] **Step 5: 提交**

```bash
git add functions/utils/expression-dsl.js tests/unit/expression-dsl.test.js
git commit -m "feat(dsl): 表达式求值器重写为解析器，支持括号/取反/算术"
```

---

## 收尾

### Task 9: 更新文档 + 全量验证

**Files:**
- Modify: `docs/OPERATOR_DSL_GUIDE.md`

- [ ] **Step 1: 更新用户文档**

在 `docs/OPERATOR_DSL_GUIDE.md` 补充（保持中文、与现有风格一致）：
1. 第 2 节动作总览表：新增 `discard`（按条件丢弃）与 `set-field`（改写结构字段）两行；标注 `rename` 现支持可选 `when`。
2. 第 4 节动作详解：新增 `discard`（`when` 必填，否则跳过）与 `set-field`（可写 `name`/`server`/`port`/`metadata.*`，值为模板或字面量，`port` 校验 1–65535，不支持 `protocol`，重建失败保留原节点）小节。
3. 第 5 节条件：说明 `value` 为数组时 `eq`/`contains`/`match`/`regex` 表示"命中任意一个"（OR），`ne`/`not_contains` 表示"全部不命中"；并说明 `filter` 现也支持 `when`。
4. 第 5.3 / 第 6 节表达式：补 `slice`/`padstart`/`concat`/`extract` 函数，说明支持括号分组、`!` 取反、算术 `+ - * / %`（`+` 两侧为字符串时拼接），并说明 `&&`/`||` 不再强制两侧空格。
5. 第 8 节完整示例：新增"名字命中数组则加后缀"（rename + when + 数组）、"丢弃过期节点"（discard）、"批量改端口"（set-field）三个示例。

- [ ] **Step 2: 全量验证**

Run: `npm run test:run`
Expected: 全部通过（含新增用例）

Run: `npm run build`
Expected: 构建成功

- [ ] **Step 3: 提交**

```bash
git add docs/OPERATOR_DSL_GUIDE.md
git commit -m "docs(dsl): 更新 DSL 指南，补 discard/set-field/数组OR/新函数与算术"
```

---

## 自查对照（Spec Coverage）

- 统一 `when`：Task 2（filter）+ Task 3（rename）+ Task 4/7（set-field）；set-query 已有。✅
- 条件数组 OR：Task 1。✅
- `discard`：Task 2。✅
- `set-field`（name/metadata）：Task 4；（server/port）：Task 6+7。✅
- 新函数：Task 5（并入 Task 8 的 FUNCTIONS）。✅
- 表达式解析器（括号/`!`/算术）：Task 8。✅
- 文档：Task 9。✅
- 安全边界（零 eval、端口校验、重建失败保留原节点、未知 action 忽略）：贯穿 Task 6/7/8。✅












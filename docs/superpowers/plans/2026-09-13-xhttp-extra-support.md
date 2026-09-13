# VLESS xHTTP extra 字段支持实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 vless+xhttp 节点的 `extra` 查询参数（xPadding / xmux / downloadSettings 等）在 MiSub 的 Clash 输出中按 mihomo 官方字段名完整保留，并支持 Clash → VLESS URL 反向转换。

**Architecture:** 新建纯函数模块 `functions/utils/xhttp-extra.js` 提供双向映射（Xray camelCase extra JSON ↔ mihomo kebab-case xhttp-opts 字段），映射逐字段对齐 mihomo 源码 `common/convert/v.go` 的 `parseXHTTPExtra`。正向在 `url-to-clash.js` 的 `parseVlessUrl` xhttp 分支调用；反向在 `clash-to-url.js` 新增的 xhttp 分支调用。中间对象上的 extra 字段经现有透传机制自动进入最终 Clash YAML，各生成器无需改动。

**Tech Stack:** ES modules（`type: module`），vitest（`npx vitest run`）。

**上游参照（只读，勿改）：** `E:\Code\go\mihomo\common\convert\v.go:166-365`（正向映射唯一权威来源）。

---

### Task 1: `parseXhttpExtra` 正向映射函数

**Files:**
- Create: `functions/utils/xhttp-extra.js`
- Test: `tests/unit/xhttp-extra.test.js`

- [ ] **Step 1: 写失败测试**

创建 `tests/unit/xhttp-extra.test.js`：

```javascript
import { describe, it, expect } from 'vitest';
import { parseXhttpExtra } from '../../functions/utils/xhttp-extra.js';

// 用户实例中的完整 extra（Xray camelCase）
const FULL_EXTRA = {
    mode: 'auto',
    seqPlacement: 'path',
    sessionIDLength: '12-20',
    sessionIDPlacement: 'path',
    sessionIDTable: 'Base62',
    sessionPlacement: 'path',
    xPaddingBytes: '100-1000',
    xPaddingHeader: 'Referer',
    xPaddingKey: 'x',
    xPaddingMethod: 'tokenish',
    xPaddingObfsMode: true,
    xPaddingPlacement: 'queryInHeader',
    xmux: {
        cMaxReuseTimes: 0,
        hKeepAlivePeriod: 0,
        hMaxRequestTimes: '600-900',
        hMaxReusableSecs: '1800-3000',
        maxConcurrency: '1',
        maxConnections: 0
    }
};

describe('parseXhttpExtra 正向映射', () => {
    it('应把用户实例的 extra 映射为 mihomo kebab-case 字段', () => {
        const opts = parseXhttpExtra(FULL_EXTRA);

        expect(opts['x-padding-bytes']).toBe('100-1000');
        expect(opts['x-padding-obfs-mode']).toBe(true);
        expect(opts['x-padding-key']).toBe('x');
        expect(opts['x-padding-header']).toBe('Referer');
        expect(opts['x-padding-placement']).toBe('queryInHeader');
        expect(opts['x-padding-method']).toBe('tokenish');
        expect(opts['seq-placement']).toBe('path');
        expect(opts['session-placement']).toBe('path');
        expect(opts['session-table']).toBe('Base62');
        expect(opts['session-length']).toBe('12-20');
        expect(opts['reuse-settings']).toEqual({
            'max-connections': '0',
            'max-concurrency': '1',
            'c-max-reuse-times': '0',
            'h-max-request-times': '600-900',
            'h-max-reusable-secs': '1800-3000',
            'h-keep-alive-period': 0
        });
    });

    it('sessionIDPlacement 应优先于 sessionPlacement', () => {
        const opts = parseXhttpExtra({ sessionIDPlacement: 'query', sessionPlacement: 'cookie' });
        expect(opts['session-placement']).toBe('query');
    });

    it('数字类型的 sessionIDLength 应转为十进制字符串', () => {
        const opts = parseXhttpExtra({ sessionIDLength: 16 });
        expect(opts['session-length']).toBe('16');
    });

    it('类型不符的字段应跳过（对齐 mihomo 类型断言失败即跳过）', () => {
        const opts = parseXhttpExtra({ xPaddingBytes: 123, xPaddingKey: true, uplinkChunkSize: 'big' });
        expect(opts['x-padding-bytes']).toBeUndefined();
        expect(opts['x-padding-key']).toBeUndefined();
        expect(opts['uplink-chunk-size']).toBeUndefined();
        expect(Object.keys(opts)).toHaveLength(0);
    });

    it('xPaddingObfsMode 为 false 时也应写入（对齐 mihomo）', () => {
        const opts = parseXhttpExtra({ xPaddingObfsMode: false });
        expect(opts['x-padding-obfs-mode']).toBe(false);
    });

    it('noGRPCHeader 仅为 true 时写入', () => {
        expect(parseXhttpExtra({ noGRPCHeader: true })['no-grpc-header']).toBe(true);
        expect(parseXhttpExtra({ noGRPCHeader: false })['no-grpc-header']).toBeUndefined();
    });

    it('数字类型的 xmux 字段应格式化为字符串，hKeepAlivePeriod 保持整数', () => {
        const opts = parseXhttpExtra({ xmux: { maxConcurrency: 4, hKeepAlivePeriod: 30 } });
        expect(opts['reuse-settings']).toEqual({ 'max-concurrency': '4', 'h-keep-alive-period': 30 });
    });

    it('空 xmux 或非对象 xmux 不产生 reuse-settings', () => {
        expect(parseXhttpExtra({ xmux: {} })['reuse-settings']).toBeUndefined();
        expect(parseXhttpExtra({ xmux: 'x' })['reuse-settings']).toBeUndefined();
    });

    it('空对象与未知字段返回空对象', () => {
        expect(parseXhttpExtra({})).toEqual({});
        expect(parseXhttpExtra({ unknownField: 'x' })).toEqual({});
    });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/unit/xhttp-extra.test.js`
Expected: FAIL，报错 `Cannot find module .../functions/utils/xhttp-extra.js` 或 `parseXhttpExtra is not a function`。

- [ ] **Step 3: 实现 `functions/utils/xhttp-extra.js`（本任务先实现 parse 部分）**

```javascript
/**
 * VLESS xHTTP extra 字段双向映射。
 * 正向（parseXhttpExtra）：Xray xhttpSettings.extra 的 camelCase JSON → mihomo xhttp-opts 的 kebab-case 字段。
 * 反向（serializeXhttpExtra）：mihomo xhttp-opts → Xray extra JSON。
 * 映射逐字段对齐 mihomo 源码 common/convert/v.go 的 parseXHTTPExtra，行为差异须先核对上游。
 */

/**
 * xmux map → mihomo reuse-settings map
 * 数字字段格式化为十进制字符串，hKeepAlivePeriod 保持整数（对齐 mihomo xmuxToReuse）。
 */
function xmuxToReuseSettings(xmux) {
    const reuse = {};
    const set = (src, dst) => {
        const v = xmux[src];
        if (typeof v === 'string') {
            if (v !== '') reuse[dst] = v;
        } else if (typeof v === 'number' && Number.isFinite(v)) {
            reuse[dst] = String(v);
        }
    };
    set('maxConnections', 'max-connections');
    set('maxConcurrency', 'max-concurrency');
    set('cMaxReuseTimes', 'c-max-reuse-times');
    set('hMaxRequestTimes', 'h-max-request-times');
    set('hMaxReusableSecs', 'h-max-reusable-secs');
    if (typeof xmux.hKeepAlivePeriod === 'number' && Number.isFinite(xmux.hKeepAlivePeriod)) {
        reuse['h-keep-alive-period'] = Math.trunc(xmux.hKeepAlivePeriod);
    }
    return reuse;
}

function isPlainObject(v) {
    return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function setStr(extra, src, opts, dst) {
    if (typeof extra[src] === 'string' && extra[src] !== '') {
        opts[dst] = extra[src];
    }
}

/**
 * 解析 Xray extra JSON 对象为 mihomo xhttp-opts 附加字段。
 * @param {Object} extra - xhttpSettings.extra 解析后的 JSON 对象
 * @returns {Object} mihomo xhttp-opts 附加字段（kebab-case）；无有效字段时为空对象
 */
export function parseXhttpExtra(extra) {
    const opts = {};
    if (!isPlainObject(extra)) return opts;

    if (extra.noGRPCHeader === true) {
        opts['no-grpc-header'] = true;
    }

    setStr(extra, 'xPaddingBytes', opts, 'x-padding-bytes');
    if (typeof extra.xPaddingObfsMode === 'boolean') {
        opts['x-padding-obfs-mode'] = extra.xPaddingObfsMode;
    }
    setStr(extra, 'xPaddingKey', opts, 'x-padding-key');
    setStr(extra, 'xPaddingHeader', opts, 'x-padding-header');
    setStr(extra, 'xPaddingPlacement', opts, 'x-padding-placement');
    setStr(extra, 'xPaddingMethod', opts, 'x-padding-method');
    setStr(extra, 'uplinkHTTPMethod', opts, 'uplink-http-method');

    // Xray 规范名为 sessionIDPlacement/sessionIDKey，兼容旧名 sessionPlacement/sessionKey
    if (typeof extra.sessionIDPlacement === 'string' && extra.sessionIDPlacement !== '') {
        opts['session-placement'] = extra.sessionIDPlacement;
    } else {
        setStr(extra, 'sessionPlacement', opts, 'session-placement');
    }
    if (typeof extra.sessionIDKey === 'string' && extra.sessionIDKey !== '') {
        opts['session-key'] = extra.sessionIDKey;
    } else {
        setStr(extra, 'sessionKey', opts, 'session-key');
    }
    setStr(extra, 'sessionIDTable', opts, 'session-table');
    if (typeof extra.sessionIDLength === 'string' && extra.sessionIDLength !== '') {
        opts['session-length'] = extra.sessionIDLength;
    } else if (typeof extra.sessionIDLength === 'number' && Number.isFinite(extra.sessionIDLength)) {
        opts['session-length'] = String(Math.trunc(extra.sessionIDLength));
    }

    setStr(extra, 'seqPlacement', opts, 'seq-placement');
    setStr(extra, 'seqKey', opts, 'seq-key');
    setStr(extra, 'uplinkDataPlacement', opts, 'uplink-data-placement');
    setStr(extra, 'uplinkDataKey', opts, 'uplink-data-key');

    const intField = (src, dst) => {
        if (typeof extra[src] === 'number' && Number.isFinite(extra[src])) {
            opts[dst] = Math.trunc(extra[src]);
        }
    };
    intField('uplinkChunkSize', 'uplink-chunk-size');
    intField('scMaxEachPostBytes', 'sc-max-each-post-bytes');
    intField('scMinPostsIntervalMs', 'sc-min-posts-interval-ms');

    if (isPlainObject(extra.xmux) && Object.keys(extra.xmux).length > 0) {
        const reuse = xmuxToReuseSettings(extra.xmux);
        if (Object.keys(reuse).length > 0) {
            opts['reuse-settings'] = reuse;
        }
    }

    if (isPlainObject(extra.downloadSettings)) {
        const ds = parseDownloadSettings(extra.downloadSettings);
        if (Object.keys(ds).length > 0) {
            opts['download-settings'] = ds;
        }
    }

    return opts;
}

/**
 * Xray downloadSettings → mihomo download-settings（对齐 mihomo v.go:282-364）
 */
function parseDownloadSettings(dsAny) {
    const ds = {};

    setStr(dsAny, 'address', ds, 'server');
    if (typeof dsAny.port === 'number' && Number.isFinite(dsAny.port)) {
        ds.port = Math.trunc(dsAny.port);
    }

    const sec = typeof dsAny.security === 'string' ? dsAny.security.toLowerCase() : '';
    if (sec === 'tls' || sec === 'reality') {
        ds.tls = true;

        const tlsAny = isPlainObject(dsAny.tlsSettings) ? dsAny.tlsSettings : null;
        if (tlsAny) {
            setStr(tlsAny, 'serverName', ds, 'servername');
            setStr(tlsAny, 'fingerprint', ds, 'client-fingerprint');
            if (Array.isArray(tlsAny.alpn) && tlsAny.alpn.length > 0) {
                const alpnList = tlsAny.alpn.filter(a => typeof a === 'string');
                if (alpnList.length > 0) ds.alpn = alpnList;
            }
            if (tlsAny.allowInsecure === true) {
                ds['skip-cert-verify'] = true;
            }
        }

        if (sec === 'reality') {
            const realityAny = isPlainObject(dsAny.realitySettings) ? dsAny.realitySettings : null;
            if (realityAny) {
                const realityOpts = {};
                setStr(realityAny, 'publicKey', realityOpts, 'public-key');
                setStr(realityAny, 'shortId', realityOpts, 'short-id');
                if (Object.keys(realityOpts).length > 0) {
                    ds['reality-opts'] = realityOpts;
                }
            }
        }
    }

    const xhttpAny = isPlainObject(dsAny.xhttpSettings) ? dsAny.xhttpSettings : null;
    if (xhttpAny) {
        setStr(xhttpAny, 'path', ds, 'path');
        setStr(xhttpAny, 'host', ds, 'host');
        if (isPlainObject(xhttpAny.headers) && Object.keys(xhttpAny.headers).length > 0) {
            ds.headers = xhttpAny.headers;
        }
        // downloadSettings.xhttpSettings.extra.xmux → download-settings.reuse-settings
        if (isPlainObject(xhttpAny.extra) && isPlainObject(xhttpAny.extra.xmux)
            && Object.keys(xhttpAny.extra.xmux).length > 0) {
            const reuse = xmuxToReuseSettings(xhttpAny.extra.xmux);
            if (Object.keys(reuse).length > 0) {
                ds['reuse-settings'] = reuse;
            }
        }
    }

    return ds;
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run tests/unit/xhttp-extra.test.js`
Expected: PASS（全部用例）。

- [ ] **Step 5: 提交**

```bash
git add functions/utils/xhttp-extra.js tests/unit/xhttp-extra.test.js
git commit -m "feat(xhttp): add Xray extra to mihomo xhttp-opts field mapping"
```

---

### Task 2: `serializeXhttpExtra` 反向序列化函数

**Files:**
- Modify: `functions/utils/xhttp-extra.js`
- Test: `tests/unit/xhttp-extra.test.js`（追加 describe 块）

- [ ] **Step 1: 写失败测试**

在 `tests/unit/xhttp-extra.test.js` 追加（并更新顶部 import 为 `import { parseXhttpExtra, serializeXhttpExtra } from '../../functions/utils/xhttp-extra.js';`）：

```javascript
import { serializeXhttpExtra } from '../../functions/utils/xhttp-extra.js';

describe('serializeXhttpExtra 反向序列化', () => {
    it('应把 mihomo 字段逆向为 Xray extra，session 系列使用规范名 sessionID*', () => {
        const extra = serializeXhttpExtra({
            path: '/test',
            host: 'test.example.com',
            mode: 'auto',
            'x-padding-bytes': '100-1000',
            'x-padding-obfs-mode': true,
            'x-padding-key': 'x',
            'x-padding-header': 'Referer',
            'x-padding-placement': 'queryInHeader',
            'x-padding-method': 'tokenish',
            'seq-placement': 'path',
            'session-placement': 'path',
            'session-table': 'Base62',
            'session-length': '12-20',
            'reuse-settings': {
                'max-connections': '0',
                'max-concurrency': '1',
                'c-max-reuse-times': '0',
                'h-max-request-times': '600-900',
                'h-max-reusable-secs': '1800-3000',
                'h-keep-alive-period': 0
            }
        });

        expect(extra).toEqual({
            xPaddingBytes: '100-1000',
            xPaddingObfsMode: true,
            xPaddingKey: 'x',
            xPaddingHeader: 'Referer',
            xPaddingPlacement: 'queryInHeader',
            xPaddingMethod: 'tokenish',
            seqPlacement: 'path',
            sessionIDPlacement: 'path',
            sessionIDTable: 'Base62',
            sessionIDLength: '12-20',
            xmux: {
                maxConnections: '0',
                maxConcurrency: '1',
                cMaxReuseTimes: '0',
                hMaxRequestTimes: '600-900',
                hMaxReusableSecs: '1800-3000',
                hKeepAlivePeriod: 0
            }
        });
    });

    it('不应输出 path/host/mode 与 noGRPCHeader=false', () => {
        const extra = serializeXhttpExtra({ path: '/test', mode: 'auto', 'no-grpc-header': false });
        expect(extra).toBeNull();
    });

    it('no-grpc-header 为 true 时输出 noGRPCHeader: true', () => {
        const extra = serializeXhttpExtra({ 'no-grpc-header': true });
        expect(extra).toEqual({ noGRPCHeader: true });
    });

    it('数字字段原样保留为数字', () => {
        const extra = serializeXhttpExtra({
            'uplink-chunk-size': 2048,
            'sc-max-each-post-bytes': 1000000,
            'sc-min-posts-interval-ms': 30
        });
        expect(extra).toEqual({
            uplinkChunkSize: 2048,
            scMaxEachPostBytes: 1000000,
            scMinPostsIntervalMs: 30
        });
    });

    it('download-settings 应逆向为 downloadSettings，含 tls 与 xhttpSettings', () => {
        const extra = serializeXhttpExtra({
            'download-settings': {
                server: 'dl.example.com',
                port: 443,
                tls: true,
                servername: 'dl.example.com',
                'client-fingerprint': 'chrome',
                alpn: ['h2', 'http/1.1'],
                'skip-cert-verify': true,
                path: '/dl',
                host: 'dl.example.com',
                'reuse-settings': { 'max-concurrency': '2' }
            }
        });

        expect(extra).toEqual({
            downloadSettings: {
                address: 'dl.example.com',
                port: 443,
                security: 'tls',
                tlsSettings: {
                    serverName: 'dl.example.com',
                    fingerprint: 'chrome',
                    alpn: ['h2', 'http/1.1'],
                    allowInsecure: true
                },
                xhttpSettings: {
                    path: '/dl',
                    host: 'dl.example.com',
                    extra: { xmux: { maxConcurrency: '2' } }
                }
            }
        });
    });

    it('reality-opts 存在时 security 输出 reality', () => {
        const extra = serializeXhttpExtra({
            'download-settings': {
                server: 'dl.example.com',
                port: 443,
                tls: true,
                'reality-opts': { 'public-key': 'pbk', 'short-id': 'sid' }
            }
        });

        expect(extra.downloadSettings.security).toBe('reality');
        expect(extra.downloadSettings.realitySettings).toEqual({ publicKey: 'pbk', shortId: 'sid' });
    });

    it('空对象或不含 extra 字段时返回 null', () => {
        expect(serializeXhttpExtra({})).toBeNull();
        expect(serializeXhttpExtra({ path: '/x', host: 'h', mode: 'auto' })).toBeNull();
        expect(serializeXhttpExtra(null)).toBeNull();
    });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/unit/xhttp-extra.test.js`
Expected: FAIL，`serializeXhttpExtra is not a function`。

- [ ] **Step 3: 在 `functions/utils/xhttp-extra.js` 追加实现**

```javascript
/**
 * mihomo reuse-settings → xmux map（xmuxToReuseSettings 的逆映射）
 */
function reuseSettingsToXmux(reuse) {
    const xmux = {};
    const set = (src, dst) => {
        const v = reuse[src];
        if (typeof v === 'string') {
            if (v !== '') xmux[dst] = v;
        } else if (typeof v === 'number' && Number.isFinite(v)) {
            xmux[dst] = String(v);
        }
    };
    set('max-connections', 'maxConnections');
    set('max-concurrency', 'maxConcurrency');
    set('c-max-reuse-times', 'cMaxReuseTimes');
    set('h-max-request-times', 'hMaxRequestTimes');
    set('h-max-reusable-secs', 'hMaxReusableSecs');
    if (typeof reuse['h-keep-alive-period'] === 'number' && Number.isFinite(reuse['h-keep-alive-period'])) {
        xmux.hKeepAlivePeriod = Math.trunc(reuse['h-keep-alive-period']);
    }
    return xmux;
}

/**
 * mihomo download-settings → Xray downloadSettings（parseDownloadSettings 的逆映射）
 */
function serializeDownloadSettings(ds) {
    const out = {};
    if (typeof ds.server === 'string' && ds.server !== '') out.address = ds.server;
    if (typeof ds.port === 'number' && Number.isFinite(ds.port)) out.port = Math.trunc(ds.port);

    const hasReality = isPlainObject(ds['reality-opts'])
        && (typeof ds['reality-opts']['public-key'] === 'string' || typeof ds['reality-opts']['short-id'] === 'string');
    if (ds.tls === true || hasReality) {
        out.security = hasReality ? 'reality' : 'tls';
        const tlsSettings = {};
        if (typeof ds.servername === 'string' && ds.servername !== '') tlsSettings.serverName = ds.servername;
        if (typeof ds['client-fingerprint'] === 'string' && ds['client-fingerprint'] !== '') {
            tlsSettings.fingerprint = ds['client-fingerprint'];
        }
        if (Array.isArray(ds.alpn) && ds.alpn.length > 0) tlsSettings.alpn = ds.alpn;
        if (ds['skip-cert-verify'] === true) tlsSettings.allowInsecure = true;
        if (Object.keys(tlsSettings).length > 0) out.tlsSettings = tlsSettings;
        if (hasReality) {
            const realitySettings = {};
            if (typeof ds['reality-opts']['public-key'] === 'string' && ds['reality-opts']['public-key'] !== '') {
                realitySettings.publicKey = ds['reality-opts']['public-key'];
            }
            if (typeof ds['reality-opts']['short-id'] === 'string' && ds['reality-opts']['short-id'] !== '') {
                realitySettings.shortId = ds['reality-opts']['short-id'];
            }
            if (Object.keys(realitySettings).length > 0) out.realitySettings = realitySettings;
        }
    }

    const xhttpSettings = {};
    if (typeof ds.path === 'string' && ds.path !== '') xhttpSettings.path = ds.path;
    if (typeof ds.host === 'string' && ds.host !== '') xhttpSettings.host = ds.host;
    if (isPlainObject(ds.headers) && Object.keys(ds.headers).length > 0) xhttpSettings.headers = ds.headers;
    if (isPlainObject(ds['reuse-settings']) && Object.keys(ds['reuse-settings']).length > 0) {
        xhttpSettings.extra = { xmux: reuseSettingsToXmux(ds['reuse-settings']) };
    }
    if (Object.keys(xhttpSettings).length > 0) out.xhttpSettings = xhttpSettings;

    return out;
}

/**
 * 把 mihomo xhttp-opts 逆向序列化为 Xray extra JSON 对象。
 * path/host/mode 不属于 extra，不输出。
 * @param {Object} xhttpOpts - mihomo xhttp-opts（含 path/host/mode 与 extra 派生字段）
 * @returns {Object|null} Xray extra 对象；不含任何 extra 派生字段时返回 null
 */
export function serializeXhttpExtra(xhttpOpts) {
    if (!isPlainObject(xhttpOpts)) return null;

    const extra = {};
    const getStr = (src, dst) => {
        if (typeof xhttpOpts[src] === 'string' && xhttpOpts[src] !== '') {
            extra[dst] = xhttpOpts[src];
        }
    };

    if (xhttpOpts['no-grpc-header'] === true) extra.noGRPCHeader = true;

    getStr('x-padding-bytes', 'xPaddingBytes');
    if (typeof xhttpOpts['x-padding-obfs-mode'] === 'boolean') {
        extra.xPaddingObfsMode = xhttpOpts['x-padding-obfs-mode'];
    }
    getStr('x-padding-key', 'xPaddingKey');
    getStr('x-padding-header', 'xPaddingHeader');
    getStr('x-padding-placement', 'xPaddingPlacement');
    getStr('x-padding-method', 'xPaddingMethod');
    getStr('uplink-http-method', 'uplinkHTTPMethod');

    // 输出 Xray 规范名 sessionID*（mihomo 正向解析两种命名均接受）
    getStr('session-placement', 'sessionIDPlacement');
    getStr('session-key', 'sessionIDKey');
    getStr('session-table', 'sessionIDTable');
    getStr('session-length', 'sessionIDLength');

    getStr('seq-placement', 'seqPlacement');
    getStr('seq-key', 'seqKey');
    getStr('uplink-data-placement', 'uplinkDataPlacement');
    getStr('uplink-data-key', 'uplinkDataKey');

    const getInt = (src, dst) => {
        if (typeof xhttpOpts[src] === 'number' && Number.isFinite(xhttpOpts[src])) {
            extra[dst] = Math.trunc(xhttpOpts[src]);
        }
    };
    getInt('uplink-chunk-size', 'uplinkChunkSize');
    getInt('sc-max-each-post-bytes', 'scMaxEachPostBytes');
    getInt('sc-min-posts-interval-ms', 'scMinPostsIntervalMs');

    if (isPlainObject(xhttpOpts['reuse-settings']) && Object.keys(xhttpOpts['reuse-settings']).length > 0) {
        extra.xmux = reuseSettingsToXmux(xhttpOpts['reuse-settings']);
    }

    if (isPlainObject(xhttpOpts['download-settings'])) {
        const ds = serializeDownloadSettings(xhttpOpts['download-settings']);
        if (Object.keys(ds).length > 0) extra.downloadSettings = ds;
    }

    return Object.keys(extra).length > 0 ? extra : null;
}
```

注意：测试文件顶部原 import 行需合并为一次导入（`parseXhttpExtra, serializeXhttpExtra`），不要保留两条 import。

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run tests/unit/xhttp-extra.test.js`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add functions/utils/xhttp-extra.js tests/unit/xhttp-extra.test.js
git commit -m "feat(xhttp): add mihomo xhttp-opts to Xray extra serialization"
```

---

### Task 3: 接入 `parseVlessUrl`（URL → Clash 中间格式）

**Files:**
- Modify: `functions/utils/url-to-clash.js:136-150`（parseVlessUrl 的 xhttp 分支）
- Test: `tests/unit/xhttp-extra.test.js`（追加集成 describe 块）

- [ ] **Step 1: 写失败测试**

在 `tests/unit/xhttp-extra.test.js` 追加（import 部分追加 `urlToClashProxy`）：

```javascript
import { urlToClashProxy } from '../../functions/utils/url-to-clash.js';

// 用户提供的真实链接（extra 为完整 JSON 的 URL 编码）
const USER_URL = 'vless://5f33ebda-7fb0-4977-bae3-1b55f3cdbed0@test.example.com:56239?encryption=none&security=none&type=xhttp&path=%2Ftest&mode=auto&extra=%7B%22mode%22%3A%22auto%22%2C%22seqPlacement%22%3A%22path%22%2C%22sessionIDLength%22%3A%2212-20%22%2C%22sessionIDPlacement%22%3A%22path%22%2C%22sessionIDTable%22%3A%22Base62%22%2C%22sessionPlacement%22%3A%22path%22%2C%22xPaddingBytes%22%3A%22100-1000%22%2C%22xPaddingHeader%22%3A%22Referer%22%2C%22xPaddingKey%22%3A%22x%22%2C%22xPaddingMethod%22%3A%22tokenish%22%2C%22xPaddingObfsMode%22%3Atrue%2C%22xPaddingPlacement%22%3A%22queryInHeader%22%2C%22xmux%22%3A%7B%22cMaxReuseTimes%22%3A0%2C%22hKeepAlivePeriod%22%3A0%2C%22hMaxRequestTimes%22%3A%22600-900%22%2C%22hMaxReusableSecs%22%3A%221800-3000%22%2C%22maxConcurrency%22%3A%221%22%2C%22maxConnections%22%3A0%7D%7D#test-test';

describe('parseVlessUrl 集成（URL → Clash 中间格式）', () => {
    it('应解析带 extra 的 vless+xhttp 链接并写入 xhttp-opts', () => {
        const proxy = urlToClashProxy(USER_URL);

        expect(proxy.type).toBe('vless');
        expect(proxy.network).toBe('xhttp');
        expect(proxy['xhttp-opts'].path).toBe('/test');
        expect(proxy['xhttp-opts'].mode).toBe('auto');
        expect(proxy['xhttp-opts']['x-padding-bytes']).toBe('100-1000');
        expect(proxy['xhttp-opts']['x-padding-obfs-mode']).toBe(true);
        expect(proxy['xhttp-opts']['session-placement']).toBe('path');
        expect(proxy['xhttp-opts']['reuse-settings']['h-max-request-times']).toBe('600-900');
        expect(proxy['xhttp-opts']['reuse-settings']['h-keep-alive-period']).toBe(0);
    });

    it('extra 为非法 JSON 时应静默忽略，节点仍正常导入', () => {
        const url = 'vless://uuid@1.2.3.4:443?type=xhttp&path=%2Ftest&extra=%7Bnot-json';
        const proxy = urlToClashProxy(url);

        expect(proxy['xhttp-opts'].path).toBe('/test');
        expect(proxy['xhttp-opts']['x-padding-bytes']).toBeUndefined();
    });

    it('extra 为合法 JSON 但非对象时应静默忽略', () => {
        const url = 'vless://uuid@1.2.3.4:443?type=xhttp&path=%2Ftest&extra=%5B1%2C2%5D';
        const proxy = urlToClashProxy(url);

        expect(proxy['xhttp-opts'].path).toBe('/test');
        expect(proxy['xhttp-opts']['reuse-settings']).toBeUndefined();
    });

    it('无 extra 参数时行为不变', () => {
        const url = 'vless://uuid@1.2.3.4:443?type=xhttp&path=%2Ftest&mode=auto';
        const proxy = urlToClashProxy(url);

        expect(proxy['xhttp-opts']).toEqual({ path: '/test', mode: 'auto' });
    });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/unit/xhttp-extra.test.js`
Expected: 新增用例 FAIL（`xhttp-opts` 中没有 x-padding-bytes 等）。

- [ ] **Step 3: 修改 `functions/utils/url-to-clash.js`**

文件顶部 import 区（第 1-10 行附近，跟现有 import 合并）追加：

```javascript
import { parseXhttpExtra } from './xhttp-extra.js';
```

将 xhttp 分支（当前 136-150 行）：

```javascript
        // xHTTP 配置 (Loon 3.0+ / Xray 1.8.7+)
        if (network === 'xhttp') {
            const xhttpOpts = {};
            const path = params.get('xhttp-path') || params.get('path');
            const host = params.get('xhttp-host') || params.get('host') || params.get('sni');
            if (path) xhttpOpts.path = path;
            if (host) {
                xhttpOpts.host = host;
                xhttpOpts.headers = { Host: host };
            }
            if (params.get('mode')) xhttpOpts.mode = params.get('mode');
            if (Object.keys(xhttpOpts).length > 0) {
                proxy['xhttp-opts'] = xhttpOpts;
            }
        }
```

改为：

```javascript
        // xHTTP 配置 (Loon 3.0+ / Xray 1.8.7+)
        if (network === 'xhttp') {
            const xhttpOpts = {};
            const path = params.get('xhttp-path') || params.get('path');
            const host = params.get('xhttp-host') || params.get('host') || params.get('sni');
            if (path) xhttpOpts.path = path;
            if (host) {
                xhttpOpts.host = host;
                xhttpOpts.headers = { Host: host };
            }
            if (params.get('mode')) xhttpOpts.mode = params.get('mode');
            // Xray extra JSON → mihomo kebab-case 字段（对齐 mihomo common/convert/v.go）
            const extraParam = params.get('extra');
            if (extraParam) {
                try {
                    const extraObj = JSON.parse(extraParam);
                    Object.assign(xhttpOpts, parseXhttpExtra(extraObj));
                } catch {
                    // 非法 JSON 静默忽略，节点按基础字段导入（对齐 mihomo 行为）
                }
            }
            if (Object.keys(xhttpOpts).length > 0) {
                proxy['xhttp-opts'] = xhttpOpts;
            }
        }
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run tests/unit/xhttp-extra.test.js`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add functions/utils/url-to-clash.js tests/unit/xhttp-extra.test.js
git commit -m "feat(xhttp): parse vless xhttp extra param into clash proxy xhttp-opts"
```

---

### Task 4: 接入 `convertClashProxyToUrl`（Clash → VLESS URL 反向）

**Files:**
- Modify: `functions/utils/clash-to-url.js:123-158`（vless 分支）
- Test: `tests/unit/xhttp-extra.test.js`（追加反向集成 describe 块）

- [ ] **Step 1: 写失败测试**

在 `tests/unit/xhttp-extra.test.js` 追加（import 部分追加 `convertClashProxyToUrl`）：

```javascript
import { convertClashProxyToUrl } from '../../functions/utils/clash-to-url.js';

describe('convertClashProxyToUrl 集成（Clash → VLESS URL）', () => {
    const proxy = {
        name: 'test-test',
        type: 'vless',
        server: 'test.example.com',
        port: 56239,
        uuid: '5f33ebda-7fb0-4977-bae3-1b55f3cdbed0',
        network: 'xhttp',
        'xhttp-opts': {
            path: '/test',
            mode: 'auto',
            'x-padding-bytes': '100-1000',
            'x-padding-obfs-mode': true,
            'session-placement': 'path',
            'reuse-settings': { 'max-concurrency': '1', 'h-keep-alive-period': 0 }
        }
    };

    it('应输出 xhttp 的 path/mode 与 extra 参数', () => {
        const url = convertClashProxyToUrl(proxy);

        expect(url).toContain('type=xhttp');
        expect(url).toContain('path=%2Ftest');
        expect(url).toContain('mode=auto');

        const extraMatch = url.match(/(?:\?|&)extra=([^&#]*)/);
        expect(extraMatch).not.toBeNull();
        const extra = JSON.parse(decodeURIComponent(extraMatch[1]));
        expect(extra.xPaddingBytes).toBe('100-1000');
        expect(extra.xPaddingObfsMode).toBe(true);
        expect(extra.sessionIDPlacement).toBe('path');
        expect(extra.xmux).toEqual({ maxConcurrency: '1', hKeepAlivePeriod: 0 });
    });

    it('xhttp-opts 不含 extra 字段时不输出 extra 参数', () => {
        const url = convertClashProxyToUrl({
            ...proxy,
            'xhttp-opts': { path: '/test', mode: 'auto' }
        });
        expect(url).toContain('path=%2Ftest');
        expect(url).not.toContain('extra=');
    });

    it('非 xhttp 节点不受影响', () => {
        const wsUrl = convertClashProxyToUrl({
            name: 'WS', type: 'vless', server: 'a.com', port: 443, uuid: 'u',
            network: 'ws', 'ws-opts': { path: '/ws', headers: { Host: 'a.com' } }, tls: true
        });
        expect(wsUrl).toContain('type=ws');
        expect(wsUrl).toContain('path=%2Fws');
    });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/unit/xhttp-extra.test.js`
Expected: 新增用例 FAIL（URL 中无 `path=%2Ftest`——当前 xhttp 分支缺失）。

- [ ] **Step 3: 修改 `functions/utils/clash-to-url.js`**

文件顶部 import 区追加：

```javascript
import { serializeXhttpExtra } from './xhttp-extra.js';
```

在 vless 分支中，httpupgrade 处理（当前 138-142 行）之后、realityOpts（当前 143 行）之前插入：

```javascript
            const xhttpOpts = proxy['xhttp-opts'] || proxy.xhttpOpts;
            if (xhttpOpts) {
                if (xhttpOpts.path) params.push(`path=${encodeURIComponent(xhttpOpts.path)}`);
                if (xhttpOpts.host) params.push(`host=${encodeURIComponent(xhttpOpts.host)}`);
                if (xhttpOpts.mode) params.push(`mode=${encodeURIComponent(xhttpOpts.mode)}`);
                const extraObj = serializeXhttpExtra(xhttpOpts);
                if (extraObj) {
                    params.push(`extra=${encodeURIComponent(JSON.stringify(extraObj))}`);
                }
            }
```

注意：`serializeXhttpExtra` 接受的是 mihomo 命名的 `xhttp-opts`，但若来源对象用了 `headers: { Host }`（MiSub 正向解析写入的字段），不属于 extra，序列化函数天然忽略——无需特殊处理。

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run tests/unit/xhttp-extra.test.js`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add functions/utils/clash-to-url.js tests/unit/xhttp-extra.test.js
git commit -m "feat(xhttp): serialize clash xhttp-opts back to vless url with extra param"
```

---

### Task 5: 端到端验证 + 回归

**Files:**
- Test: `tests/unit/xhttp-extra.test.js`（追加端到端 describe 块）

- [ ] **Step 1: 写端到端测试**

在 `tests/unit/xhttp-extra.test.js` 追加：

```javascript
import { generateProxiesOnly } from '../../functions/modules/subscription/builtin-clash-generator.js';

describe('端到端：vless+xhttp+extra 经 Clash 生成器输出', () => {
    it('最终 YAML 的 xhttp-opts 应包含 extra 派生字段', () => {
        const result = generateProxiesOnly(USER_URL);
        const parsed = yaml.load(result);
        const proxy = parsed.proxies[0];

        expect(proxy.network).toBe('xhttp');
        expect(proxy['xhttp-opts']['x-padding-bytes']).toBe('100-1000');
        expect(proxy['xhttp-opts']['x-padding-obfs-mode']).toBe(true);
        expect(proxy['xhttp-opts']['session-placement']).toBe('path');
        expect(proxy['xhttp-opts']['reuse-settings']).toEqual({
            'max-connections': '0',
            'max-concurrency': '1',
            'c-max-reuse-times': '0',
            'h-max-request-times': '600-900',
            'h-max-reusable-secs': '1800-3000',
            'h-keep-alive-period': 0
        });
    });
});
```

同时把 `import yaml from 'js-yaml';` 加到文件顶部（仓库 `builtin-clash-generator.test.js` 同款用法）。

- [ ] **Step 2: 运行确认通过**

Run: `npx vitest run tests/unit/xhttp-extra.test.js`
Expected: PASS。

- [ ] **Step 3: 跑相关回归测试**

Run: `npx vitest run tests/unit/xhttp-extra.test.js tests/unit/builtin-clash-generator.test.js tests/unit/builtin-singbox-generator.test.js tests/unit/builtin-loon-generator.test.js tests/unit/builtin-quanx-generator.test.js tests/unit/protocol-conversion-fixtures.test.js tests/unit/builtin-conversion-matrix.test.js`
Expected: 全部 PASS。sing-box/Loon/QuanX 生成器只读取 path/host/mode，extra 字段不会外泄到这些格式——若有用例因多余字段失败，检查该生成器是否用了 spread 整个 xhttp-opts（按现状不应发生）。

- [ ] **Step 4: 全量测试**

Run: `npx vitest run`
Expected: 全部 PASS（`--passWithNoTests` 已在 script 中）。

- [ ] **Step 5: 提交**

```bash
git add tests/unit/xhttp-extra.test.js
git commit -m "test(xhttp): end-to-end coverage for vless xhttp extra in clash output"
```

---

## 验证清单（实现完成后向用户汇报用）

- [ ] 用户原始链接 → Clash 输出包含全部 mihomo 字段
- [ ] `extra` 非法/非对象 JSON 静默忽略，不炸 Worker
- [ ] Clash 配置源 → VLESS URL 反向不丢 extra
- [ ] sing-box / Loon / QuanX / base64 输出行为不变（多余字段不外泄）
- [ ] 全量 vitest 通过

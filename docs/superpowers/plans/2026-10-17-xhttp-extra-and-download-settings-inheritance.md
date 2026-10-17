# VLESS xHTTP extra 补全与下行继承补偿实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 vless+xhttp 节点的 `extra`（padding / session / seq / uplinkData / xmux / downloadSettings）在 MiSub 的 Clash 输出中完整保留，并修正 mihomo 对下行 TLS / REALITY 配置的继承，使上下行分离节点按 Xray 语义工作。

**Architecture:** 新建纯函数模块 `functions/utils/xhttp-extra.js`，集中承载 Xray camelCase extra JSON ↔ mihomo kebab-case `xhttp-opts` 的双向映射与下行继承补偿。`url-to-clash.js` 的 `parseVlessUrl` 负责 URL 解析、调用映射与补偿；`clash-to-url.js` 的 vless xhttp 分支负责把 `xhttp-opts` 序列化回 `extra=`。生成器、其他协议与前端转换器不动。

**Tech Stack:** ES modules（`"type": "module"`）、vitest、Prettier（4 空格 / 单引号 / 分号 / printWidth 100）。

**上游基线：** imzyb/MiSub `4952c16`（2026-10-14）。本计划中的行号均以该提交为准；实现工作副本须基于该提交并已执行 `npm ci`。

**Specs：**
- `docs/superpowers/specs/2026-10-17-xhttp-extra-completion-design.md`
- `docs/superpowers/specs/2026-10-17-xhttp-download-settings-inheritance-design.md`

---

## File Structure

- Create: `functions/utils/xhttp-extra.js`
  - 职责：extra 字段与非安全下载字段的正反向映射、安全块映射、下行继承补偿。纯函数，不做 URL 解析、不写日志（唯一例外是 REALITY 缺公钥的告警）。
- Modify: `functions/utils/url-to-clash.js`
  - `parseVlessUrl` 的 xhttp 分支（168-241 行）改为调用 `parseXhttpExtra`，保留 path/host/mode 与 Host 头优先级。
  - 在 `return proxy` 前调用 `applyDownloadInheritanceGuard`。
- Modify: `functions/utils/clash-to-url.js`
  - vless 分支的 xhttp 段（212-218 行）追加 `extra=`。
- Create: `tests/unit/xhttp-extra.test.js`
  - 只覆盖核心流程：全字段正向映射、反向序列化、两个转换器接入、安全块映射、继承补偿关键分支、往返。

不修改：`builtin-*-generator.js`、`src/utils/protocols/**`、其他协议解析、mihomo 内核。

---

### Task 1: 正向映射（extra 与非安全下载字段）

**Files:**
- Create: `functions/utils/xhttp-extra.js`
- Test: `tests/unit/xhttp-extra.test.js`

- [ ] **Step 1: 写失败测试**

创建 `tests/unit/xhttp-extra.test.js`：

```javascript
import { describe, it, expect } from 'vitest';
import { parseXhttpExtra } from '../../functions/utils/xhttp-extra.js';

// packet-up 模式下 extra 可用的完整字段集；同时覆盖下行非安全字段。
const FULL_EXTRA = {
    headers: {
        Host: 'extra.example.com',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
    },
    xPaddingBytes: '100-1000',
    xPaddingObfsMode: true,
    xPaddingPlacement: 'queryInHeader',
    xPaddingMethod: 'tokenish',
    xPaddingKey: 'x',
    xPaddingHeader: 'Origin',
    sessionIDPlacement: 'query',
    sessionIDKey: 's',
    seqPlacement: 'query',
    seqKey: 'q',
    uplinkDataPlacement: 'header',
    uplinkDataKey: 'X-Data',
    sessionIDTable: 'Base62',
    sessionIDLength: '12-20',
    uplinkChunkSize: '2000-3000',
    uplinkHTTPMethod: 'GET',
    noGRPCHeader: false,
    scMaxEachPostBytes: '4000-8000',
    scMinPostsIntervalMs: '10-50',
    xmux: {
        maxConcurrency: 0,
        maxConnections: 0,
        cMaxReuseTimes: 0,
        hMaxRequestTimes: 0,
        hMaxReusableSecs: 0,
        hKeepAlivePeriod: 0,
    },
    downloadSettings: {
        address: 'cf2.example.com',
        port: 443,
        xhttpSettings: {
            path: '/dl',
            host: 'cf3.example.com',
            extra: { xmux: { maxConcurrency: 1 } },
        },
    },
};

describe('parseXhttpExtra 正向映射', () => {
    it('应完整映射 packet-up 的 extra 与非安全下载字段', () => {
        const opts = parseXhttpExtra(FULL_EXTRA);

        expect(opts).toEqual({
            headers: {
                Host: 'extra.example.com',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
            },
            'x-padding-bytes': '100-1000',
            'x-padding-obfs-mode': true,
            'x-padding-placement': 'queryInHeader',
            'x-padding-method': 'tokenish',
            'x-padding-key': 'x',
            'x-padding-header': 'Origin',
            'session-placement': 'query',
            'session-key': 's',
            'seq-placement': 'query',
            'seq-key': 'q',
            'uplink-data-placement': 'header',
            'uplink-data-key': 'X-Data',
            'session-table': 'Base62',
            'session-length': '12-20',
            'uplink-chunk-size': '2000-3000',
            'uplink-http-method': 'GET',
            'sc-max-each-post-bytes': '4000-8000',
            'sc-min-posts-interval-ms': '10-50',
            'reuse-settings': {
                'max-connections': '0',
                'max-concurrency': '0',
                'c-max-reuse-times': '0',
                'h-max-request-times': '0',
                'h-max-reusable-secs': '0',
                'h-keep-alive-period': 0,
            },
            'download-settings': {
                server: 'cf2.example.com',
                port: 443,
                path: '/dl',
                host: 'cf3.example.com',
                'reuse-settings': { 'max-concurrency': '1' },
            },
        });
    });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/unit/xhttp-extra.test.js`
Expected: FAIL，报错 `Cannot find module .../functions/utils/xhttp-extra.js`。

- [ ] **Step 3: 新建 `functions/utils/xhttp-extra.js`（本任务只实现正向部分）**

```javascript
/**
 * VLESS xHTTP extra 字段双向映射。
 *
 * 字段表以 mihomo 的 common/convert/v.go 与 adapter/outbound/vless.go 为准。
 * 这里保持纯函数、不负责 URL 解析与错误日志，避免转换逻辑和 HTTP 细节互相牵扯。
 */

function isPlainObject(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// mihomo 中这些字段最终按字符串读取，空串等同于“未配置”；
// 直接丢弃空值，避免生成会覆盖默认值的空配置。
function setNonEmptyString(source, sourceKey, target, targetKey) {
    const value = source[sourceKey];
    if (typeof value === 'string' && value !== '') {
        target[targetKey] = value;
    }
}

// Xray 的分包参数允许数字或区间字符串，mihomo 的配置层统一按字符串处理。
function setRangeField(source, sourceKey, target, targetKey) {
    const value = source[sourceKey];
    if (typeof value === 'string' && value !== '') {
        target[targetKey] = value;
    } else if (typeof value === 'number' && Number.isFinite(value)) {
        target[targetKey] = String(Math.trunc(value));
    }
}

function xmuxToReuseSettings(xmux) {
    const reuse = {};
    const set = (sourceKey, targetKey) => {
        const value = xmux[sourceKey];
        if (typeof value === 'string') {
            if (value !== '') reuse[targetKey] = value;
        } else if (typeof value === 'number' && Number.isFinite(value)) {
            reuse[targetKey] = String(Math.trunc(value));
        }
    };
    set('maxConnections', 'max-connections');
    set('maxConcurrency', 'max-concurrency');
    set('cMaxReuseTimes', 'c-max-reuse-times');
    set('hMaxRequestTimes', 'h-max-request-times');
    set('hMaxReusableSecs', 'h-max-reusable-secs');
    // mihomo 把该值当整数秒读取，写成字符串会被拒绝。
    if (typeof xmux.hKeepAlivePeriod === 'number' && Number.isFinite(xmux.hKeepAlivePeriod)) {
        reuse['h-keep-alive-period'] = Math.trunc(xmux.hKeepAlivePeriod);
    }
    return reuse;
}

function parseDownloadSettings(settings) {
    const ds = {};

    setNonEmptyString(settings, 'address', ds, 'server');
    if (typeof settings.port === 'number' && Number.isFinite(settings.port)) {
        ds.port = Math.trunc(settings.port);
    }

    const xhttp = isPlainObject(settings.xhttpSettings) ? settings.xhttpSettings : null;
    if (xhttp) {
        setNonEmptyString(xhttp, 'path', ds, 'path');
        setNonEmptyString(xhttp, 'host', ds, 'host');
        if (isPlainObject(xhttp.headers) && Object.keys(xhttp.headers).length > 0) {
            ds.headers = { ...xhttp.headers };
        }
        // 下行 extra 中只有 xmux 能独立于上行：padding/session/seq 是协议要求两端一致的字段，
        // mihomo 继承上行正好满足；其余字段属于客户端上行或服务端，没有下行语义。
        const xmux = isPlainObject(xhttp.extra) ? xhttp.extra.xmux : null;
        if (isPlainObject(xmux) && Object.keys(xmux).length > 0) {
            const reuse = xmuxToReuseSettings(xmux);
            if (Object.keys(reuse).length > 0) {
                ds['reuse-settings'] = reuse;
            }
        }
    }

    return ds;
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

    setNonEmptyString(extra, 'xPaddingBytes', opts, 'x-padding-bytes');
    if (typeof extra.xPaddingObfsMode === 'boolean') {
        opts['x-padding-obfs-mode'] = extra.xPaddingObfsMode;
    }
    setNonEmptyString(extra, 'xPaddingKey', opts, 'x-padding-key');
    setNonEmptyString(extra, 'xPaddingHeader', opts, 'x-padding-header');
    setNonEmptyString(extra, 'xPaddingPlacement', opts, 'x-padding-placement');
    setNonEmptyString(extra, 'xPaddingMethod', opts, 'x-padding-method');
    setNonEmptyString(extra, 'uplinkHTTPMethod', opts, 'uplink-http-method');

    // Xray 规范名是 sessionID*，但存量链接里仍有旧名；规范名优先，避免两者同时出现时行为不确定。
    if (typeof extra.sessionIDPlacement === 'string' && extra.sessionIDPlacement !== '') {
        opts['session-placement'] = extra.sessionIDPlacement;
    } else {
        setNonEmptyString(extra, 'sessionPlacement', opts, 'session-placement');
    }
    if (typeof extra.sessionIDKey === 'string' && extra.sessionIDKey !== '') {
        opts['session-key'] = extra.sessionIDKey;
    } else {
        setNonEmptyString(extra, 'sessionKey', opts, 'session-key');
    }
    setNonEmptyString(extra, 'sessionIDTable', opts, 'session-table');
    if (typeof extra.sessionIDLength === 'string' && extra.sessionIDLength !== '') {
        opts['session-length'] = extra.sessionIDLength;
    } else if (
        typeof extra.sessionIDLength === 'number' &&
        Number.isFinite(extra.sessionIDLength)
    ) {
        opts['session-length'] = String(Math.trunc(extra.sessionIDLength));
    }

    setNonEmptyString(extra, 'seqPlacement', opts, 'seq-placement');
    setNonEmptyString(extra, 'seqKey', opts, 'seq-key');
    setNonEmptyString(extra, 'uplinkDataPlacement', opts, 'uplink-data-placement');
    setNonEmptyString(extra, 'uplinkDataKey', opts, 'uplink-data-key');

    setRangeField(extra, 'uplinkChunkSize', opts, 'uplink-chunk-size');
    setRangeField(extra, 'scMaxEachPostBytes', opts, 'sc-max-each-post-bytes');
    setRangeField(extra, 'scMinPostsIntervalMs', opts, 'sc-min-posts-interval-ms');

    if (isPlainObject(extra.headers) && Object.keys(extra.headers).length > 0) {
        opts.headers = { ...extra.headers };
    }

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
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run tests/unit/xhttp-extra.test.js`
Expected: PASS，`1 passed`。

- [ ] **Step 5: 提交**

```bash
git add functions/utils/xhttp-extra.js tests/unit/xhttp-extra.test.js
git commit -m "feat(xhttp): map xray extra fields to mihomo xhttp-opts"
```

---

### Task 2: 反向序列化（extra 与非安全下载字段）

**Files:**
- Modify: `functions/utils/xhttp-extra.js`
- Test: `tests/unit/xhttp-extra.test.js`

- [ ] **Step 1: 写失败测试**

把测试文件顶部的 import 改为：

```javascript
import { describe, it, expect } from 'vitest';
import { parseXhttpExtra, serializeXhttpExtra } from '../../functions/utils/xhttp-extra.js';
```

在 `FULL_EXTRA` 之后追加：

```javascript
const PARSED_OPTS = parseXhttpExtra(FULL_EXTRA);
```

在文件末尾追加：

```javascript
describe('serializeXhttpExtra 反向序列化', () => {
    it('应把 mihomo xhttp-opts 逆向为 extra，并剔除 Host 头', () => {
        const extra = serializeXhttpExtra({
            path: '/up',
            host: 'up.example.com',
            mode: 'packet-up',
            ...PARSED_OPTS,
        });

        expect(extra).toEqual({
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
            },
            xPaddingBytes: '100-1000',
            xPaddingObfsMode: true,
            xPaddingPlacement: 'queryInHeader',
            xPaddingMethod: 'tokenish',
            xPaddingKey: 'x',
            xPaddingHeader: 'Origin',
            sessionIDPlacement: 'query',
            sessionIDKey: 's',
            seqPlacement: 'query',
            seqKey: 'q',
            uplinkDataPlacement: 'header',
            uplinkDataKey: 'X-Data',
            sessionIDTable: 'Base62',
            sessionIDLength: '12-20',
            uplinkChunkSize: '2000-3000',
            uplinkHTTPMethod: 'GET',
            scMaxEachPostBytes: '4000-8000',
            scMinPostsIntervalMs: '10-50',
            xmux: {
                maxConnections: '0',
                maxConcurrency: '0',
                cMaxReuseTimes: '0',
                hMaxRequestTimes: '0',
                hMaxReusableSecs: '0',
                hKeepAlivePeriod: 0,
            },
            downloadSettings: {
                address: 'cf2.example.com',
                port: 443,
                xhttpSettings: {
                    path: '/dl',
                    host: 'cf3.example.com',
                    extra: { xmux: { maxConcurrency: '1' } },
                },
            },
        });
    });

    it('不含 extra 字段时返回 null', () => {
        expect(serializeXhttpExtra({ path: '/x', host: 'h', mode: 'auto' })).toBeNull();
        expect(serializeXhttpExtra(null)).toBeNull();
    });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/unit/xhttp-extra.test.js`
Expected: FAIL，报错 `serializeXhttpExtra is not a function`。

- [ ] **Step 3: 在 `functions/utils/xhttp-extra.js` 追加反向实现**

在 `parseDownloadSettings` 之后、`parseXhttpExtra` 之前插入：

```javascript
function reuseSettingsToXmux(reuse) {
    const xmux = {};
    const set = (sourceKey, targetKey) => {
        const value = reuse[sourceKey];
        if (typeof value === 'string') {
            if (value !== '') xmux[targetKey] = value;
        } else if (typeof value === 'number' && Number.isFinite(value)) {
            xmux[targetKey] = String(Math.trunc(value));
        }
    };
    set('max-connections', 'maxConnections');
    set('max-concurrency', 'maxConcurrency');
    set('c-max-reuse-times', 'cMaxReuseTimes');
    set('h-max-request-times', 'hMaxRequestTimes');
    set('h-max-reusable-secs', 'hMaxReusableSecs');
    if (
        typeof reuse['h-keep-alive-period'] === 'number' &&
        Number.isFinite(reuse['h-keep-alive-period'])
    ) {
        xmux.hKeepAlivePeriod = Math.trunc(reuse['h-keep-alive-period']);
    }
    return xmux;
}

function serializeDownloadSettings(ds) {
    const out = {};

    if (typeof ds.server === 'string' && ds.server !== '') out.address = ds.server;
    if (typeof ds.port === 'number' && Number.isFinite(ds.port)) out.port = Math.trunc(ds.port);

    const xhttpSettings = {};
    if (typeof ds.path === 'string' && ds.path !== '') xhttpSettings.path = ds.path;
    if (typeof ds.host === 'string' && ds.host !== '') xhttpSettings.host = ds.host;
    if (isPlainObject(ds.headers) && Object.keys(ds.headers).length > 0) {
        xhttpSettings.headers = { ...ds.headers };
    }
    if (isPlainObject(ds['reuse-settings']) && Object.keys(ds['reuse-settings']).length > 0) {
        xhttpSettings.extra = { xmux: reuseSettingsToXmux(ds['reuse-settings']) };
    }
    if (Object.keys(xhttpSettings).length > 0) {
        out.xhttpSettings = xhttpSettings;
    }

    return out;
}
```

在文件末尾追加：

```javascript
/**
 * 把 mihomo xhttp-opts 逆向序列化为 Xray extra JSON 对象。
 * path/host/mode 不属于 extra，不输出。
 * @param {Object} xhttpOpts - mihomo xhttp-opts（含 path/host/mode 与 extra 派生字段）
 * @returns {Object|null} Xray extra 对象；不含任何 extra 字段时返回 null
 */
export function serializeXhttpExtra(xhttpOpts) {
    if (!isPlainObject(xhttpOpts)) return null;

    const extra = {};
    const getString = (sourceKey, targetKey) => {
        if (typeof xhttpOpts[sourceKey] === 'string' && xhttpOpts[sourceKey] !== '') {
            extra[targetKey] = xhttpOpts[sourceKey];
        }
    };
    const getRange = (sourceKey, targetKey) => {
        const value = xhttpOpts[sourceKey];
        if (typeof value === 'string' && value !== '') {
            extra[targetKey] = value;
        } else if (typeof value === 'number' && Number.isFinite(value)) {
            extra[targetKey] = String(Math.trunc(value));
        }
    };

    if (xhttpOpts['no-grpc-header'] === true) extra.noGRPCHeader = true;

    getString('x-padding-bytes', 'xPaddingBytes');
    if (typeof xhttpOpts['x-padding-obfs-mode'] === 'boolean') {
        extra.xPaddingObfsMode = xhttpOpts['x-padding-obfs-mode'];
    }
    getString('x-padding-key', 'xPaddingKey');
    getString('x-padding-header', 'xPaddingHeader');
    getString('x-padding-placement', 'xPaddingPlacement');
    getString('x-padding-method', 'xPaddingMethod');
    getString('uplink-http-method', 'uplinkHTTPMethod');

    // 输出 Xray 规范名；mihomo 正向解析同时接受新旧两种命名。
    getString('session-placement', 'sessionIDPlacement');
    getString('session-key', 'sessionIDKey');
    getString('session-table', 'sessionIDTable');
    getString('session-length', 'sessionIDLength');

    getString('seq-placement', 'seqPlacement');
    getString('seq-key', 'seqKey');
    getString('uplink-data-placement', 'uplinkDataPlacement');
    getString('uplink-data-key', 'uplinkDataKey');

    getRange('uplink-chunk-size', 'uplinkChunkSize');
    getRange('sc-max-each-post-bytes', 'scMaxEachPostBytes');
    getRange('sc-min-posts-interval-ms', 'scMinPostsIntervalMs');

    // Host 由 host 参数单独表达；留在 headers 里会让往返后的 Host 出现两个来源。
    if (isPlainObject(xhttpOpts.headers)) {
        const { Host, ...rest } = xhttpOpts.headers;
        if (Object.keys(rest).length > 0) extra.headers = rest;
    }

    if (
        isPlainObject(xhttpOpts['reuse-settings']) &&
        Object.keys(xhttpOpts['reuse-settings']).length > 0
    ) {
        extra.xmux = reuseSettingsToXmux(xhttpOpts['reuse-settings']);
    }

    if (isPlainObject(xhttpOpts['download-settings'])) {
        const ds = serializeDownloadSettings(xhttpOpts['download-settings']);
        if (Object.keys(ds).length > 0) extra.downloadSettings = ds;
    }

    return Object.keys(extra).length > 0 ? extra : null;
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run tests/unit/xhttp-extra.test.js`
Expected: PASS，`3 passed`。

- [ ] **Step 5: 提交**

```bash
git add functions/utils/xhttp-extra.js tests/unit/xhttp-extra.test.js
git commit -m "feat(xhttp): serialize mihomo xhttp-opts back to xray extra"
```

---

### Task 3: 接入两个转换器

**Files:**
- Modify: `functions/utils/url-to-clash.js:168-241`（xhttp 分支）
- Modify: `functions/utils/clash-to-url.js:212-218`（vless xhttp 段）
- Test: `tests/unit/xhttp-extra.test.js`

- [ ] **Step 1: 写失败测试**

把测试文件顶部的 import 改为：

```javascript
import { describe, it, expect, vi } from 'vitest';
import { parseXhttpExtra, serializeXhttpExtra } from '../../functions/utils/xhttp-extra.js';
import { urlToClashProxy } from '../../functions/utils/url-to-clash.js';
import { convertClashProxyToUrl } from '../../functions/utils/clash-to-url.js';
```

在文件末尾追加：

```javascript
const EXTRA_PARAM = encodeURIComponent(JSON.stringify(FULL_EXTRA));

const XHTTP_URL =
    'vless://uuid@1.2.3.4:443?encryption=none&security=none&type=xhttp' +
    `&path=%2Fup&host=url.example.com&mode=packet-up&extra=${EXTRA_PARAM}#node`;

describe('转换器接入', () => {
    it('parseVlessUrl 应合并 extra，并让 URL 的 Host 优先于 extra.headers.Host', () => {
        const proxy = urlToClashProxy(XHTTP_URL);
        const opts = proxy['xhttp-opts'];

        expect(opts.path).toBe('/up');
        expect(opts.host).toBe('url.example.com');
        expect(opts.headers).toEqual({
            Host: 'url.example.com',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        });
        expect(opts['x-padding-bytes']).toBe('100-1000');
        expect(opts['reuse-settings']['h-max-request-times']).toBe('0');
        expect(opts['download-settings']).toEqual({
            server: 'cf2.example.com',
            port: 443,
            path: '/dl',
            host: 'cf3.example.com',
            'reuse-settings': { 'max-concurrency': '1' },
        });
    });

    it('extra 为非法 JSON 时仍按基础字段导入', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const url = 'vless://uuid@1.2.3.4:443?type=xhttp&path=%2Fup&extra=%7Bnot-json';
        const proxy = urlToClashProxy(url);

        expect(proxy['xhttp-opts']).toEqual({ path: '/up' });
        expect(warn).toHaveBeenCalled();
        warn.mockRestore();
    });

    it('convertClashProxyToUrl 应输出 path/host/mode 与 extra', () => {
        const url = convertClashProxyToUrl({
            name: 'node',
            type: 'vless',
            server: '1.2.3.4',
            port: 443,
            uuid: 'uuid',
            network: 'xhttp',
            'xhttp-opts': {
                path: '/up',
                host: 'up.example.com',
                mode: 'packet-up',
                'x-padding-bytes': '100-1000',
                'session-placement': 'query',
                'reuse-settings': { 'max-concurrency': '1' },
            },
        });

        expect(url).toContain('type=xhttp');
        expect(url).toContain('path=%2Fup');
        expect(url).toContain('host=up.example.com');
        expect(url).toContain('mode=packet-up');

        const match = url.match(/(?:\?|&)extra=([^&#]*)/);
        expect(match).not.toBeNull();
        const extra = JSON.parse(decodeURIComponent(match[1]));
        expect(extra.xPaddingBytes).toBe('100-1000');
        expect(extra.sessionIDPlacement).toBe('query');
        expect(extra.xmux).toEqual({ maxConcurrency: '1' });
    });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/unit/xhttp-extra.test.js`
Expected: FAIL，新增用例中 `x-padding-bytes` 为 `undefined`（extra 尚未接入）。

- [ ] **Step 3: 修改两个转换器**

在 `functions/utils/url-to-clash.js` 顶部 import 区追加：

```javascript
import { parseXhttpExtra } from './xhttp-extra.js';
```

把 xhttp 分支中从 `/* Xray XHTTP 分享链接中的高级参数通常保存在 extra JSON 中 ... */` 注释开始，到 `catch` 块结束的整段（含过时的 5 字段注释）替换为：

```javascript
            const extraParam = params.get('extra');
            if (extraParam) {
                try {
                    const extraFields = parseXhttpExtra(JSON.parse(extraParam));
                    const { headers: extraHeaders, ...rest } = extraFields;
                    Object.assign(xhttpOpts, rest);
                    // URL 的 host 参数是分享链接的显式声明，优先级高于 extra 里的同名头。
                    if (extraHeaders) {
                        xhttpOpts.headers = { ...extraHeaders, ...(xhttpOpts.headers || {}) };
                    }
                } catch (e) {
                    // extra 非法时不能让整个订阅转换失败。
                    console.warn('[MiSub] XHTTP extra 参数解析失败:', e);
                }
            }
```

在 `functions/utils/clash-to-url.js` 顶部 import 区追加：

```javascript
import { serializeXhttpExtra } from './xhttp-extra.js';
```

把 vless 分支的 xhttp 段（当前 212-218 行）改为：

```javascript
            const xhttpOpts = proxy['xhttp-opts'] || proxy.xhttpOpts;
            if (xhttpOpts) {
                if (xhttpOpts.path) params.push(`path=${encodeURIComponent(xhttpOpts.path)}`);
                const xhttpHost = xhttpOpts.host || xhttpOpts.headers?.Host;
                if (xhttpHost) params.push(`host=${encodeURIComponent(xhttpHost)}`);
                if (xhttpOpts.mode) params.push(`mode=${encodeURIComponent(xhttpOpts.mode)}`);
                const extraObj = serializeXhttpExtra(xhttpOpts);
                if (extraObj) {
                    params.push(`extra=${encodeURIComponent(JSON.stringify(extraObj))}`);
                }
            }
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run tests/unit/xhttp-extra.test.js`
Expected: PASS，`6 passed`。

- [ ] **Step 5: 提交**

```bash
git add functions/utils/url-to-clash.js functions/utils/clash-to-url.js tests/unit/xhttp-extra.test.js
git commit -m "feat(xhttp): wire extra mapping into clash converters"
```

---

### Task 4: downloadSettings 安全块映射

**Files:**
- Modify: `functions/utils/xhttp-extra.js`（`parseDownloadSettings`）
- Test: `tests/unit/xhttp-extra.test.js`

- [ ] **Step 1: 写失败测试**

在文件末尾追加：

```javascript
describe('downloadSettings 安全块映射', () => {
    it('security 决定读取 tlsSettings 还是 realitySettings', () => {
        const tlsOpts = parseXhttpExtra({
            downloadSettings: {
                address: 'dl.example.com',
                port: 443,
                security: 'tls',
                tlsSettings: {
                    serverName: 'tls.example.com',
                    fingerprint: 'firefox',
                    alpn: ['h2'],
                    allowInsecure: true,
                },
                realitySettings: {
                    serverName: 'reality.example.com',
                    fingerprint: 'safari',
                    publicKey: 'rpk',
                    shortId: 'rsid',
                },
                xhttpSettings: { path: '/dl' },
            },
        });
        expect(tlsOpts['download-settings']).toEqual({
            server: 'dl.example.com',
            port: 443,
            tls: true,
            servername: 'tls.example.com',
            'client-fingerprint': 'firefox',
            alpn: ['h2'],
            'skip-cert-verify': true,
            path: '/dl',
        });

        const realityOpts = parseXhttpExtra({
            downloadSettings: {
                address: 'dl.example.com',
                port: 443,
                security: 'reality',
                tlsSettings: { serverName: 'tls.example.com', fingerprint: 'firefox' },
                realitySettings: {
                    serverName: 'reality.example.com',
                    fingerprint: 'safari',
                    publicKey: 'rpk',
                    shortId: 'rsid',
                },
            },
        });
        expect(realityOpts['download-settings']).toEqual({
            server: 'dl.example.com',
            port: 443,
            tls: true,
            servername: 'reality.example.com',
            'client-fingerprint': 'safari',
            'reality-opts': { 'public-key': 'rpk', 'short-id': 'rsid' },
        });
    });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/unit/xhttp-extra.test.js`
Expected: FAIL，`download-settings.tls` 为 `undefined`。

- [ ] **Step 3: 用以下完整实现替换 `parseDownloadSettings`**

```javascript
function parseDownloadSettings(settings) {
    const ds = {};

    setNonEmptyString(settings, 'address', ds, 'server');
    if (typeof settings.port === 'number' && Number.isFinite(settings.port)) {
        ds.port = Math.trunc(settings.port);
    }

    // Xray 的 downloadSettings 是独立 StreamConfig，security 缺省即 none；
    // 这里只负责把“有 TLS / REALITY”映射为 true，false 由补偿步骤补齐。
    const security = typeof settings.security === 'string' ? settings.security.toLowerCase() : '';
    if (security === 'tls') {
        ds.tls = true;
        const tls = isPlainObject(settings.tlsSettings) ? settings.tlsSettings : null;
        if (tls) {
            setNonEmptyString(tls, 'serverName', ds, 'servername');
            setNonEmptyString(tls, 'fingerprint', ds, 'client-fingerprint');
            if (Array.isArray(tls.alpn) && tls.alpn.length > 0) {
                const alpn = tls.alpn.filter((item) => typeof item === 'string');
                if (alpn.length > 0) ds.alpn = alpn;
            }
            if (tls.allowInsecure === true) {
                ds['skip-cert-verify'] = true;
            }
        }
    } else if (security === 'reality') {
        ds.tls = true;
        // REALITY 下 Xray 只读 realitySettings；tlsSettings 即使存在也不参与握手。
        const reality = isPlainObject(settings.realitySettings) ? settings.realitySettings : {};
        setNonEmptyString(reality, 'serverName', ds, 'servername');
        setNonEmptyString(reality, 'fingerprint', ds, 'client-fingerprint');
        const publicKey = typeof reality.publicKey === 'string' ? reality.publicKey : '';
        if (publicKey !== '') {
            const realityOpts = { 'public-key': publicKey };
            setNonEmptyString(reality, 'shortId', realityOpts, 'short-id');
            ds['reality-opts'] = realityOpts;
        } else {
            // 声明 REALITY 却没有公钥时，显式清空比继承上行安全：
            // 否则会拿上行公钥握手，表现为“能建立连接但认证必然失败”。
            ds['reality-opts'] = { 'public-key': '' };
            console.warn('[MiSub] XHTTP downloadSettings security=reality 缺少 publicKey');
        }
    }

    const xhttp = isPlainObject(settings.xhttpSettings) ? settings.xhttpSettings : null;
    if (xhttp) {
        setNonEmptyString(xhttp, 'path', ds, 'path');
        setNonEmptyString(xhttp, 'host', ds, 'host');
        if (isPlainObject(xhttp.headers) && Object.keys(xhttp.headers).length > 0) {
            ds.headers = { ...xhttp.headers };
        }
        // 下行 extra 中只有 xmux 能独立于上行：padding/session/seq 是协议要求两端一致的字段，
        // mihomo 继承上行正好满足；其余字段属于客户端上行或服务端，没有下行语义。
        const xmux = isPlainObject(xhttp.extra) ? xhttp.extra.xmux : null;
        if (isPlainObject(xmux) && Object.keys(xmux).length > 0) {
            const reuse = xmuxToReuseSettings(xmux);
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
Expected: PASS，`7 passed`。

- [ ] **Step 5: 提交**

```bash
git add functions/utils/xhttp-extra.js tests/unit/xhttp-extra.test.js
git commit -m "feat(xhttp): map downloadSettings tls and reality blocks"
```

---

### Task 5: 下行继承补偿

**Files:**
- Modify: `functions/utils/xhttp-extra.js`（新增 `applyDownloadInheritanceGuard`）
- Modify: `functions/utils/url-to-clash.js`（`return proxy` 之前调用）
- Test: `tests/unit/xhttp-extra.test.js`

- [ ] **Step 1: 写失败测试**

在文件末尾追加：

```javascript
const UPSTREAM_REALITY_QUERY = 'security=reality&pbk=upPbk&sid=abcd&sni=up.example.com&fp=chrome';

function buildXhttpUrl(query, extra) {
    return (
        `vless://uuid@1.2.3.4:443?encryption=none&type=xhttp&path=%2Fup&mode=packet-up&${query}` +
        `&extra=${encodeURIComponent(JSON.stringify(extra))}#node`
    );
}

describe('下行继承补偿', () => {
    it('上行 REALITY + 下行 TLS：清空 REALITY 并显式写出 TLS 字段', () => {
        const url = buildXhttpUrl(UPSTREAM_REALITY_QUERY, {
            downloadSettings: {
                address: 'cf2.example.com',
                port: 443,
                security: 'tls',
                tlsSettings: {
                    serverName: 'cf2.example.com',
                    fingerprint: 'chrome',
                    alpn: ['h3'],
                },
                xhttpSettings: { path: '/up' },
            },
        });
        const ds = urlToClashProxy(url)['xhttp-opts']['download-settings'];

        expect(ds).toEqual({
            server: 'cf2.example.com',
            port: 443,
            tls: true,
            servername: 'cf2.example.com',
            'client-fingerprint': 'chrome',
            alpn: ['h3'],
            path: '/up',
            'skip-cert-verify': false,
            'reality-opts': { 'public-key': '' },
        });
    });

    it('上行 REALITY + 下行无 security：tls 置 false 并清空 REALITY', () => {
        const url = buildXhttpUrl(UPSTREAM_REALITY_QUERY, {
            downloadSettings: {
                address: 'cf2.example.com',
                port: 443,
                xhttpSettings: { path: '/up' },
            },
        });
        const ds = urlToClashProxy(url)['xhttp-opts']['download-settings'];

        expect(ds).toEqual({
            server: 'cf2.example.com',
            port: 443,
            path: '/up',
            tls: false,
            'reality-opts': { 'public-key': '' },
        });
    });

    it('上行 TLS + 下行 REALITY：读取 realitySettings 并补 chrome / 空 ALPN', () => {
        const url = buildXhttpUrl('security=tls&sni=up.example.com&alpn=h3&fp=chrome', {
            downloadSettings: {
                address: 'reality.example.com',
                port: 443,
                security: 'reality',
                realitySettings: {
                    serverName: 'www.reality-target.com',
                    fingerprint: 'firefox',
                    publicKey: 'dlPbk',
                    shortId: 'dlSid',
                },
                xhttpSettings: { path: '/up' },
            },
        });
        const ds = urlToClashProxy(url)['xhttp-opts']['download-settings'];

        expect(ds).toEqual({
            server: 'reality.example.com',
            port: 443,
            tls: true,
            servername: 'www.reality-target.com',
            'client-fingerprint': 'firefox',
            'reality-opts': { 'public-key': 'dlPbk', 'short-id': 'dlSid' },
            path: '/up',
            alpn: [],
            'skip-cert-verify': false,
        });
    });

    it('下行 TLS 未提供任何 tlsSettings 时写入显式缺省值', () => {
        const url = buildXhttpUrl(UPSTREAM_REALITY_QUERY, {
            downloadSettings: {
                address: 'cf2.example.com',
                port: 443,
                security: 'tls',
            },
        });
        const ds = urlToClashProxy(url)['xhttp-opts']['download-settings'];

        expect(ds).toEqual({
            server: 'cf2.example.com',
            port: 443,
            tls: true,
            'reality-opts': { 'public-key': '' },
            servername: '',
            'client-fingerprint': 'chrome',
            alpn: [],
            'skip-cert-verify': false,
        });
    });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/unit/xhttp-extra.test.js`
Expected: FAIL，下行 `reality-opts` 为 `undefined` 或 TLS 缺省字段缺失。

- [ ] **Step 3: 新增补偿函数并接入 `parseVlessUrl`**

在 `functions/utils/xhttp-extra.js` 末尾追加：

```javascript
/**
 * 切断 mihomo 下行配置对上行 TLS / REALITY 字段的继承。
 *
 * Xray 的 downloadSettings 是独立 StreamConfig，缺省值不继承上行；mihomo 则在字段缺省时
 * 回退上行值。这里把缺省值写成显式值，让两边语义一致。
 */
export function applyDownloadInheritanceGuard(xhttpOpts, { upstreamReality } = {}) {
    const ds = xhttpOpts && xhttpOpts['download-settings'];
    if (!isPlainObject(ds)) return xhttpOpts;

    ds.tls = ds.tls === true;

    const publicKey = ds['reality-opts'] && ds['reality-opts']['public-key'];
    const downlinkReality = typeof publicKey === 'string' && publicKey !== '';
    if (!downlinkReality && upstreamReality) {
        // mihomo 只在 reality-opts 缺省时整份继承上行；空 public-key 会解析成 nil，
        // 是唯一能表达“下行不是 REALITY”的写法（空对象会触发结构解码报错）。
        ds['reality-opts'] = { 'public-key': '' };
    }

    if (!ds.tls) return xhttpOpts;

    // 上行常是 REALITY 伪装域名，其 SNI / ALPN 对下行 CDN 是错误值；
    // 空串与空数组在 mihomo 中同样是显式覆盖，不会回退上行。
    if (typeof ds.servername !== 'string') ds.servername = '';
    if (typeof ds['client-fingerprint'] !== 'string' || ds['client-fingerprint'] === '') {
        ds['client-fingerprint'] = 'chrome';
    }
    if (!Array.isArray(ds.alpn)) ds.alpn = [];
    if (typeof ds['skip-cert-verify'] !== 'boolean') ds['skip-cert-verify'] = false;

    return xhttpOpts;
}
```

在 `functions/utils/url-to-clash.js` 把顶部 import 改为：

```javascript
import { parseXhttpExtra, applyDownloadInheritanceGuard } from './xhttp-extra.js';
```

在 `parseVlessUrl` 的 `return proxy;` 之前插入：

```javascript
        const xhttpOpts = proxy['xhttp-opts'];
        if (xhttpOpts) {
            const upstreamPublicKey = proxy['reality-opts'] && proxy['reality-opts']['public-key'];
            applyDownloadInheritanceGuard(xhttpOpts, {
                upstreamReality:
                    typeof upstreamPublicKey === 'string' && upstreamPublicKey !== '',
            });
        }
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run tests/unit/xhttp-extra.test.js`
Expected: PASS，`11 passed`。

- [ ] **Step 5: 提交**

```bash
git add functions/utils/xhttp-extra.js functions/utils/url-to-clash.js tests/unit/xhttp-extra.test.js
git commit -m "fix(xhttp): stop download-settings from inheriting upstream tls and reality"
```

---

### Task 6: 反向安全字段、往返与回归

**Files:**
- Modify: `functions/utils/xhttp-extra.js`（`serializeDownloadSettings`）
- Test: `tests/unit/xhttp-extra.test.js`

- [ ] **Step 1: 写失败测试**

在文件末尾追加：

```javascript
describe('下行安全字段反向序列化', () => {
    it('空 public-key 不应被写成 reality，补偿默认值应被省略', () => {
        const url = convertClashProxyToUrl({
            name: 'node',
            type: 'vless',
            server: '1.2.3.4',
            port: 443,
            uuid: 'uuid',
            network: 'xhttp',
            tls: true,
            servername: 'up.example.com',
            'client-fingerprint': 'chrome',
            'xhttp-opts': {
                path: '/up',
                mode: 'packet-up',
                'download-settings': {
                    server: 'cf2.example.com',
                    port: 443,
                    tls: true,
                    servername: 'cf2.example.com',
                    'client-fingerprint': 'firefox',
                    alpn: ['h2'],
                    'skip-cert-verify': true,
                    path: '/up',
                    'reality-opts': { 'public-key': '' },
                },
            },
        });
        const extra = JSON.parse(
            decodeURIComponent(url.match(/(?:\?|&)extra=([^&#]*)/)[1])
        );

        expect(extra.downloadSettings).toEqual({
            address: 'cf2.example.com',
            port: 443,
            security: 'tls',
            tlsSettings: {
                serverName: 'cf2.example.com',
                fingerprint: 'firefox',
                alpn: ['h2'],
                allowInsecure: true,
            },
            xhttpSettings: { path: '/up' },
        });
        expect(extra.downloadSettings.realitySettings).toBeUndefined();
    });

    it('上行 REALITY + 下行 TLS 的链接往返后仍为 security=tls', () => {
        const url = buildXhttpUrl(UPSTREAM_REALITY_QUERY, {
            downloadSettings: {
                address: 'cf2.example.com',
                port: 443,
                security: 'tls',
                tlsSettings: {
                    serverName: 'cf2.example.com',
                    fingerprint: 'firefox',
                    alpn: ['h2'],
                },
                xhttpSettings: { path: '/up' },
            },
        });
        const roundTrip = convertClashProxyToUrl(urlToClashProxy(url));
        const extra = JSON.parse(
            decodeURIComponent(roundTrip.match(/(?:\?|&)extra=([^&#]*)/)[1])
        );

        expect(extra.downloadSettings.security).toBe('tls');
        expect(extra.downloadSettings.realitySettings).toBeUndefined();
        expect(extra.downloadSettings.tlsSettings.fingerprint).toBe('firefox');
    });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/unit/xhttp-extra.test.js`
Expected: FAIL，`extra.downloadSettings.security` 为 `undefined`（安全字段尚未反向写出）。

- [ ] **Step 3: 用以下完整实现替换 `serializeDownloadSettings`**

```javascript
function serializeDownloadSettings(ds) {
    const out = {};

    if (typeof ds.server === 'string' && ds.server !== '') out.address = ds.server;
    if (typeof ds.port === 'number' && Number.isFinite(ds.port)) out.port = Math.trunc(ds.port);

    const publicKey = ds['reality-opts'] && ds['reality-opts']['public-key'];
    const hasReality = typeof publicKey === 'string' && publicKey !== '';
    if (hasReality) {
        out.security = 'reality';
        const realitySettings = { publicKey };
        setNonEmptyString(ds['reality-opts'], 'short-id', realitySettings, 'shortId');
        setNonEmptyString(ds, 'servername', realitySettings, 'serverName');
        // chrome 是 Xray 两种 security 的缺省指纹；写回会把补偿产生的默认值固化成配置。
        if (
            typeof ds['client-fingerprint'] === 'string' &&
            ds['client-fingerprint'] !== '' &&
            ds['client-fingerprint'] !== 'chrome'
        ) {
            realitySettings.fingerprint = ds['client-fingerprint'];
        }
        out.realitySettings = realitySettings;
    } else if (ds.tls === true) {
        out.security = 'tls';
        const tlsSettings = {};
        setNonEmptyString(ds, 'servername', tlsSettings, 'serverName');
        if (
            typeof ds['client-fingerprint'] === 'string' &&
            ds['client-fingerprint'] !== '' &&
            ds['client-fingerprint'] !== 'chrome'
        ) {
            tlsSettings.fingerprint = ds['client-fingerprint'];
        }
        if (Array.isArray(ds.alpn) && ds.alpn.length > 0) {
            tlsSettings.alpn = ds.alpn;
        }
        if (ds['skip-cert-verify'] === true) {
            tlsSettings.allowInsecure = true;
        }
        if (Object.keys(tlsSettings).length > 0) {
            out.tlsSettings = tlsSettings;
        }
    }

    const xhttpSettings = {};
    if (typeof ds.path === 'string' && ds.path !== '') xhttpSettings.path = ds.path;
    if (typeof ds.host === 'string' && ds.host !== '') xhttpSettings.host = ds.host;
    if (isPlainObject(ds.headers) && Object.keys(ds.headers).length > 0) {
        xhttpSettings.headers = { ...ds.headers };
    }
    if (isPlainObject(ds['reuse-settings']) && Object.keys(ds['reuse-settings']).length > 0) {
        xhttpSettings.extra = { xmux: reuseSettingsToXmux(ds['reuse-settings']) };
    }
    if (Object.keys(xhttpSettings).length > 0) {
        out.xhttpSettings = xhttpSettings;
    }

    return out;
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run tests/unit/xhttp-extra.test.js`
Expected: PASS，`13 passed`。

- [ ] **Step 5: 跑相关回归**

Run:

```bash
npx vitest run tests/unit/reality-support-x25519mlkem768.test.js \
  tests/unit/protocol-conversion-fixtures.test.js \
  tests/unit/builtin-clash-generator.test.js
```

Expected: 全部 PASS。若失败，先检查是否改动了 `reality-opts` 的上行写法或其他协议分支；本计划不应触碰它们。

- [ ] **Step 6: 全量测试与格式检查**

Run:

```bash
npx vitest run
npx prettier --check functions/utils/xhttp-extra.js \
  functions/utils/url-to-clash.js functions/utils/clash-to-url.js \
  tests/unit/xhttp-extra.test.js
```

Expected: 测试全部 PASS；Prettier 输出 `All matched files use Prettier code style!`。若格式不符，只对上述四个文件执行 `npx prettier --write` 后重新跑 check。

- [ ] **Step 7: 一次性手工验证 mihomo 覆盖语义**

这一步无法由 vitest 覆盖，必须实际跑一次 mihomo 配置加载：

1. 用本计划生成的 Clash 配置（或手写等价片段）构造一个 `config.yaml`，其中 `proxies` 含：

```yaml
- name: verify
  type: vless
  server: 1.2.3.4
  port: 443
  uuid: 00000000-0000-0000-0000-000000000000
  network: xhttp
  tls: true
  servername: up.example.com
  client-fingerprint: chrome
  reality-opts:
    public-key: upPbk
    short-id: abcd
  xhttp-opts:
    path: /up
    mode: packet-up
    download-settings:
      server: cf2.example.com
      port: 443
      tls: false
      servername: ''
      alpn: []
      skip-cert-verify: false
      reality-opts:
        public-key: ''
```

2. Run: `mihomo -t -f config.yaml`
   Expected: 配置加载成功，无 `REALITY requires TLS`、无 `has unset fields: public-key`、无 `alpn` 类型错误。若任一项报错，说明显式空值不能覆盖继承，需要回到 spec 调整补偿字段的写法，而不是继续加代码。

- [ ] **Step 8: 提交**

```bash
git add functions/utils/xhttp-extra.js tests/unit/xhttp-extra.test.js
git commit -m "feat(xhttp): serialize download-settings security back to xray extra"
```

---

## 非目标（与 spec 保持一致）

- 不处理 `download-settings.host` / `path` / `headers` 的继承差异，也不处理 ECH、mTLS、证书 pin、ShadowTLS / Restls / JLS。
- 不改 mihomo 内核、各 `builtin-*-generator.js`、`src/utils/protocols/**` 与其他协议解析。
- 不做 `extra` 宽松 JSON（尾逗号纠错）解析，保持严格 `JSON.parse`。
- 不兜底 `stream-one` 与 `download-settings` 的非法组合；mihomo 与 Xray 都会直接报错。
- 不为了覆盖继承去新增 mihomo 字段，只使用 `XHTTPDownloadSettings` 已有 schema。

## 验证清单（实现完成后汇报）

- [ ] `extra` 的 packet-up 全字段进入 Clash 输出，`downloadSettings` 的 address/port/xhttpSettings/xmux 保留
- [ ] URL 的 `host` 优先于 `extra.headers.Host`，非法 JSON 不影响节点导入
- [ ] Clash → URL 反向输出 `extra=`，空结果不输出
- [ ] 下行 TLS / REALITY 按 `security` 只读对应块，不跨块取值
- [ ] 上行 REALITY + 下行 TLS / 无 security 时注入空 `public-key`，下行 TLS 字段显式覆盖
- [ ] 上行 TLS + 下行 REALITY 时使用 `realitySettings`，缺省 `chrome` 与 `alpn: []`
- [ ] 往返后下行仍为 `security=tls`，补偿默认值不被固化
- [ ] 定向测试、全量测试、Prettier 检查通过
- [ ] mihomo 配置加载手工验证通过

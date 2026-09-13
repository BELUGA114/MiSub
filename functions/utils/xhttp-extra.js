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
            reuse[dst] = String(Math.trunc(v));
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
            xmux[dst] = String(Math.trunc(v));
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

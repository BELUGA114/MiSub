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

import { describe, it, expect } from 'vitest';
import { parseXhttpExtra, serializeXhttpExtra } from '../../functions/utils/xhttp-extra.js';

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

    it('xmux 分数值应向零截断（对齐 mihomo strconv.FormatInt）', () => {
        const opts = parseXhttpExtra({ xmux: { maxConcurrency: 1.5, hMaxRequestTimes: 600.9 } });
        expect(opts['reuse-settings']).toEqual({ 'max-concurrency': '1', 'h-max-request-times': '600' });
    });

    it('空 xmux 或非对象 xmux 不产生 reuse-settings', () => {
        expect(parseXhttpExtra({ xmux: {} })['reuse-settings']).toBeUndefined();
        expect(parseXhttpExtra({ xmux: 'x' })['reuse-settings']).toBeUndefined();
    });

    it('downloadSettings 应映射为 download-settings（含 tls 与嵌套 xmux）', () => {
        const opts = parseXhttpExtra({
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

        expect(opts['download-settings']).toEqual({
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
        });
    });

    it('security=reality 时应输出 reality-opts', () => {
        const opts = parseXhttpExtra({
            downloadSettings: {
                address: 'dl.example.com',
                port: 443,
                security: 'reality',
                realitySettings: { publicKey: 'pbk', shortId: 'sid' }
            }
        });

        expect(opts['download-settings']).toEqual({
            server: 'dl.example.com',
            port: 443,
            tls: true,
            'reality-opts': { 'public-key': 'pbk', 'short-id': 'sid' }
        });
    });

    it('空对象与未知字段返回空对象', () => {
        expect(parseXhttpExtra({})).toEqual({});
        expect(parseXhttpExtra({ unknownField: 'x' })).toEqual({});
    });
});

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

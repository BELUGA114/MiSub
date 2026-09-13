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

import { describe, it, expect } from 'vitest';
import yaml from 'js-yaml';
import { parseXhttpExtra, serializeXhttpExtra, parseXhttpExtraParam } from '../../functions/utils/xhttp-extra.js';
import { urlToClashProxy } from '../../functions/utils/url-to-clash.js';
import { convertClashProxyToUrl } from '../../functions/utils/clash-to-url.js';
import { generateProxiesOnly } from '../../functions/modules/subscription/builtin-clash-generator.js';

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
        const opts = parseXhttpExtra({ xPaddingBytes: 123, xPaddingKey: true, uplinkChunkSize: true });
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

    it('extra.headers 应浅拷贝输出为 headers 字段', () => {
        const opts = parseXhttpExtra({
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
        });
        expect(opts.headers).toEqual({ 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' });
    });

    it('分包节奏字段应接受区间字符串并原样输出', () => {
        const opts = parseXhttpExtra({
            uplinkChunkSize: '2000-3000',
            scMaxEachPostBytes: '4000-8000',
            scMinPostsIntervalMs: '10-50'
        });
        expect(opts['uplink-chunk-size']).toBe('2000-3000');
        expect(opts['sc-max-each-post-bytes']).toBe('4000-8000');
        expect(opts['sc-min-posts-interval-ms']).toBe('10-50');
    });

    it('分包节奏字段的数字应转为截断后的十进制字符串', () => {
        const opts = parseXhttpExtra({ uplinkChunkSize: 2048.7, scMaxEachPostBytes: 1000000 });
        expect(opts['uplink-chunk-size']).toBe('2048');
        expect(opts['sc-max-each-post-bytes']).toBe('1000000');
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

    it('分包节奏字段的数字应序列化为字符串', () => {
        const extra = serializeXhttpExtra({
            'uplink-chunk-size': 2048,
            'sc-max-each-post-bytes': 1000000,
            'sc-min-posts-interval-ms': 30
        });
        expect(extra).toEqual({
            uplinkChunkSize: '2048',
            scMaxEachPostBytes: '1000000',
            scMinPostsIntervalMs: '30'
        });
    });

    it('headers 应逆向输出并剔除 Host 键', () => {
        const extra = serializeXhttpExtra({
            headers: { 'User-Agent': 'Mozilla/5.0', Host: 'x.example.com' }
        });
        expect(extra.headers).toEqual({ 'User-Agent': 'Mozilla/5.0' });
    });

    it('分包节奏字段的区间字符串应往返保留', () => {
        const extra = serializeXhttpExtra({
            'uplink-chunk-size': '2000-3000',
            'sc-max-each-post-bytes': '4000-8000',
            'sc-min-posts-interval-ms': '10-50'
        });
        expect(extra).toEqual({
            uplinkChunkSize: '2000-3000',
            scMaxEachPostBytes: '4000-8000',
            scMinPostsIntervalMs: '10-50'
        });
    });

    it('分包节奏字段的数字应截断序列化为字符串', () => {
        const extra = serializeXhttpExtra({ 'uplink-chunk-size': 2048 });
        expect(extra.uplinkChunkSize).toBe('2048');
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

    it('extra.headers 的自定义头应保留且不覆盖 Host', () => {
        const extraJson = JSON.stringify({
            headers: { 'User-Agent': 'Mozilla/5.0', Host: 'evil.example.com' },
            xPaddingBytes: '100-1000'
        });
        const url = `vless://uuid@1.2.3.4:443?type=xhttp&host=real.example.com&path=%2Ft&extra=${encodeURIComponent(extraJson)}`;
        const proxy = urlToClashProxy(url);

        expect(proxy['xhttp-opts'].headers).toEqual({
            Host: 'real.example.com',
            'User-Agent': 'Mozilla/5.0'
        });
    });
});

// 带尾逗号的 extra JSON（用户实际遇到的输入，含 CRLF 缩进）
const USER_URL_TRAILING_COMMA = 'vless://5f33ebda-7fb0-4977-bae3-1b55f3cdbed0@test.example.com:56239?encryption=none&security=none&sni=cf.cobweb11.top&fp=chrome&type=xhttp&path=%2Fcdn&mode=auto&extra=%7B%0D%0A%20%20%22seqPlacement%22%3A%20%22path%22%2C%0D%0A%20%20%22sessionIDLength%22%3A%20%2212-20%22%2C%0D%0A%20%20%22sessionIDPlacement%22%3A%20%22path%22%2C%0D%0A%20%20%22sessionIDTable%22%3A%20%22Alphabet%22%2C%0D%0A%20%20%22sessionPlacement%22%3A%20%22path%22%2C%0D%0A%20%20%22uplinkHTTPMethod%22%3A%20%22POST%22%2C%0D%0A%20%20%22xPaddingBytes%22%3A%20%22100-1000%22%2C%0D%0A%20%20%22xPaddingHeader%22%3A%20%22Referer%22%2C%0D%0A%20%20%22xPaddingKey%22%3A%20%22x%22%2C%0D%0A%20%20%22xPaddingMethod%22%3A%20%22tokenish%22%2C%0D%0A%20%20%22xPaddingObfsMode%22%3A%20true%2C%0D%0A%20%20%22xPaddingPlacement%22%3A%20%22queryInHeader%22%2C%0D%0A%7D#test-test';

describe('parseXhttpExtraParam 宽松 JSON 解析（自动纠错）', () => {
    it('标准 JSON 直接解析', () => {
        expect(parseXhttpExtraParam('{"xPaddingKey":"x"}')).toEqual({ xPaddingKey: 'x' });
    });

    it('对象与数组中的尾逗号应被剥离', () => {
        const raw = '{"xPaddingKey":"x","xmux":{"maxConcurrency":"1",},"headers":{"A":"b",},}';
        expect(parseXhttpExtraParam(raw)).toEqual({
            xPaddingKey: 'x',
            xmux: { maxConcurrency: '1' },
            headers: { A: 'b' }
        });
    });

    it('字符串值内的逗号与右括号不应被误删', () => {
        const raw = '{"xPaddingKey":"a, }","xPaddingHeader":"x\\", 1",}';
        expect(parseXhttpExtraParam(raw)).toEqual({
            xPaddingKey: 'a, }',
            xPaddingHeader: 'x", 1'
        });
    });

    it('无法修复的 JSON 返回 null', () => {
        expect(parseXhttpExtraParam('{not-json')).toBeNull();
        expect(parseXhttpExtraParam('')).toBeNull();
    });

    it('合法 JSON 但非对象返回 null', () => {
        expect(parseXhttpExtraParam('[1,2]')).toBeNull();
        expect(parseXhttpExtraParam('"str"')).toBeNull();
    });

    it('带尾逗号的用户实例 URL 应完整解析出 extra 字段', () => {
        const proxy = urlToClashProxy(USER_URL_TRAILING_COMMA);

        expect(proxy['xhttp-opts'].path).toBe('/cdn');
        expect(proxy['xhttp-opts']['x-padding-bytes']).toBe('100-1000');
        expect(proxy['xhttp-opts']['x-padding-obfs-mode']).toBe(true);
        expect(proxy['xhttp-opts']['x-padding-header']).toBe('Referer');
        expect(proxy['xhttp-opts']['session-placement']).toBe('path');
        expect(proxy['xhttp-opts']['session-length']).toBe('12-20');
        expect(proxy['xhttp-opts']['seq-placement']).toBe('path');
    });
});

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

    it('应输出 xhttp 的 host 参数', () => {
        const url = convertClashProxyToUrl({
            ...proxy,
            'xhttp-opts': { ...proxy['xhttp-opts'], host: 'test.example.com' }
        });
        expect(url).toContain('host=test.example.com');
    });

    it('YAML 奇形怪状的 xhttp-opts 不应抛错且不产生垃圾参数', () => {
        const url = convertClashProxyToUrl({
            ...proxy,
            'xhttp-opts': {
                path: null,
                mode: 123,
                'reuse-settings': null,
                'download-settings': null
            }
        });
        expect(url).toContain('type=xhttp');
        expect(url).not.toContain('path=null');
        expect(url).toContain('mode=123');
        expect(url).not.toContain('mode=undefined');
        expect(url).not.toContain('extra=');
    });
});

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

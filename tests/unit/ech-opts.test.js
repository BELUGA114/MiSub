import { describe, it, expect } from 'vitest';
import { urlToClashProxy } from '../../functions/utils/url-to-clash.js';
import { convertClashProxyToUrl } from '../../functions/utils/clash-to-url.js';

// Xray ech 参数三种格式（transport/internet/tls/ech.go）：
// 1. "example.com+udp://223.5.5.5:53" — 指定 DNS 查询 example.com 的 HTTPS ECH 记录
// 2. "udp://1.1.1.1" — 用 TLS serverName 作为查询名
// 3. 纯 base64 — 直接内嵌 ECHConfigList

describe('parseVlessUrl ech 参数映射（URL → Clash）', () => {
    const base = 'vless://5f33ebda-7fb0-4977-bae3-1b55f3cdbed0@test.example.com:56239?encryption=none&security=tls&sni=cf.example.com&fp=chrome';

    it('name+dnsserver 格式应映射 query-server-name，DNS 服务器部分 mihomo 无法表达而丢弃', () => {
        const proxy = urlToClashProxy(`${base}&type=xhttp&path=%2Fcdn&mode=auto&ech=${encodeURIComponent('cf.example.com+udp://223.5.5.5:53')}`);
        expect(proxy['ech-opts']).toEqual({
            enable: true,
            'query-server-name': 'cf.example.com'
        });
    });

    it('仅 dnsserver 格式应输出 enable（mihomo 默认用 servername 查询，与 Xray 行为一致）', () => {
        const proxy = urlToClashProxy(`${base}&type=xhttp&ech=${encodeURIComponent('udp://1.1.1.1')}`);
        expect(proxy['ech-opts']).toEqual({ enable: true });
    });

    it('纯 base64 格式应映射为 config', () => {
        const proxy = urlToClashProxy(`${base}&type=tcp&ech=AbCdEf123%2B%3D%3D`);
        expect(proxy['ech-opts']).toEqual({ enable: true, config: 'AbCdEf123+==' });
    });

    it('非法值（非 URL 格式且非 base64）应静默忽略，节点不挂', () => {
        const proxy = urlToClashProxy(`${base}&type=tcp&ech=not-base64-at-all`);
        expect(proxy['ech-opts']).toBeUndefined();
    });

    it('security=none 时 ech 应忽略（ECH 依赖 TLS）', () => {
        const proxy = urlToClashProxy(`vless://uuid@test.example.com:443?security=none&type=tcp&ech=${encodeURIComponent('udp://1.1.1.1')}`);
        expect(proxy['ech-opts']).toBeUndefined();
    });

    it('无 ech 参数时不受影响', () => {
        const proxy = urlToClashProxy(`${base}&type=tcp`);
        expect(proxy['ech-opts']).toBeUndefined();
    });
});

describe('parseTrojanUrl ech 参数映射', () => {
    it('trojan 链接的 ech 应映射为 ech-opts', () => {
        const proxy = urlToClashProxy(`trojan://pass@test.example.com:443?sni=cf.example.com&ech=${encodeURIComponent('cf.example.com+https://1.1.1.1/dns-query')}`);
        expect(proxy['ech-opts']).toEqual({
            enable: true,
            'query-server-name': 'cf.example.com'
        });
    });
});

describe('convertClashProxyToUrl ech-opts 反向序列化（Clash → URL）', () => {
    const proxy = {
        name: 'ECH', type: 'vless', server: 'test.example.com', port: 443,
        uuid: '5f33ebda-7fb0-4977-bae3-1b55f3cdbed0', tls: true
    };

    it('config 应无损还原为 ech 参数', () => {
        const url = convertClashProxyToUrl({ ...proxy, 'ech-opts': { enable: true, config: 'AbCdEf123+==' } });
        expect(url).toContain('ech=AbCdEf123%2B%3D%3D');
    });

    it('仅 query-server-name 时不应输出 ech（Xray URL 格式无法表达，避免生成下游非法 base64）', () => {
        const url = convertClashProxyToUrl({ ...proxy, 'ech-opts': { enable: true, 'query-server-name': 'cf.example.com' } });
        expect(url).not.toContain('ech=');
    });

    it('enable 为 false 或缺省时不输出 ech', () => {
        expect(convertClashProxyToUrl({ ...proxy, 'ech-opts': { enable: false, config: 'AbCd' } })).not.toContain('ech=');
        expect(convertClashProxyToUrl({ ...proxy, 'ech-opts': { config: 'AbCd' } })).not.toContain('ech=');
    });
});

describe('用户实例：vless+xhttp+tls+ech 端到端', () => {
    const USER_URL = 'vless://5f33ebda-7fb0-4977-bae3-1b55f3cdbed0@test.example.com:56239?encryption=none&security=tls&sni=cf.example.com&fp=chrome&alpn=h2&ech=cf.example.com%2Budp%3A%2F%2F223.5.5.5%3A53&type=xhttp&path=%2Fcdn&mode=auto&extra=%7B%22xPaddingBytes%22%3A%22100-1000%22%7D#test-test';

    it('ech 与 extra 应同时保留', () => {
        const proxy = urlToClashProxy(USER_URL);
        expect(proxy['ech-opts']).toEqual({ enable: true, 'query-server-name': 'cf.example.com' });
        expect(proxy['xhttp-opts']['x-padding-bytes']).toBe('100-1000');
    });
});

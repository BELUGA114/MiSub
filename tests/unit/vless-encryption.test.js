import { describe, it, expect } from 'vitest';
import { urlToClashProxy } from '../../functions/utils/url-to-clash.js';
import { convertClashProxyToUrl } from '../../functions/utils/clash-to-url.js';

// VLESS Encryption（Xray 抗量子加密）映射测试。
// 值形如 mlkem768x25519plus.<native|xorpub|random>.<1rtt|0rtt>.<paddings...>.<base64url 公钥...>。
// 对齐 mihomo transport/vless/encryption/factory.go：空串与 "none" 视为不加密。
// mihomo 自身的分享链接解析器 common/convert/v.go 不读取 encryption，本项目在转换层补齐。

const UUID = '5f33ebda-7fb0-4977-bae3-1b55f3cdbed0';
// 88 字符 base64url（X25519PasswordSize=32B → 43 字符；此处用一段合法的抗量子密钥占位）
const KEY = 'mlkem768x25519plus.native.1rtt.100-1000.hRq8fZ0eN1c2Xt7uYpLmKwVbGjDsFhAaBbCcDdEeFf';

describe('VLESS Encryption 映射（URL ↔ Clash）', () => {
    const base = `vless://${UUID}@test.example.com:443?security=tls&sni=cf.example.com&type=tcp`;

    it('encryption=none 应省略，不写入 proxy.encryption', () => {
        const proxy = urlToClashProxy(`${base}&encryption=none`);
        expect(proxy.encryption).toBeUndefined();
    });

    it('缺省 encryption 参数时也不写入', () => {
        const proxy = urlToClashProxy(base);
        expect(proxy.encryption).toBeUndefined();
    });

    it('抗量子加密值应透传到 proxy.encryption', () => {
        const proxy = urlToClashProxy(`${base}&encryption=${encodeURIComponent(KEY)}`);
        expect(proxy.encryption).toBe(KEY);
    });

    it('反向转换：proxy.encryption 应写回 URL 的 encryption 参数', () => {
        const url = convertClashProxyToUrl({
            name: 'PQ',
            type: 'vless',
            server: 'test.example.com',
            port: 443,
            uuid: UUID,
            tls: true,
            servername: 'cf.example.com',
            encryption: KEY
        });
        const params = new URLSearchParams(url.substring(url.indexOf('?') + 1, url.indexOf('#')));
        expect(params.get('encryption')).toBe(KEY);
    });

    it('反向转换：缺省 encryption 回落为 none', () => {
        const url = convertClashProxyToUrl({
            name: 'Plain',
            type: 'vless',
            server: 'test.example.com',
            port: 443,
            uuid: UUID,
            tls: true
        });
        const params = new URLSearchParams(url.substring(url.indexOf('?') + 1, url.indexOf('#')));
        expect(params.get('encryption')).toBe('none');
    });

    it('往返（URL → Clash → URL）应保留抗量子加密值', () => {
        const proxy = urlToClashProxy(`${base}&encryption=${encodeURIComponent(KEY)}`);
        const url = convertClashProxyToUrl(proxy);
        const params = new URLSearchParams(url.substring(url.indexOf('?') + 1, url.indexOf('#')));
        expect(params.get('encryption')).toBe(KEY);
    });
});

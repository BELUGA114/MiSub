import { describe, it, expect } from 'vitest';
import { convertClashProxyToUrl } from '../../functions/utils/clash-to-url.js';
import { urlToClashProxy } from '../../functions/utils/url-to-clash.js';

const V = '11111111-1111-1111-1111-111111111111';
describe('reality mlkem 往返（默认开启）', () => {
    it('VLESS 未显式禁用 → 默认开启，URL 不留 mlkem 痕', () => {
        const p = urlToClashProxy(`vless://${V}@a.com:443?encryption=none&security=reality&pbk=KEY&sid=01#n`);
        expect(p['reality-opts']['support-x25519mlkem768']).toBe(true);
        const url = convertClashProxyToUrl(p);
        expect(url).not.toContain('mlkem');
        expect(urlToClashProxy(url)['reality-opts']['support-x25519mlkem768']).toBe(true);
    });
    it('VLESS &mlkem=0 → 关闭并往返保留 mlkem=0', () => {
        const p = urlToClashProxy(`vless://${V}@a.com:443?encryption=none&security=reality&pbk=KEY&mlkem=0#n`);
        expect(p['reality-opts']['support-x25519mlkem768']).toBe(false);
        const url = convertClashProxyToUrl(p);
        expect(url).toContain('mlkem=0');
        expect(urlToClashProxy(url)['reality-opts']['support-x25519mlkem768']).toBe(false);
    });
    it('Trojan reality 往返（默认开启）', () => {
        const p = urlToClashProxy('trojan://pw@a.com:443?security=reality&pbk=KEY&sid=01#n');
        expect(p['reality-opts']['public-key']).toBe('KEY');
        expect(p['reality-opts']['support-x25519mlkem768']).toBe(true);
        const url = convertClashProxyToUrl(p);
        expect(url).toContain('security=reality');
        expect(url).toContain('pbk=KEY');
        expect(url).not.toContain('mlkem');
    });
});

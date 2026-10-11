import { describe, it, expect } from 'vitest';
import { convertClashProxyToUrl } from '../../functions/utils/clash-to-url.js';
import { urlToClashProxy } from '../../functions/utils/url-to-clash.js';

describe('IPv6 字面量服务器往返', () => {
    const cases = [
        { type: 'vless', server: '2001:db8::1', port: 443, uuid: '11111111-1111-1111-1111-111111111111', network: 'tcp', tls: true, servername: 'a.com' },
        { type: 'hysteria2', server: '2606:4700::1', port: 8443, password: 'pw' },
        { type: 'ss', server: 'fe80::1', port: 8388, cipher: 'aes-128-gcm', password: 'pw' }
    ];
    for (const proxy of cases) {
        it(`${proxy.type} 的 IPv6 server 加括号且可再解析`, () => {
            const url = convertClashProxyToUrl({ name: 'n', ...proxy });
            expect(url).toContain(`[${proxy.server}]:${proxy.port}`);
            const parsed = urlToClashProxy(url);
            expect(parsed).not.toBeNull();
            expect(parsed.server).toBe(proxy.server);
            expect(parsed.port).toBe(proxy.port);
        });
    }
});

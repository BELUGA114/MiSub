import { describe, it, expect } from 'vitest';
import { convertClashProxyToUrl } from '../../functions/utils/clash-to-url.js';
import { urlToClashProxy } from '../../functions/utils/url-to-clash.js';

describe('WireGuard IPv6 本地地址往返', () => {
    it('address 拆 ip/ipv6 并去 CIDR，双向保留', () => {
        const p = urlToClashProxy('wireguard://cHJpdmtleQ==@h.com:51820?publickey=UFVC&address=10.0.0.2/32,fd00::2/128');
        expect(p.ip).toEqual(['10.0.0.2']);
        expect(p.ipv6).toEqual(['fd00::2']);
        const url = convertClashProxyToUrl(p);
        const addr = new URLSearchParams(url.split('?')[1].split('#')[0]).get('address');
        expect(addr.split(',')).toEqual(['10.0.0.2', 'fd00::2']);
    });
});

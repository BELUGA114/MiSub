import { describe, it, expect } from 'vitest';
import { convertClashProxyToUrl } from '../../functions/utils/clash-to-url.js';
import { urlToClashProxy } from '../../functions/utils/url-to-clash.js';

describe('Hysteria2 端口跳跃往返', () => {
    it('mport 作为 ports 的回退被导入', () => {
        const p = urlToClashProxy('hysteria2://pw@h.com:443?mport=1000-2000#n');
        expect(p.ports).toBe('1000-2000');
    });
    it('ports 优先于 mport', () => {
        const p = urlToClashProxy('hysteria2://pw@h.com:443?ports=3000-4000&mport=1000-2000#n');
        expect(p.ports).toBe('3000-4000');
    });
    it('hop-interval 双向存活', () => {
        const url = convertClashProxyToUrl({ name: 'n', type: 'hysteria2', server: 'h.com', port: 443, password: 'pw', ports: '1000-2000', 'hop-interval': 30 });
        expect(url).toContain('hop-interval=30');
        const p = urlToClashProxy(url);
        expect(p['hop-interval']).toBe(30);
        expect(p.ports).toBe('1000-2000');
    });
});

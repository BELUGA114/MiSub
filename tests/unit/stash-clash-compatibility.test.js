import { describe, it, expect } from 'vitest';
import { generateBuiltinClashConfig } from '../../functions/modules/subscription/builtin-clash-generator.js';

describe('Stash 兼容', () => {
    it('hysteria2 同时输出 password 与 auth', () => {
        const out = generateBuiltinClashConfig('hysteria2://pw@h.com:443?sni=h.com#Hy', { userAgent: 'Stash/2.0' });
        expect(out).toContain('auth: pw');
        expect(out).toContain('password: pw');
    });
    it('Stash UA 首行是 #SUBSCRIBED，非 Stash 不带', () => {
        const stash = generateBuiltinClashConfig('hysteria2://pw@h.com:443#Hy', { userAgent: 'Stash/2.0', managedConfigUrl: 'https://x.com/sub' });
        expect(stash.split('\n')[0]).toBe('#SUBSCRIBED https://x.com/sub');
        const clash = generateBuiltinClashConfig('hysteria2://pw@h.com:443#Hy', { userAgent: 'clash.meta', managedConfigUrl: 'https://x.com/sub' });
        expect(clash.startsWith('#SUBSCRIBED')).toBe(false);
    });
});

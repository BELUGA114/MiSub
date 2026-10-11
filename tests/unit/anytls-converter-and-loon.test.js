import { describe, it, expect } from 'vitest';
import { convertClashProxyToUrl } from '../../src/utils/protocols/clash.js';
import { generateBuiltinLoonConfig } from '../../functions/modules/subscription/builtin-loon-generator.js';

describe('anytls 前端转换与 builtin-loon', () => {
    it('前端 clash→url 支持 anytls（不再 return null）', () => {
        const url = convertClashProxyToUrl({ name: 'Any', type: 'anytls', server: 'a.com', port: 443, password: 'pw', sni: 'a.com' });
        expect(url).toBeTruthy();
        expect(url.startsWith('anytls://')).toBe(true);
        expect(url).toContain('sni=a.com');
    });
    it('builtin-loon 输出含 anytls 行', () => {
        const result = generateBuiltinLoonConfig('anytls://pw@a.com:443?sni=a.com#AnyNode');
        expect(result).toContain('= anytls');
        expect(result).toContain('a.com');
    });
});

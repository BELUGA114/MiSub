import { describe, it, expect } from 'vitest';
import { convertVlessToUrl } from '../../src/utils/protocols/converters/vless.js';

describe('前端 vless xhttp', () => {
    it('xhttp 的 path/host/mode 进入 URL', () => {
        const url = convertVlessToUrl({ name: 'n', type: 'vless', server: 'a.com', port: 443, uuid: '11111111-1111-1111-1111-111111111111', network: 'xhttp', 'xhttp-opts': { path: '/p', host: 'h.com', mode: 'auto' } });
        const qs = new URLSearchParams(url.split('?')[1].split('#')[0]);
        expect(qs.get('type')).toBe('xhttp');
        expect(qs.get('path')).toBe('/p');
        expect(qs.get('host')).toBe('h.com');
        expect(qs.get('mode')).toBe('auto');
    });
});

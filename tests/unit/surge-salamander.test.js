import { describe, expect, it } from 'vitest';
import { generateBuiltinSurgeConfig } from '../../functions/modules/subscription/builtin-surge-generator.js';
import { renderSurgeFromTemplateModel } from '../../functions/modules/subscription/template-renderers/render-surge.js';
import { convertClashProxyToUrl } from '../../functions/utils/clash-to-url.js';

const proxy = {
    name: 'HY2', type: 'hysteria2', server: 'hy2.example.com', port: 443,
    password: 'password', obfs: 'salamander', 'obfs-password': 'obfs-secret'
};

const renderers = [
    ['builtin', (node) => generateBuiltinSurgeConfig(convertClashProxyToUrl(node), { enableEmoji: false })],
    ['template', (node) => renderSurgeFromTemplateModel({ proxies: [node], groups: [], rules: [] })]
];

describe.each(renderers)('Surge Salamander output (%s)', (_name, render) => {
    it('preserves the Hysteria2 obfuscation password', () => {
        expect(render(proxy)).toContain('salamander-password=obfs-secret');
    });

    it('does not emit a Salamander password for other obfuscation modes', () => {
        expect(render({ ...proxy, obfs: 'other' })).not.toContain('salamander-password=');
    });

});

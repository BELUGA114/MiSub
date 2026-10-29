import { describe, expect, it } from 'vitest';
import { urlToClashProxy } from '../../functions/utils/url-to-clash.js';
import { convertClashProxyToUrl } from '../../functions/utils/clash-to-url.js';

describe('XHTTP header conversion', () => {
    it('keeps the explicit URL Host and filters non-string header values', () => {
        const extra = { headers: { host: 'extra.example.com', 'X-Token': 'token', 'X-Number': 1 } };
        const url = `vless://uuid@example.com:443?type=xhttp&host=url.example.com&extra=${encodeURIComponent(JSON.stringify(extra))}`;
        expect(urlToClashProxy(url)['xhttp-opts'].headers).toEqual({ Host: 'url.example.com', 'X-Token': 'token' });
    });

    it('exports a lowercase Host through the URL host parameter', () => {
        const url = convertClashProxyToUrl({
            type: 'vless', name: 'node', server: 'example.com', port: 443, uuid: 'uuid', network: 'xhttp',
            'xhttp-opts': { headers: { host: 'header.example.com', 'X-Token': 'token' } }
        });
        const params = new URL(url).searchParams;
        expect(params.get('host')).toBe('header.example.com');
        expect(JSON.parse(params.get('extra'))).toEqual({ headers: { 'X-Token': 'token' } });
    });
});

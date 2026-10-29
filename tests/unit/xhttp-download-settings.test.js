import { describe, it, expect, vi } from 'vitest';
import { parseXhttpExtra, serializeXhttpExtra } from '../../functions/utils/xhttp-extra.js';
import { urlToClashProxy } from '../../functions/utils/url-to-clash.js';
import { convertClashProxyToUrl } from '../../functions/utils/clash-to-url.js';

describe('downloadSettings 安全块映射', () => {
    it('security 决定读取 tlsSettings 还是 realitySettings', () => {
        const tlsOpts = parseXhttpExtra({
            downloadSettings: {
                address: 'dl.example.com',
                port: 443,
                security: 'tls',
                tlsSettings: {
                    serverName: 'tls.example.com',
                    fingerprint: 'firefox',
                    // Xray 的 StringList 同时接受字符串形式
                    alpn: 'h2, http/1.1',
                    allowInsecure: true,
                },
                realitySettings: {
                    serverName: 'reality.example.com',
                    fingerprint: 'safari',
                    publicKey: 'rpk',
                    shortId: 'rsid',
                },
                xhttpSettings: { path: '/dl' },
            },
        });
        expect(tlsOpts['download-settings']).toEqual({
            server: 'dl.example.com',
            port: 443,
            tls: true,
            servername: 'tls.example.com',
            'client-fingerprint': 'firefox',
            alpn: ['h2', 'http/1.1'],
            'skip-cert-verify': true,
            path: '/dl',
        });

        const realityOpts = parseXhttpExtra({
            downloadSettings: {
                address: 'dl.example.com',
                port: 443,
                security: 'reality',
                tlsSettings: { serverName: 'tls.example.com', fingerprint: 'firefox' },
                realitySettings: {
                    serverName: 'reality.example.com',
                    fingerprint: 'safari',
                    publicKey: 'rpk',
                    shortId: 'rsid',
                },
            },
        });
        expect(realityOpts['download-settings']).toEqual({
            server: 'dl.example.com',
            port: 443,
            tls: true,
            servername: 'reality.example.com',
            'client-fingerprint': 'safari',
            'reality-opts': { 'public-key': 'rpk', 'short-id': 'rsid' },
        });
    });

    it('security=reality 缺少 publicKey 时应显式清空并告警', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const opts = parseXhttpExtra({
            downloadSettings: {
                address: 'dl.example.com',
                security: 'reality',
                tlsSettings: { serverName: 'tls.example.com', fingerprint: 'firefox' },
                realitySettings: { serverName: 'reality.example.com', fingerprint: 'safari' },
            },
        });

        expect(opts['download-settings']).toEqual({
            server: 'dl.example.com',
            tls: true,
            servername: 'reality.example.com',
            'client-fingerprint': 'safari',
            'reality-opts': { 'public-key': '' },
        });
        expect(warn).toHaveBeenCalled();
        warn.mockRestore();
    });

    it('security=none 时不读取任何安全块', () => {
        const opts = parseXhttpExtra({
            downloadSettings: {
                address: 'dl.example.com',
                security: 'none',
                tlsSettings: {
                    serverName: 'tls.example.com',
                    fingerprint: 'firefox',
                    allowInsecure: true,
                },
                realitySettings: { publicKey: 'pk', serverName: 'reality.example.com' },
                xhttpSettings: { path: '/dl' },
            },
        });

        expect(opts['download-settings']).toEqual({ server: 'dl.example.com', path: '/dl' });
    });
});

const UPSTREAM_REALITY_QUERY = 'security=reality&pbk=upPbk&sid=abcd&sni=up.example.com&fp=chrome';

function buildXhttpUrl(query, extra) {
    return (
        `vless://uuid@1.2.3.4:443?encryption=none&type=xhttp&path=%2Fup&mode=packet-up&${query}` +
        `&extra=${encodeURIComponent(JSON.stringify(extra))}#node`
    );
}

describe('下行继承补偿', () => {
    it('上行 REALITY + 下行 TLS：清空 REALITY 并显式写出 TLS 字段', () => {
        const url = buildXhttpUrl(UPSTREAM_REALITY_QUERY, {
            downloadSettings: {
                address: 'cf2.example.com',
                port: 443,
                security: 'tls',
                tlsSettings: {
                    serverName: 'cf2.example.com',
                    fingerprint: 'chrome',
                    alpn: ['h3'],
                },
                xhttpSettings: { path: '/up' },
            },
        });
        const ds = urlToClashProxy(url)['xhttp-opts']['download-settings'];

        expect(ds).toEqual({
            server: 'cf2.example.com',
            port: 443,
            tls: true,
            servername: 'cf2.example.com',
            'client-fingerprint': 'chrome',
            alpn: ['h3'],
            path: '/up',
            'skip-cert-verify': false,
            'reality-opts': { 'public-key': '' },
        });
    });

    it('上行 REALITY + 下行无 security：tls 置 false 并清空 REALITY', () => {
        const url = buildXhttpUrl(UPSTREAM_REALITY_QUERY, {
            downloadSettings: {
                address: 'cf2.example.com',
                port: 443,
                xhttpSettings: { path: '/up' },
            },
        });
        const ds = urlToClashProxy(url)['xhttp-opts']['download-settings'];

        expect(ds).toEqual({
            server: 'cf2.example.com',
            port: 443,
            path: '/up',
            tls: false,
            'reality-opts': { 'public-key': '' },
        });
    });

    it('上行 TLS + 下行 REALITY：读取 realitySettings 并补 chrome / 空 ALPN', () => {
        const url = buildXhttpUrl('security=tls&sni=up.example.com&alpn=h3&fp=chrome', {
            downloadSettings: {
                address: 'reality.example.com',
                port: 443,
                security: 'reality',
                realitySettings: {
                    serverName: 'www.reality-target.com',
                    fingerprint: 'firefox',
                    publicKey: 'dlPbk',
                    shortId: 'dlSid',
                },
                xhttpSettings: { path: '/up' },
            },
        });
        const ds = urlToClashProxy(url)['xhttp-opts']['download-settings'];

        expect(ds).toEqual({
            server: 'reality.example.com',
            port: 443,
            tls: true,
            servername: 'www.reality-target.com',
            'client-fingerprint': 'firefox',
            'reality-opts': { 'public-key': 'dlPbk', 'short-id': 'dlSid' },
            path: '/up',
            alpn: [],
            'skip-cert-verify': false,
        });
    });

    it('下行 TLS 未提供任何 tlsSettings 时写入显式缺省值', () => {
        const url = buildXhttpUrl(UPSTREAM_REALITY_QUERY, {
            downloadSettings: {
                address: 'cf2.example.com',
                port: 443,
                security: 'tls',
            },
        });
        const ds = urlToClashProxy(url)['xhttp-opts']['download-settings'];

        expect(ds).toEqual({
            server: 'cf2.example.com',
            port: 443,
            tls: true,
            'reality-opts': { 'public-key': '' },
            servername: '',
            'client-fingerprint': 'chrome',
            alpn: [],
            'skip-cert-verify': false,
        });
    });
});

describe('下行安全字段反向序列化', () => {
    it('空 public-key 不应被写成 reality，补偿默认值应被省略', () => {
        const url = convertClashProxyToUrl({
            name: 'node',
            type: 'vless',
            server: '1.2.3.4',
            port: 443,
            uuid: 'uuid',
            network: 'xhttp',
            tls: true,
            servername: 'up.example.com',
            'client-fingerprint': 'chrome',
            'xhttp-opts': {
                path: '/up',
                mode: 'packet-up',
                'download-settings': {
                    server: 'cf2.example.com',
                    port: 443,
                    tls: true,
                    servername: 'cf2.example.com',
                    'client-fingerprint': 'firefox',
                    alpn: ['h2'],
                    'skip-cert-verify': true,
                    path: '/up',
                    'reality-opts': { 'public-key': '' },
                },
            },
        });
        const extra = JSON.parse(decodeURIComponent(url.match(/(?:\?|&)extra=([^&#]*)/)[1]));

        expect(extra.downloadSettings).toEqual({
            address: 'cf2.example.com',
            port: 443,
            network: 'xhttp',
            security: 'tls',
            tlsSettings: {
                serverName: 'cf2.example.com',
                fingerprint: 'firefox',
                alpn: ['h2'],
                allowInsecure: true,
            },
            xhttpSettings: { path: '/up' },
        });
        expect(extra.downloadSettings.realitySettings).toBeUndefined();
    });

    it('上行 REALITY + 下行 TLS 的链接往返后仍为 security=tls', () => {
        const url = buildXhttpUrl(UPSTREAM_REALITY_QUERY, {
            downloadSettings: {
                address: 'cf2.example.com',
                port: 443,
                security: 'tls',
                tlsSettings: {
                    serverName: 'cf2.example.com',
                    fingerprint: 'firefox',
                    alpn: ['h2'],
                },
                xhttpSettings: { path: '/up' },
            },
        });
        const roundTrip = convertClashProxyToUrl(urlToClashProxy(url));
        const extra = JSON.parse(decodeURIComponent(roundTrip.match(/(?:\?|&)extra=([^&#]*)/)[1]));

        expect(extra.downloadSettings.security).toBe('tls');
        expect(extra.downloadSettings.realitySettings).toBeUndefined();
        expect(extra.downloadSettings.tlsSettings.fingerprint).toBe('firefox');
    });

    it('下行 REALITY 应写回 realitySettings 并省略默认指纹', () => {
        const extra = serializeXhttpExtra({
            'download-settings': {
                server: 'dl.example.com',
                port: 443,
                tls: true,
                servername: 'target.example.com',
                'client-fingerprint': 'chrome',
                alpn: [],
                'skip-cert-verify': false,
                'reality-opts': { 'public-key': 'pk', 'short-id': 'sid' },
            },
        });

        expect(extra.downloadSettings).toEqual({
            address: 'dl.example.com',
            port: 443,
            network: 'xhttp',
            security: 'reality',
            realitySettings: {
                publicKey: 'pk',
                shortId: 'sid',
                serverName: 'target.example.com',
            },
        });
    });
});

describe('下行继承的反向物化', () => {
    it('Clash 源依赖下行继承 REALITY 时，Clash→URL→Clash 仍保持 REALITY', () => {
        const url = convertClashProxyToUrl({
            name: 'node',
            type: 'vless',
            server: '1.2.3.4',
            port: 443,
            uuid: 'uuid',
            network: 'xhttp',
            tls: true,
            servername: 'up.example.com',
            'client-fingerprint': 'firefox',
            'reality-opts': { 'public-key': 'upPbk', 'short-id': 'abcd' },
            'xhttp-opts': {
                path: '/up',
                mode: 'stream-up',
                'download-settings': { server: 'cdn.example.com', port: 443 },
            },
        });
        const extra = JSON.parse(decodeURIComponent(url.match(/(?:\?|&)extra=([^&#]*)/)[1]));

        expect(extra.downloadSettings.network).toBe('xhttp');
        expect(extra.downloadSettings.security).toBe('reality');
        expect(extra.downloadSettings.realitySettings).toEqual({
            publicKey: 'upPbk',
            shortId: 'abcd',
            serverName: 'up.example.com',
            fingerprint: 'firefox',
        });

        const ds = urlToClashProxy(url)['xhttp-opts']['download-settings'];
        expect(ds.tls).toBe(true);
        expect(ds['reality-opts']).toEqual({ 'public-key': 'upPbk', 'short-id': 'abcd' });
        expect(ds.servername).toBe('up.example.com');
    });

    it('Clash 源依赖下行继承 TLS 时保持 TLS，显式 tls:false 则不继承', () => {
        const proxy = {
            name: 'node',
            type: 'vless',
            server: '1.2.3.4',
            port: 443,
            uuid: 'uuid',
            network: 'xhttp',
            tls: true,
            servername: 'up.example.com',
            alpn: ['h2'],
            'xhttp-opts': {
                path: '/up',
                mode: 'stream-up',
                'download-settings': { server: 'cdn.example.com', port: 443 },
            },
        };

        const url = convertClashProxyToUrl(proxy);
        const extra = JSON.parse(decodeURIComponent(url.match(/(?:\?|&)extra=([^&#]*)/)[1]));
        expect(extra.downloadSettings.security).toBe('tls');
        expect(extra.downloadSettings.tlsSettings).toEqual({
            serverName: 'up.example.com',
            alpn: ['h2'],
        });

        const ds = urlToClashProxy(url)['xhttp-opts']['download-settings'];
        expect(ds.tls).toBe(true);
        expect(ds.servername).toBe('up.example.com');
        expect(ds.alpn).toEqual(['h2']);

        const offUrl = convertClashProxyToUrl({
            ...proxy,
            'xhttp-opts': {
                ...proxy['xhttp-opts'],
                'download-settings': { server: 'cdn.example.com', port: 443, tls: false },
            },
        });
        const offExtra = JSON.parse(decodeURIComponent(offUrl.match(/(?:\?|&)extra=([^&#]*)/)[1]));
        expect(offExtra.downloadSettings.security).toBeUndefined();
    });
});

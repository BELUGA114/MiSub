import { describe, it, expect } from 'vitest';
import { convertClashProxyToUrl } from '../../functions/utils/clash-to-url.js';
import { urlToClashProxy } from '../../functions/utils/url-to-clash.js';

const UUID = '11111111-1111-4111-8111-111111111111';
const ECH_CONFIG = 'AEX+DQBB';

function roundTrip(proxy) {
    const url = convertClashProxyToUrl(proxy);
    expect(url).toBeTruthy();
    const parsed = urlToClashProxy(url);
    expect(parsed).toBeTruthy();
    return { url, parsed };
}

function queryOf(url) {
    const hashIndex = url.indexOf('#');
    const queryStart = url.indexOf('?');
    return new URLSearchParams(url.slice(queryStart + 1, hashIndex === -1 ? undefined : hashIndex));
}

describe('协议往返：此前未被 fixtures 覆盖的字段', () => {
    it('AnyTLS padding 在 Clash → URL → Clash 中保留', () => {
        const base = {
            name: 'AnyTLS Padding',
            type: 'anytls',
            server: 'anytls.example.com',
            port: 443,
            password: 'anytls-pass',
            sni: 'anytls.example.com'
        };

        const enabled = roundTrip({ ...base, padding: true });
        expect(queryOf(enabled.url).get('padding')).toBe('true');
        expect(enabled.parsed.padding).toBe(true);

        const disabled = roundTrip({ ...base, name: 'AnyTLS No Padding', padding: false });
        expect(queryOf(disabled.url).get('padding')).toBe('false');
        expect(disabled.parsed.padding).toBe(false);
    });

    it('VLESS alpn 在 Clash → URL → Clash 中保留', () => {
        const { url, parsed } = roundTrip({
            name: 'VLESS ALPN',
            type: 'vless',
            server: 'vless.example.com',
            port: 443,
            uuid: UUID,
            tls: true,
            servername: 'vless.example.com',
            alpn: ['h2', 'http/1.1']
        });

        expect(queryOf(url).get('alpn')).toBe('h2,http/1.1');
        expect(parsed.alpn).toEqual(['h2', 'http/1.1']);
    });

    it('VMess alpn 在 Clash → URL → Clash 中保留', () => {
        const { url, parsed } = roundTrip({
            name: 'VMess ALPN',
            type: 'vmess',
            server: 'vmess.example.com',
            port: 443,
            uuid: UUID,
            alterId: 0,
            cipher: 'auto',
            tls: true,
            servername: 'vmess.example.com',
            alpn: ['h2']
        });

        const config = JSON.parse(atob(url.slice('vmess://'.length)));
        expect(config.alpn).toBe('h2');
        expect(parsed.alpn).toEqual(['h2']);
    });

    it('VLESS encryption 往返保留，none 不写入 Clash', () => {
        const encryption = 'mlkem768x25519plus.native.0rtt.test-key';
        const preserved = roundTrip({
            name: 'VLESS Encryption',
            type: 'vless',
            server: 'vless.example.com',
            port: 443,
            uuid: UUID,
            encryption
        });
        expect(queryOf(preserved.url).get('encryption')).toBe(encryption);
        expect(preserved.parsed.encryption).toBe(encryption);

        const disabled = roundTrip({
            name: 'VLESS Encryption None',
            type: 'vless',
            server: 'vless.example.com',
            port: 443,
            uuid: UUID,
            encryption: 'none'
        });
        expect(disabled.parsed.encryption).toBeUndefined();
    });

    it('VLESS ECH config 往返保留，query-server-name 仍是明确丢弃项', () => {
        const preserved = roundTrip({
            name: 'VLESS ECH',
            type: 'vless',
            server: 'vless.example.com',
            port: 443,
            uuid: UUID,
            tls: true,
            servername: 'vless.example.com',
            'ech-opts': { enable: true, config: ECH_CONFIG }
        });
        expect(preserved.parsed['ech-opts']).toMatchObject({ enable: true, config: ECH_CONFIG });

        const queryOnly = roundTrip({
            name: 'VLESS ECH Query',
            type: 'vless',
            server: 'vless.example.com',
            port: 443,
            uuid: UUID,
            tls: true,
            servername: 'vless.example.com',
            'ech-opts': { enable: true, 'query-server-name': 'ech.example.com' }
        });
        expect(queryOf(queryOnly.url).has('ech')).toBe(false);
        expect(queryOnly.parsed['ech-opts']).toBeUndefined();
    });

    it('REALITY mlkem 默认开启，显式关闭后往返保留', () => {
        const base = {
            name: 'VLESS Reality MLKEM',
            type: 'vless',
            server: 'vless.example.com',
            port: 443,
            uuid: UUID,
            tls: true,
            servername: 'www.example.com',
            'reality-opts': { 'public-key': 'public-key-value', 'short-id': 'abcd' }
        };

        const byDefault = roundTrip(base);
        expect(queryOf(byDefault.url).has('mlkem')).toBe(false);
        expect(byDefault.parsed['reality-opts']['support-x25519mlkem768']).toBe(true);

        const disabled = roundTrip({
            ...base,
            name: 'VLESS Reality MLKEM Off',
            'reality-opts': { ...base['reality-opts'], 'support-x25519mlkem768': false }
        });
        expect(queryOf(disabled.url).get('mlkem')).toBe('0');
        expect(disabled.parsed['reality-opts']['support-x25519mlkem768']).toBe(false);
    });

    it('Trojan REALITY 与 ECH 同时往返保留', () => {
        const { parsed } = roundTrip({
            name: 'Trojan Reality ECH',
            type: 'trojan',
            server: 'trojan.example.com',
            port: 443,
            password: 'trojan-pass',
            sni: 'trojan.example.com',
            'reality-opts': { 'public-key': 'public-key-value', 'short-id': 'abcd' },
            'ech-opts': { enable: true, config: ECH_CONFIG }
        });

        expect(parsed['reality-opts']).toMatchObject({
            'public-key': 'public-key-value',
            'short-id': 'abcd',
            'support-x25519mlkem768': true
        });
        expect(parsed['ech-opts']).toMatchObject({ enable: true, config: ECH_CONFIG });
    });

    it('TUIC 扩展参数在 Clash → URL → Clash 中保留', () => {
        const { parsed } = roundTrip({
            name: 'TUIC Extended',
            type: 'tuic',
            server: 'tuic.example.com',
            port: 443,
            uuid: UUID,
            password: 'tuic-pass',
            'udp-over-stream': true,
            'heartbeat-interval': '5s',
            'request-timeout': 8000,
            cwnd: 64,
            'bbr-profile': 'standard',
            'max-udp-relay-packet-size': 1400,
            'max-open-streams': 100,
            'disable-sni': true,
            'fast-open': true,
            'dialer-proxy': '前置节点'
        });

        expect(parsed).toMatchObject({
            'udp-over-stream': true,
            'heartbeat-interval': '5s',
            'request-timeout': 8000,
            cwnd: 64,
            'bbr-profile': 'standard',
            'max-udp-relay-packet-size': 1400,
            'max-open-streams': 100,
            'disable-sni': true,
            'fast-open': true,
            'dialer-proxy': '前置节点'
        });
    });

    it('Hysteria2 ports/hop-interval 往返保留，mport 作为导入别名', () => {
        const { parsed } = roundTrip({
            name: 'HY2 Ports',
            type: 'hysteria2',
            server: 'hy2.example.com',
            port: 443,
            password: 'hy2-pass',
            ports: '20000-30000',
            'hop-interval': 30
        });
        expect(parsed.ports).toBe('20000-30000');
        expect(parsed['hop-interval']).toBe(30);

        const mport = urlToClashProxy('hysteria2://hy2-pass@hy2.example.com:443?mport=20000-30000#HY2 Mport');
        expect(mport.ports).toBe('20000-30000');
    });
});

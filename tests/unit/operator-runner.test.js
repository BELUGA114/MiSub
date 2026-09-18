import { describe, expect, it, vi } from 'vitest';
import { runOperatorChain } from '../../functions/utils/operator-runner.js';

describe('operator runner', () => {
  it('runs script operators through the restricted DSL without dynamic code execution', async () => {
    const functionSpy = vi.spyOn(globalThis, 'Function').mockImplementation(() => {
      throw new Error('dynamic code execution disabled');
    });
    const urls = ['ss://YWVzLTEyOC1nY206cGFzcw@example.com:8388#HKNode'];

    try {
      const result = await runOperatorChain(urls, [
        {
          type: 'script',
          params: {
            dsl: [
              { action: 'rename', template: '{name} Scripted' },
              { action: 'filter', field: 'name', op: 'contains', value: 'HKNode' }
            ]
          }
        }
      ], { target: 'clash' });

      expect(result).toHaveLength(1);
      expect(decodeURIComponent(result[0])).toContain('#HKNode Scripted');
      expect(functionSpy).not.toHaveBeenCalled();
    } finally {
      functionSpy.mockRestore();
    }
  });

  it('does not execute legacy script code when dynamic code execution is disabled', async () => {
    const functionSpy = vi.spyOn(globalThis, 'Function').mockImplementation(() => {
      throw new Error('dynamic code execution disabled');
    });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const urls = ['ss://YWVzLTEyOC1nY206cGFzcw@example.com:8388#HKNode'];

    try {
      const result = await runOperatorChain(urls, [
        {
          type: 'script',
          params: {
            code: 'return $proxies.map(p => ({ ...p, name: `${p.name} Scripted` }))'
          }
        }
      ], { target: 'clash' });

      expect(result).toHaveLength(1);
      expect(decodeURIComponent(result[0])).toContain('#HKNode');
      expect(decodeURIComponent(result[0])).not.toContain('Scripted');
      expect(functionSpy).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledWith('[Operator] Legacy script code is disabled; use params.dsl instead.');
    } finally {
      functionSpy.mockRestore();
      warnSpy.mockRestore();
    }
  });

  it('passes regex capture groups to a template in the same rename operator', async () => {
    const urls = [
      `ss://YWVzLTEyOC1nY206cGFzcw@example.com:8388#${encodeURIComponent('[香港]-机场A-线路B')}`
    ];
    const result = await runOperatorChain(urls, [
      {
        type: 'rename',
        params: {
          regex: {
            enabled: true,
            rules: [
              {
                pattern: '\\[(.*?)\\]-(.*?)-(.*)$',
                replacement: '',
                flags: 'gi'
              }
            ]
          },
          template: {
            enabled: true,
            template: '{g1}|{g2}|{g3}',
            indexScope: 'global'
          }
        }
      }
    ]);

    expect(decodeURIComponent(result[0])).toContain('#香港|机场A|线路B');
  });

  it('preserves regex capture groups across sequential rename operators', async () => {
    const urls = [
      `ss://YWVzLTEyOC1nY206cGFzcw@example.com:8388#${encodeURIComponent('[香港]-机场A-线路B')}`
    ];
    const result = await runOperatorChain(urls, [
      {
        type: 'rename',
        params: {
          regex: {
            enabled: true,
            rules: [
              {
                pattern: '\\[(.*?)\\]-(.*?)-(.*)$',
                replacement: '',
                flags: 'gi'
              }
            ]
          }
        }
      },
      {
        type: 'rename',
        params: {
          template: {
            enabled: true,
            template: '{g1}|{g2}|{g3}',
            indexScope: 'global'
          }
        }
      }
    ]);

    expect(decodeURIComponent(result[0])).toContain('#香港|机场A|线路B');
  });

  it('rewrites matching xhttp node queries via the set-query action without dynamic code execution', async () => {
    const functionSpy = vi.spyOn(globalThis, 'Function').mockImplementation(() => {
      throw new Error('dynamic code execution disabled');
    });
    const urls = [
      'vless://test-uuid@cf.danfeng.eu.org:443?encryption=none&security=tls&sni=cf.danfeng.eu.org&fp=chrome&type=xhttp&host=cf.danfeng.eu.org&path=%2Fxhttp&mode=auto#CF-01',
      'vless://test-uuid@cf3.danfeng.eu.org:443?encryption=none&security=tls&sni=cf3.danfeng.eu.org&fp=chrome&type=xhttp&host=cf3.danfeng.eu.org&path=%2Fxhttp&mode=auto#CF-03',
      'vless://test-uuid@eu.example.com:443?encryption=none&security=tls&sni=eu.example.com&type=xhttp&host=eu.example.com&path=%2Fxhttp&mode=auto#EU-01',
      'vless://test-uuid@cf.danfeng.eu.org:2053?encryption=none&security=tls&sni=cf.danfeng.eu.org&type=ws&host=cf.danfeng.eu.org&path=%2Fws#CF-WS'
    ];

    try {
      const result = await runOperatorChain(urls, [
        {
          type: 'script',
          params: {
            dsl: [
              {
                action: 'set-query',
                when: [
                  { field: 'server', op: 'regex', value: '^cf[1-9]?\\.danfeng\\.eu\\.org$' },
                  { field: 'query.type', op: 'eq', value: 'xhttp' }
                ],
                set: { mode: 'packet-up', alpn: 'h3' }
              }
            ]
          }
        }
      ], { target: 'clash' });

      expect(result).toEqual([
        'vless://test-uuid@cf.danfeng.eu.org:443?encryption=none&security=tls&sni=cf.danfeng.eu.org&fp=chrome&type=xhttp&host=cf.danfeng.eu.org&path=%2Fxhttp&mode=packet-up&alpn=h3#CF-01',
        'vless://test-uuid@cf3.danfeng.eu.org:443?encryption=none&security=tls&sni=cf3.danfeng.eu.org&fp=chrome&type=xhttp&host=cf3.danfeng.eu.org&path=%2Fxhttp&mode=packet-up&alpn=h3#CF-03',
        urls[2],
        urls[3]
      ]);
      expect(functionSpy).not.toHaveBeenCalled();
    } finally {
      functionSpy.mockRestore();
    }
  });

  it('supports string when expressions with dotted query fields for set-query', async () => {
    const urls = [
      'vless://test-uuid@cf.danfeng.eu.org:443?security=tls&type=xhttp#CF',
      'vless://test-uuid@cf.danfeng.eu.org:443?security=tls&type=grpc#CF-GRPC'
    ];

    const result = await runOperatorChain(urls, [
      {
        type: 'script',
        params: {
          dsl: [
            {
              action: 'set-query',
              when: 'server === \'cf.danfeng.eu.org\' && query.type === \'xhttp\'',
              set: { alpn: 'h3' }
            }
          ]
        }
      }
    ]);

    expect(result[0]).toBe('vless://test-uuid@cf.danfeng.eu.org:443?security=tls&type=xhttp&alpn=h3#CF');
    expect(result[1]).toBe(urls[1]);
  });

  it('adds missing params, removes null params, and appends a query string when absent', async () => {
    const result = await runOperatorChain([
      'vless://test-uuid@node.example.com:443?security=tls&fp=chrome&type=tcp#A',
      'vless://test-uuid@node.example.com:443#B'
    ], [
      {
        type: 'script',
        params: {
          dsl: [{ action: 'set-query', set: { alpn: 'h3', fp: null } }]
        }
      }
    ]);

    expect(result[0]).toBe('vless://test-uuid@node.example.com:443?security=tls&type=tcp&alpn=h3#A');
    expect(result[1]).toBe('vless://test-uuid@node.example.com:443?alpn=h3#B');
  });

  it('sorts nodes by custom group metadata', async () => {
    const urls = [
      'ss://YWVzLTEyOC1nY206cGFzcw@us.example.com:8388#USNode',
      'ss://YWVzLTEyOC1nY206cGFzcw@hk.example.com:8388#HKNode',
      'ss://YWVzLTEyOC1nY206cGFzcw@jp.example.com:8388#JPNode'
    ];

    const result = await runOperatorChain(urls, [
      {
        type: 'sort',
        params: {
          keys: [{ key: 'group', order: 'asc' }]
        }
      }
    ], {
      nodeMetadataByUrl: new Map([
        [urls[0], { group: 'B-US' }],
        [urls[1], { group: 'A-HK' }],
        [urls[2], { group: 'C-JP' }]
      ])
    });

    expect(result.map(url => decodeURIComponent(url))).toEqual([
      expect.stringContaining('#HKNode'),
      expect.stringContaining('#USNode'),
      expect.stringContaining('#JPNode')
    ]);
  });

});

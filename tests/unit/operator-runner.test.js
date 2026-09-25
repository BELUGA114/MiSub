import { describe, expect, it, vi } from 'vitest';
import { runOperatorChain } from '../../functions/utils/operator-runner.js';
import { parseNodeInfo } from '../../functions/modules/utils/geo-utils.js';

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

  it('renders template {emoji} according to context.enableEmoji', async () => {
    const urls = [
      `ss://YWVzLTEyOC1nY206cGFzcw@example.com:8388#${encodeURIComponent('香港节点')}`
    ];
    const params = {
      template: { enabled: true, template: '{emoji}{regionZh}', indexScope: 'global' }
    };

    const withEmoji = await runOperatorChain(urls, [{ type: 'rename', params }], { enableEmoji: true });
    expect(decodeURIComponent(withEmoji[0])).toContain('#🇭🇰香港');

    const noEmoji = await runOperatorChain(urls, [{ type: 'rename', params }], { enableEmoji: false });
    expect(decodeURIComponent(noEmoji[0])).toContain('#香港');
    expect(decodeURIComponent(noEmoji[0])).not.toContain('🇭🇰');
  });

  it('falls back to 🌍 for unknown region only when emoji is enabled', async () => {
    const urls = [
      `ss://YWVzLTEyOC1nY206cGFzcw@example.com:8388#${encodeURIComponent('MyNode')}`
    ];
    const params = {
      template: { enabled: true, template: '{emoji}{name}', indexScope: 'global' }
    };

    const withEmoji = await runOperatorChain(urls, [{ type: 'rename', params }], { enableEmoji: true });
    expect(decodeURIComponent(withEmoji[0])).toContain('🌍');

    const noEmoji = await runOperatorChain(urls, [{ type: 'rename', params }], { enableEmoji: false });
    expect(decodeURIComponent(noEmoji[0])).not.toContain('🌍');
  });

});

describe('opScript filter/discard 条件增强', () => {
  const urls = [
    'trojan://p@hk1.example.com:443#HK-01',
    'trojan://p@jp1.example.com:443#JP-01',
    'trojan://p@sg1.example.com:443#SG-过期'
  ];
  it('filter 用 when + 数组只保留香港/日本', async () => {
    const out = await runOperatorChain(urls, [{
      type: 'script',
      params: { dsl: [{ action: 'filter', when: { field: 'name', op: 'regex', value: ['HK', 'JP'] } }] }
    }], { target: 'clash' });
    expect(out).toHaveLength(2);
  });
  it('discard 丢弃名字含"过期"的节点', async () => {
    const out = await runOperatorChain(urls, [{
      type: 'script',
      params: { dsl: [{ action: 'discard', when: { field: 'name', op: 'contains', value: '过期' } }] }
    }], { target: 'clash' });
    expect(out).toHaveLength(2);
    expect(out.join('|')).not.toContain('%E8%BF%87%E6%9C%9F');
  });
});

describe('opScript rename 条件化', () => {
  const urls = [
    'trojan://p@hk1.example.com:443#HK-01',
    'trojan://p@jp1.example.com:443#JP-01'
  ];
  it('只给命中数组的节点加后缀，其余原样', async () => {
    const out = await runOperatorChain(urls, [{
      type: 'script',
      params: { dsl: [{
        action: 'rename',
        when: { field: 'name', op: 'regex', value: ['HK', '香港'] },
        template: '{name} [专线]'
      }] }
    }], { target: 'clash' });
    const names = out.map(u => decodeURIComponent(u.slice(u.lastIndexOf('#') + 1)));
    expect(names).toContain('HK-01 [专线]');
    expect(names).toContain('JP-01');
  });
});

describe('opScript set-field（name/metadata）', () => {
  const urls = ['trojan://p@hk1.example.com:443#HK-01'];
  it('按模板改名', async () => {
    const out = await runOperatorChain(urls, [{
      type: 'script',
      params: { dsl: [{ action: 'set-field', set: { name: '[HK] {name}' } }] }
    }], { target: 'clash' });
    expect(decodeURIComponent(out[0].slice(out[0].lastIndexOf('#') + 1))).toBe('[HK] HK-01');
  });
  it('when 未命中则原样透传', async () => {
    const out = await runOperatorChain(urls, [{
      type: 'script',
      params: { dsl: [{ action: 'set-field', when: { field: 'name', op: 'contains', value: 'JP' }, set: { name: 'X' } }] }
    }], { target: 'clash' });
    expect(decodeURIComponent(out[0].slice(out[0].lastIndexOf('#') + 1))).toBe('HK-01');
  });
});

describe('opScript 审查跟进用例', () => {
  it('set-field 写 metadata.* 后可被后续 rename 读到', async () => {
    const out = await runOperatorChain(['trojan://p@hk1.example.com:443#HK-01'], [{
      type: 'script',
      params: { dsl: [
        { action: 'set-field', set: { 'metadata.group': 'AAA' } },
        { action: 'rename', template: '{metadata.group}-{name}' }
      ] }
    }], { target: 'clash' });
    expect(decodeURIComponent(out[0].slice(out[0].lastIndexOf('#') + 1))).toBe('AAA-HK-01');
  });
  it('discard 支持内联条件（无 when，与 filter 对称）', async () => {
    const urls = ['trojan://p@hk1.example.com:443#HK-01', 'trojan://p@sg1.example.com:443#SG-过期'];
    const out = await runOperatorChain(urls, [{
      type: 'script',
      params: { dsl: [{ action: 'discard', field: 'name', op: 'contains', value: '过期' }] }
    }], { target: 'clash' });
    expect(out).toHaveLength(1);
    expect(decodeURIComponent(out[0])).toContain('#HK-01');
  });
  it('无任何条件的 discard 跳过、不清空', async () => {
    const urls = ['trojan://p@hk1.example.com:443#HK-01', 'trojan://p@jp1.example.com:443#JP-01'];
    const out = await runOperatorChain(urls, [{
      type: 'script',
      params: { dsl: [{ action: 'discard' }] }
    }], { target: 'clash' });
    expect(out).toHaveLength(2);
  });
});

describe('opScript set-field（server/port）', () => {
  const urls = ['trojan://p@old.example.com:443?sni=a.com#HK-01'];
  it('改写 server 与 port，query/#备注 原样', async () => {
    const out = await runOperatorChain(urls, [{
      type: 'script',
      params: { dsl: [{ action: 'set-field', set: { server: 'new.example.com', port: 8443 } }] }
    }], { target: 'clash' });
    expect(out[0]).toContain('new.example.com:8443');
    expect(out[0]).toContain('sni=a.com');
    expect(out[0]).toContain('#HK-01');
  });
  it('非法 port 被跳过（端口保持原值）', async () => {
    const out = await runOperatorChain(urls, [{
      type: 'script',
      params: { dsl: [{ action: 'set-field', set: { port: 70000 } }] }
    }], { target: 'clash' });
    expect(out[0]).toContain('old.example.com:443');
  });
});

describe('opScript set-field 同时改 name 与 server/port（vmess 组合）', () => {
  const vmess = 'vmess://eyJ2IjoiMiIsInBzIjoi8J+HuvCfh7ggVVMgTm9kZSAwMSIsImFkZCI6InVzMS5leGFtcGxlLmNvbSIsInBvcnQiOiI0NDMiLCJpZCI6IjAwMDAwMDAwLTAwMDAtMDAwMC0wMDAwLTAwMDAwMDAwMDAwMSIsImFpZCI6MCwibmV0IjoidGNwIiwidHlwZSI6Im5vbmUiLCJob3N0IjoiIiwicGF0aCI6IiIsInRscyI6InRscyJ9';
  it('name 与 port 同时生效，其余字段保留', async () => {
    const out = await runOperatorChain([vmess], [{
      type: 'script',
      params: { dsl: [{ action: 'set-field', set: { name: 'US-X', port: 9999 } }] }
    }], { target: 'clash' });
    const info = parseNodeInfo(out[0]);
    expect(info.name).toBe('US-X');
    expect(String(info.port)).toBe('9999');
    expect(info.server).toBe('us1.example.com');
  });
});

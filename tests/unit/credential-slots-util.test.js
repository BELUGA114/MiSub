import { describe, it, expect } from 'vitest';
import { extractCredentialFromUrl, collectUsedSlots } from '../../src/utils/credentialSlots.js';

describe('extractCredentialFromUrl', () => {
  it('取 vless/trojan 的 @ 前凭证，未知协议返回空', () => {
    expect(extractCredentialFromUrl('vless://U1@h:443?x=1#n')).toBe('U1');
    expect(extractCredentialFromUrl('trojan://p%40ss@h:443#n')).toBe('p@ss');
    expect(extractCredentialFromUrl('ss://body@h:443')).toBe('');
    expect(extractCredentialFromUrl('')).toBe('');
  });
});

describe('collectUsedSlots', () => {
  const nodes = [
    { id: 'a', url: 'vless://UA@h1:443#a', credentialSlot: 'vps1' },
    { id: 'b', url: 'vless://UB@h2:443#b', credentialSlot: 'vps2' },
    { id: 'c', url: 'vless://UC@h1:443#c', credentialSlot: 'vps1' },
    { id: 'd', url: 'vless://UD@h3:443#d' }
  ];
  it('按槽去重、忽略无槽节点、带基准', () => {
    const slots = collectUsedSlots(['a', 'b', 'c', 'd'], nodes);
    expect(slots.map(s => s.slot).sort()).toEqual(['vps1', 'vps2']);
    expect(slots.find(s => s.slot === 'vps1').baseline).toBe('UA'); // 首个命中
  });
});

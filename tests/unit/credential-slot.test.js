import { describe, it, expect } from 'vitest';
import { handleProfileMode } from '../../functions/modules/subscription/profile-handler.js';

// 按仓库既有 KV mock 模式实现：get 返回种子里的 JSON 字符串，put/delete/list 齐备
function createKv(initial = {}) {
    const values = new Map(Object.entries(initial));
    return {
        async get(key) {
            return values.get(key) ?? null;
        },
        async put(key, value) {
            values.set(key, value);
        },
        async delete(key) {
            values.delete(key);
        },
        async list() {
            return { keys: Array.from(values.keys()).map(name => ({ name })) };
        }
    };
}

describe('凭证槽覆盖（公开预览/统计路径）', () => {
    it('预览路径按 Profile.credentials 覆盖手动节点凭证', async () => {
        const kv = createKv({
            misub_subscriptions_v1: JSON.stringify([
                { id: 'n1', enabled: true, name: 'N1', url: 'vless://BASE-UUID@h.example.com:443?type=ws#N1', credentialSlot: 'vps1' }
            ]),
            misub_profiles_v1: JSON.stringify([
                { id: 'p1', enabled: true, name: 'P1', subscriptions: [], manualNodes: ['n1'], credentials: { vps1: 'UUID-B' } }
            ]),
            worker_settings_v1: JSON.stringify({})
        });
        const req = new Request('https://example.com/profiles/p1');
        const res = await handleProfileMode(req, { MISUB_KV: kv }, 'p1', 'clash-meta/1.0');
        const urls = (res.nodes || []).map(n => n.url).join('\n');
        expect(urls).toContain('vless://UUID-B@h.example.com:443');
        expect(urls).not.toContain('BASE-UUID');
    });
});

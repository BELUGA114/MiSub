import { describe, it, expect } from 'vitest';
import { handleProfileMode } from '../../functions/modules/subscription/profile-handler.js';
import { handleMisubsSave } from '../../functions/modules/api-handler.js';

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
        async list(options = {}) {
            // 模拟 CF KV：按 prefix 过滤（兼容字符串前缀与 { prefix } 选项），否则缓存清理会误删全部键
            const prefix = typeof options === 'string' ? options : (options?.prefix || '');
            const keys = Array.from(values.keys())
                .filter(name => name.startsWith(prefix))
                .map(name => ({ name }));
            return { keys, list_complete: true };
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

describe('凭证槽持久化守卫（保存→读取不丢字段）', () => {
    it('手动节点 credentialSlot 与 Profile credentials 经保存后仍在', async () => {
        // recon 已确认保存链路整对象存储（misubs 仅补 sortIndex、normalizeProfile 用 ...profile 展开），
        // 新字段本应自动持久化。本用例锁定这一点，防止将来有人给保存端加字段白名单剔除未知字段。
        const kv = createKv({ worker_settings_v1: JSON.stringify({}) });
        const body = {
            misubs: [
                { id: 'n1', enabled: true, name: 'N1', url: 'vless://BASE-UUID@h.example.com:443#N1', credentialSlot: 'vps1' }
            ],
            profiles: [
                { id: 'p1', enabled: true, name: 'P1', subscriptions: [], manualNodes: ['n1'], credentials: { vps1: 'UUID-B' } }
            ]
        };
        const req = new Request('https://example.com/api/misubs', { method: 'POST', body: JSON.stringify(body) });
        const res = await handleMisubsSave(req, { MISUB_KV: kv });
        expect(res.status).toBe(200);

        const savedSubs = JSON.parse(await kv.get('misub_subscriptions_v1'));
        const savedProfiles = JSON.parse(await kv.get('misub_profiles_v1'));
        expect(savedSubs[0].credentialSlot).toBe('vps1');
        expect(savedProfiles[0].credentials).toEqual({ vps1: 'UUID-B' });
    });
});

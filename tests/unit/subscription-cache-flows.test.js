import { afterEach, describe, expect, it, vi } from 'vitest';
import { StorageFactory } from '../../functions/storage-adapter.js';
import { buildSubscriptionNodeCacheKey, generateCombinedNodeList } from '../../functions/services/subscription-service.js';
import { fetchSubscriptionNodes } from '../../functions/modules/subscription/node-fetcher.js';
import { handleProfileMode } from '../../functions/modules/subscription/profile-handler.js';
import { handleSingleSubscriptionMode } from '../../functions/modules/subscription/single-subscription.js';

const SUB = { id: 'airport', name: 'Airport', url: 'https://airport.example/sub', enabled: true, enableNodeCache: true };
const NODES = Array.from({ length: 20 }, (_, index) =>
    `trojan://pass${index}@proxy${index}.example.com:443#${index === 0 ? 'Keep' : `Drop${index}`}`
);

function createStorage() {
    const values = new Map([
        ['misub_subscriptions_v1', [SUB]],
        ['misub_profiles_v1', [{ id: 'profile', enabled: true, subscriptions: ['airport'], manualNodes: [] }]],
        ['worker_settings_v1', { enableFlagEmoji: false }]
    ]);
    return {
        values,
        async get(key) { return values.get(key) ?? null; },
        async put(key, value) { values.set(key, value); return true; }
    };
}

function respond(content, status = 200) {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(content, { status })));
}

function generate(storage, sub = SUB) {
    return generateCombinedNodeList(
        { storage }, { enableFlagEmoji: false, enableTrafficNode: false }, 'ClashMeta', [sub], '',
        { enableSubscriptions: false, enableManualNodes: false }
    );
}

async function seedCache(storage) {
    respond(NODES.join('\n'));
    await generate(storage);
}

function preview(storage, sub = SUB) {
    return fetchSubscriptionNodes(sub.url, sub.name, 'ClashMeta', null, false, sub.exclude, null, false, false, sub.enableNodeCache, storage, sub);
}

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('subscription output protective cache', () => {
    it('allows a changed filter to shrink the output and replaces the cached result', async () => {
        const storage = createStorage();
        await seedCache(storage);
        const output = await generate(storage, { ...SUB, exclude: 'keep:Keep' });
        expect(output.trim()).toBe('trojan://pass0@proxy0.example.com:443#Keep');
        expect(storage.values.get(buildSubscriptionNodeCacheKey(SUB)).nodes).toEqual(['trojan://pass0@proxy0.example.com:443#Keep']);
    });

    it('returns no nodes when the changed filter intentionally matches nothing', async () => {
        const storage = createStorage();
        await seedCache(storage);
        expect((await generate(storage, { ...SUB, exclude: 'keep:Missing' })).trim()).toBe('');
    });

    it('retains the last good output when the upstream response is truncated', async () => {
        const storage = createStorage();
        await seedCache(storage);
        respond(NODES[0]);
        expect((await generate(storage)).trim().split('\n')).toEqual(NODES);
    });
});

describe('subscription preview protective cache', () => {
    it.each(['single', 'profile'])('returns cached nodes through the %s preview handler on HTTP failure', async (mode) => {
        const storage = createStorage();
        await seedCache(storage);
        vi.spyOn(StorageFactory, 'getStorageType').mockResolvedValue('kv');
        vi.spyOn(StorageFactory, 'createAdapter').mockReturnValue(storage);
        respond('Expired', 403);
        const result = mode === 'single'
            ? await handleSingleSubscriptionMode(null, {}, 'airport', 'ClashMeta')
            : await handleProfileMode(null, {}, 'profile', 'ClashMeta');
        expect(result.nodes.map(node => node.url)).toEqual(NODES);
        expect(result.subscriptions[0].fromCache).toBe(true);
        expect(result.subscriptions[0].error).toContain('403');
    });

    it('falls back on an expiration page but respects changed filters and the cache switch', async () => {
        const storage = createStorage();
        await seedCache(storage);
        respond('Subscription expired');
        expect((await preview(storage)).nodes.map(node => node.url)).toEqual(NODES);
        respond(NODES.join('\n'));
        expect((await preview(storage, { ...SUB, exclude: 'keep:Missing' })).nodes).toEqual([]);
        respond('Expired', 403);
        expect((await preview(storage, { ...SUB, enableNodeCache: false })).success).toBe(false);
    });
});

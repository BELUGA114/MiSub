import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import yaml from 'js-yaml';
import { generateProxiesOnly } from '../../functions/modules/subscription/builtin-clash-generator.js';
import { renderClashFromIniTemplate } from '../../functions/modules/subscription/template-pipeline.js';

// 国旗 / 地球 emoji 检测（两个区域指示符，或地球符号）
const EMOJI_REGEX = /[\u{1F1E6}-\u{1F1FF}]{2}|[\u{1F30D}-\u{1F30F}]/u;

// 名称含地区关键字但本身不带 emoji 的节点，最容易暴露"转换器反查地区补 emoji"的问题
const REGION_NODE = `trojan://pass@hk.example.com:443#${encodeURIComponent('香港01')}`;

// 从 Clash YAML 中取出所有代理节点名，只针对"节点名"断言，避免误伤策略组/规则里的合法 emoji
function proxyNamesFromClashYaml(text) {
    const doc = yaml.load(text);
    return Array.isArray(doc?.proxies) ? doc.proxies.map(p => p?.name ?? '') : [];
}

const createAdapter = vi.fn();
const getStorageType = vi.fn();

vi.mock('../../functions/storage-adapter.js', () => ({
    StorageFactory: {
        createAdapter: (...args) => createAdapter(...args),
        getStorageType: (...args) => getStorageType(...args),
        resolveKV: (env) => env?.MISUB_KV || null
    },
    STORAGE_TYPES: { KV: 'kv', D1: 'd1' }
}));

function createStorageAdapter({ settings = {}, subscriptions = [], profiles = [] } = {}) {
    const store = new Map([
        ['worker_settings_v1', settings],
        ['misub_subscriptions_v1', subscriptions],
        ['misub_profiles_v1', profiles]
    ]);

    return {
        store,
        get: vi.fn(async (key) => store.has(key) ? store.get(key) : null),
        put: vi.fn(async (key, value) => {
            store.set(key, value);
            return true;
        }),
        getAllSubscriptions: vi.fn(async () => subscriptions),
        getAllProfiles: vi.fn(async () => profiles),
        getSubscriptionsByIds: vi.fn(async (ids) => subscriptions.filter(item => ids.includes(item.id)))
    };
}

describe('内置 Clash 生成器：generateProxiesOnly 尊重 emoji 开关', () => {
    it('addFlagEmoji=false 时不应给节点名反查补国旗', () => {
        const names = proxyNamesFromClashYaml(generateProxiesOnly(REGION_NODE, { addFlagEmoji: false }));
        expect(names).toEqual(['香港01']);
        expect(names.some(n => EMOJI_REGEX.test(n)), `节点名含 emoji: ${JSON.stringify(names)}`).toBe(false);
    });

    it('默认（未显式关闭）时保留补全国旗的行为', () => {
        const names = proxyNamesFromClashYaml(generateProxiesOnly(REGION_NODE));
        expect(names.some(n => EMOJI_REGEX.test(n))).toBe(true);
    });
});

describe('外部 INI 模板渲染：renderClashFromIniTemplate 尊重 emoji 开关且不泄漏内部 metadata', () => {
    const MINIMAL_TEMPLATE = [
        '[custom]',
        'ruleset=🚀 节点选择,[]MATCH',
        'custom_proxy_group=🚀 节点选择`select`.*'
    ].join('\n');

    it('addFlagEmoji=false 时模板渲染的节点名不应出现国旗', () => {
        const output = renderClashFromIniTemplate(MINIMAL_TEMPLATE, {
            nodeList: REGION_NODE,
            addFlagEmoji: false
        });
        const names = proxyNamesFromClashYaml(output);
        expect(names).toEqual(['香港01']);
        expect(output.includes('metadata:'), `模板输出泄漏内部 metadata:\n${output}`).toBe(false);
    });
});

describe('handleMisubRequest：内置 Clash 输出遵循 emoji 决策', () => {
    beforeEach(() => {
        vi.resetModules();
        vi.clearAllMocks();
        getStorageType.mockResolvedValue('kv');
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    async function requestClashProxyNames(query, settings) {
        const subscriptions = [{
            id: 'sub-a',
            name: 'Airport A',
            url: 'https://airport.example/sub',
            enabled: true
        }];
        const adapter = createStorageAdapter({
            settings: { mytoken: 'stable-token', enableTrafficNode: false, ...settings },
            subscriptions
        });
        createAdapter.mockReturnValue(adapter);
        vi.stubGlobal('fetch', vi.fn(async () => new Response(REGION_NODE, { status: 200 })));
        vi.spyOn(console, 'log').mockImplementation(() => {});

        const { handleMisubRequest } = await import('../../functions/modules/subscription/main-handler.js');
        const response = await handleMisubRequest({
            request: new Request(`https://misub.example/stable-token?${query}`, {
                headers: { 'User-Agent': 'ClashMeta' }
            }),
            env: {},
            waitUntil: vi.fn()
        });
        const text = await response.text();
        return proxyNamesFromClashYaml(text);
    }

    it('全局关闭 emoji 时，内置 Clash 节点名不应带国旗', async () => {
        const names = await requestClashProxyNames('target=clash&builtin=true&refresh=1', { enableFlagEmoji: false });
        expect(names.length).toBeGreaterThan(0);
        expect(names.some(n => EMOJI_REGEX.test(n)), `节点名含 emoji: ${JSON.stringify(names)}`).toBe(false);
    });

    it('全局开启 emoji + ?emoji=false 时，内置 Clash 节点名不应带国旗', async () => {
        const names = await requestClashProxyNames('target=clash&builtin=true&refresh=1&emoji=false', { enableFlagEmoji: true });
        expect(names.length).toBeGreaterThan(0);
        expect(names.some(n => EMOJI_REGEX.test(n)), `节点名含 emoji: ${JSON.stringify(names)}`).toBe(false);
    });

    it('全局开启 emoji 时，内置 Clash 节点名应带国旗', async () => {
        const names = await requestClashProxyNames('target=clash&builtin=true&refresh=1', { enableFlagEmoji: true });
        expect(names.some(n => EMOJI_REGEX.test(n)), `期望带国旗: ${JSON.stringify(names)}`).toBe(true);
    });
});

import { describe, it, expect } from 'vitest';
import {
    resolveEffectiveNodeTransform,
    applyUrlEmojiOverride,
    resolveKeepEmoji
} from '../../functions/utils/emoji-decision.js';
import { generateCacheKey } from '../../functions/services/node-cache-service.js';

describe('resolveEffectiveNodeTransform 回退优先级', () => {
    const globalNt = { enabled: true, tag: 'global' };
    const presetNt = { enabled: true, tag: 'preset' };
    const config = {
        defaultNodeTransform: globalNt,
        nodeTransformPresets: [{ id: 'p1', config: presetNt }]
    };

    it('订阅组自身 nodeTransform 优先', () => {
        const profile = { nodeTransform: { enabled: true, tag: 'profile' } };
        expect(resolveEffectiveNodeTransform(config, profile).tag).toBe('profile');
    });

    it('无自身配置时用引用的预设', () => {
        const profile = { nodeTransformPresetId: 'p1' };
        expect(resolveEffectiveNodeTransform(config, profile).tag).toBe('preset');
    });

    it('都没有时回退全局默认', () => {
        expect(resolveEffectiveNodeTransform(config, null).tag).toBe('global');
    });

    it('空对象 nodeTransform 视为未配置，回退全局', () => {
        expect(resolveEffectiveNodeTransform(config, { nodeTransform: {} }).tag).toBe('global');
    });
});

describe('applyUrlEmojiOverride', () => {
    it('emoji=false 置 addFlagEmoji=false 且标记 removeFlagEmoji', () => {
        expect(applyUrlEmojiOverride({}, 'false')).toEqual({ addFlagEmoji: false, removeFlagEmoji: true });
    });

    it('emoji=true 置 addFlagEmoji=true', () => {
        expect(applyUrlEmojiOverride({}, 'true')).toEqual({ addFlagEmoji: true });
    });

    it('无参数时不改动', () => {
        expect(applyUrlEmojiOverride({ addFlagEmoji: true }, null)).toEqual({ addFlagEmoji: true });
    });

    it('不改动入参对象', () => {
        const input = { addFlagEmoji: true };
        applyUrlEmojiOverride(input, 'false');
        expect(input).toEqual({ addFlagEmoji: true });
    });
});

describe('resolveKeepEmoji 决策', () => {
    it('全局开启、无覆盖 → 保留', () => {
        expect(resolveKeepEmoji({ enableFlagEmoji: true }, {})).toBe(true);
    });

    it('全局关闭、无覆盖 → 不保留', () => {
        expect(resolveKeepEmoji({ enableFlagEmoji: false }, {})).toBe(false);
    });

    it('全局关闭但 addFlagEmoji=true 覆盖 → 保留', () => {
        expect(resolveKeepEmoji({ enableFlagEmoji: false }, { addFlagEmoji: true })).toBe(true);
    });

    it('全局开启但 addFlagEmoji=false 覆盖 → 不保留', () => {
        expect(resolveKeepEmoji({ enableFlagEmoji: true }, { addFlagEmoji: false })).toBe(false);
    });

    it('模板启用且含 {emoji} → 尊重开关（保留）', () => {
        const nt = { enabled: true, rename: { template: { enabled: true, template: '{emoji}{name}' } } };
        expect(resolveKeepEmoji({ enableFlagEmoji: true }, nt)).toBe(true);
    });

    it('模板启用但不含 {emoji} → 强制不保留', () => {
        const nt = { enabled: true, rename: { template: { enabled: true, template: '{name}' } } };
        expect(resolveKeepEmoji({ enableFlagEmoji: true }, nt)).toBe(false);
    });
});

describe('generateCacheKey emoji variant', () => {
    it('无 variant 时保持旧键格式（向后兼容）', () => {
        expect(generateCacheKey('profile', 'iloveu')).toBe('node_cache_profile_iloveu');
    });

    it('不同 emoji 状态产生不同键', () => {
        const on = generateCacheKey('profile', 'iloveu', 'emoji1');
        const off = generateCacheKey('profile', 'iloveu', 'emoji0');
        expect(on).not.toBe(off);
        expect(on).toBe('node_cache_profile_iloveu__emoji1');
    });

    it('归一化非法字符', () => {
        expect(generateCacheKey('token', 'abc', 'a/b c')).toBe('node_cache_token_abc__a_b_c');
    });
});

/**
 * 节点名 emoji 决策的单一数据源。
 * 订阅生成（generateCombinedNodeList）、缓存键（generateCacheKey）与 main-handler
 * 复用同一套逻辑，避免"缓存烤进旧 emoji 状态、改设置不生效"的问题。
 */

const DEFAULT_TEMPLATE = '{emoji}{region}-{protocol}-{index}';

/**
 * 按回退优先级解析生效的 nodeTransform：
 * 订阅组自身 > 订阅组引用的预设 > 全局默认。
 * @param {Object} config - 全局配置（含 defaultNodeTransform / nodeTransformPresets）
 * @param {Object|null} profile - 当前订阅组
 * @returns {Object} 生效的 nodeTransform（可能为空对象）
 */
export function resolveEffectiveNodeTransform(config, profile) {
    const globalNodeTransform = config?.defaultNodeTransform || {};
    const presets = Array.isArray(config?.nodeTransformPresets) ? config.nodeTransformPresets : [];
    const profileNodeTransform = profile?.nodeTransform ?? null;
    const presetId = profile?.nodeTransformPresetId || '';
    const presetNodeTransform = presetId
        ? (presets.find(item => item?.id === presetId)?.config || null)
        : null;

    const hasProfileNodeTransform =
        profileNodeTransform && Object.keys(profileNodeTransform).length > 0;

    return hasProfileNodeTransform
        ? profileNodeTransform
        : presetNodeTransform || globalNodeTransform;
}

/**
 * 把 URL 的 emoji 参数（true/false/其它）叠加到 nodeTransform.addFlagEmoji 上，
 * 返回新对象，不改动入参。对齐 main-handler 对 urlEmoji 的处理。
 * @param {Object} nodeTransform - 生效的 nodeTransform
 * @param {string|null} urlEmoji - URL 中的 emoji 参数原值
 * @returns {Object} 叠加 URL 覆盖后的 nodeTransform 副本
 */
export function applyUrlEmojiOverride(nodeTransform, urlEmoji) {
    const next = { ...(nodeTransform || {}) };
    if (urlEmoji === 'false') {
        next.addFlagEmoji = false;
        next.removeFlagEmoji = true;
    } else if (urlEmoji === 'true') {
        next.addFlagEmoji = true;
    }
    return next;
}

/**
 * 计算最终是否保留/添加节点名 emoji。
 * 优先级：nodeTransform.addFlagEmoji（来自 URL 或组件设置）> config.enableFlagEmoji（全局设置）；
 * 额外约束：启用了模板命名但模板不含 {emoji} 时强制移除。
 * @param {Object} config - 全局配置（读取 enableFlagEmoji）
 * @param {Object} nodeTransform - 已叠加 URL 覆盖的 nodeTransform
 * @returns {boolean} 是否保留 emoji
 */
export function resolveKeepEmoji(config, nodeTransform) {
    const nt = nodeTransform || {};
    const templateEnabled = Boolean(nt.enabled && nt.rename?.template?.enabled);
    const effectiveTemplate = nt.rename?.template?.template || DEFAULT_TEMPLATE;
    const templateContainsEmoji = templateEnabled && effectiveTemplate.includes('{emoji}');

    const emojiEnabledByConfig = config?.enableFlagEmoji !== false;
    let keep = emojiEnabledByConfig;
    if (nt.addFlagEmoji === false) keep = false;
    if (nt.addFlagEmoji === true) keep = true;

    // 模板启用但不含 {emoji}：无论开关如何，都不应保留
    if (templateEnabled && !templateContainsEmoji) keep = false;

    return keep;
}

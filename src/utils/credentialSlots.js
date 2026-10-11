// 凭证在 @ 前 userinfo（单字段）的协议——与后端 node-transformer 的注入范围保持一致
const USERINFO_PROTOS = new Set(['vless', 'trojan', 'hysteria', 'hysteria2', 'hy2']);

/** 从节点 URL 的 @ 前 userinfo 取基准凭证；仅支持 userinfo 协议，其余/异常返回空串。 */
export function extractCredentialFromUrl(url) {
    const text = String(url || '');
    const proto = (text.split('://')[0] || '').toLowerCase();
    if (!USERINFO_PROTOS.has(proto)) return '';
    try {
        const afterScheme = text.slice(text.indexOf('://') + 3);
        const authority = afterScheme.split(/[?#]/)[0];
        const at = authority.lastIndexOf('@');
        if (at === -1) return '';
        return decodeURIComponent(authority.slice(0, at));
    } catch {
        return '';
    }
}

/** 汇总一个 Profile 选中的手动节点用到的凭证槽（按槽去重，带首个命中的基准凭证）。 */
export function collectUsedSlots(manualNodeIds = [], allManualNodes = []) {
    const byId = new Map((allManualNodes || []).map(n => [n.id, n]));
    const slots = new Map();
    for (const id of (manualNodeIds || [])) {
        const node = byId.get(id);
        const slot = node && typeof node.credentialSlot === 'string' ? node.credentialSlot.trim() : '';
        if (!slot || slots.has(slot)) continue;
        slots.set(slot, { slot, baseline: extractCredentialFromUrl(node.url) });
    }
    return Array.from(slots.values());
}

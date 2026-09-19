import { describe, it, expect } from 'vitest';
import { generateCombinedNodeList } from '../../functions/services/subscription-service.js';

// 复现：全局 enableFlagEmoji=false，订阅组启用了 rename 模板算子且模板为纯 {name}，
// 源节点名不含国旗。期望：输出节点名不应出现任何 emoji（国旗或 🌍）。
describe('emoji 开关复现', () => {
    const misubs = [
        { id: 'n1', name: 'plain', url: 'trojan://pass@hk.example.com:443#MyNode', enabled: true }
    ];

    it('全局关闭 emoji + 模板 {name} 时不应出现 emoji', async () => {
        const result = await generateCombinedNodeList(
            {},
            { enableAccessLog: false, enableFlagEmoji: false },
            'ClashMeta',
            misubs,
            '',
            {
                enableSubscriptions: true,
                operators: [
                    {
                        type: 'rename',
                        enabled: true,
                        params: { template: { enabled: true, template: '{name}', indexScope: 'global' } }
                    }
                ]
            },
            false
        );

        const emojiRegex = /[\u{1F1E6}-\u{1F1FF}]{2}|\u{1F30D}/u;
        expect(emojiRegex.test(result), `输出含 emoji:\n${result}`).toBe(false);
    });

    it('全局关闭 emoji + 模板 {emoji}{name} 时也不应出现 emoji', async () => {
        const result = await generateCombinedNodeList(
            {},
            { enableAccessLog: false, enableFlagEmoji: false },
            'ClashMeta',
            misubs,
            '',
            {
                enableSubscriptions: true,
                operators: [
                    {
                        type: 'rename',
                        enabled: true,
                        params: { template: { enabled: true, template: '{emoji}{name}', indexScope: 'global' } }
                    }
                ]
            },
            false
        );

        const emojiRegex = /[\u{1F1E6}-\u{1F1FF}]{2}|\u{1F30D}/u;
        expect(emojiRegex.test(result), `输出含 emoji:\n${result}`).toBe(false);
    });

    it('源节点已带国旗 + 全局关闭时应剥离国旗（无算子 legacy 路径）', async () => {
        const flagged = [
            { id: 'f1', name: 'x', url: `trojan://pass@hk.example.com:443#${encodeURIComponent('\u{1F1ED}\u{1F1F0} 香港01')}`, enabled: true }
        ];
        const result = await generateCombinedNodeList(
            {},
            { enableAccessLog: false, enableFlagEmoji: false },
            'ClashMeta',
            flagged,
            '',
            { enableSubscriptions: true },
            false
        );

        const emojiRegex = /[\u{1F1E6}-\u{1F1FF}]{2}|\u{1F30D}/u;
        expect(emojiRegex.test(result), `输出含 emoji:\n${result}`).toBe(false);
    });
});

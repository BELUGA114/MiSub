# rename 算子「仅重名时编号」实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让结构化 rename 算子的模板重写支持「仅对重名分组编号」——同名（或同名+协议）分组大小 ≥ 2 时组内编号，= 1 时整条模板跳过、保持原名。

**Architecture:** 纯新增。后端在 `nodeGroupKey` 增加两个精确匹配的分组键（`nameExact` / `nameProtocolExact`），并在 `opRename` 模板阶段增加 `template.onlyWhenDuplicated` 开关：开启时先扫描各分组大小，map 内对大小为 1 的分组直接返回原记录。前端在 `RenameEditor.vue` 增加两个分组按钮与一个开关，开关打开时该行只显示两个同名维度按钮。存量配置与输出逐字节不变。

**Tech Stack:** Cloudflare Pages Functions（纯 ES modules，无构建）、Vue 3 + Vitest、i18n 双语（`src/i18n/messages.js`）。

**Spec:** `docs/superpowers/specs/2026-10-15-rename-dup-index-design.md`

---

## File Structure

| 文件 | 职责 | 动作 |
|---|---|---|
| `functions/utils/operator-runner.js` | 算子链执行；`nodeGroupKey` 分组键、`opRename` 的 rename 逻辑 | 修改（两处） |
| `tests/unit/operator-runner.test.js` | 算子链单元测试（含现有 `rename indexScope=name 同名编号` 块） | 修改 |
| `src/i18n/messages.js` | zh-CN / en-US 文案，`operators` 命名空间 | 修改（两个 locale） |
| `src/components/features/Operators/components/RenameEditor.vue` | rename 算子卡表单 | 修改 |
| `tests/unit/rename-editor-dup-toggle.test.js` | RenameEditor 开关行为单元测试 | 新建 |
| `docs/OPERATOR_CHAIN_GUIDE.md` | 操作符链用户文档 | 修改 |

**关键约定**（三个测试文件都要用，先记牢）：

- 测试用节点 URL 构造器：`const mk = (host, name) => \`trojan://p@${host}:443#${encodeURIComponent(name)}\``
- 从输出 URL 取回名字：`const names = out => out.map(u => decodeURIComponent(u.slice(u.lastIndexOf('#') + 1)))`

以下期望值均已用当前代码实测确认，不是推测。

---

### Task 1: 后端分组键 `nameExact` / `nameProtocolExact`

**Files:**
- Modify: `functions/utils/operator-runner.js:88-94`
- Test: `tests/unit/operator-runner.test.js`（在现有 `describe('rename indexScope=name 同名编号')` 块之后新增）

- [ ] **Step 1: 写失败测试**

在 `tests/unit/operator-runner.test.js` 中找到现有的这段（约 `:439-450`）：

```js
describe('rename indexScope=name 同名编号', () => {
  const mk = (host, name) => `trojan://p@${host}:443#${encodeURIComponent(name)}`;
  it('同名节点组内各自从 1 递增', async () => {
    const urls = [mk('a.example.com', '香港'), mk('b.example.com', '香港'), mk('c.example.com', '日本')];
    const out = await runOperatorChain(urls, [{
      type: 'rename',
      params: { template: { enabled: true, template: '{name}-{index}', indexScope: 'name' } }
    }]);
    const names = out.map(u => decodeURIComponent(u.slice(u.lastIndexOf('#') + 1)));
    expect(names).toEqual(['香港-1', '香港-2', '日本-1']);
  });
});
```

**不要改动这个块**（它是「开关关闭」的回归基线）。在它之后新增：

```js
describe('rename indexScope=nameExact 精确同名分组', () => {
  const mk = (host, name) => `trojan://p@${host}:443#${encodeURIComponent(name)}`;
  const names = out => out.map(u => decodeURIComponent(u.slice(u.lastIndexOf('#') + 1)));

  it('按当前 name 精确分组，不与 cleanName 相同的不同名节点合组', async () => {
    const urls = [
      mk('a.example.com', '香港01 3x'),
      mk('b.example.com', '香港01 5x'),
      mk('c.example.com', '香港01 5x'),
      mk('d.example.com', '日本01')
    ];
    const out = await runOperatorChain(urls, [{
      type: 'rename',
      params: { template: { enabled: true, template: '{name}-{index}', indexScope: 'nameExact' } }
    }]);
    expect(names(out)).toEqual(['香港01 3x-1', '香港01 5x-1', '香港01 5x-2', '日本01-1']);
  });

  it('nameProtocolExact 下同名的不同协议各自计数', async () => {
    const urls = [
      'trojan://p@a.example.com:443#HK',
      'trojan://p@b.example.com:443#HK',
      'vless://00000000-0000-0000-0000-000000000001@c.example.com:443?type=tcp#HK'
    ];
    const out = await runOperatorChain(urls, [{
      type: 'rename',
      params: { template: { enabled: true, template: '{name}-{index}', indexScope: 'nameProtocolExact' } }
    }]);
    expect(names(out)).toEqual(['HK-1', 'HK-2', 'HK-1']);
  });
});
```

第一条为什么能区分 `name` 与 `nameExact`：`香港01 3x` 与 `香港01 5x` 的 `metadata.cleanName` 都被净化成 `香港01`，用旧 `name` scope 会三者同组得到 `香港01 3x-1 / 香港01 5x-2 / 香港01 5x-3`；用 `nameExact` 则前两者各自成组、两个 `香港01 5x` 同组。

- [ ] **Step 2: 运行测试确认失败**

```bash
npm run test:run -- tests/unit/operator-runner.test.js
```

预期：新增两条 FAIL。因为未识别的 scope 在 `nodeGroupKey` 里落到 `'global'`，实际会得到 `['香港01 3x-1', '香港01 5x-2', '香港01 5x-3', '日本01-4']` 与 `['HK-1', 'HK-2', 'HK-3']`。

- [ ] **Step 3: 实现分组键**

修改 `functions/utils/operator-runner.js:84-94`，把整段替换为：

```js
/**
 * 计算分组计数的分组键：供结构化 rename 的 indexScope 与 limit 的 groupBy 共用。
 * region/regionProtocol 依赖富化后的 enriched.regionZh；name 用 cleanName 兜底原始 name；
 * nameExact/nameProtocolExact 只读当前 name，用于“显示名完全一致才算同名”的场景。
 */
function nodeGroupKey(record, enriched, scope) {
    if (scope === 'region') return `r:${enriched.regionZh || 'Other'}`;
    if (scope === 'protocol') return `p:${record.protocol}`;
    if (scope === 'regionProtocol') return `rp:${enriched.regionZh || 'Other'}|${record.protocol}`;
    if (scope === 'name') return `n:${record.metadata?.cleanName || record.name}`;
    // 精确同名：不读 cleanName，区分大小写、不 trim。显示名完全一致才需要编号区分，
    // 例如“香港01 3x”与“香港01 5x”在客户端里本就是两个不同的名字。
    if (scope === 'nameExact') return `ne:${record.name}`;
    // 精确同名 + 协议：同名的不同协议各自成组、各自从 1 递增。
    if (scope === 'nameProtocolExact') return `np:${record.name}|${record.protocol}`;
    return 'global';
}
```

- [ ] **Step 4: 运行测试确认通过**

```bash
npm run test:run -- tests/unit/operator-runner.test.js
```

预期：全部 PASS，含原有 `['香港-1', '香港-2', '日本-1']` 那条未改动。

- [ ] **Step 5: 提交**

```bash
git add functions/utils/operator-runner.js tests/unit/operator-runner.test.js
git commit -m "feat(operator): rename 新增 nameExact/nameProtocolExact 精确同名分组键"
```

---

### Task 2: 后端 `template.onlyWhenDuplicated` 跳过逻辑

**Files:**
- Modify: `functions/utils/operator-runner.js:140-175`（`opRename` 的 template 分支）
- Test: `tests/unit/operator-runner.test.js`

- [ ] **Step 1: 写失败测试**

在 Task 1 新增的 `describe('rename indexScope=nameExact 精确同名分组')` 块之后追加一个新块：

```js
describe('rename onlyWhenDuplicated 仅重名时编号', () => {
  const mk = (host, name) => `trojan://p@${host}:443#${encodeURIComponent(name)}`;
  const names = out => out.map(u => decodeURIComponent(u.slice(u.lastIndexOf('#') + 1)));

  it('nameExact：分组 ≥2 编号，唯一分组保持原名', async () => {
    const urls = [
      mk('a.example.com', '香港01'), mk('b.example.com', '香港01'), mk('c.example.com', '香港01'),
      mk('d.example.com', '日本01')
    ];
    const out = await runOperatorChain(urls, [{
      type: 'rename',
      params: {
        template: { enabled: true, template: '{name}-{index}', indexScope: 'nameExact', onlyWhenDuplicated: true }
      }
    }]);
    expect(names(out)).toEqual(['香港01-1', '香港01-2', '香港01-3', '日本01']);
  });

  it('nameProtocolExact：同名不同协议各自成组，组内唯一的不编号', async () => {
    const urls = [
      'trojan://p@a.example.com:443#HK',
      'trojan://p@b.example.com:443#HK',
      'vless://00000000-0000-0000-0000-000000000001@c.example.com:443?type=tcp#HK',
      'trojan://p@d.example.com:443#JP'
    ];
    const out = await runOperatorChain(urls, [{
      type: 'rename',
      params: {
        template: { enabled: true, template: '{name}-{index}', indexScope: 'nameProtocolExact', onlyWhenDuplicated: true }
      }
    }]);
    expect(names(out)).toEqual(['HK-1', 'HK-2', 'HK', 'JP']);
  });

  it('唯一分组是整条模板跳过，而非把 {index} 渲染成空串', async () => {
    const urls = [
      mk('a.example.com', '🇯🇵日本01'), mk('b.example.com', '🇯🇵日本01'),
      mk('c.example.com', '🇭🇰香港01')
    ];
    const out = await runOperatorChain(urls, [{
      type: 'rename',
      params: {
        template: {
          enabled: true,
          template: '{emoji}{region}-{protocol}-{index}',
          indexScope: 'nameExact',
          onlyWhenDuplicated: true
        }
      }
    }]);
    expect(names(out)).toEqual(['🇯🇵日本-trojan-1', '🇯🇵日本-trojan-2', '🇭🇰香港01']);
  });

  it('开关关闭时行为不变', async () => {
    const urls = [mk('a.example.com', '香港'), mk('b.example.com', '香港'), mk('c.example.com', '日本')];
    const out = await runOperatorChain(urls, [{
      type: 'rename',
      params: { template: { enabled: true, template: '{name}-{index}', indexScope: 'name', onlyWhenDuplicated: false } }
    }]);
    expect(names(out)).toEqual(['香港-1', '香港-2', '日本-1']);
  });

  it('与起始序号 offset 协同，且唯一分组不受 offset 影响', async () => {
    const urls = [
      mk('a.example.com', '香港01'), mk('b.example.com', '香港01'), mk('c.example.com', '日本01')
    ];
    const out = await runOperatorChain(urls, [{
      type: 'rename',
      params: {
        template: { enabled: true, template: '{name}-{index}', indexScope: 'nameExact', onlyWhenDuplicated: true, offset: 10 }
      }
    }]);
    expect(names(out)).toEqual(['香港01-10', '香港01-11', '日本01']);
  });
});
```

第三条是区分「跳过」与「渲染空 index」的关键断言：若实现成后者，会得到 `🇭🇰香港--trojan-`（悬空的 emoji 与分隔符）而不是 `🇭🇰香港01`。

- [ ] **Step 2: 运行测试确认失败**

```bash
npm run test:run -- tests/unit/operator-runner.test.js
```

预期：前三条与第五条 FAIL（唯一节点被编号）；第四条 PASS。

- [ ] **Step 3: 实现跳过逻辑**

修改 `functions/utils/operator-runner.js:140-175`，把 template 分支的开头（从 `if (template?.enabled && template.template) {` 到 `const vars = {` 之前）替换为：

```js
    if (template?.enabled && template.template) {
        const counters = new Map();
        const scope = template.indexScope || template.scope || 'region'; // 默认按地区分组计数，符合用户直觉
        const skipUnique = template.onlyWhenDuplicated === true;

        // 仅重名时编号：先扫描各分组大小（只读不改）。预扫描与主循环用同样的富化方式，
        // 保证两次算出的分组键逐字一致。
        let groupSizes = null;
        if (skipUnique) {
            groupSizes = new Map();
            for (const r of result) {
                const enriched = NodeUtils.ensureRegionInfo(r, enableEmoji);
                const key = nodeGroupKey(r, enriched, scope);
                groupSizes.set(key, (groupSizes.get(key) || 0) + 1);
            }
        }

        result = result.map((r, index) => {
            const enriched = NodeUtils.ensureRegionInfo(r, enableEmoji);

            // 确定索引分组键（region/protocol/regionProtocol/name/nameExact/nameProtocolExact/global）
            const groupKey = nodeGroupKey(r, enriched, scope);

            // 组内只有本节点时无需区分：整条模板都不套用，保持进入本算子时的原名。
            // 跳过发生在计数之前，被跳过的分组大小恒为 1、其本身也只会被计入一次，
            // 故不影响任何分组的计数。
            if (groupSizes && (groupSizes.get(groupKey) || 0) < 2) {
                return r;
            }

            const groupIndex = (counters.get(groupKey) || 0) + 1;
```

其后的 `counters.set(groupKey, groupIndex);`、`vars`、`renderTemplate`、写回 `url` 的代码**一行都不要动**。

- [ ] **Step 4: 运行测试确认通过**

```bash
npm run test:run -- tests/unit/operator-runner.test.js
```

预期：全部 PASS。

- [ ] **Step 5: 提交**

```bash
git add functions/utils/operator-runner.js tests/unit/operator-runner.test.js
git commit -m "feat(operator): rename 支持 template.onlyWhenDuplicated 仅重名时编号"
```

---

### Task 3: i18n 文案（zh-CN / en-US）

**Files:**
- Modify: `src/i18n/messages.js`（zh-CN 约 `:1066-1067`，en-US 约 `:2282-2283`）
- Test: `tests/unit/operator-chain-i18n.test.js`（现有契约测试，不改）

- [ ] **Step 1: 加 zh-CN 文案**

在 `src/i18n/messages.js` 中 zh-CN 的 `operators` 命名空间里，找到：

```js
      indexScopeName: '按名称',
      regionLabel: '{region}'
```

改为：

```js
      indexScopeName: '按名称',
      indexScopeNameExact: '同名',
      indexScopeNameProtocolExact: '同名+协议',
      onlyWhenDuplicated: '仅重名时编号',
      onlyWhenDuplicatedHint: '开启后按「同名」维度分组，组内节点数 ≥ 2 才套用模板编号；只有 1 个的节点保持原订阅中的名字。',
      regionLabel: '{region}'
```

- [ ] **Step 2: 加 en-US 文案**

在同文件 en-US 的 `operators` 命名空间里，找到：

```js
      indexScopeName: 'By name',
      regionLabel: '{region}'
```

改为：

```js
      indexScopeName: 'By name',
      indexScopeNameExact: 'Same name',
      indexScopeNameProtocolExact: 'Same name + protocol',
      onlyWhenDuplicated: 'Number duplicates only',
      onlyWhenDuplicatedHint: 'Groups by name; the template is applied only when 2 or more nodes share the name. Unique nodes keep their original name.',
      regionLabel: '{region}'
```

en-US 的值里不能出现任何汉字，否则 `tests/unit/operator-chain-i18n.test.js` 的 `expectNoChineseOrKeys` 会失败。

- [ ] **Step 3: 运行契约测试**

```bash
npm run test:run -- tests/unit/operator-chain-i18n.test.js
```

预期：PASS（此时新按钮还没渲染，测试只是保证既有文案未被破坏）。

- [ ] **Step 4: 提交**

```bash
git add src/i18n/messages.js
git commit -m "i18n(operator): rename 仅重名时编号的双语文案"
```

---

### Task 4: `RenameEditor.vue` 开关与分组按钮

**Files:**
- Modify: `src/components/features/Operators/components/RenameEditor.vue:68-75`（选项常量）、`:201-214`（索引分组一行）
- Test: `tests/unit/rename-editor-dup-toggle.test.js`（新建）

- [ ] **Step 1: 写失败测试**

新建 `tests/unit/rename-editor-dup-toggle.test.js`：

```js
import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import RenameEditor from '../../src/components/features/Operators/components/RenameEditor.vue';
import { createI18n } from '../../src/i18n/index.js';

// 与 RenameEditor 的按钮文案一一对应，用于把「索引分组」那一行的按钮筛出来
const SCOPE_LABELS = ['全局', '按地区', '按协议', '按地区+协议', '按名称', '同名', '同名+协议'];

const mountEditor = (params) => mount(RenameEditor, {
  props: { modelValue: params },
  global: { plugins: [createI18n({ initialLocale: 'zh-CN' })] }
});

const templateParams = (params) => ({ enabled: true, template: '{name}-{index}', ...params });

const scopeButtons = (wrapper) => wrapper.findAll('button').filter(b => SCOPE_LABELS.includes(b.text()));

const lastEmittedTemplate = (wrapper) => {
  const events = wrapper.emitted('update:modelValue');
  return events[events.length - 1][0].template;
};

// “仅重名时编号”开关按 DOM 顺序是模板区最后一个「开/关」按钮：
// 正则区开关 -> 模板重写开关 -> 本开关。RenamEditor 的模板区渲染顺序固定，故取末位即可。
const dupToggle = (wrapper) => {
  const toggles = wrapper.findAll('button').filter(b => ['开', '关'].includes(b.text()));
  return toggles[toggles.length - 1];
};

describe('RenameEditor 仅重名时编号', () => {
  it('开关关闭时展示全部 7 个索引分组按钮', () => {
    const wrapper = mountEditor({ template: templateParams({ indexScope: 'region' }) });
    expect(scopeButtons(wrapper)).toHaveLength(7);
  });

  it('开启开关且当前 scope 非同名维度时，同时写回 nameExact', async () => {
    const wrapper = mountEditor({ template: templateParams({ indexScope: 'region' }) });
    await dupToggle(wrapper).trigger('click');
    expect(lastEmittedTemplate(wrapper)).toEqual({
      enabled: true,
      template: '{name}-{index}',
      indexScope: 'nameExact',
      onlyWhenDuplicated: true
    });
  });

  it('开启开关时已是 nameProtocolExact 则不改写 scope', async () => {
    const wrapper = mountEditor({ template: templateParams({ indexScope: 'nameProtocolExact' }) });
    await dupToggle(wrapper).trigger('click');
    expect(lastEmittedTemplate(wrapper)).toEqual({
      enabled: true,
      template: '{name}-{index}',
      indexScope: 'nameProtocolExact',
      onlyWhenDuplicated: true
    });
  });

  it('开关开启后只展示同名维度的 2 个分组按钮', () => {
    const wrapper = mountEditor({
      template: templateParams({ indexScope: 'nameExact', onlyWhenDuplicated: true })
    });
    expect(scopeButtons(wrapper).map(b => b.text())).toEqual(['同名', '同名+协议']);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
npm run test:run -- tests/unit/rename-editor-dup-toggle.test.js
```

预期：4 条全部 FAIL——按钮只有 5 个、找不到「仅重名时编号」开关。

- [ ] **Step 3: 实现选项常量与开关辅助函数**

修改 `RenameEditor.vue:68-75`，把整个 `indexScopeOptions` 常量替换为：

```js
// 索引分组方式：与后端 rename 的 indexScope（nodeGroupKey）取值一致
const indexScopeOptions = [
  { value: 'global', labelKey: 'operators.indexScopeGlobal' },
  { value: 'region', labelKey: 'operators.indexScopeRegion' },
  { value: 'protocol', labelKey: 'operators.indexScopeProtocol' },
  { value: 'regionProtocol', labelKey: 'operators.indexScopeRegionProtocol' },
  { value: 'name', labelKey: 'operators.indexScopeName' },
  { value: 'nameExact', labelKey: 'operators.indexScopeNameExact' },
  { value: 'nameProtocolExact', labelKey: 'operators.indexScopeNameProtocolExact' },
];

// 仅重名时编号只在“同名”维度上有定义：全局/地区/协议 等分组下没有“重名”一说
const dupOnlyScopeValues = ['nameExact', 'nameProtocolExact'];

const onlyWhenDuplicated = computed(() => props.modelValue.template?.onlyWhenDuplicated === true);

const visibleIndexScopeOptions = computed(() => onlyWhenDuplicated.value
  ? indexScopeOptions.filter(opt => dupOnlyScopeValues.includes(opt.value))
  : indexScopeOptions);

// 开关打开时把落在同名维度之外的 scope 写回 nameExact：若只做界面回落而保存值仍是 region，
// 会出现“界面高亮同名、后端按地区分组”的错配。关闭开关不回退该值，它在完整列表里仍是合法选项。
const toggleOnlyWhenDuplicated = () => {
  const next = !onlyWhenDuplicated.value;
  const currentScope = props.modelValue.template?.indexScope || 'region';
  if (next && !dupOnlyScopeValues.includes(currentScope)) {
    updateTemplate({ onlyWhenDuplicated: true, indexScope: 'nameExact' });
    return;
  }
  updateTemplate({ onlyWhenDuplicated: next });
};
```

`computed` 已在文件顶部 import（`:2`），无需新增 import。

- [ ] **Step 4: 实现模板 UI**

修改 `RenameEditor.vue:201-214`（`<div class="flex flex-wrap items-center gap-1.5 mt-3 pt-3 border-t border-teal-100/20">` 那一段），整段替换为：

```html
          <div class="flex flex-wrap items-center gap-2 mt-3 pt-3 border-t border-teal-100/20">
            <span class="text-[10px] text-teal-600/60 font-medium mr-1">{{ t('operators.onlyWhenDuplicated') }}</span>
            <button
              @click="toggleOnlyWhenDuplicated"
              :class="['text-[10px] font-medium transition-colors', onlyWhenDuplicated ? 'text-teal-600' : 'text-gray-300']"
            >
              {{ statusLabel(onlyWhenDuplicated) }}
            </button>
          </div>
          <p class="mt-1 text-[10px] text-gray-400">{{ t('operators.onlyWhenDuplicatedHint') }}</p>

          <div v-if="visibleIndexScopeOptions.length" class="flex flex-wrap items-center gap-1.5 mt-3 pt-3 border-t border-teal-100/20">
            <span class="text-[10px] text-teal-600/60 font-medium mr-1">{{ t('operators.indexScope') }}</span>
            <button v-for="opt in visibleIndexScopeOptions" :key="opt.value"
              @click="updateTemplate({ indexScope: opt.value })"
              :class="[
                'text-[9px] px-2 py-0.5 rounded border transition-colors',
                (props.modelValue.template.indexScope || 'region') === opt.value
                  ? 'bg-teal-600 border-teal-500 text-white'
                  : 'bg-white dark:bg-gray-800 border-teal-100/30 text-gray-500 hover:bg-teal-50 dark:hover:bg-teal-900/20'
              ]"
            >
              {{ t(opt.labelKey) }}
            </button>
          </div>
```

注意：`v-for` 的数据源从 `indexScopeOptions` 改成 `visibleIndexScopeOptions`。

- [ ] **Step 5: 运行测试确认通过**

```bash
npm run test:run -- tests/unit/rename-editor-dup-toggle.test.js tests/unit/operator-chain-i18n.test.js
```

预期：全部 PASS。i18n 契约测试会点开 rename 卡（`headers[1]`）并对整页文本跑 `expectNoChineseOrKeys`，是新增开关文案在 en-US 下不泄漏 key 的验证。

- [ ] **Step 6: 提交**

```bash
git add src/components/features/Operators/components/RenameEditor.vue tests/unit/rename-editor-dup-toggle.test.js
git commit -m "feat(ui): rename 算子卡新增同名/同名+协议分组与仅重名时编号开关"
```

---

### Task 5: 用户文档

**Files:**
- Modify: `docs/OPERATOR_CHAIN_GUIDE.md:29-36`

- [ ] **Step 1: 改写重命名段落**

把 `docs/OPERATOR_CHAIN_GUIDE.md` 第 2 节 Rename 的这段：

```markdown
### 🏷️ 节点重命名 (Rename)
重塑节点名称，使其在客户端中整齐划一。
- **正则替换**：将 `香港 01` 替换为 `HK-01`。
- **模板重写**：支持占位符，如 `{emoji}{region}-{protocol}-{index}`。
  - `{emoji}`: 自动添加国旗。
  - `{regionZh}`: 中文地区名。
  - `{index}`: 自动递增序列号。
  - **索引分组**：`{index}` 的计数方式可选 全局 / 按地区 / 按协议 / 按地区+协议 / **按名称**。选“按名称”时，**同名节点**各自从 1 递增，配合模板 `{name}-{index}` 可实现“同名加序号”。
```

替换为：

```markdown
### 🏷️ 节点重命名 (Rename)
重塑节点名称，使其在客户端中整齐划一。
- **正则替换**：将 `香港 01` 替换为 `HK-01`。
- **模板重写**：支持占位符，如 `{emoji}{region}-{protocol}-{index}`。
  - `{emoji}`: 自动添加国旗。
  - `{regionZh}`: 中文地区名。
  - `{index}`: 自动递增序列号。
  - **索引分组**：`{index}` 的计数方式可选 全局 / 按地区 / 按协议 / 按地区+协议 / 按名称 / **同名** / **同名+协议**。各取值都是组内从 1 递增，配合模板 `{name}-{index}` 可实现“同名加序号”。
    - **按名称**：按**净化名**分组——会剥掉“3x”倍率、标签、国旗后再比较，所以 `香港01 3x` 与 `香港01 5x` 算作同一组。
    - **同名**：按**当前名字逐字精确匹配**（区分大小写、不 trim）分组。显示名完全一致才需要编号区分，配合下面的开关即“只有重名才加序号”。
    - **同名+协议**：在“同名”基础上并入协议，同名的 vless 与 trojan 各自成组、各自从 1 递增。
  - **仅重名时编号**：开启后按“同名”维度分组，**组内节点数 ≥ 2 才套用模板**；只有 1 个的节点**整条模板都不套用**，保持原订阅里的名字（不是“序号渲染为空”——模板里的 `{emoji}{region}` 等也不会生效）。开启时分组方式自动切到“同名”（若原来是全局/地区等）。
    - 典型用法：`去重 -> 过滤 -> 重命名(模板 {name}-{index}，分组=同名，勾选仅重名时编号) -> 排序`。结果是重名节点被编成 `香港01-1`、`香港01-2`，而唯一的 `日本01` 保持原样。
    - 顺序提示：编号按**当前列表顺序**递增；想让编号稳定可预期，把**排序 (Sort) 放在重命名之前**。
```

- [ ] **Step 2: 提交**

```bash
git add docs/OPERATOR_CHAIN_GUIDE.md
git commit -m "docs(operator): 补充 rename 同名维度分组与仅重名时编号说明"
```

---

### Task 6: 全量验证

- [ ] **Step 1: 跑全部单元测试**

```bash
npm run test:run
```

预期：全部 PASS，无 failed。**开工前先跑一次全量记录基线数字**（哪个用例数不重要，重要的是「无 failed」这个状态在改动前后一致），改动引入的任何新失败都必须定位修复。

- [ ] **Step 2: 跑构建**

```bash
npm run build
```

预期：构建成功，无新增警告。

- [ ] **Step 3: 复核 diff**

```bash
git log --oneline -8
git status --short
```

预期：`git log` 显示本计划的 5 个 Task 提交（外加 spec 提交与 plan 提交）；`git status --short` 输出为空（无未提交残留）。若出现 File Structure 表以外的文件被改动，回退那部分改动。

- [ ] **Step 4: 若发现验证未过**

不要带病提交。回到对应 Task 修复，重新跑该 Task 的窄测试，再重跑 Step 1/2。**不要**为了让测试变绿而改期望值——所有期望值都是先用当前代码实测确认过的。

---

## 非目标（不要在实现时顺手做）

- 不给 DSL 脚本算子注入分组计数（不新增 `{dupIndex}` 之类模板函数）。
- 不改现有 `indexScope: 'name'`（`cleanName` 兜底）的语义，不改 `tests/unit/operator-runner.test.js:445` 那条断言。
- 不给 `limit` 的 `groupBy` 前端暴露 `nameExact` / `nameProtocolExact`。
- 不改遗留路径 `functions/utils/node-transformer.js:995-1032` 与 `getIndexGroupKey`（`:713-719`，无 `name` 分支）。前端已无入口。
- 不新增格式化/重排改动，不带入无关文件。

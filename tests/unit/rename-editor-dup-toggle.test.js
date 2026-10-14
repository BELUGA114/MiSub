import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import RenameEditor from '../../src/components/features/Operators/components/RenameEditor.vue';
import { createI18n } from '../../src/i18n/index.js';

// 与 RenameEditor 的按钮文案一一对应，用于把「索引分组」那一行的按钮筛出来
const SCOPE_LABELS = ['全局', '按地区', '按协议', '按地区+协议', '按名称', '同名', '同名+协议'];
// operators.statusOn / statusOff 的中文文案
const TOGGLE_LABELS = ['已开启', '关闭'];

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

// “仅重名时编号”开关按 DOM 顺序是模板区最后一个开/关按钮：
// 正则区开关 -> 模板重写开关 -> 本开关。模板区渲染顺序固定，故取末位即可。
const dupToggle = (wrapper) => {
  const toggles = wrapper.findAll('button').filter(b => TOGGLE_LABELS.includes(b.text()));
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

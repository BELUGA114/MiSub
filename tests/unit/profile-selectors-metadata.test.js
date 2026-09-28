import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import SubscriptionSelector from '../../src/components/modals/ProfileModal/SubscriptionSelector.vue';
import NodeSelector from '../../src/components/modals/ProfileModal/NodeSelector.vue';
import { createI18n } from '../../src/i18n/index.js';

const withI18n = () => createI18n({ initialLocale: 'zh-CN' });

describe('SubscriptionSelector 备注展示', () => {
  it('在可选列表中渲染订阅备注', () => {
    const subs = [
      { id: 's1', name: '香港订阅A', url: 'https://a.example.com', notes: '主力线路，月付' },
      { id: 's2', name: '美国订阅B', url: 'https://b.example.com' }
    ];
    const wrapper = mount(SubscriptionSelector, {
      props: { subscriptions: subs, filteredSubscriptions: subs, searchTerm: '', selectedIds: [] },
      global: { plugins: [withI18n()] }
    });

    expect(wrapper.text()).toContain('香港订阅A');
    expect(wrapper.text()).toContain('主力线路，月付');
  });

  it('订阅没有备注时不渲染备注行', () => {
    const subs = [{ id: 's2', name: '美国订阅B', url: 'https://b.example.com' }];
    const wrapper = mount(SubscriptionSelector, {
      props: { subscriptions: subs, filteredSubscriptions: subs, searchTerm: '', selectedIds: [] },
      global: { plugins: [withI18n()] }
    });

    // 备注行使用 text-gray-400，无备注时不应出现
    expect(wrapper.find('span.text-gray-400').exists()).toBe(false);
  });
});

describe('NodeSelector 分组展示', () => {
  it('在可选列表中渲染节点分组胶囊', () => {
    const nodes = [
      { id: 'n1', name: '香港节点01', url: 'vmess://xxx', group: '家宽' },
      { id: 'n2', name: '美国节点02', url: 'vless://yyy' }
    ];
    const wrapper = mount(NodeSelector, {
      props: {
        nodes,
        filteredNodes: nodes,
        searchTerm: '',
        activeGroupFilter: null,
        groups: ['家宽'],
        selectedIds: []
      },
      global: { plugins: [withI18n()] }
    });

    expect(wrapper.text()).toContain('香港节点01');
    // 分组胶囊使用 bg-gray-100，且承载分组名
    expect(wrapper.find('span.bg-gray-100').exists()).toBe(true);
    expect(wrapper.find('span.bg-gray-100').text()).toBe('家宽');
  });

  it('节点没有分组时不渲染分组胶囊', () => {
    const nodes = [{ id: 'n2', name: '美国节点02', url: 'vless://yyy' }];
    const wrapper = mount(NodeSelector, {
      props: {
        nodes,
        filteredNodes: nodes,
        searchTerm: '',
        activeGroupFilter: null,
        groups: [],
        selectedIds: []
      },
      global: { plugins: [withI18n()] }
    });

    expect(wrapper.find('span.bg-gray-100').exists()).toBe(false);
  });
});

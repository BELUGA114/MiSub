import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import OperatorChain from '../../src/components/features/Operators/OperatorChain.vue';
import { createI18n } from '../../src/i18n/index.js';

const mountChain = (params) => mount(OperatorChain, {
  props: {
    modelValue: [{ id: 'script-1', type: 'script', enabled: true, params }]
  },
  global: { plugins: [createI18n({ initialLocale: 'en-US' })] }
});

const dslStep = {
  action: 'set-query',
  when: [{ field: 'query.type', op: 'eq', value: 'xhttp' }],
  set: { mode: 'packet-up', alpn: 'h3' }
};

describe('script operator DSL editor', () => {
  it('commits parsed dsl when valid JSON is entered', async () => {
    const wrapper = mountChain({ url: '', dsl: [] });

    await wrapper.find('.cursor-pointer').trigger('click');
    const textarea = wrapper.find('textarea');
    expect(textarea.exists()).toBe(true);

    await textarea.setValue(JSON.stringify([dslStep], null, 2));

    const emitted = wrapper.emitted('update:modelValue');
    expect(emitted).toBeTruthy();
    const ops = emitted[emitted.length - 1][0];
    expect(ops[0].params.dsl).toEqual([dslStep]);
  });

  it('keeps params untouched and shows an error hint for invalid JSON', async () => {
    const wrapper = mountChain({ url: '', dsl: [] });

    await wrapper.find('.cursor-pointer').trigger('click');
    await wrapper.find('textarea').setValue('{ not json');

    expect(wrapper.emitted('update:modelValue')).toBeFalsy();
    expect(wrapper.text()).toContain('Invalid JSON');
  });

  it('serializes an existing dsl back into the textarea', async () => {
    const wrapper = mountChain({ url: '', dsl: [dslStep] });

    await wrapper.find('.cursor-pointer').trigger('click');
    const textarea = wrapper.find('textarea');

    expect(JSON.parse(textarea.element.value)).toEqual([dslStep]);
  });
});

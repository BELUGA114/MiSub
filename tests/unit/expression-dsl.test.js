import { describe, it, expect } from 'vitest';
import { matchesDslCondition, renderDslTemplate } from '../../functions/utils/expression-dsl.js';

describe('matchesDslCondition 数组 value = OR', () => {
  it('regex + 数组命中任意一个', () => {
    const rec = { name: '香港01' };
    expect(matchesDslCondition(rec, { field: 'name', op: 'regex', value: ['香港', 'HK'] })).toBe(true);
    expect(matchesDslCondition(rec, { field: 'name', op: 'regex', value: ['日本', 'JP'] })).toBe(false);
  });
  it('contains + 数组命中任意一个', () => {
    expect(matchesDslCondition({ name: 'Tokyo-Premium' }, { op: 'contains', value: ['Premium', 'IPLC'] })).toBe(true);
  });
  it('not_contains + 数组需全部不命中', () => {
    expect(matchesDslCondition({ name: '过期-01' }, { op: 'not_contains', value: ['过期', 'expire'] })).toBe(false);
    expect(matchesDslCondition({ name: '正常-01' }, { op: 'not_contains', value: ['过期', 'expire'] })).toBe(true);
  });
});

describe('新增表达式函数', () => {
  it('extract 取正则捕获组', () => {
    expect(renderDslTemplate('{extract(name, "(\\\\d+)$", 1)}', { name: '香港01' })).toBe('01');
  });
  it('slice 字符串切片', () => {
    expect(renderDslTemplate('{slice(name, 0, 2)}', { name: '香港01' })).toBe('香港');
  });
  it('padstart 左填充', () => {
    expect(renderDslTemplate('{padstart(index, 3, "0")}', { index: 5 })).toBe('005');
  });
  it('concat 拼接', () => {
    expect(renderDslTemplate('{concat(regionZh, "-", name)}', { regionZh: '香港', name: '01' })).toBe('香港-01');
  });
});

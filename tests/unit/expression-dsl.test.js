import { describe, it, expect } from 'vitest';
import { matchesDslCondition, renderDslTemplate, evaluateDslExpression } from '../../functions/utils/expression-dsl.js';

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

describe('健壮性与更多数组语义', () => {
  it('padstart 超长参数被钳制且不抛错', () => {
    const r = renderDslTemplate('{padstart(name, 999999999, "0")}', { name: 'x' });
    expect(r.length).toBe(1024);
    expect(r.endsWith('x')).toBe(true);
  });
  it('eq + 数组为 OR', () => {
    expect(matchesDslCondition({ protocol: 'vless' }, { field: 'protocol', op: 'eq', value: ['vless', 'vmess'] })).toBe(true);
    expect(matchesDslCondition({ protocol: 'trojan' }, { field: 'protocol', op: 'eq', value: ['vless', 'vmess'] })).toBe(false);
  });
  it('ne + 数组为全部不等', () => {
    expect(matchesDslCondition({ protocol: 'trojan' }, { field: 'protocol', op: 'ne', value: ['vless', 'vmess'] })).toBe(true);
    expect(matchesDslCondition({ protocol: 'vless' }, { field: 'protocol', op: 'ne', value: ['vless', 'vmess'] })).toBe(false);
  });
});

describe('对象条件：数值/顺序比较（gt/gte/lt/lte）', () => {
  it('gt/gte/lt/lte 按数值比较', () => {
    expect(matchesDslCondition({ port: '443' }, { field: 'port', op: 'gt', value: 400 })).toBe(true);
    expect(matchesDslCondition({ port: '443' }, { field: 'port', op: 'gt', value: 443 })).toBe(false);
    expect(matchesDslCondition({ port: '443' }, { field: 'port', op: 'gte', value: 443 })).toBe(true);
    expect(matchesDslCondition({ port: '80' }, { field: 'port', op: 'lt', value: 443 })).toBe(true);
    expect(matchesDslCondition({ port: '443' }, { field: 'port', op: 'lte', value: 443 })).toBe(true);
  });
  it('非数值一侧返回 false（不报错）', () => {
    expect(matchesDslCondition({ name: 'HK' }, { field: 'name', op: 'gt', value: 1 })).toBe(false);
    expect(matchesDslCondition({ port: '' }, { field: 'port', op: 'lte', value: 1 })).toBe(false);
  });
  it('数组 value 为 OR', () => {
    expect(matchesDslCondition({ port: '443' }, { field: 'port', op: 'gt', value: [9000, 400] })).toBe(true);
    expect(matchesDslCondition({ port: '443' }, { field: 'port', op: 'gt', value: [9000, 8000] })).toBe(false);
  });
});

describe('对象条件：starts_with / ends_with', () => {
  it('前后缀匹配且不区分大小写', () => {
    expect(matchesDslCondition({ name: 'HK-01' }, { field: 'name', op: 'starts_with', value: 'hk' })).toBe(true);
    expect(matchesDslCondition({ name: 'Node-IPLC' }, { field: 'name', op: 'ends_with', value: 'iplc' })).toBe(true);
    expect(matchesDslCondition({ name: 'HK-01' }, { field: 'name', op: 'starts_with', value: 'JP' })).toBe(false);
  });
  it('数组 value 为 OR', () => {
    expect(matchesDslCondition({ name: 'JP-02' }, { field: 'name', op: 'starts_with', value: ['HK', 'JP'] })).toBe(true);
    expect(matchesDslCondition({ name: 'SG-02' }, { field: 'name', op: 'starts_with', value: ['HK', 'JP'] })).toBe(false);
  });
});

describe('新增模板函数：split / len / number', () => {
  it('split 取第 i 段，越界取空串', () => {
    expect(renderDslTemplate('{split(name, "-", 1)}', { name: 'HK-01-A' })).toBe('01');
    expect(renderDslTemplate('{split(name, "-", 0)}', { name: 'HK-01-A' })).toBe('HK');
    expect(renderDslTemplate('{split(name, "-", 9)}', { name: 'HK-01-A' })).toBe('');
  });
  it('len 返回长度', () => {
    expect(renderDslTemplate('{len(name)}', { name: '香港01' })).toBe('4');
  });
  it('number 显式转数值，非数值得空串', () => {
    expect(renderDslTemplate('{number(port) + 1}', { port: '443' })).toBe('444');
    expect(renderDslTemplate('{number(name)}', { name: 'abc' })).toBe('');
  });
  it('函数名大小写不敏感', () => {
    expect(renderDslTemplate('{LEN(name)}', { name: 'abcd' })).toBe('4');
  });
});

describe('表达式解析器：分组/取反/算术', () => {
  const ctx = { name: '香港01', port: '443', protocol: 'vless' };
  it('括号改变优先级', () => {
    expect(evaluateDslExpression("(protocol === 'vless' || protocol === 'vmess') && contains(name, '香港')", ctx)).toBe(true);
  });
  it('&& 优先级高于 ||', () => {
    expect(evaluateDslExpression("protocol === 'vless' || protocol === 'x' && contains(name, '日本')", ctx)).toBe(true);
  });
  it('! 取反', () => {
    expect(evaluateDslExpression("!contains(name, '日本')", ctx)).toBe(true);
  });
  it('数字比较与算术', () => {
    expect(evaluateDslExpression('port > 400', ctx)).toBe(true);
    expect(renderDslTemplate('{1 + 2 * 3}', {})).toBe('7');
  });
  it('字符串 + 拼接', () => {
    expect(renderDslTemplate("{regionZh + '-' + name}", { regionZh: '香港', name: '01' })).toBe('香港-01');
  });
  it('保留既有语义', () => {
    expect(evaluateDslExpression("name === '香港01'", ctx)).toBe(true);
    expect(evaluateDslExpression('', ctx)).toBe(true);
  });
});

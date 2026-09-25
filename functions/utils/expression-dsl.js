/**
 * Restricted expression DSL for MiSub node transformations.
 * This intentionally avoids eval/new Function and supports only declarative
 * templates, field comparisons and a small helper call grammar.
 */

// 支持点路径（如 query.type），用于访问节点记录上的嵌套对象字段
const PATH_RE = /^[a-zA-Z_][a-zA-Z0-9_]*(?:\.[a-zA-Z_][a-zA-Z0-9_]*)*$/;
const STRING_RE = /^(?:'([^'\\]*(?:\\.[^'\\]*)*)'|"([^"\\]*(?:\\.[^"\\]*)*)")$/;
const NUMBER_RE = /^-?\d+(?:\.\d+)?$/;

function unquote(value) {
    const text = String(value || '').trim();
    const match = text.match(STRING_RE);
    if (!match) return text;
    const raw = match[1] ?? match[2] ?? '';
    return raw.replace(/\\(['"\\nrt])/g, (_, ch) => {
        switch (ch) {
            case 'n': return '\n';
            case 'r': return '\r';
            case 't': return '\t';
            default: return ch;
        }
    });
}

function splitArgs(input) {
    const args = [];
    let current = '';
    let quote = '';
    let escaped = false;
    let depth = 0;
    for (const char of String(input || '')) {
        if (escaped) {
            current += char;
            escaped = false;
            continue;
        }
        if (char === '\\') {
            current += char;
            escaped = true;
            continue;
        }
        if (quote) {
            current += char;
            if (char === quote) quote = '';
            continue;
        }
        if (char === '\'' || char === '"') {
            quote = char;
            current += char;
            continue;
        }
        if (char === '(') depth++;
        if (char === ')') depth = Math.max(0, depth - 1);
        if (char === ',' && depth === 0) {
            args.push(current.trim());
            current = '';
            continue;
        }
        current += char;
    }
    if (current.trim() || input === '') args.push(current.trim());
    return args;
}

function getField(ctx, name) {
    const path = String(name || '').trim();
    if (!PATH_RE.test(path)) return '';
    let value = ctx;
    for (const part of path.split('.')) {
        if (value === null || typeof value !== 'object' || !Object.prototype.hasOwnProperty.call(value, part)) return '';
        value = value[part];
    }
    return value ?? '';
}

function safeTitle(value) {
    const text = String(value || '');
    return text ? text.charAt(0).toUpperCase() + text.slice(1) : '';
}

function safeMatch(value, pattern, flags = 'i') {
    try {
        return new RegExp(String(pattern || ''), String(flags || 'i')).test(String(value || ''));
    } catch {
        return false;
    }
}

function safeReplace(value, pattern, replacement = '', flags = 'g') {
    try {
        return String(value || '').replace(new RegExp(String(pattern || ''), String(flags || 'g')), String(replacement || ''));
    } catch {
        return String(value || '');
    }
}

function safeExtract(value, pattern, groupIndex) {
    try {
        const m = String(value || '').match(new RegExp(String(pattern || '')));
        if (!m) return '';
        const n = Number.isFinite(Number(groupIndex)) ? Number(groupIndex) : 1;
        return m[n] ?? '';
    } catch {
        return '';
    }
}

function fallback(...values) {
    for (const value of values) {
        if (value !== null && value !== undefined && String(value).trim() !== '') return value;
    }
    return '';
}

function pick(condition, truthyValue, falsyValue = '') {
    return condition ? truthyValue : falsyValue;
}

function evalValue(expr, ctx) {
    const text = String(expr || '').trim();
    if (!text) return '';
    if (STRING_RE.test(text)) return unquote(text);
    if (NUMBER_RE.test(text)) return Number(text);
    if (text === 'true') return true;
    if (text === 'false') return false;
    if (text === 'null') return null;

    const call = text.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\((.*)\)$/s);
    if (call) {
        const [, fn, rawArgs] = call;
        const args = splitArgs(rawArgs).map(arg => evalValue(arg, ctx));
        switch (String(fn).toLowerCase()) {
            case 'upper': return String(args[0] || '').toUpperCase();
            case 'lower': return String(args[0] || '').toLowerCase();
            case 'title': return safeTitle(args[0]);
            case 'trim': return String(args[0] || '').trim();
            case 'replace': return safeReplace(args[0], args[1], args[2], args[3]);
            case 'contains': return String(args[0] || '').toLowerCase().includes(String(args[1] || '').toLowerCase());
            case 'match': return safeMatch(args[0], args[1], args[2] || 'i');
            case 'fallback': return fallback(...args);
            case 'pick': return pick(Boolean(args[0]), args[1], args[2] ?? '');
            case 'slice': return String(args[0] || '').slice(Number(args[1]) || 0, args[2] === undefined ? undefined : Number(args[2]));
            case 'padstart': return String(args[0] ?? '').padStart(Math.min(Number(args[1]) || 0, 1024), args[2] === undefined ? ' ' : String(args[2]));
            case 'concat': return args.map(a => String(a ?? '')).join('');
            case 'extract': return safeExtract(args[0], args[1], args[2]);
            default: return '';
        }
    }

    return getField(ctx, text);
}

export function evaluateDslExpression(expression, ctx = {}) {
    const expr = String(expression || '').trim();
    if (!expr) return true;

    const logicalOr = expr.split(/\s+\|\|\s+/);
    if (logicalOr.length > 1) return logicalOr.some(part => evaluateDslExpression(part, ctx));
    const logicalAnd = expr.split(/\s+&&\s+/);
    if (logicalAnd.length > 1) return logicalAnd.every(part => evaluateDslExpression(part, ctx));

    const comparison = expr.match(/^(.+?)\s*(===|!==|>=|<=|>|<)\s*(.+)$/s);
    if (comparison) {
        const left = evalValue(comparison[1], ctx);
        const right = evalValue(comparison[3], ctx);
        switch (comparison[2]) {
            case '===': return String(left) === String(right);
            case '!==': return String(left) !== String(right);
            case '>=': return Number(left) >= Number(right);
            case '<=': return Number(left) <= Number(right);
            case '>': return Number(left) > Number(right);
            case '<': return Number(left) < Number(right);
            default: return false;
        }
    }

    return Boolean(evalValue(expr, ctx));
}

export function renderDslTemplate(template, ctx = {}) {
    return String(template || '').replace(/\{([^{}]+)\}/g, (_, inner) => {
        const value = evalValue(inner, ctx);
        return value == null ? '' : String(value);
    }).trim();
}

function matchesOp(actual, op, expected, flags) {
    switch (op) {
        case 'eq':
        case 'equals': return String(actual) === String(expected);
        case 'ne':
        case 'not_equals': return String(actual) !== String(expected);
        case 'contains': return String(actual || '').toLowerCase().includes(String(expected || '').toLowerCase());
        case 'not_contains': return !String(actual || '').toLowerCase().includes(String(expected || '').toLowerCase());
        case 'match':
        case 'regex': return safeMatch(actual, expected, flags);
        default: return false;
    }
}

export function matchesDslCondition(record, condition = {}) {
    // 数组条件为 AND 语义：全部满足才算匹配
    if (Array.isArray(condition)) return condition.every(item => matchesDslCondition(record, item));
    if (typeof condition === 'string') return evaluateDslExpression(condition, record);
    if (!condition || typeof condition !== 'object') return true;
    const actual = getField(record, condition.field || 'name');
    const expected = condition.value ?? '';
    const op = String(condition.op || 'contains').toLowerCase();
    const flags = condition.flags || 'i';

    if (op === 'in') return Array.isArray(expected) && expected.map(String).includes(String(actual));

    // value 为数组时按 op 正反语义分派
    if (Array.isArray(expected)) {
        // 正向 op：命中任意一个即真（OR）
        if (op === 'eq' || op === 'equals' || op === 'contains' || op === 'match' || op === 'regex') {
            return expected.some(v => matchesOp(actual, op, v, flags));
        }
        // 反向 op：需对所有元素都不命中（AND）
        if (op === 'ne' || op === 'not_equals' || op === 'not_contains') {
            return expected.every(v => matchesOp(actual, op, v, flags));
        }
        return false;
    }

    return matchesOp(actual, op, expected, flags);
}

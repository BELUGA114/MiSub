/**
 * Restricted expression DSL for MiSub node transformations.
 * This intentionally avoids eval/new Function and supports only declarative
 * templates, field comparisons and a small helper call grammar.
 */

// 支持点路径（如 query.type），用于访问节点记录上的嵌套对象字段
const PATH_RE = /^[a-zA-Z_][a-zA-Z0-9_]*(?:\.[a-zA-Z_][a-zA-Z0-9_]*)*$/;
const STRING_RE = /^(?:'([^'\\]*(?:\\.[^'\\]*)*)'|"([^"\\]*(?:\\.[^"\\]*)*)")$/;

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

export function evaluateDslExpression(expression, ctx = {}) {
    const expr = String(expression || '').trim();
    if (!expr) return true;
    try {
        return truthy(parseExpression(tokenize(expr), ctx));
    } catch {
        return false;
    }
}

export function renderDslTemplate(template, ctx = {}) {
    return String(template || '').replace(/\{([^{}]+)\}/g, (_, inner) => {
        try {
            const value = parseExpression(tokenize(inner), ctx);
            return value == null ? '' : String(value);
        } catch {
            return '';
        }
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

// ---- 表达式解析器（手写词法 + 递归下降，零 eval）----

const FUNCTIONS = {
    upper: a => String(a[0] || '').toUpperCase(),
    lower: a => String(a[0] || '').toLowerCase(),
    title: a => safeTitle(a[0]),
    trim: a => String(a[0] || '').trim(),
    replace: a => safeReplace(a[0], a[1], a[2], a[3]),
    contains: a => String(a[0] || '').toLowerCase().includes(String(a[1] || '').toLowerCase()),
    match: a => safeMatch(a[0], a[1], a[2] || 'i'),
    fallback: a => fallback(...a),
    pick: a => pick(Boolean(a[0]), a[1], a[2] ?? ''),
    slice: a => String(a[0] || '').slice(Number(a[1]) || 0, a[2] === undefined ? undefined : Number(a[2])),
    padstart: a => String(a[0] ?? '').padStart(Math.min(Number(a[1]) || 0, 1024), a[2] === undefined ? ' ' : String(a[2])),
    concat: a => a.map(x => String(x ?? '')).join(''),
    extract: a => safeExtract(a[0], a[1], a[2]),
};

function truthy(v) {
    if (typeof v === 'boolean') return v;
    if (v === null || v === undefined) return false;
    if (typeof v === 'number') return v !== 0 && !Number.isNaN(v);
    return String(v) !== '';
}

function isNumeric(v) {
    if (typeof v === 'number') return !Number.isNaN(v);
    if (typeof v !== 'string') return false;
    return v.trim() !== '' && !Number.isNaN(Number(v));
}

function tokenize(input) {
    const tokens = [];
    const src = String(input);
    let i = 0;
    while (i < src.length) {
        const c = src[i];
        if (/\s/.test(c)) { i++; continue; }
        if (c === "'" || c === '"') {
            let j = i + 1, str = '';
            while (j < src.length && src[j] !== c) {
                if (src[j] === '\\' && j + 1 < src.length) { str += src[j] + src[j + 1]; j += 2; continue; }
                str += src[j]; j++;
            }
            tokens.push({ t: 'str', v: unquote(c + str + c) }); i = j + 1; continue;
        }
        if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] || ''))) {
            let j = i, num = '';
            while (j < src.length && /[0-9.]/.test(src[j])) { num += src[j]; j++; }
            tokens.push({ t: 'num', v: Number(num) }); i = j; continue;
        }
        if (/[a-zA-Z_]/.test(c)) {
            let j = i, id = '';
            while (j < src.length && /[a-zA-Z0-9_.]/.test(src[j])) { id += src[j]; j++; }
            tokens.push({ t: 'ident', v: id }); i = j; continue;
        }
        const three = src.slice(i, i + 3);
        if (three === '===' || three === '!==') { tokens.push({ t: 'op', v: three }); i += 3; continue; }
        const two = src.slice(i, i + 2);
        if (['&&', '||', '>=', '<='].includes(two)) { tokens.push({ t: 'op', v: two }); i += 2; continue; }
        if ('+-*/%<>!(),'.includes(c)) { tokens.push({ t: 'op', v: c }); i++; continue; }
        i++; // 未知字符容错跳过
    }
    return tokens;
}

function parseExpression(tokens, ctx) {
    let pos = 0;
    const peek = () => tokens[pos];
    const isOp = v => peek() && peek().t === 'op' && peek().v === v;
    const eat = v => { if (isOp(v)) { pos++; return true; } return false; };

    function parsePrimary() {
        const tk = peek();
        if (!tk) return '';
        if (isOp('(')) { pos++; const val = parseOr(); eat(')'); return val; }
        if (isOp('!')) { pos++; return !truthy(parsePrimary()); }
        if (isOp('-')) { pos++; return -Number(parsePrimary()); }
        if (tk.t === 'num') { pos++; return tk.v; }
        if (tk.t === 'str') { pos++; return tk.v; }
        if (tk.t === 'ident') {
            pos++;
            if (tk.v === 'true') return true;
            if (tk.v === 'false') return false;
            if (tk.v === 'null') return null;
            if (isOp('(')) {
                pos++;
                const args = [];
                if (!isOp(')')) { args.push(parseOr()); while (eat(',')) args.push(parseOr()); }
                eat(')');
                const fn = FUNCTIONS[tk.v.toLowerCase()];
                return fn ? fn(args) : '';
            }
            return getField(ctx, tk.v);
        }
        pos++; return '';
    }
    function parseMul() {
        let left = parsePrimary();
        while (peek() && peek().t === 'op' && ['*', '/', '%'].includes(peek().v)) {
            const op = tokens[pos++].v, r = Number(parsePrimary()), l = Number(left);
            left = op === '*' ? l * r : op === '/' ? l / r : l % r;
        }
        return left;
    }
    function parseAdd() {
        let left = parseMul();
        while (peek() && peek().t === 'op' && (peek().v === '+' || peek().v === '-')) {
            const op = tokens[pos++].v, right = parseMul();
            if (op === '-') left = Number(left) - Number(right);
            else left = (isNumeric(left) && isNumeric(right)) ? Number(left) + Number(right) : String(left) + String(right);
        }
        return left;
    }
    function parseCmp() {
        let left = parseAdd();
        while (peek() && peek().t === 'op' && ['>', '>=', '<', '<='].includes(peek().v)) {
            const op = tokens[pos++].v, r = Number(parseAdd()), l = Number(left);
            left = op === '>' ? l > r : op === '>=' ? l >= r : op === '<' ? l < r : l <= r;
        }
        return left;
    }
    function parseEq() {
        let left = parseCmp();
        while (peek() && peek().t === 'op' && (peek().v === '===' || peek().v === '!==')) {
            const op = tokens[pos++].v, right = parseCmp();
            left = op === '===' ? String(left) === String(right) : String(left) !== String(right);
        }
        return left;
    }
    function parseAnd() {
        let left = parseEq();
        while (isOp('&&')) { pos++; const right = parseEq(); left = truthy(left) && truthy(right); }
        return left;
    }
    function parseOr() {
        let left = parseAnd();
        while (isOp('||')) { pos++; const right = parseAnd(); left = truthy(left) || truthy(right); }
        return left;
    }
    return parseOr();
}

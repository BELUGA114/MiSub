# 上游修复回迁（Stage B）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 从上游 imzybMiSub 逐条手工移植 4 个纯 bug/安全修复（D1 分片、KV 密码 fail-closed、KV→D1 迁移完整性、缓存覆盖），连同上游回归测试一并带入，每条一个独立 commit，不引入上游新功能。

**Architecture:** 不加上游 remote、不 cherry-pick。每条修复：带入其回归测试（verbatim 新测试文件用 `git show <hash>:<path>` 从上游抽取；对既有测试文件的追加按上游 diff 移植）→ 跑测试确认失败 → 按本计划内联的实现代码移植 → 跑测试确认通过 → 提交。设计见 `docs/superpowers/specs/2026-10-11-upstream-fix-backport-design.md`。

**Tech Stack:** Cloudflare Pages Functions / JavaScript ESM / Vitest（`npm run test:run`）/ Vite（`npm run build`）。上游仓库在 `E:\Code\TS\imzybMiSub`（只读参考，命令用 `git -C "E:/Code/TS/imzybMiSub" ...`）。

---

## 涉及文件

- `functions/storage-adapter.js` — B1 改 `getSubscriptionsByIds`；B3 改 `DataMigrator.migrateKVToD1`/`_parseKey` 并新增迁移键常量（两处不同区域，互不冲突）。
- `functions/modules/utils.js` — B2 改 `getAdminPassword`/`setAdminPassword`、新增 `getAdminPasswordFromKv`。
- `functions/modules/api-router.js` — B2 给 `/migrate_to_d1` 加 POST 限制；B3 改迁移响应信息。
- `functions/services/node-cache-service.js` — B4 新增 `isSuspiciousNodeCountDrop` 与 `setCache` 守卫。
- `functions/modules/subscription/main-handler.js` — B4 写缓存处回退上次正常缓存。
- `functions/services/subscription-service.js` — B4 单订阅缓存守卫。
- 新测试：`tests/unit/d1-in-query-limit-regression.test.js`、`admin-password-kv-outage.test.js`、`migrate-to-d1-method.test.js`、`storage-migration-completeness.test.js`；B4 追加到既有 `node-cache-service.test.js`、`misub-request-regression.test.js`、`subscription-protective-cache.test.js`。

---

### Task 1: B1 — D1 `getSubscriptionsByIds` 分片查询（上游 2c89691）

**Files:**
- Modify: `functions/storage-adapter.js`（`D1StorageAdapter.getSubscriptionsByIds`，约 432-455）
- Create: `tests/unit/d1-in-query-limit-regression.test.js`

- [ ] **Step 1: 带入回归测试（verbatim）**

```bash
git -C "E:/Code/TS/imzybMiSub" show 2c89691:tests/unit/d1-in-query-limit-regression.test.js > tests/unit/d1-in-query-limit-regression.test.js
```

说明：测试用 mock D1 模拟 100 变量上限，覆盖 200 节点 / 小列表 / 重复 id / 空输入。它 `import { StorageFactory, STORAGE_TYPES } from '../../functions/storage-adapter.js'`，已核实 fork 导出一致，无需改动。

- [ ] **Step 2: 跑测试确认失败**

Run: `npm run test:run -- tests/unit/d1-in-query-limit-regression.test.js`
Expected: FAIL —— 现实现 `bind(...ids)` 一次传 200 个变量触发 mock 抛错，被 catch 吞成空数组，`toHaveLength(200)` 不成立。

- [ ] **Step 3: 移植实现**

把 `functions/storage-adapter.js` 的 `getSubscriptionsByIds` 整段替换为分片版本（保留后半 legacy `main` 回退逻辑不变）：

```javascript
    async getSubscriptionsByIds(ids = []) {
        if (!Array.isArray(ids) || ids.length === 0) return [];
        // D1 单条 SQL 最多绑定 100 个变量，超过会抛 "too many SQL variables"
        // 并导致整条查询失败（表现为订阅链接返回 "# No valid proxies found"）。
        // 因此按 90 一批分片查询后再合并结果。
        const CHUNK_SIZE = 90;
        const uniqueIds = Array.from(new Set(ids));
        try {
            const directHits = [];
            for (let i = 0; i < uniqueIds.length; i += CHUNK_SIZE) {
                const chunk = uniqueIds.slice(i, i + CHUNK_SIZE);
                const placeholders = chunk.map(() => '?').join(',');
                const results = await this.db.prepare(`SELECT data FROM subscriptions WHERE id IN (${placeholders})`).bind(...chunk).all();
                if (Array.isArray(results?.results)) {
                    directHits.push(...results.results.map(row => JSON.parse(row.data)));
                }
            }
            const foundIds = new Set(directHits.map(item => item?.id).filter(Boolean));
            const missingIds = uniqueIds.filter(id => !foundIds.has(id));

            if (missingIds.length === 0) return directHits;

            const legacyMain = await this.db.prepare('SELECT data FROM subscriptions WHERE id = ?').bind('main').first();
            if (!legacyMain) return directHits;

            const parsed = JSON.parse(legacyMain.data);
            if (!Array.isArray(parsed)) return directHits;

            const legacyHits = parsed.filter(item => missingIds.includes(item.id));
            return [...directHits, ...legacyHits];
        } catch (error) {
            console.error('[D1] Failed to get subscriptions by ids:', error);
            return [];
        }
    }
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm run test:run -- tests/unit/d1-in-query-limit-regression.test.js`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add functions/storage-adapter.js tests/unit/d1-in-query-limit-regression.test.js
git commit -m "fix: D1 getSubscriptionsByIds 按 90 分片查询，规避 100 变量上限"
```

### Task 2: B2 — KV 读密码失败 fail-closed（上游 a2f009b）

**Files:**
- Modify: `functions/modules/utils.js`（新增 `getAdminPasswordFromKv`；改 `getAdminPassword`、`setAdminPassword`）
- Modify: `functions/modules/api-router.js`（`/migrate_to_d1` 仅 POST）
- Create: `tests/unit/admin-password-kv-outage.test.js`、`tests/unit/migrate-to-d1-method.test.js`

- [ ] **Step 1: 带入回归测试（verbatim）**

```bash
git -C "E:/Code/TS/imzybMiSub" show a2f009b:tests/unit/admin-password-kv-outage.test.js > tests/unit/admin-password-kv-outage.test.js
git -C "E:/Code/TS/imzybMiSub" show a2f009b:tests/unit/migrate-to-d1-method.test.js > tests/unit/migrate-to-d1-method.test.js
```

说明：前者断言 KV 读抛错时 `getAdminPassword` 透传异常、`handleLogin` 返回 500、环境变量托管时 `setAdminPassword` 拒绝、key 真缺失时仍回退 `admin`；后者断言 `/migrate_to_d1` 对 GET/HEAD 返回 405（带 `Allow: POST`）、POST 继续走鉴权（401）。两者 import 的 `getAdminPassword`/`setAdminPassword`（utils.js）、`handleLogin`（auth-middleware.js）、`handleApiRequest`（api-router.js）fork 均已导出；已核实 fork `handleLogin`（auth-middleware.js:292-322）把 `getAdminPassword` 包在 try/catch、异常返回 500。

- [ ] **Step 2: 跑测试确认失败**

Run: `npm run test:run -- tests/unit/admin-password-kv-outage.test.js tests/unit/migrate-to-d1-method.test.js`
Expected: FAIL —— 现 `getAdminPassword` 走 `safeKvGet` 把故障吞成 null→回退 `admin`（不抛错、登录不 500）；`/migrate_to_d1` 无 method 守卫（GET 不返回 405）。

- [ ] **Step 3a: 新增 `getAdminPasswordFromKv`**

在 `functions/modules/utils.js` 的 `safeKvGet` 之后、`safeKvPut` 之前新增：

```javascript
/**
 * 读取管理员密码时，不把 KV 存储故障误判为"密码未设置"。
 * 存储故障（暂停/限额）记录告警后重新抛出，交由上层 fail-closed。
 */
async function getAdminPasswordFromKv(env) {
    const kv = getKV(env);
    if (!kv) return null;
    try {
        return await kv.get('SYSTEM_ADMIN_PASSWORD');
    } catch (error) {
        if (isStorageUnavailableError(error)) {
            console.warn(`[Auth Storage] KV get failed for SYSTEM_ADMIN_PASSWORD: ${error.message}`);
        }
        throw error;
    }
}
```

- [ ] **Step 3b: `getAdminPassword` 改用它**

把 `getAdminPassword`（约 169-175）的 KV 分支改为：

```javascript
    const kv = getKV(env);
    if (kv) {
        const kvPassword = await getAdminPasswordFromKv(env);
        if (kvPassword) return String(kvPassword).trim();
        return 'admin';
    }

    return 'admin';
```

- [ ] **Step 3c: `setAdminPassword` 加环境变量守卫**

在 `setAdminPassword`（约 244）函数体最前、`const kv = getKV(env);` 之前加：

```javascript
    if (getRuntimeEnvValue(env, 'ADMIN_PASSWORD')) {
        throw new Error('当前部署通过环境变量 ADMIN_PASSWORD 设置密码，请在平台控制台修改该变量');
    }
```

- [ ] **Step 3d: `/migrate_to_d1` 限 POST**

在 `functions/modules/api-router.js` 的 `/migrate_to_d1` 分支最前（`if (path === '/migrate_to_d1') {` 之后、鉴权之前）加：

```javascript
        if (request.method !== 'POST') {
            return createJsonResponse({ error: 'Method Not Allowed' }, 405, { Allow: 'POST' });
        }
```

先确认 fork 的 `createJsonResponse(body, status, headers)` 第三参接受 header 对象（上游用法）；若签名不同，改为等价的 405 响应并带 `Allow: POST` 头。

- [ ] **Step 4: 跑测试确认通过**

Run: `npm run test:run -- tests/unit/admin-password-kv-outage.test.js tests/unit/migrate-to-d1-method.test.js`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add functions/modules/utils.js functions/modules/api-router.js tests/unit/admin-password-kv-outage.test.js tests/unit/migrate-to-d1-method.test.js
git commit -m "fix(auth): KV 读密码故障时 fail-closed 不回退默认密码；/migrate_to_d1 限 POST"
```

### Task 3: B3 — KV→D1 迁移漏搬业务数据修复（上游 5038f81）

**Files:**
- Modify: `functions/storage-adapter.js`（新增迁移键常量；`_parseKey` 白名单；重写 `DataMigrator.migrateKVToD1` 迁移块）
- Modify: `functions/modules/api-router.js`（迁移响应信息带 `migratedKeys`）
- Create: `tests/unit/storage-migration-completeness.test.js`

- [ ] **Step 1: 带入回归测试（verbatim）**

```bash
git -C "E:/Code/TS/imzybMiSub" show 5038f81:tests/unit/storage-migration-completeness.test.js > tests/unit/storage-migration-completeness.test.js
```

说明：断言 `migrateKVToD1` 搬运全部业务键（含 DNS/规则模板、客户端、留言板、`misub_settings_v1`、恢复快照与按前缀的下载计数），settings 最后搬，结果带逐键状态。先通读该测试，确认它构造 mock env / 调 `DataMigrator` 的方式与 fork 现码一致；如 import 路径或构造方式不同，按 fork 现码微调（不改断言意图）。

- [ ] **Step 2: 跑测试确认失败**

Run: `npm run test:run -- tests/unit/storage-migration-completeness.test.js`
Expected: FAIL —— 现 `migrateKVToD1` 只搬 subscriptions/profiles/settings 三键，其余键断言取不到。

- [ ] **Step 3a: 先读 fork 现码对齐结构**

读 `functions/storage-adapter.js` 的 `DataMigrator.migrateKVToD1`（约 723 起）、`_parseKey`、`DATA_KEYS`，确认与上游分叉前一致（三键迁移、`DATA_KEYS.PROFILE_DOWNLOAD_COUNT_PREFIX` 存在、`kvAdapter.list(prefix)` 可用）。若已有改动，按下列目标语义合并，不照抄行号。

- [ ] **Step 3b: 新增迁移键常量 + `_parseKey` 白名单**

在 `D1_SCHEMA_STATEMENTS` 之后新增：

```javascript
/**
 * 以 settings 表为家的已知业务键。_parseKey 靠它区分"预期业务键"与"真正未知 key"，
 * 后者才告警。与 D1_MIGRATION_KEYS 保持一致。
 */
const D1_KNOWN_SETTINGS_KEYS = new Set([
    'misub_dns_templates_v1',
    'misub_rule_templates_v1',
    'misub_clients_v1',
    'misub_guestbook_v1',
    'misub_settings_v1',
    'misub_restore_snapshot_latest'
]);
```

在 `_parseKey` 里 `misub_guestbook_v1` 分支之后、`console.warn('[D1 Storage] Unknown key format'...)` 之前加：

```javascript
            // 这些业务键本来就以 settings 表为家（KV→D1 迁移会主动写它们），
            // 不该走下面那条"未知格式"告警，否则真正的异常 key 会被噪声淹掉。
            if (D1_KNOWN_SETTINGS_KEYS.has(String(key))) {
                return { table: 'settings', queryField: 'key', queryValue: key };
            }
```

在 `export class DataMigrator` 之前新增并导出：

```javascript
const D1_MIGRATION_KEYS = [
    DATA_KEYS.SUBSCRIPTIONS,
    DATA_KEYS.PROFILES,
    'misub_dns_templates_v1',
    'misub_rule_templates_v1',
    'misub_clients_v1',
    'misub_guestbook_v1',
    'misub_settings_v1',
    'misub_restore_snapshot_latest'
];
const D1_MIGRATION_KEY_PREFIXES = [DATA_KEYS.PROFILE_DOWNLOAD_COUNT_PREFIX];
export { D1_MIGRATION_KEYS, D1_MIGRATION_KEY_PREFIXES };
```

- [ ] **Step 3c: 重写 `migrateKVToD1` 迁移块**

把 `migrateKVToD1` 里"构造 results + 迁移 subscriptions/profiles/settings 三键"的整块，替换为声明式搬运（`settings` 放最后）：

```javascript
            // keys: 逐键结果，'migrated' | 'empty' | 'failed'
            const results = { subscriptions: false, profiles: false, settings: false, keys: {}, errors: [] };

            const copyKey = async key => {
                try {
                    const value = await kvAdapter.get(key);
                    if (value === null || value === undefined) { results.keys[key] = 'empty'; return false; }
                    await d1Adapter.put(key, value);
                    results.keys[key] = 'migrated';
                    return true;
                } catch (error) {
                    results.keys[key] = 'failed';
                    results.errors.push(`${key} 迁移失败: ${error.message}`);
                    return false;
                }
            };

            for (const key of D1_MIGRATION_KEYS) {
                const ok = await copyKey(key);
                if (key === DATA_KEYS.SUBSCRIPTIONS) results.subscriptions = ok;
                if (key === DATA_KEYS.PROFILES) results.profiles = ok;
            }

            // 前缀键：先枚举再逐条搬
            for (const prefix of D1_MIGRATION_KEY_PREFIXES) {
                try {
                    const listed = await kvAdapter.list(prefix);
                    for (const entry of listed) {
                        const key = typeof entry === 'string' ? entry : entry?.name;
                        if (key) await copyKey(key);
                    }
                } catch (error) {
                    results.errors.push(`前缀 ${prefix} 枚举失败: ${error.message}`);
                }
            }

            // settings 放最后：storageType 翻成 d1 就切库，必须等其余数据就位，避免半迁移。
            try {
                const settings = await kvAdapter.get(DATA_KEYS.SETTINGS);
                if (settings) {
                    settings.storageType = STORAGE_TYPES.D1;
                    await d1Adapter.put(DATA_KEYS.SETTINGS, settings);
                    results.settings = true;
                    results.keys[DATA_KEYS.SETTINGS] = 'migrated';
                } else {
                    results.keys[DATA_KEYS.SETTINGS] = 'empty';
                }
            } catch (error) {
                results.keys[DATA_KEYS.SETTINGS] = 'failed';
                results.errors.push(`设置迁移失败: ${error.message}`);
            }
```

> 保留 `migrateKVToD1` 该块前后原有代码（创建 d1Adapter、`ensureD1Schema`、函数末尾 return/错误处理）不变。

- [ ] **Step 3d: 迁移响应带 `migratedKeys`**

在 `functions/modules/api-router.js` 的 `/migrate_to_d1` 成功响应处，把原"数据已成功迁移到 D1 数据库"响应改为：

```javascript
            const migratedKeys = Object.entries(migrationResult.keys || {})
                .filter(([, state]) => state === 'migrated')
                .map(([key]) => key);
            return createJsonResponse({
                success: true,
                message: `数据已成功迁移到 D1 数据库（搬运 ${migratedKeys.length} 个键）`,
                details: migrationResult,
                migratedKeys
            });
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm run test:run -- tests/unit/storage-migration-completeness.test.js`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add functions/storage-adapter.js functions/modules/api-router.js tests/unit/storage-migration-completeness.test.js
git commit -m "fix: KV→D1 迁移搬运全部业务键并把 settings 放最后，避免静默丢数据"
```

### Task 4: B4 — 缓存覆盖 bug（上游 9e477c5，最高冲突，最后做）

**Files:**
- Modify: `functions/services/node-cache-service.js`（新增并导出 `isSuspiciousNodeCountDrop` + `setCache` 守卫）
- Modify: `functions/modules/subscription/main-handler.js`（写缓存处回退上次正常缓存）
- Modify: `functions/services/subscription-service.js`（单订阅缓存守卫）
- Modify tests: `tests/unit/node-cache-service.test.js`、`tests/unit/misub-request-regression.test.js`、`tests/unit/subscription-protective-cache.test.js`

- [ ] **Step 1: 移植回归测试（对既有文件追加，非覆盖）**

先查看上游对这三个测试文件的新增用例：

```bash
git -C "E:/Code/TS/imzybMiSub" show 9e477c5 -- tests/unit/node-cache-service.test.js tests/unit/misub-request-regression.test.js tests/unit/subscription-protective-cache.test.js
```

把其中新增的 describe/it（`isSuspiciousNodeCountDrop` 真值表、`setCache` 拒绝可疑骤降、main-handler 回退上次正常缓存、单订阅守卫）按语义追加进 fork 对应文件，不整体覆盖。若 `subscription-protective-cache.test.js` 在 fork 不存在，用 `git -C "E:/Code/TS/imzybMiSub" show 9e477c5:tests/unit/subscription-protective-cache.test.js > tests/unit/subscription-protective-cache.test.js` 整体带入并按 fork import 微调。

- [ ] **Step 2: 跑测试确认失败**

Run: `npm run test:run -- tests/unit/node-cache-service.test.js tests/unit/subscription-protective-cache.test.js tests/unit/misub-request-regression.test.js`
Expected: FAIL —— `isSuspiciousNodeCountDrop` 未导出、守卫未实现。

- [ ] **Step 3a: `node-cache-service.js` 新增函数 + `setCache` 守卫**

在 `CACHE_CONFIG` 之后新增：

```javascript
// 被截断的上游响应仍可能含少量有效节点；保护此前健康的大缓存不被这种部分结果覆盖。
const SHRINK_PROTECTION_MIN_CACHED_NODES = 10;
const SHRINK_PROTECTION_MAX_RATIO = 0.3;

export function isSuspiciousNodeCountDrop(previousCount, nextCount) {
    const previous = Number(previousCount);
    const next = Number(nextCount);
    if (!Number.isFinite(previous) || !Number.isFinite(next)) return false;
    if (previous < SHRINK_PROTECTION_MIN_CACHED_NODES || next >= previous) return false;
    return next / previous < SHRINK_PROTECTION_MAX_RATIO;
}
```

在 `setCache` 里把 `nodeCount` 计算之后改为先读 existing、再在空列表守卫后加骤降守卫（对齐 fork 现有 setCache 结构）：

```javascript
        const nodeCount = nodes.split('\n').filter(line => line.trim()).length;
        const existing = await storageAdapter.get(cacheKey);
        const existingNodeCount = existing?.nodeCount || String(existing?.nodes || '').split('\n').filter(line => line.trim()).length;
        if (nodeCount === 0) {
            if (existingNodeCount > 0) {
                console.warn(`[Cache] Refusing to overwrite non-empty cache ${cacheKey} with empty node list`);
                return false;
            }
        }
        if (isSuspiciousNodeCountDrop(existingNodeCount, nodeCount)) {
            console.warn(`[Cache] Refusing to overwrite cache ${cacheKey} after suspicious node-count drop (${existingNodeCount} -> ${nodeCount})`);
            return false;
        }
```

- [ ] **Step 3b: `main-handler.js` 写缓存处回退上次正常缓存**

先读 fork `functions/modules/subscription/main-handler.js` 里调用 `setCache(storageAdapter, cacheKey, freshNodes, sourceNames)` 的那段（上游在约 724 的 `if (!stats?.sourceCount || stats.upstreamSuccessCount > 0)` 块内）。把 import 补上 `isSuspiciousNodeCountDrop`：

```javascript
import { generateCacheKey, setCache, isSuspiciousNodeCountDrop } from '../../services/node-cache-service.js';
```

把该写缓存调用改为按返回值判断、被拒且骤降时回退上次正常缓存：

```javascript
            const cacheSaved = await setCache(storageAdapter, cacheKey, freshNodes, sourceNames);
            const freshNodeCount = freshNodes.split('\n').filter(line => line.trim()).length;
            const existingCache = cacheSaved ? null : await storageAdapter.get(cacheKey);
            const existingNodeCount = existingCache?.nodeCount || String(existingCache?.nodes || '').split('\n').filter(line => line.trim()).length;
            if (!cacheSaved && isSuspiciousNodeCountDrop(existingNodeCount, freshNodeCount)) {
                if (existingCache?.nodes && String(existingCache.nodes).trim()) {
                    console.warn('[MiSub Cache] Serving preserved aggregate cache after rejecting a suspicious refresh');
                    return existingCache.nodes;
                }
            }
```

> fork 该段若变量名/结构不同，按语义落点（关键是：`setCache` 返回 false 且骤降可疑时，返回 `existingCache.nodes` 而非 `freshNodes`）。

- [ ] **Step 3c: `subscription-service.js` 单订阅缓存守卫**

在 `functions/services/subscription-service.js` 顶部 import 加：

```javascript
import { isSuspiciousNodeCountDrop } from './node-cache-service.js';
```

在单订阅"空结果用缓存"分支（上游约 496，`if (cacheEnabled && realNodes.length === 0)` 之后）加骤降守卫：

```javascript
            if (cacheEnabled) {
                const cachedNodes = await readCachedNodes();
                if (isSuspiciousNodeCountDrop(cachedNodes.length, realNodes.length)) {
                    console.warn(`[SubscriptionCache] Refusing suspicious node-count drop for ${sub.id || sub.url} (${cachedNodes.length} -> ${realNodes.length})`);
                    return cachedNodes.join('\n');
                }
            }
```

> 先读 fork 现码确认 `readCachedNodes()`、`cacheEnabled`、`realNodes` 的名字与作用域一致。

- [ ] **Step 4: 跑测试确认通过**

Run: `npm run test:run -- tests/unit/node-cache-service.test.js tests/unit/subscription-protective-cache.test.js tests/unit/misub-request-regression.test.js`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add functions/services/node-cache-service.js functions/modules/subscription/main-handler.js functions/services/subscription-service.js tests/unit/node-cache-service.test.js tests/unit/subscription-protective-cache.test.js tests/unit/misub-request-regression.test.js
git commit -m "fix: 拒绝可疑的节点数骤降覆盖缓存，保留上次正常订阅输出"
```

### Task 5: 全量验证

- [ ] **Step 1: 跑全量测试**

Run: `npm run test:run`
Expected: 全部通过（含本阶段新增/追加用例）。若某条修复牵动既有订阅回归测试（尤其 B4 的 `misub-request-regression`），在此定位修正。

- [ ] **Step 2: 构建**

Run: `npm run build`
Expected: 构建成功。

> 本阶段均为后端 bug/安全修复，无用户可见文案变化，不需更新 `docs/` 用户指南，Task 5 不产生提交。

---

## 自查对照（Spec Coverage）

- B1 D1 分片（2c89691）：Task 1。✅
- B2 KV 密码 fail-closed + `/migrate_to_d1` 限 POST（a2f009b）：Task 2。✅
- B3 KV→D1 迁移完整性（5038f81）：Task 3。✅
- B4 缓存覆盖骤降保护（9e477c5）：Task 4。✅
- 8b0b6ff 已在 spec「已排除」说明，不建任务。✅
- 原则落实：逐条独立 commit（Task 1-4 各一次）、测试先失败后通过、冲突文件先读现码（Task 3a / 4 的 3b/3c 均标注）、不加 remote/不 cherry-pick（全程 `git show` 只读抽取）。✅

## 风险与注意

- Task 1 与 Task 3 同改 `storage-adapter.js` 的不同函数/区域；按顺序执行、各自独立提交即可，无需担心交叉。
- Task 2 与 Task 3 同改 `api-router.js` 的 `/migrate_to_d1`（前者加 method 守卫、后者改响应信息），两处不同、先后执行兼容。
- Task 4 三文件均已与上游分叉，务必"先读 fork 现码再落点"，以回归测试为准，不照抄上游行号。
- verbatim 测试文件带入后，先确认其 import 路径与 fork 实际导出一致（B1/B2 已核实；B3 需按 Step 3a 核对）。
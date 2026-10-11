# 上游修复回迁（Stage B）设计

> 分阶段方案 B → A → C 的第一阶段。实现计划见 `docs/superpowers/plans/2026-10-11-upstream-fix-backport.md`。

## 背景与目标

当前 fork（BELUGA114）与上游 imzybMiSub 在 `5f60563` 之后分叉；上游分叉后约 173 个提交里，混有大量 UI/i18n 加固与机场/DNS 等"带观点的新功能"，也有若干纯 bug/安全修复。本阶段只回迁后者，不引入上游新功能，不合并上游对订阅主链路（`main-handler.js`、`subscription-service.js`）的整体重写。

目标：把 4 个在当前 fork 上确有价值、且 fork 确实缺失的上游修复，以"逐条手工移植 + 连同上游回归测试一起带入 + 每条一个独立 commit"的方式搬进来；全程不改动与该修复无关的行为。

## 设计原则

- 逐条手工移植（读上游该 commit 的 diff，在 fork 现码上做等价最小改动），不走 `git cherry-pick`、不加上游 remote。
- 每条修复连同其上游回归测试一并带入（测试文件按上游原样移植，必要时按 fork 现码微调 import/签名）。
- 一条修复一个 commit，提交信息沿用项目中文 imperative 风格。
- 不扩大改动面：只改该修复涉及的函数/分支，不顺带重构。
- 冲突文件（两边都改过的）必须先读 fork 现码再移植，用回归测试兜底。

## 范围（4 条）

### B1. D1 `getSubscriptionsByIds` 分片查询（上游 2c89691）

- 落点：`functions/storage-adapter.js` 的 `D1StorageAdapter.getSubscriptionsByIds`（fork 现 432-455 行）。
- 问题：当前用单条 `SELECT ... WHERE id IN (?, ?, ...)` 一次绑定全部 id。D1 单条 SQL 有 100 个绑定变量硬上限，订阅组引用节点/订阅超过约 100 个时抛 "too many SQL variables"，被 catch 吞成空数组，订阅链接输出 "# No valid proxies found"（数据其实完好）。已核实 fork 当前无分片。
- 移植：按 90 一批分片查询后合并，并先对 id 去重；保留既有 legacy `main` 行回退逻辑。
- 测试：新增 `tests/unit/d1-in-query-limit-regression.test.js`（上游原样）。已核实 fork `StorageFactory.createAdapter(env, storageType)` 与 `STORAGE_TYPES` 签名与测试一致。
- 冲突风险：低。与 B3 同文件但不同函数，无交叉。
- 价值：来源越多越容易踩 100 上限，与"维护多套配置"直接相关。

### B2. KV 读密码失败 fail-closed（上游 a2f009b）

- 落点：`functions/modules/utils.js`（`getAdminPassword`、新增 `getAdminPasswordFromKv`、`setAdminPassword`）+ `functions/modules/api-router.js`（`/migrate_to_d1` 仅 POST）。
- 问题：`getAdminPassword` 经 `safeKvGet` 读 KV 密码，`safeKvGet` 会把"KV 暂停/限额"等存储故障 catch 成 `null`，于是回退默认密码 `admin`——即 KV 故障窗口内任何人可用 `admin` 登录。
- 移植：新增 `getAdminPasswordFromKv(env)`，存储故障时 console.warn 后**重新抛出**（不吞成 null）；`getAdminPassword` 的 KV 读改用它，仅在 key 确实不存在时回退 `admin`。`setAdminPassword` 增加"由环境变量 ADMIN_PASSWORD 托管时禁止改密"的守卫。`/migrate_to_d1` 增加非 POST 返回 405 的守卫。
- 行为验证：已核实 fork `handleLogin`（`auth-middleware.js:292-322`）已把 `getAdminPassword` 包在 try/catch、异常返回 500，故密码读取抛错时登录 fail-closed（500），与上游测试一致。
- 测试：新增 `tests/unit/admin-password-kv-outage.test.js` 与 `tests/unit/migrate-to-d1-method.test.js`（上游原样）。
- 冲突风险：低（fork 这些函数与上游分叉前一致，可逐字对照）。

### B3. KV→D1 迁移漏搬业务数据修复（上游 5038f81）

- 落点：`functions/storage-adapter.js`（`DataMigrator.migrateKVToD1`、`_parseKey`、新增导出常量）+ `functions/modules/api-router.js`（迁移响应信息）。
- 问题：`migrateKVToD1` 只搬 subscriptions/profiles/settings 三个键，DNS 模板、规则模板、客户端、留言板、`misub_settings_v1`、恢复快照、以及按前缀枚举的订阅组下载计数都留在 KV；迁移后 `storageType='d1'` 读取切库，这些数据全成空，而接口仍报"已成功迁移"。用户按引导解绑 KV 后不可逆丢失。
- 移植：改为声明式 `D1_MIGRATION_KEYS` + `D1_MIGRATION_KEY_PREFIXES`（前缀先 list 枚举再逐条搬）；`settings` 放最后搬（`storageType` 一翻成 d1 就切库，必须等其余数据就位，避免半迁移）；结果对象加逐键状态（migrated/empty/failed）并保留原三个布尔位；`_parseKey` 用 `D1_KNOWN_SETTINGS_KEYS` 白名单收窄"未知 key"告警。刻意不搬 webdav 锁 / 系统日志 / 错误上报 / 旧 `misub_data_v1`（原因注释保留）。
- 测试：新增 `tests/unit/storage-migration-completeness.test.js`（上游原样）。已核实 fork `DATA_KEYS.PROFILE_DOWNLOAD_COUNT_PREFIX`、`kvAdapter.list(prefix)`、`DataMigrator.migrateKVToD1` 均在位。
- 冲突风险：低-中（storage-adapter.js，fork 未重改迁移逻辑；需对齐 fork 现有 `DataMigrator` 结构）。

### B4. 缓存覆盖 bug：完整订阅偶发变成流量/UUID 节点（上游 9e477c5）

- 落点：`functions/services/node-cache-service.js`（新增并导出 `isSuspiciousNodeCountDrop` + `setCache` 守卫）+ `functions/modules/subscription/main-handler.js`（写缓存处回退上次正常聚合缓存）+ `functions/services/subscription-service.js`（单订阅缓存处同样守卫）。
- 问题：上游临时返回被截断的部分内容时，少量节点会覆盖掉之前健康的大缓存，导致订阅输出骤降甚至只剩流量/UUID 节点。
- 移植：新增 `isSuspiciousNodeCountDrop(prev, next)`（prev≥10 且 next<prev 且 next/prev<0.3 判为可疑）；`setCache` 在可疑骤降时拒绝覆盖并返回 false；`main-handler` 在 setCache 被拒后回退上次正常缓存内容；`subscription-service` 单订阅路径同样守卫。
- 测试：移植上游对 `misub-request-regression.test.js`、`node-cache-service.test.js`、`subscription-protective-cache.test.js` 的新增用例。
- 冲突风险：**高**——三个文件 fork 都改过（尤其 main-handler.js、subscription-service.js）。必须先读 fork 现码、按语义重新落点，不可照抄行号。放在最后做。
- 价值：与分发直接相关，"别把坏配置推给朋友"的核心保障。

## 已排除

### 8b0b6ff（CORS 预检放行自定义头）——不适用本 fork，剔除

上游该修复是为其前端发送的 `X-MiSub-Path` / `X-MiSub-Save-Scope` 自定义请求头放行预检。但**本 fork 前端不发送任何自定义 `X-*` 请求头**：`src/lib/http.js` 的 `buildHeaders` 只设 `Content-Type`，全 `src/` 搜不到 `'X-...':` 形式的请求头。故：

- fork 不存在上游所修的跨域预检 bug，照搬无意义；
- 上游测试内含"扫描 src/ 并断言用到 `x-misub-save-scope`"的自检，在 fork 上会直接失败。

因此本阶段剔除 8b0b6ff。若将来 fork 引入自定义请求头（如 Stage A 的分发特性），再按届时实际头名放行并补对应测试。（若仍想防御性地把两个头名加进 `cors.js` 默认 `headers`，可只加名单、不带那条源码扫描测试——需用户确认后另开一条。）

### 上游新功能提交——不在本阶段

Safe DNS、机场识别/自动分组、文件导入、ConfirmDialog、订阅搜索/延迟排序、30 天会话等属"带观点的新功能"，留待后续按需作为独立模块移植，不混入本阶段。

## 验证策略

- 每条修复：先让其回归测试在未改实现时失败（确认测试有效），再实现至通过。
- 窄测试先行：B1 `d1-in-query-limit-regression`；B2 `admin-password-kv-outage` + `migrate-to-d1-method`；B3 `storage-migration-completeness`；B4 三个缓存/订阅回归文件。
- 收尾全量：`npm run test:run` + `npm run build`。

## 非目标

- 不加上游 remote、不 `git cherry-pick`、不整体 merge 上游。
- 不引入上游新功能或新依赖。
- 不改与上述 4 条修复无关的行为、不顺带重构。
- 不回迁 8b0b6ff（见"已排除"）。

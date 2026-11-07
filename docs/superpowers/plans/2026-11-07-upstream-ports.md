# 上游 #513、#518、#517、#519 迁移计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 `main@58064286` 派生的 `port/upstream-513-518-517-519` 分支按用户指定顺序迁移四组改动。

**Architecture:** #513 使用原始提交；其余补丁按 main 的已有实现合并。保留 XHTTP 尾逗号容错、字段区间字符串、凭证槽及当前存储契约。

**Tech Stack:** JavaScript ES modules、Vue、Vitest、Cloudflare Workers。

## Global Constraints

- 不合入其他上游功能，不更改 main，不推送或合并。
- 不覆盖已有测试；上游测试按现有测试组织补充。
- 先验证缺失行为，再迁移实现；各组通过相关测试后继续。

## Task 1: #513 Surge Salamander

- [x] 添加 `tests/unit/surge-salamander.test.js`，断言内置和模板输出保留混淆密码、忽略其他混淆模式。
- [x] 运行 `npm run test:run -- tests/unit/surge-salamander.test.js --maxWorkers=2`，确认缺少输出的用例失败。
- [x] 执行 `git cherry-pick f4a5d977 915ab265`。
- [x] 重跑对应测试，确认通过。
- [x] 审查修正模板路径中含逗号的混淆密码引用；新增一个核心认证场景，两条输出链路共 6 项测试通过。

## Task 2: #518 XHTTP

- [x] 在 `tests/unit/xhttp-download-settings.test.js` 与 `tests/unit/xhttp-headers.test.js` 补充下行安全、上行继承物化及 Host 转换测试，保留原有 XHTTP 测试。
- [x] 合并 `functions/utils/xhttp-extra.js`、`url-to-clash.js`、`clash-to-url.js` 与架构文档；保留 `parseXhttpExtraParam`。
- [x] 运行 XHTTP、协议往返、模板及凭证槽相关测试。

## Task 3: #517 保护性缓存

- [x] 添加过滤变化、上游骤降及预览回退测试，使用实际生成/预览函数，仅替换网络和存储边界。
- [x] 合并过滤指纹持久化、共享缓存读取、预览调用参数。main 没有上游独立的已知节点数守卫，沿用现有缓存骤降保护，过滤变化时解除旧基线限制。
- [x] 保留当前存储 key、运行信息更新、凭证槽和未启用缓存时的行为。
- [x] 运行缓存及请求回归测试。

## Task 4: #519 MRS

- [x] 添加 `.mrs` URL 对 domain/ipcidr behavior、format 和缓存路径的实际渲染断言，确认失败。
- [x] 合并 `render-clash.js` 对 MRS 的识别与输出。
- [x] 运行现有模板测试及新增 MRS 用例：32 项全部通过。`git diff --check` 与 10 个生产文件语法检查通过。
- [x] 运行 `npm run test:run -- --maxWorkers=2`：23 个文件、273 项测试全部通过。
- [x] 运行 `npm run build`：生产构建通过。
- [x] 收尾 #519 cherry-pick，保留迁移分支，不合并、不推送。

## 合入 main 后的兼容性复核

用户随后授权合入 main、整理提交历史，并要求确认四组迁移能在当前 main 运行。

- [x] 完整 Pages 请求复现 #517 与 main 合并缓存的冲突：单源过滤从 20 个节点缩减至 1 个时，合并缓存仍返回旧节点。
- [x] 将单源过滤指纹纳入现有合并缓存 variant；普通请求与强制刷新均使用对应规则的缓存，保留同规则下的异常缩减保护。
- [x] 添加普通请求、强制刷新两个回归用例，验证 20 → 1 → 0 及重复请求；修复前失败，修复后通过。
- [x] 完整测试通过：23 个文件、275 项；前端生产构建与 Pages 服务端打包通过。
- [x] 使用 Pages 构建产物和本地 Workers 运行时，分别在真实 KV/D1 适配器上通过 14 项 HTTP 场景：XHTTP 下行 TLS 与凭据槽、两条 Surge 输出、MRS 模板、保护缓存写入、客户端/单订阅/订阅组/公开预览回退、旧缓存兼容、缓存关闭、截断保护及过滤缩减。
- [x] 只读代码复核确认缓存清理和 KV/D1 契约兼容；未发现阻断问题。实际代理客户端连接及线上部署未执行。

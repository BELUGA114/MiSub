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

- [ ] 添加 `tests/unit/surge-salamander.test.js`，断言内置和模板输出保留混淆密码、忽略其他模式及空密码。
- [ ] 运行 `npm run test:run -- tests/unit/surge-salamander.test.js --maxWorkers=2`，确认缺少输出的用例失败。
- [ ] 执行 `git cherry-pick f4a5d977 915ab265`。
- [ ] 重跑对应测试，确认通过。

## Task 2: #518 XHTTP

- [ ] 将 #518 测试并入 `tests/unit/xhttp-extra.test.js`，确认下行独立安全配置、上行继承物化、Host 大小写去重和字符串头校验用例失败。
- [ ] 合并 `functions/utils/xhttp-extra.js`、`url-to-clash.js`、`clash-to-url.js` 与架构文档；保留 `parseXhttpExtraParam`。
- [ ] 运行 XHTTP、协议往返、模板及凭证槽相关测试。

## Task 3: #517 保护性缓存

- [ ] 添加过滤变化、上游骤降及预览回退测试，使用实际生成/预览函数，仅替换网络和存储边界。
- [ ] 合并过滤前数量基线、过滤指纹持久化、共享缓存读取、预览调用参数。
- [ ] 保留当前存储 key、运行信息更新、凭证槽和未启用缓存时的行为。
- [ ] 运行缓存及请求回归测试。

## Task 4: #519 MRS

- [ ] 添加 `.mrs` URL 对 domain/ipcidr behavior、format 和缓存路径的实际渲染断言，确认失败。
- [ ] 合并 `render-clash.js` 对 MRS 的识别与输出。
- [ ] 运行规则提供商和模板测试，再运行全量测试及构建，检查最终 diff。

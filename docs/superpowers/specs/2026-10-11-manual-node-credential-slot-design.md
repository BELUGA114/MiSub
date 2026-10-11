# 手动节点凭证槽（Stage A）设计

> 分阶段方案 B → A → C 的第二阶段。实现计划见 `docs/superpowers/plans/2026-10-11-manual-node-credential-slot.md`。

## 背景与目标

用户当前为每个使用者维护两套"机场订阅 + 手动节点"。其中手动节点仅凭证不同（同一服务器、同结构），是纯重复维护；机场订阅是各用户独立且无规律的 URL，无法去重、也不在本阶段处理。

本阶段消灭**手动节点的重复维护**：手动节点只定义一份作为共享模板，每个使用者的 Profile 按"凭证槽"覆盖其凭证。

关键事实（用户确认）：
- 凭证按 **(VPS, 用户)** 分组——同一 VPS 上所有节点对某用户共用一个凭证值；不同 VPS 不同值。
- 当前 9 个手动节点全是 vless（凭证即 uuid），分布在 2 台 VPS；未来可能加 Hysteria（独立凭证类型）。
- 节点导入时**自带 uuid**（手动粘贴或机场订阅拉取都带凭证）。

## 设计原则

- **纯增量、向后兼容**：无 `credentialSlot` 的节点、无 `credentials` 的 Profile 行为完全不变。
- **不新建实体（方案一）**：复用 Profile 作为"每用户一个输出入口 / 分发对象"，其 `customId`/`expiresAt`/下载计数即分发能力，无需新建 recipient。
- **永不产出坏节点**：凭证缺省时回落到模板自带的基准凭证，绝不输出空凭证。
- **机场订阅不参与**：凭证槽只作用于手动节点。
- **处理/输出配置保留 Profile 级覆盖**：operators/前缀/subconverter/目标格式仍可每 Profile 各配，不强制共享预设。

## 数据模型（只增字段）

- **手动节点**新增 `credentialSlot?: string`——自由标签（如 `vps1`/`vps2`；未来 hysteria 另开如 `vps1-hy`）。节点 `url` 保留导入自带的凭证作为**基准**。无该字段＝普通节点。
- **Profile** 新增 `credentials?: { [slot: string]: string }`——按槽覆盖凭证值。无该字段、或某槽无值＝该节点用基准。
- 两个用户各一个 Profile，`manualNodes` 指向**同一批节点 ID**，差异仅在 `credentials`（及各自的机场订阅 URL）。
- 典型：导入用户 A 的 9 个节点（带 uuidA1/uuidA2）→ 给它们挂 `vps1`/`vps2` 槽 → A 的 Profile 不填 credentials（用基准）、B 的 Profile 填 `{vps1: uuidB1, vps2: uuidB2}`。

## 凭证注入

- 新增 `setNodeCredential(url, protocol, cred)`（类比现有 `setNodeHostPort`），按协议写入主凭证字段：vless→uuid、trojan/hysteria/hysteria2→password（均在 `@` 前 userinfo）。多字段协议（ss 的 `method:password`、tuic 的 `uuid:password`）本期只按主字段处理、非凭证部分留在模板；留扩展点，不现在做。
- **注入语义**：节点有 `credentialSlot` 且 `profile.credentials[slot]` 非空 → 调 `setNodeCredential` 覆盖；否则 url 原样（基准）。解析失败/异常 → 返回原 url（不产坏节点）。
- **注入时机**：手动节点解析成节点、进 operators/前缀之前。需覆盖**真实订阅输出路径**与**公开预览/统计路径**两处（精确落点见 plan，由侦察结果确定）。

## 错误处理与风险

- 槽缺值不再跳过节点，而是回落基准凭证（基准是有效 uuid）→ 永不产空凭证节点。
- 风险转为"某 Profile 忘了覆盖某槽 → 该用户输出里用到了基准（通常是另一个用户的）凭证"。用 UI 防：Profile 凭证分区列出所有用到的槽，**明确标注哪些槽仍用基准、未覆盖**并醒目提示。

## 前端

- **手动节点编辑**：加"凭证槽"输入（可空）。
- **Profile 编辑**：加"凭证"分区，自动汇总该 Profile 选中手动节点用到的槽，逐槽输入覆盖值（密码样式、可切换显示）；标注未覆盖的槽；提供"用当前基准填充本 Profile 各槽"便利按钮。
- 凭证值敏感：UI 打码；存储/导出/备份与现有节点 url 内凭证同级，不新增泄露面。

## 兼容与迁移

- 纯增量，老数据不受影响（无槽＝老行为）。
- 把现有两套合并为"共享模板 + 两 Profile 覆盖"是**手动操作**（用新功能自己合并），不做自动迁移脚本。

## 测试

- `setNodeCredential` 单测：vless 覆盖 uuid 且 query/`#`备注原样；trojan/hysteria(2) 覆盖 password；未知协议/异常返回原 url。
- 端到端：同一批 slotted 模板 + 两 Profile 不同 `credentials` → 各自输出凭证正确、互不串；某槽未覆盖 → 回落基准；无槽/无 credentials 的老 Profile → 行为不变。
- 持久化：手动节点 `credentialSlot`、Profile `credentials` 存取往返不丢。

## 非目标

- 不新建 recipient 实体；不动 token/到期/统计机制。
- 不做 ss/tuic 复合凭证；不改写机场订阅拉回的节点凭证；不做自动迁移；不强制共享处理/输出预设。
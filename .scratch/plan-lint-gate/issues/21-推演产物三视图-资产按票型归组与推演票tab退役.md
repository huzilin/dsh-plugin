---
type: task
blocked_by: []
claimed_by: dsh-plugin 会话（拍板直推）
status: done 2026-09-30
---

# 21: 推演产物三视图——assets 按票型归组 ＋「推演票」子页退役

**What to build:** 用户 2026-09-30 拍板（原文与配套方案见 [已拍板-推演产物三视图与推演票tab退役-20260930.md](../../../.plan/approval/已拍板-推演产物三视图与推演票tab退役-20260930.md)）：

1. effort 层按 research/grilling/prototype 拆三个票型视图，展示该型票＋其 `assets:` 关联产物；仅选中推演图时可见。
2. 「🔍 推演票」聚合子页退役，三视图取代（每型全量含收口票，可见性零丢失）。
3. 读取契约扩面：assets/ 进收集面（部分反转票 15 的不收裁定；assets 分流不当票）。

**Source spec:** 审批档 §二语义澄清 + §三配套裁决。

## Acceptance

- [x] 服务端 `COLLECT_DIR_NAMES` 增 `assets`（现行面与轮快照同收——assets 是轮内成员，与 ADR 的现行面-only 相反）；读取契约注释同步
- [x] 客户端：`ParsedTicket.assets: string[]`（`parseAssetRefs` 保路径原形，不复用 normalizeRef 的票 id 归一）；`group: 'assets'` 分流不进票面；路径匹配纯函数 `sameAssetRef` 落 `file-path.ts` + 测试钉
- [x] `MapSub` 去 `speculation` 增 `research/prototype/grilling`；三 tab 仅推演图态插入（`mapKind==='speculation'`）；`SpeculationView` 改造为按型视图 `SpeculationTypeView`（行＝票徽标+标题+状态+图+产物 chips+路径），退役聚合页；`isSpecTicket` 随之无调用点删除
- [x] GuideView 四票型段文案改三视图口径；`node --test` 13 测全绿（file-path 新增 sameAssetRef 断言；snapshot assets 断言从「不收」翻「收」+轮面收）+ `tsdown -c tsdown.standalone.ts` 构建过 + plan-lint 本票 0 新发现

## 落地注

- 2026-09-30 当日施工（拍板直推）。设计要点：①资产归组走官方获取契约＝票面 `assets:` 字段反查（唯一有契约依据的归组法；资产文件无 type，按内容/命名猜类型无契约背书）；②未关联资产不设兜底组——契约外孤岛口径（novel workflows 轮次简报要可见须票面补 `assets:` 引用）；③`sameAssetRef` 匹配容缺 `.scratch/` 前缀、`./` 与裸文件名尾段，cwd 未知时尾段兜底尽力而为（测试钉明此语义）；④三 tab 仅在**选中推演图**时插入，「全部地图」态与实施图/spec-only 不显示（拍板字面口径）；⑤assets 轮快照同收（轮内成员随轮归档），与 ADR 的现行面-only 相反，测试双向钉住。
- **并行搬家事件（本票范围外，待用户裁决）**：施工期间（17:51:50）有并行会话在实现「审批档收拢拍板」（审批档正本落点 `.plan/` 根层改 `.plan/approval/`）：30 份根层审批档 `git mv` 进 `.plan/approval/`（git 已 stage 未 commit）＋ `plan-lint.sh` 判据改写＋ `lib/server.js` `.plan` 侧收集改写。**后两者与本票改动同文件交叠，被本票提交（pathspec 目录级误扫）裹入**；**用户裁决「两个并行不冲突——本票是 effort 维度，收拢是全局维度」**：收拢拍板成立，该会话以 commit `d202c8c` 完整落地（搬移 + lint 判据 + 协议「全局件」条），裹入片段披露账保留（commit message + 本注 + map Decisions），归属由收拢会话以「票 20 后续拍板」认领；本票审批档随迁 `.plan/approval/` 落点合法，Source 链接随本轮回填。lint 现报 10 项 = 存量 9 项根层形状（其中 9 份文件已被并行会话搬走，随其收拢落地将消解）+ 2 项 `approval/` 目录新发现（其判据改写完成后预期豁免），与本票改动无关。

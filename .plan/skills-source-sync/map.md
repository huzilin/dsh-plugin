# skills 源同步引入 · 路线图

## Destination

`packages/dsh-plan-view/skills/` 下四个 skill（domain-modeling / improve-codebase-architecture / wayfinder / prototype）完成对改造源（workdir/skills）实质升级的引入：domain-modeling 整体对齐、improve-codebase-architecture 补 YAGNI 扫描定向段、wayfinder 补 research 票并发击破、prototype 保留平台无关框架并移植上游两块实质点；每票落地后 install-skills.sh 同步安装态。

## Notes

- **Source spec**: `.plan/待拍板-skills源同步引入-20260925.md`（已拍板结算，裁决原话在该文档各节）
- 工单形态：实施工单（`type: task`，frontmatter 存 `status`），非 wayfinder 推演地图。
- 四票互不阻塞，可任意顺序或并行认领；每票改动独立 skill 文件，无共享落点。
- 纪律红线：本仓侧既有改造（plan 协议挂接、adapter 化、自含化、环境兼容措辞）一律保留，只引入审批文档列明的源侧实质点；agents/ 目录维持 eabc203 拍板不拷。

## Decisions so far

- 2026-09-25 拍板 A.A1 / B.B1 / C.C1 / D.D2（原话与考证见 Source spec）→ 转化为本 effort 01–04 四票。

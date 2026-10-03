#!/usr/bin/env bash
# plan-lint —— 只读校验计划治理目录（.scratch/ + .plan/）的文档状态协议。
#
# 规则正本 = skills/plan-protocol/SKILL.md §三「文档形态约定」；脚本只是执行者，
# 规则改动先改协议。口径与已退役的 plan-lint.mjs 逐条对拍一致（票 02）。
#
# 2026-09-29 目录迁移（票 09）：治理目录为两个——tracker 类（spec/map/issues 票
# ＋图内 qa/ledger/assets）在 .scratch/，审批档与全局 qa/ledger 在 .plan/（审批
# 档 2026-09-30 收拢拍板起正本落 .plan/approval/，根层前缀形状仅存量兼容）；
# 存量未迁移图仍按旧布局留在 .plan/。两个目录各跑一遍全量检查，发现数累计。
# 票目录名 issues/（新）与 tickets/（存量）双认。
#
# 抓十类漂移（[7] terms 仅带 --terms 时执行）：
#   1. 同票双档：同一票 id 多处落点，且多于一份未标 superseded-by
#      （map/readme 豁免；type: ledger 是台账登记簿不是票，2026-09-21 拍板；
#      qa/ 下的缺陷/测例档不是票，整目录豁免）
#   2. 目录有票缺 map：路径上没有 map.md 且没有 spec.md → 整个目录不被 plan 视图
#      加载（2026-09-29 拍板：无 map 有 spec 的 spec-only 实施图同被加载，不报；
#      根层 qa/ 豁免——无图归属缺陷/测例按设计进第一层「测例&缺陷」tab；
#      .plan/approval/ 同理豁免——全局审批档正本落点，2026-09-30 收拢拍板）
#   3. 状态头违规：approval / qa-defect 缺四字段/状态越词表；task 状态越词表；
#      文件名带「待拍板」或 DEF- 前缀却无 frontmatter（围栏/引用块插件读不到）
#   4. 票形态：issues/（存量 tickets/）下文件缺 frontmatter 或缺 type；缺正文
#      **Status:** / **Blocked by:** 行；合体 issues.md / tickets.md（多票一文件
#      会被视图当成一张票；2026-09-24 拍板「1」——手写票不拦写入，格式必须
#      同源 to-tickets，lint 兜底）
#      载体正本 = plan-protocol §三「文档头三字段 ＋ 正文状态行」（2026-10-02
#      拍板 Q10=乙「全文档统一走正文行」）：type 留 frontmatter（它回答「这是
#      什么单据」，视图靠它分流），**状态与阻塞边一律写正文行**，frontmatter
#      的 status:/blocked_by: 仅作存量回退读取，本脚本按违例报出驱动迁移。
#      词表正本 = plan-protocol §三「票面 Status: 词表」（2026-10-02 拍板
#      Q1/Q4，三值）：open / claimed / resolved（终态 resolved 允许附日期）。
#      done 已于 2026-10-02 退出词表（对齐 mp 原版 issue-tracker-local.md 明文，
#      取代 2026-09-27「resolved 改为 done」拍板）；out_of_scope 是派生态（由
#      ## Ruled out 带正文派生），非 Status: 的第四个取值，残留不报。
#      type 不在上表的文件按说明/杂项解析、不查（研究型票 status 暂不设门，
#      留观察）。impl 已于 2026-09-27 废弃（存量已于 2026-09-29 全 workdir 回扫
#      清零，plan-lint-gate 票 07）；再遇即真漂移，本脚本不作拦截。
#   5. 取代登记（2026-10-04 E' 拍板取代旧判据）：spec 带 superseded-by 注记 ⇒
#      该 effort 不得存在未终态票（premature-supersede——spec 中途退役使续批
#      决策失去收纳点，novel 2026-10-03 事故病灶）。spec 退役只发生在 effort
#      归档（G4 前置判据④，plan-archive 执行）；旧判据「effort 票尽 ⇒ spec
#      必标 superseded-by」（2026-09-28 Q1=A/Q2=A）就此取代——票尽时 spec
#      合法存活，续批口径回写 spec 走销号分流；销号清单机械校验待立项
#   6. .plan 根层白名单：.plan/ 只放全局件封闭三件套（approval/ 审批档 + qa/ +
#      ledger/，定义正本 = plan-protocol §三「全局件」条，2026-09-29 拍板；
#      审批成员 2026-09-30 收拢拍板由根层散放改为 approval/ 目录）；
#      清单外新子目录即报（novel .plan/research/ 旧病——判据须机械守门）。
#      豁免：handoffs（存量历史轮快照）。2026-09-29 二次拍板：.plan/ 下无
#      effort——任何子目录含 map.md/spec.md 即报 plan-root-effort（旧布局
#      「存量图留 .plan/ 可读」兼容已废，迁 .scratch/ 即合规）
#   7. 术语残留（terms-residue，2026-09-29 拍板，novel 术语 sweep 移交方案 C，
#      plan-lint-gate 票 13）：词表驱动全仓活面断言「无标记残留=0」——只在
#      带 --terms 时执行，执行体 = 同目录 terms_check.py（python3 stdlib，
#      bash 3.2 对中文枚举/计数是实证雷区，故此查不走本文件）；不带 --terms
#      整体跳过，其他仓无词表零影响。规则正本 = plan-protocol §三「术语残留
#      断言」条。注意：检查[7] 输出禁套 rtk（压缩/统计改写已实证失真）。
#   8. effort 目录白名单（2026-09-30 拍板，plan-lint-gate 票 16；判据正本 =
#      docs/research/梳理-plan目录写入矩阵-20260930.md 两层 tree）：effort
#      （.scratch/ 下含 map.md 或 spec.md 的目录）的直接子目录封闭清单 =
#      issues / assets / approval / qa / ledger ＋ 存量只读兼容 tickets /
#      impl / impl-fe（协议「impl 不是票型」条：历史路径不得清理）；清单外
#      自建子目录（fengping/specs/briefs 类）报 effort-dir-whitelist——视图
#      不收集、产物按写入矩阵归 assets/ 等合法落点。
#   9. .plan 根层文件形状（同上拍板与判据正本）：审批档正本落点 =
#      .plan/approval/（2026-09-30 收拢拍板），根层 .md 一律违例（README 层级
#      说明档豁免），报 plan-root-shape 并提示合法落点——审批档入 approval/，
#      其余（梳理/复盘/参考/需求等）按写入矩阵分流（docs/research/、
#      docs/requirements/、.tmp/、effort assets/）。子目录由检查[6]管，
#      本查只管根层文件。
#   10. 审批档归属声明（2026-09-30 拍板 A，to-approval 参数化配套）：图内档
#      frontmatter 带 effort: <slug> 且落 .scratch/<slug>/approval/；全局档不
#      带该字段、落 .plan/approval/（路径即声明）。声明与落点不符报
#      approval-misplaced，缺声明报 approval-scope。lint 不知场景，只验声明
#      与落点一致；全局档带 effort: 字段同样报。
#
# 非治理区（遍历时整棵剪掉，与 mjs SKIP 一致）：.archive / node_modules /
# assets / handoffs / ledger / 一切隐藏目录与隐藏文件。
# qa/ 自 2026-09-24 起纳入校验（围栏与状态头；正文字段行形状仍靠
# run-qa-testcases 自检兜）。
#
# 只读，不改任何文件。用法：
#   bash plan-lint.sh [--terms <词表> --terms-roots <dir,dir,...>] [<治理目录> ...]
#   # 治理目录省略时自动找 ./.scratch ./.plan 或 ../ 同名；带 --terms 且找不到
#   # 治理目录时跳过检查[1]-[6]、只跑检查[7]（无词表仓不受影响）
# 退出码：0=无发现，1=有发现，2=用法错误。
#
# 兼容 bash 3.2（macOS 自带版没有关联数组），只用 sort/awk/uniq 等通用工具。

set -uo pipefail

# 文件名按字节比较：macOS 的 sort/uniq 在 UTF-8 collation 下会把不同汉字判等
# （实测 en_US.UTF-8 把 150 行收成 148），制造「同票双档」假阳性，故强制 C locale。
export LC_ALL=C

# 选项解析（--terms / --terms-roots；选项须在治理目录之前）
TERMS_FILE=""
TERMS_ROOTS=""
while [ $# -gt 0 ]; do
  case "$1" in
    --terms)
      [ $# -ge 2 ] || { echo "用法错误: --terms 需要词表文件路径" >&2; exit 2; }
      TERMS_FILE="$2"; shift 2 ;;
    --terms-roots)
      [ $# -ge 2 ] || { echo "用法错误: --terms-roots 需要目录清单（逗号分隔）" >&2; exit 2; }
      TERMS_ROOTS="$2"; shift 2 ;;
    --*)
      echo "未知选项: $1" >&2
      echo "用法: bash plan-lint.sh [--terms <词表> --terms-roots <dir,dir,...>] [<治理目录> ...]" >&2
      exit 2 ;;
    *) break ;;
  esac
done

if [ $# -gt 0 ]; then
  PLAN_DIRS="$*"
else
  PLAN_DIRS=""
  for d in .scratch .plan; do
    if [ -d "$d" ]; then PLAN_DIRS="$PLAN_DIRS $d"
    elif [ -d "../$d" ]; then PLAN_DIRS="$PLAN_DIRS ../$d"
    fi
  done
  if [ -z "$PLAN_DIRS" ]; then
    if [ -n "$TERMS_FILE" ]; then
      echo "plan-lint: 治理目录（.scratch/.plan）未找到，跳过检查[1]-[6]，仅跑检查[7]"
    else
      echo "用法: bash plan-lint.sh <path-to-治理目录> ...   # 例: .scratch .plan" >&2
      exit 2
    fi
  fi
fi

TOTAL_FINDINGS=0
TOTAL_FILES=0
note() { printf '  %s\n' "$*"; }

# frontmatter 取字段（首个 --- 围栏内；解析同 mjs：^key:[ \t]*value）
fm_field() {
  awk -v k="$2" '/^---[ \t\r]*$/{n++; next} n==1 && index($0, k":")==1 { sub(/^[^:]*:[ \t]*/, ""); sub(/[ \t\r]+$/, ""); print; exit }' "$1"
}

# 是否有完整 frontmatter 围栏（首行 --- 且存在闭合 ---，同 mjs 的 hasHeader）
has_header() {
  awk 'NR==1 && $0!~/^---[ \t\r]*$/{exit 1} NR>1 && $0~/^---[ \t\r]*$/{s=1; exit} END{exit s?0:1}' "$1"
}

# 正文固定行取字段（2026-10-02 拍板 Q10=乙：状态载体统一到正文行）。
# 形态 = 行首 **Label:** value（票 Status / Blocked by，审批档 Status，spec Status）。
# 围栏感知：``` / ~~~ 代码块内的同形行不算声明（防「引用格式的票」自我收口，
# 与客户端 bodyField fence 语义对齐）。命中即返回，无命中输出空串。
body_field() {
  awk -v k="$2" '
    /^[ \t]*(```|~~~)/ { fence = !fence; next }
    fence { next }
    index($0, "**" k ":**") == 1 {
      sub(/^\*\*[^*]*:\*\*[ \t]*/, ""); sub(/[ \t\r]+$/, ""); print; exit
    }
  ' "$1"
}

# 某目录到治理目录根的路径上有没有 map.md（同 mjs 的 hasMapOnPath）
has_map_on_path() {
  local d="$1"
  while :; do
    [ -f "$d/map.md" ] && return 0
    [ "$d" = "$PD" ] && return 1
    d=$(dirname "$d")
  done
}

# spec-only effort 豁免（2026-09-29 拍板）：路径上有 spec.md 的目录同样被视图
# 加载（loadPlan 判据 = map.md 或 spec.md），不应报 missing-map。
has_spec_on_path() {
  local d="$1"
  while :; do
    [ -f "$d/spec.md" ] && return 0
    [ "$d" = "$PD" ] && return 1
    d=$(dirname "$d")
  done
}

for PD in $PLAN_DIRS; do
  PD="${PD%/}"
  [ -d "$PD" ] || { echo "错误: 找不到目录 $PD" >&2; exit 2; }

  findings=0

  TMP=$(mktemp -d)
  trap 'rm -rf "$TMP"' EXIT

  # 收集清单：非治理区整棵剪掉（-mindepth 1 防根目录自身被 -name '.*' 剪没）
  find "$PD" -mindepth 1 \( -type d \( -name '.*' -o -name node_modules -o -name assets \
        -o -name handoffs -o -name ledger \) -prune \) \
     -o \( -type f -name '*.md' ! -name '.*' -print \) | sort > "$TMP/files.txt"

  # 逐文件预取元数据：dir \t id \t path \t hasHeader \t type \t status \t blockedBy
  # status 取值优先级（2026-10-02 拍板 Q10=乙「全文档统一走正文行」）：
  #   正文 **Status:** 行 > 正文 - 状态: 行（缺陷/台账）> frontmatter status:
  # frontmatter 仅作存量回退读取；新写文档一律正文行（协议 §三）。
  : > "$TMP/meta.tsv"
  while IFS= read -r f; do
    b=$(basename "$f"); id=${b%.md}; d=$(dirname "$f")
    hh=$(has_header "$f" && echo 1 || echo 0)
    st=$(body_field "$f" "Status")
    [ -z "$st" ] && st=$(awk '/^[ \t]*-[ \t]*状态:[ \t]*/ { sub(/^[ \t]*-[ \t]*状态:[ \t]*/, ""); sub(/[ \t\r]+$/, ""); print; exit }' "$f")
    [ -z "$st" ] && st=$(fm_field "$f" status)
    bby=$(body_field "$f" "Blocked by")
    [ -z "$bby" ] && bby=$(fm_field "$f" blocked_by)
    printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\n' "$d" "$id" "$f" "$hh" \
      "$(fm_field "$f" type)" "$st" "$bby" >> "$TMP/meta.tsv"
  done < "$TMP/files.txt"

  echo "plan-lint: 校验 $PD"
  echo

  # ── 1. 同票双档 ────────────────────────────────────────────────────────────
  echo "[1] 同票双档（同一票 id 多处落点，且多于一份未标 superseded-by）"
  # map/readme/spec 每图一份天然同名豁免（大小写不敏感）；type: ledger 是登记簿
  # 不是票；qa/ 目录是缺陷/测例档不是票，整目录豁免
  awk -F'\t' '{l=tolower($2); if (l!="map" && l!="readme" && l!="spec" && $5!="ledger" && $1 !~ /\/qa$/) print $2"\t"$3"\t"$6}' \
    "$TMP/meta.tsv" > "$TMP/ids.tsv"
  cut -f1 "$TMP/ids.tsv" | sort | uniq -d > "$TMP/dupes.txt"

  dupe=0
  if [ -s "$TMP/dupes.txt" ]; then
    while IFS= read -r id; do
      awk -F'\t' -v b="$id" '$1==b{print $2"\t"$3}' "$TMP/ids.tsv" > "$TMP/g.tsv"
      first=$(cut -f1 "$TMP/g.tsv" | head -1)
      n=$(wc -l < "$TMP/g.tsv" | tr -d ' ')
      nstray=0
      while IFS=$'\t' read -r p st; do
        case "$st" in superseded-by*) ;; *) nstray=$((nstray + 1)) ;; esac
      done < "$TMP/g.tsv"
      if [ "$nstray" -gt 1 ]; then
        dupe=$((dupe + 1))
        note "✗ $first: duplicate-ticket — 票 id「${id}」有 $n 处落点，其中 $nstray 处未标 superseded-by："
        cut -f1 "$TMP/g.tsv" | while IFS= read -r p; do note "      $p"; done
      fi
    done < "$TMP/dupes.txt"
  fi
  [ "$dupe" -eq 0 ] && note "✓ 无"
  findings=$((findings + dupe))
  echo

  # ── 2. 目录有票却缺 map.md ─────────────────────────────────────────────────
  echo "[2] 目录有票缺 map.md 且缺 spec.md（该目录不会被 plan 视图加载）"
  # ticket-like = 除 map/readme 外的全部 .md，按目录聚合；根层文档合法免查
  awk -F'\t' '{l=tolower($2); if (l!="map" && l!="readme") print $1"\t"$3}' "$TMP/meta.tsv" \
    | sort -u > "$TMP/tl.tsv"
  cut -f1 "$TMP/tl.tsv" | sort -u > "$TMP/dirs.txt"

  missing=0
  while IFS= read -r d; do
    [ "$d" = "$PD" ] && continue
    case "$d" in "$PD"/qa|"$PD"/qa/*|"$PD"/approval|"$PD"/approval/*) continue ;; esac
    has_map_on_path "$d" && continue
    has_spec_on_path "$d" && continue
    n=$(awk -F'\t' -v dd="$d" '$1==dd' "$TMP/tl.tsv" | wc -l | tr -d ' ')
    missing=$((missing + 1))
    note "✗ ${d}/: missing-map — $n 个票形文件在 plan 视图不会加载的目录下（路径上无 map.md 且无 spec.md）"
  done < "$TMP/dirs.txt"
  [ "$missing" -eq 0 ] && note "✓ 无"
  findings=$((findings + missing))
  echo

  # ── 3. 状态头 ──────────────────────────────────────────────────────────────
  echo "[3] 状态头（approval·qa-defect 四字段与词表 / task 词表 / 「待拍板」·DEF- 裸文件）"
  # type 不在 approval/task/qa-defect 的文件按说明/杂项解析，不作校验对象（协议 §三 2026-09-24）
  bad=0
  while IFS=$'\t' read -r d id f hh ty st bby; do
    lcty=$(printf '%s' "$ty" | tr 'A-Z' 'a-z')
    if [ "$lcty" = "approval" ]; then
      # 审批档：frontmatter 保三字段（2026-10-02 拍板 Q10=乙），状态走正文 **Status:**
      for k in type date origin; do
        v=$(fm_field "$f" "$k")
        if [ -z "$v" ]; then
          note "✗ $f: status-header — approval 文档缺 frontmatter 字段「${k}」"; bad=$((bad + 1))
        fi
      done
      if [ -z "$st" ]; then
        note "✗ $f: status-header — approval 文档缺状态（正文 **Status:** 行）"; bad=$((bad + 1)); continue
      fi
      if [ -z "$(body_field "$f" "Status")" ] && [ -n "$(fm_field "$f" status)" ]; then
        note "✗ $f: status-header — 状态仍在 frontmatter status:，须迁正文行 **Status:**（2026-10-02 拍板 Q10=乙/Q14）"; bad=$((bad + 1))
      fi
      head="${st%%:*}"
      case "$head" in
        pending|closed|active|abandoned) : ;;
        *)
          case "$st" in
            superseded-by*) : ;;
            *) note "✗ $f: status-header — approval status「${st}」不在词表（pending/closed/superseded-by:<path>/active/abandoned）"; bad=$((bad + 1)) ;;
          esac ;;
      esac
    fi
    if [ "$lcty" = "qa-defect" ]; then
      # 缺陷档：2026-10-02 拍板 Q11「按正文，单写」——frontmatter 取消 status
      # （superseded-by: 为可选保留字段），状态只由正文 `- 状态:` 行承载。
      for k in type date origin; do
        v=$(fm_field "$f" "$k")
        if [ -z "$v" ]; then
          note "✗ $f: status-header — qa-defect 文档缺 frontmatter 字段「${k}」"; bad=$((bad + 1))
        fi
      done
      if [ -n "$(fm_field "$f" status)" ]; then
        note "✗ $f: status-header — 缺陷档 frontmatter 不得带 status（2026-10-02 拍板 Q11），状态只写正文「- 状态:」行"; bad=$((bad + 1))
      fi
      if [ -z "$st" ]; then
        note "✗ $f: status-header — qa-defect 文档缺正文「- 状态:」行"; bad=$((bad + 1))
      fi
    fi
    if [ "$lcty" = "task" ] && [ -n "$st" ]; then
      case "$st" in
        open|claimed|resolved|resolved\ *) : ;;
        out_of_scope|out_of_scope\ *) : ;;  # 派生态：由 ## Ruled out 带正文派生，容忍残留不报
        done|done\ *) note "✗ $f: status-header — task status「${st}」为已废弃词：done 已于 2026-10-02 退出票态词表（对齐 mp 原版 issue-tracker-local.md），请改为 resolved"; bad=$((bad + 1)) ;;
        *) note "✗ $f: status-header — task status「${st}」不在词表（open/claimed/resolved，终态可附日期；out_of_scope 为派生态不写入）"; bad=$((bad + 1)) ;;
      esac
    fi
    if [ "$hh" = "0" ]; then
      case "$id" in
        *待拍板*) note "✗ $f: status-header — 文件名带「待拍板」但无 frontmatter 状态头"; bad=$((bad + 1)) ;;
        DEF-*) note "✗ $f: status-header — 缺陷档文件名带 DEF- 前缀但无 frontmatter 状态头（围栏/引用块插件读不到）"; bad=$((bad + 1)) ;;
      esac
    fi
  done < "$TMP/meta.tsv"
  [ "$bad" -eq 0 ] && note "✓ 无"
  findings=$((findings + bad))
  echo

  # ── 4. 票形态 ──────────────────────────────────────────────────────────────
  echo "[4] 票形态（issues/·tickets/ 下文件缺 frontmatter/type；缺正文 Status/Blocked by 行；合体票文件）"
  bad4=0
  while IFS=$'\t' read -r d id f hh ty st bby; do
    case "$d" in */issues|*/tickets) ;; *) continue ;; esac
    lcid=$(printf '%s' "$id" | tr 'A-Z' 'a-z')
    if [ "$lcid" = "issues" ] || [ "$lcid" = "tickets" ]; then
      note "✗ $f: ticket-shape — 合体票文件（issues.md/tickets.md）会被视图当成一张票，须拆一票一文件"; bad4=$((bad4 + 1)); continue
    fi
    if [ "$hh" = "0" ]; then
      note "✗ $f: ticket-shape — 票缺 frontmatter（type 仍须留 frontmatter）"; bad4=$((bad4 + 1)); continue
    fi
    # type 仍留 frontmatter：它回答「这是什么单据」，视图靠它分流（协议 §三 2026-10-02）
    if [ -z "$(fm_field "$f" type)" ]; then
      note "✗ $f: ticket-shape — 票缺 frontmatter 字段「type」"; bad4=$((bad4 + 1))
    fi
    # 状态与阻塞边改为正文行载体（2026-10-02 拍板 Q1/Q2，对齐 mp 原版明文）
    if [ -z "$(body_field "$f" "Status")" ]; then
      if [ -n "$(fm_field "$f" status)" ]; then
        note "✗ $f: ticket-shape — 状态仍在 frontmatter status:，须迁正文行 **Status:**（2026-10-02 拍板 Q1）"; bad4=$((bad4 + 1))
      else
        note "✗ $f: ticket-shape — 票缺正文 **Status:** 行"; bad4=$((bad4 + 1))
      fi
    fi
    if [ -z "$(body_field "$f" "Blocked by")" ]; then
      if [ -n "$(fm_field "$f" blocked_by)" ]; then
        note "✗ $f: ticket-shape — 阻塞边仍在 frontmatter blocked_by:，须迁正文行 **Blocked by:**（2026-10-02 拍板 Q2）"; bad4=$((bad4 + 1))
      else
        note "✗ $f: ticket-shape — 票缺正文 **Blocked by:** 行（无前置写 None — can start immediately）"; bad4=$((bad4 + 1))
      fi
    fi
  done < "$TMP/meta.tsv"
  [ "$bad4" -eq 0 ] && note "✓ 无"
  findings=$((findings + bad4))
  echo

  # ── 5. 取代登记 ────────────────────────────────────────────────────────────
  echo "[5] 取代登记（spec 带 superseded-by ⇒ effort 不得有未终态票；票尽不再触发必标）"
  # 判据正本 = 2026-10-04 拍板 E'（spec＝effort 归档前变更总线；审批档
  # .plan/approval/待拍板-文档sweep范围起草侧漏圈-20261003.md §七）：spec 退役
  # 只发生在 effort 归档（G4 前置判据④，plan-archive 执行时核销号清单）；
  # 旧判据「effort 票全 resolved ⇒ spec 必带 superseded-by」（2026-09-28
  # Q1=A/Q2=A）就此取代——票尽时 spec 合法存活，续批拍板/缺陷口径回写 spec
  # 走销号分流。本检查反向守门：spec 已标 superseded-by 而 effort 仍有
  # open/claimed 票 = spec 中途退役（novel 2026-10-03 事故病灶：spec 死后
  # 十票无收纳点，sweep 清单漏圈权威文档），报 premature-supersede。
  # 标记检索面同旧判据：正文 `**Status:**` 或头部 10 行内 `superseded-by:`
  # （覆盖无头 spec 首行 HTML 注释形态），埋正文深处不算。
  # 销号清单全清的机械校验为加法项，待立项票。
  nviol=0
  while IFS=$'\t' read -r d id f hh ty st; do
    [ "$id" = "spec" ] || continue
    [ "$d" = "$PD" ] && continue          # 根层散件 spec 不属任何 effort
    found=0
    for tdir in tickets issues; do
      [ -d "$d/$tdir" ] && found=1
    done
    [ "$found" -eq 1 ] || continue
    marked=0
    case "$(fm_field "$f" status)" in
      superseded-by*) marked=1 ;;
    esac
    if [ "$marked" -eq 0 ] && head -10 "$f" | grep -q 'superseded-by' 2>/dev/null; then marked=1; fi
    [ "$marked" -eq 1 ] || continue
    nopen=0
    while IFS=$'\t' read -r td tid tf tth tty tst tbby; do
      case "$td" in "$d/tickets"|"$d/issues") ;; *) continue ;; esac
      case "$tst" in
        resolved|resolved\ *|out_of_scope) : ;;
        *) nopen=$((nopen + 1)) ;;
      esac
    done < "$TMP/meta.tsv"
    if [ "$nopen" -gt 0 ]; then
      note "✗ $f: premature-supersede — spec.md 已带 superseded-by 注记，但该 effort 仍有 $nopen 张未终态票（2026-10-04 E' 拍板：spec 为归档前变更总线，中途退役使续批决策失去收纳点）；撤销注记或先收口票"
      nviol=$((nviol + 1))
    fi
  done < "$TMP/meta.tsv"
  [ "$nviol" -eq 0 ] && note "✓ 无"
  findings=$((findings + nviol))
  echo

  # ── 6. .plan 根层白名单 ───────────────────────────────────────────────────
  # 判据正本 = plan-protocol §三「全局件」条（2026-09-29 拍板；同日二次拍板
  # 「.plan/ 下无 effort」）：.plan/ 只放全局件封闭三件套——approval/（全局
  # 审批档正本落点，2026-09-30 收拢拍板由根层散放目录化）+ qa/ + ledger/。
  # 清单外子目录即报；handoffs（存量历史轮快照）
  # 豁免；任何子目录（含锚点目录内部）含 map.md/spec.md 即报 plan-root-effort
  # ——视图已对 .plan 关 effort 扫描，违例数据迁 .scratch/ 即合规。
  # 仅当本遍历目录名为 .plan 时生效。
  case "${PD##*/}" in .plan)
    echo "[6] .plan 根层白名单（全局件封闭清单：approval/ qa/ ledger/；handoffs 豁免；子目录含 map/spec = 违例 effort）"
    stray=0
    for d in "$PD"/*/; do
      [ -d "$d" ] || continue
      name=$(basename "$d")
      case "$name" in
        approval|qa|ledger|handoffs|assets|node_modules) continue ;;
      esac
      stray=$((stray + 1))
      note "✗ ${d}: plan-root-whitelist — .plan/ 根层清单外子目录「${name}」（调研/复盘落 docs/research/，一次性交接落 .tmp/，tracker 类落 .scratch/<slug>/）"
    done
    for d in "$PD"/*/; do
      [ -d "$d" ] || continue
      [ -f "${d}map.md" ] || [ -f "${d}spec.md" ] || continue
      stray=$((stray + 1))
      note "✗ ${d}: plan-root-effort — .plan/ 下不构成 effort（2026-09-29 拍板：子目录含 map.md/spec.md 即违例），整树迁 .scratch/<slug>/"
    done
    [ "$stray" -eq 0 ] && note "✓ 无"
    findings=$((findings + stray))
    echo
    ;;
  esac

  # ── 8. effort 目录白名单 ─────────────────────────────────────────────────
  # 判据正本 = docs/research/梳理-plan目录写入矩阵-20260930.md 两层 tree
  # （2026-09-30 用户拍板「那就按这个来」）：effort（含 map.md 或 spec.md，
  # 与视图加载判据一致）的直接子目录封闭清单 = issues / assets / approval /
  # qa / ledger ＋ 存量只读 tickets / impl / impl-fe（历史路径不得清理）。
  # 清单外自建子目录 = 视图不收集的孤岛（fengping/specs/briefs 类），报出
  # 供迁移施工；只对 PD=.scratch 生效。tree 之外的目录即违例——「结构即契约」。
  case "${PD##*/}" in .scratch)
    echo "[8] effort 目录白名单（封闭：issues assets approval qa ledger；存量只读：tickets impl impl-fe）"
    stray8=0
    for d in "$PD"/*/; do
      [ -d "$d" ] || continue
      [ -f "${d}map.md" ] || [ -f "${d}spec.md" ] || continue
      for sub in "$d"*/; do
        [ -d "$sub" ] || continue
        name=$(basename "$sub")
        case "$name" in
          issues|assets|approval|qa|ledger|tickets|impl|impl-fe|node_modules) continue ;;
          .*) continue ;;
        esac
        stray8=$((stray8 + 1))
        note "✗ ${sub}: effort-dir-whitelist — effort「$(basename "$d")」清单外子目录「${name}」（视图不收集；按写入矩阵分流：调研产物归 assets/，票归 issues/，一次性归 .tmp/）"
      done
    done
    [ "$stray8" -eq 0 ] && note "✓ 无"
    findings=$((findings + stray8))
    echo
    ;;
  esac

  # ── 9. .plan 根层文件形状 ────────────────────────────────────────────────
  # 判据正本同检查[8]（写入矩阵两层 tree）＋ 2026-09-30 收拢拍板：全局审批档
  # 正本落点 = .plan/approval/（全局件封闭清单的 approval/ 成员，正本 =
  # plan-protocol §三「审批文档归属」条），根层 .md 一律违例报
  # plan-root-shape 并提示合法落点。子目录白名单归检查[6]管，本查只管根层
  # 文件；仅当本遍历目录名为 .plan 时生效。
  case "${PD##*/}" in .plan)
    echo "[9] .plan 根层文件形状（审批档落 approval/；其余按写入矩阵分流）"
    bad9=0
    for f in "$PD"/*.md; do
      [ -f "$f" ] || continue
      b=$(basename "$f")
      case "$b" in
        [Rr][Ee][Aa][Dd][Mm][Ee].md) continue ;;  # 层级说明档，非单据（同检查[1][2]的 map/readme 豁免惯例）
      esac
      bad9=$((bad9 + 1))
      note "✗ $f: plan-root-shape — 全局审批档落 .plan/approval/（2026-09-30 收拢拍板）；本文件按写入矩阵分流（调研/复盘→docs/research/，需求→docs/requirements/，一次性→.tmp/，effort 挂钩→.scratch/<slug>/assets/）"
    done
    [ "$bad9" -eq 0 ] && note "✓ 无"
    findings=$((findings + bad9))
    echo
    ;;
  esac

  # ── 10. 审批档归属声明一致性（2026-09-30 拍板 A，to-approval 参数化配套）──
  # 判据正本 = plan-protocol §三「审批文档归属」条：图内档 frontmatter 带
  # effort: <slug> 且落 .scratch/<slug>/approval/；全局档不带 effort: 字段、
  # 落 .plan/approval/（路径即声明）。lint 不知场景，只验「声明 vs 落点」
  # 一致：全局档带 effort: → 报；图内档缺声明或声明≠所在目录 → 报。
  # 形状类违例（根层/契约外目录）归检查[6][8][9]，本查只管 approval/ 目录内。
  echo "[10] 审批档归属声明（图内带 effort: 声明、全局不带；声明与落点一致）"
  bad10=0
  if [ "$(basename "$PD")" = ".plan" ] && [ -d "$PD/approval" ]; then
    for f in "$PD/approval"/*.md; do
      [ -f "$f" ] || continue
      if [ -n "$(fm_field "$f" effort)" ]; then
        note "✗ $f: approval-scope — 全局审批档（.plan/approval/）不得带 effort: 字段（路径即声明）；归属某图请迁 .scratch/<slug>/approval/ 并带声明"
        bad10=$((bad10 + 1))
      fi
    done
  fi
  for d in "$PD"/*/; do
    [ -d "$d" ] || continue
    [ -d "${d}approval" ] || continue
    [ "$(basename "$d")" = "approval" ] && continue  # .plan 全局面已在上方处理
    eff="$(basename "$d")"
    for f in "${d}approval"/*.md; do
      [ -f "$f" ] || continue
      v=$(fm_field "$f" effort)
      if [ -z "$v" ]; then
        note "✗ $f: approval-scope — 图内审批档缺 effort: 声明（frontmatter 加 effort: $eff）"
        bad10=$((bad10 + 1))
      elif [ "$v" != "$eff" ]; then
        note "✗ $f: approval-misplaced — 声明 effort: $v 与落点 $eff/approval/ 不符（迁移文件或改声明，二者取一）"
        bad10=$((bad10 + 1))
      fi
    done
  done
  [ "$bad10" -eq 0 ] && note "✓ 无"
  findings=$((findings + bad10))
  echo

  # ── 汇总（本目录） ─────────────────────────────────────────────────────────
  total=$(wc -l < "$TMP/files.txt" | tr -d ' ')
  TOTAL_FILES=$((TOTAL_FILES + total))
  TOTAL_FINDINGS=$((TOTAL_FINDINGS + findings))
  if [ "$findings" -eq 0 ]; then
    echo "plan-lint: ✓ $PD：$total 个 markdown，未发现漂移"
  else
    echo "plan-lint: ✗ $PD：共 $findings 项发现（$total 个 markdown；只读报告，未改动任何文件）"
  fi
  if [ "$PD" != "${PLAN_DIRS##* }" ] || [ "$PLAN_DIRS" != "${PLAN_DIRS#* }" ]; then
    echo
  fi
  rm -rf "$TMP"
done

# ── 7. 术语残留（词表驱动全仓活面；只在带 --terms 时执行）──────────────────
# 执行体 = 同目录 terms_check.py（python3 stdlib 只读断言：UTF-8 枚举、三计数
# 对账、显式排除区、零命中⚠警告、--self-test）。发现数经 summary-file 并入
# 总数；退出码 2（用法/环境错误）直接中止。输出禁套 rtk。
if [ -n "$TERMS_FILE" ]; then
  SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
  TC="$SCRIPT_DIR/terms_check.py"
  if [ ! -f "$TC" ]; then
    echo "plan-lint: ✗ 检查[7]执行体缺失: $TC（skill 安装不完整）" >&2
    exit 2
  fi
  if ! command -v python3 >/dev/null 2>&1; then
    echo "plan-lint: ✗ 检查[7]需要 python3（macOS 自带），当前环境不可用" >&2
    exit 2
  fi
  echo
  SUMMARY=$(mktemp)
  T_RC=0
  if [ -n "$TERMS_ROOTS" ]; then
    python3 "$TC" --terms "$TERMS_FILE" --roots "$TERMS_ROOTS" --summary-file "$SUMMARY" || T_RC=$?
  else
    python3 "$TC" --terms "$TERMS_FILE" --summary-file "$SUMMARY" || T_RC=$?
  fi
  T_FINDINGS=$(tr -dc '0-9' < "$SUMMARY" 2>/dev/null)
  rm -f "$SUMMARY"
  [ -z "$T_FINDINGS" ] && T_FINDINGS=0
  if [ "$T_RC" -eq 2 ]; then
    echo "plan-lint: ✗ 检查[7]用法/环境错误（见上）" >&2
    exit 2
  fi
  TOTAL_FINDINGS=$((TOTAL_FINDINGS + T_FINDINGS))
fi

if [ "$TOTAL_FINDINGS" -eq 0 ]; then
  echo "plan-lint: ✓ 合计 $TOTAL_FILES 个 markdown，未发现漂移"
  exit 0
fi
echo "plan-lint: ✗ 合计 $TOTAL_FINDINGS 项发现（$TOTAL_FILES 个 markdown；只读报告，未改动任何文件）"
exit 1

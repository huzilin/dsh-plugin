#!/usr/bin/env bash
# plan-lint —— 只读校验计划治理目录（.scratch/ + .plan/）的文档状态协议。
#
# 规则正本 = skills/plan-protocol/SKILL.md §三「文档形态约定」；脚本只是执行者，
# 规则改动先改协议。口径与已退役的 plan-lint.mjs 逐条对拍一致（票 02）。
#
# 2026-09-29 目录迁移（票 09）：治理目录为两个——tracker 类（spec/map/issues 票
# ＋图内 qa/ledger/assets）在 .scratch/，审批档与全局 qa/ledger 在 .plan/；存量
# 未迁移图仍按旧布局留在 .plan/。两个目录各跑一遍全量检查，发现数累计。
# 票目录名 issues/（新）与 tickets/（存量）双认。
#
# 抓六类漂移：
#   1. 同票双档：同一票 id 多处落点，且多于一份未标 superseded-by
#      （map/readme 豁免；type: ledger 是台账登记簿不是票，2026-09-21 拍板；
#      qa/ 下的缺陷/测例档不是票，整目录豁免）
#   2. 目录有票缺 map：路径上没有 map.md → 整个目录不被 plan 视图加载
#      （根层 qa/ 豁免——无图归属缺陷/测例按设计进第一层「测例&缺陷」tab）
#   3. 状态头违规：approval / qa-defect 缺四字段/状态越词表；task 状态越词表；
#      文件名带「待拍板」或 DEF- 前缀却无 frontmatter（围栏/引用块插件读不到）
#   4. 票形态：issues/（存量 tickets/）下文件缺 frontmatter 或缺 type/blocked_by；
#      合体 issues.md / tickets.md（多票一文件会被视图当成一张票；2026-09-24
#      拍板「1」——手写票不拦写入，格式必须同源 to-tickets，lint 兜底）
#      词表正本 = plan-protocol §三「票面 status 词表」（2026-09-27 拍板统一）：
#      票的终态只有一个词 done（不分票型，允许附日期 done <YYYY-MM-DD>）、
#      执行中 claimed、另有 open 与 out_of_scope。
#      resolved 已于 2026-09-27 退出票态词表（原话「resolved 改为 done」），
#      本脚本不再放行——残留 resolved 的票须由「形态契约变更回扫」迁移。
#      todo/doing/closed 为插件归一容忍别名；type 不在上表的文件按说明/杂项
#      解析、不查（研究型票 status 暂不设门，留观察）。
#      impl 已于 2026-09-27 废弃（存量已于 2026-09-29 全 workdir 回扫清零，
#      plan-lint-gate 票 07）；再遇即真漂移，本脚本不作拦截。
#   5. 取代登记：effort 票已全终态（done/out_of_scope）⇒ 该 effort 的 spec.md
#      必带 superseded-by 注记或已随轮归档（2026-09-28 拍板 Q1=A/Q2=A，
#      票 07；spec 一次性化收口——防走完的 effort 留下无取代声明的 spec
#      被后续会话当现行权威照做）
#   6. .plan 根层白名单：.plan/ 只放全局件封闭三件套（根层审批档 + qa/ +
#      ledger/，定义正本 = plan-protocol §三「全局件」条，2026-09-29 拍板）；
#      清单外新子目录即报（novel .plan/research/ 旧病——判据须机械守门）。
#      豁免：handoffs（存量历史轮快照）、含 map.md 的子目录（存量旧布局
#      effort，只读兼容，迁移归存量批次）
#
# 非治理区（遍历时整棵剪掉，与 mjs SKIP 一致）：.archive / node_modules /
# assets / handoffs / ledger / 一切隐藏目录与隐藏文件。
# qa/ 自 2026-09-24 起纳入校验（围栏与状态头；正文字段行形状仍靠
# run-qa-testcases 自检兜）。
#
# 只读，不改任何文件。用法：
#   bash plan-lint.sh [<治理目录> ...]   # 省略时自动找 ./.scratch ./.plan 或 ../ 同名
# 退出码：0=无发现，1=有发现，2=用法错误。
#
# 兼容 bash 3.2（macOS 自带版没有关联数组），只用 sort/awk/uniq 等通用工具。

set -uo pipefail

# 文件名按字节比较：macOS 的 sort/uniq 在 UTF-8 collation 下会把不同汉字判等
# （实测 en_US.UTF-8 把 150 行收成 148），制造「同票双档」假阳性，故强制 C locale。
export LC_ALL=C

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
    echo "用法: bash plan-lint.sh <path-to-治理目录> ...   # 例: .scratch .plan" >&2
    exit 2
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

# 某目录到治理目录根的路径上有没有 map.md（同 mjs 的 hasMapOnPath）
has_map_on_path() {
  local d="$1"
  while :; do
    [ -f "$d/map.md" ] && return 0
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

  # 逐文件预取元数据：dir \t id \t path \t hasHeader \t type \t status
  : > "$TMP/meta.tsv"
  while IFS= read -r f; do
    b=$(basename "$f"); id=${b%.md}; d=$(dirname "$f")
    hh=$(has_header "$f" && echo 1 || echo 0)
    printf '%s\t%s\t%s\t%s\t%s\t%s\n' "$d" "$id" "$f" "$hh" \
      "$(fm_field "$f" type)" "$(fm_field "$f" status)" >> "$TMP/meta.tsv"
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
  echo "[2] 目录有票缺 map.md（该目录不会被 plan 视图加载）"
  # ticket-like = 除 map/readme 外的全部 .md，按目录聚合；根层文档合法免查
  awk -F'\t' '{l=tolower($2); if (l!="map" && l!="readme") print $1"\t"$3}' "$TMP/meta.tsv" \
    | sort -u > "$TMP/tl.tsv"
  cut -f1 "$TMP/tl.tsv" | sort -u > "$TMP/dirs.txt"

  missing=0
  while IFS= read -r d; do
    [ "$d" = "$PD" ] && continue
    case "$d" in "$PD"/qa|"$PD"/qa/*) continue ;; esac
    has_map_on_path "$d" && continue
    n=$(awk -F'\t' -v dd="$d" '$1==dd' "$TMP/tl.tsv" | wc -l | tr -d ' ')
    missing=$((missing + 1))
    note "✗ ${d}/: missing-map — $n 个票形文件在 plan 视图不会加载的目录下（路径上无 map.md）"
  done < "$TMP/dirs.txt"
  [ "$missing" -eq 0 ] && note "✓ 无"
  findings=$((findings + missing))
  echo

  # ── 3. 状态头 ──────────────────────────────────────────────────────────────
  echo "[3] 状态头（approval·qa-defect 四字段与词表 / task 词表 / 「待拍板」·DEF- 裸文件）"
  # type 不在 approval/task/qa-defect 的文件按说明/杂项解析，不作校验对象（协议 §三 2026-09-24）
  bad=0
  while IFS=$'\t' read -r d id f hh ty st; do
    lcty=$(printf '%s' "$ty" | tr 'A-Z' 'a-z')
    if [ "$lcty" = "approval" ] || [ "$lcty" = "qa-defect" ]; then
      for k in type date status origin; do
        v=$(fm_field "$f" "$k")
        if [ -z "$v" ]; then
          note "✗ $f: status-header — ${lcty} 文档缺 frontmatter 字段「${k}」"; bad=$((bad + 1))
        fi
      done
      if [ -z "$st" ]; then
        note "✗ $f: status-header — ${lcty} 文档缺 status"; bad=$((bad + 1)); continue
      fi
      head="${st%%:*}"
      case "$head" in
        pending|closed|active|abandoned) : ;;
        *)
          case "$st" in
            superseded-by*) : ;;
            *) note "✗ $f: status-header — ${lcty} status「${st}」不在词表（pending/closed/superseded-by:<path>/active/abandoned）"; bad=$((bad + 1)) ;;
          esac ;;
      esac
    fi
    if [ "$lcty" = "task" ] && [ -n "$st" ]; then
      case "$st" in
        open|claimed|done|out_of_scope|done\ *) : ;;
        todo|doing|closed) : ;;  # 插件归一容忍别名（→claimed / →done）
        resolved|resolved\ *) note "✗ $f: status-header — task status「${st}」为已废弃词：resolved 已退出票态词表（2026-09-27 拍板「resolved 改为 done」），请改为 done"; bad=$((bad + 1)) ;;
        *) note "✗ $f: status-header — task status「${st}」不在词表（open/claimed/done [日期]/out_of_scope；容忍别名 todo/doing/closed）"; bad=$((bad + 1)) ;;
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
  echo "[4] 票形态（issues/·tickets/ 下文件缺 frontmatter/type/blocked_by；合体票文件）"
  bad4=0
  while IFS=$'\t' read -r d id f hh ty st; do
    case "$d" in */issues|*/tickets) ;; *) continue ;; esac
    lcid=$(printf '%s' "$id" | tr 'A-Z' 'a-z')
    if [ "$lcid" = "issues" ] || [ "$lcid" = "tickets" ]; then
      note "✗ $f: ticket-shape — 合体票文件（issues.md/tickets.md）会被视图当成一张票，须拆一票一文件"; bad4=$((bad4 + 1)); continue
    fi
    if [ "$hh" = "0" ]; then
      note "✗ $f: ticket-shape — 票缺 frontmatter 状态头"; bad4=$((bad4 + 1)); continue
    fi
    for k in type blocked_by; do
      if [ -z "$(fm_field "$f" "$k")" ]; then
        note "✗ $f: ticket-shape — 票缺 frontmatter 字段「${k}」"; bad4=$((bad4 + 1))
      fi
    done
  done < "$TMP/meta.tsv"
  [ "$bad4" -eq 0 ] && note "✓ 无"
  findings=$((findings + bad4))
  echo

  # ── 5. 取代登记 ────────────────────────────────────────────────────────────
  echo "[5] 取代登记（effort 票全终态 ⇒ spec 必带 superseded-by 注记或已归档）"
  # 判据正本 = 2026-09-28 拍板（Q1=A/Q2=A，plan-lint-gate 票 07）：「effort 票全
  # done ⇒ spec 必带 superseded-by 或已归档」。spec 已归档时整文件随轮搬进
  # .archive/（本脚本遍历剪枝区），自然不在校验面——留在治理目录的 spec 才查。
  # 终态词 = done/out_of_scope（done 允许附日期）；存在 open/claimed/空 status
  # 的票 = effort 未走完，不触发。无票目录或零票 = 无「票尽」判据，跳过。
  unmarked=0
  while IFS=$'\t' read -r d id f hh ty st; do
    [ "$id" = "spec" ] || continue
    [ "$d" = "$PD" ] && continue          # 根层散件 spec 不属任何 effort
    found=0
    for tdir in tickets issues; do
      [ -d "$d/$tdir" ] && found=1
    done
    [ "$found" -eq 1 ] || continue
    all_done=1; ntk=0
    while IFS=$'\t' read -r td tid tf tth tty tst; do
      case "$td" in "$d/tickets"|"$d/issues") ;; *) continue ;; esac
      ntk=$((ntk + 1))
      case "$tst" in
        done|done\ *|out_of_scope) : ;;
        *) all_done=0 ;;
      esac
    done < "$TMP/meta.tsv"
    [ "$ntk" -eq 0 ] && continue
    [ "$all_done" -eq 1 ] || continue
    marked=0
    case "$(fm_field "$f" status)" in
      superseded-by*) marked=1 ;;
    esac
    # 头部 10 行内的「superseded-by:」注记也认（取代声明必须头部机械可检索——
    # 埋正文的标记 agent 读不到，doc-authority 复盘实证 23% 可检索率教训）。
    # 不做全文 grep：正文「提及」他人被取代（引用性出现）不算自身已标，2026-09-29 实测误放行。
    if [ "$marked" -eq 0 ] && head -10 "$f" | grep -q 'superseded-by' 2>/dev/null; then marked=1; fi
    if [ "$marked" -eq 0 ]; then
      note "✗ $f: superseded-register — effort 票已全部终态（done/out_of_scope），spec.md 仍无 superseded-by 注记且未归档（按五类归宿分流后补标或归档）"
      unmarked=$((unmarked + 1))
    fi
  done < "$TMP/meta.tsv"
  [ "$unmarked" -eq 0 ] && note "✓ 无"
  findings=$((findings + unmarked))
  echo

  # ── 6. .plan 根层白名单 ───────────────────────────────────────────────────
  # 判据正本 = plan-protocol §三「全局件」条（2026-09-29 拍板）：.plan/ 只放
  # 全局件封闭三件套——根层审批档（文件，不归本查）+ qa/ + ledger/。清单外
  # 子目录即报；豁免：handoffs（存量历史轮快照）、含 map.md 的子目录（存量
  # 旧布局 effort，只读兼容，迁移归存量批次）。仅当本遍历目录名为 .plan 时生效。
  case "${PD##*/}" in .plan)
    echo "[6] .plan 根层白名单（全局件封闭清单：qa/ ledger/；豁免 handoffs 与含 map.md 的存量 effort 目录）"
    stray=0
    for d in "$PD"/*/; do
      [ -d "$d" ] || continue
      name=$(basename "$d")
      case "$name" in
        qa|ledger|handoffs|assets|node_modules) continue ;;
      esac
      [ -f "${d}map.md" ] && continue
      stray=$((stray + 1))
      note "✗ ${d}: plan-root-whitelist — .plan/ 根层清单外子目录「${name}」（调研/复盘落 docs/research/，一次性交接落 .tmp/，tracker 类落 .scratch/<slug>/）"
    done
    [ "$stray" -eq 0 ] && note "✓ 无"
    findings=$((findings + stray))
    echo
    ;;
  esac

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

if [ "$TOTAL_FINDINGS" -eq 0 ]; then
  echo "plan-lint: ✓ 合计 $TOTAL_FILES 个 markdown，未发现漂移"
  exit 0
fi
echo "plan-lint: ✗ 合计 $TOTAL_FINDINGS 项发现（$TOTAL_FILES 个 markdown；只读报告，未改动任何文件）"
exit 1

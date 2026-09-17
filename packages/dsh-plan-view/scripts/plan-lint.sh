#!/usr/bin/env bash
# plan-lint —— 只读校验 .plan/ 的文档状态协议。
#
# 抓三类本次真实发生过的漂移：
#   1. 同票双档：同一个票 id 在两个目录各有一份，且副本没标 superseded-by
#      （S1 事故：tickets/S1.md 标 done，impl-fe/S1.md 还挂 todo）
#   2. effort 有票无 map：目录里有 tickets/ 却没有 map.md → 整个 effort
#      不被 plan 视图加载（state-machine/ 的 14 张票就这样不可见）
#   3. .plan 根目录的待拍板类文档缺 frontmatter、缺 status，或 status 不在词表内
#      （W5 与两份 dsh-ai-backend 材料即此）
#
# 只读，不改任何文件。用法：
#   bash scripts/plan-lint.sh [.plan 目录]      # 省略时自动找 ./.plan 或 ../.plan
# 退出码：0=无发现，1=有发现，2=用法错误。
#
# 兼容 bash 3.2（macOS 自带版没有关联数组），故只用 sort/awk/uniq 等通用工具。

set -uo pipefail

PLAN_DIR="${1:-}"
if [ -z "$PLAN_DIR" ]; then
  if [ -d ".plan" ]; then PLAN_DIR=".plan"
  elif [ -d "../.plan" ]; then PLAN_DIR="../.plan"
  else echo "用法: bash scripts/plan-lint.sh <path-to-.plan>" >&2; exit 2
  fi
fi
[ -d "$PLAN_DIR" ] || { echo "错误: 找不到目录 $PLAN_DIR" >&2; exit 2; }

findings=0
note() { printf '  %s\n' "$*"; }

# 取某文件的 status 值（frontmatter 内首个小节）
status_of() {
  awk '/^---$/{n++;next} n==1 && /^status:/{sub(/^status:[ \t]*/,""); print; exit}' "$1"
}

# 合法状态词表：覆盖两套约定（wayfinder 用正文小节、不写 status，故不在此列；
# 这里只管「写了 status 的」那一份）。superseded-by:<path> 单独前缀匹配。
LEGAL_STATUS='done|closed|resolved|complete|completed|shipped|open|todo|doing|in_progress|in-progress|wip|claimed|review|ready-for-agent|pending|active|confirmed|blocked|abandoned|rejected|wontfix|cancelled|canceled'

echo "plan-lint: 校验 $PLAN_DIR"
echo

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

# 全量清单：basename<TAB>path（供第 1、2 节复用）
find "$PLAN_DIR" -name '*.md' -not -path '*/.archive/*' -print | sort > "$TMP/files.txt"

# ── 1. 同票双档 ──────────────────────────────────────────────────────────────
echo "[1] 同票双档（同一票 id 多处落点，且多于一处未标 superseded-by）"
# 只把「票一样的名字」算双档：排除各 effort 都会有的通用文件名
# （map/spec/README 等天然同名，不是同一张票的两个副本）。
while IFS= read -r f; do printf '%s\t%s\n' "$(basename "$f" .md)" "$f"; done < "$TMP/files.txt" \
  | grep -vE '^(map|spec|tech-spec|fe-v1-spec|README|index|plan|CONTEXT)(\.md)?\t' > "$TMP/all.tsv"
cut -f1 "$TMP/all.tsv" | sort | uniq -d > "$TMP/dupes.txt"

dupe=0
if [ -s "$TMP/dupes.txt" ]; then
  while IFS= read -r base; do
    awk -F'\t' -v b="$base" '$1==b{print $2}' "$TMP/all.tsv" > "$TMP/paths.txt"
    npath=$(wc -l < "$TMP/paths.txt" | tr -d ' ')
    nstray=0
    while IFS= read -r p; do
      st=$(status_of "$p")
      case "$st" in superseded-by*) ;; *) nstray=$((nstray + 1)) ;; esac
    done < "$TMP/paths.txt"
    # 权威只应有一个落点：多于一处未标副本才算漂移
    if [ "$nstray" -gt 1 ]; then
      dupe=$((dupe + 1))
      note "✗ 「${base}」有 ${npath} 处落点，其中 ${nstray} 处未标 superseded-by："
      while IFS= read -r p; do note "      $p"; done < "$TMP/paths.txt"
    fi
  done < "$TMP/dupes.txt"
fi
[ "$dupe" -eq 0 ] && note "✓ 无"
findings=$((findings + dupe))
echo

# ── 2. effort 有 tickets/ 却无 map.md ────────────────────────────────────────
echo "[2] effort 有 tickets/ 却缺 map.md（该 effort 不会被 plan 视图加载）"
: > "$TMP/nomap.txt"
while IFS= read -r td; do
  d=$(dirname "$td")
  if [ ! -f "$d/map.md" ]; then
    n=$(find "$td" -name '*.md' | wc -l | tr -d ' ')
    printf '%s\t%s\n' "$n" "$d" >> "$TMP/nomap.txt"
  fi
done < <(find "$PLAN_DIR" -type d -name tickets -not -path '*/.archive/*' -print | sort)

missing=0
if [ -s "$TMP/nomap.txt" ]; then
  while IFS=$'\t' read -r n d; do
    note "✗ $d/ 有 tickets/（$n 张票）但无 map.md → 整目录不可见"
    missing=$((missing + 1))
  done < "$TMP/nomap.txt"
fi
[ "$missing" -eq 0 ] && note "✓ 无"
findings=$((findings + missing))
echo

# ── 3. .plan 根目录文档的状态头 ──────────────────────────────────────────────
echo "[3] .plan 根目录文档缺 frontmatter / 缺 status / status 非法"
bad=0
while IFS= read -r f; do
  first=$(head -1 "$f")
  if [ "$first" != "---" ]; then
    note "✗ 无 frontmatter: $f"; bad=$((bad + 1)); continue
  fi
  st=$(status_of "$f")
  if [ -z "$st" ]; then
    note "✗ 有 frontmatter 但无 status: $f"; bad=$((bad + 1)); continue
  fi
  case "$st" in
    superseded-by*) : ;;
    *) if ! printf '%s' "$st" | grep -qE "^($LEGAL_STATUS)$"; then
         note "✗ status 不在词表内（$st）: $f"; bad=$((bad + 1))
       fi ;;
  esac
done < <(find "$PLAN_DIR" -maxdepth 1 -name '*.md' -type f -print | sort)
[ "$bad" -eq 0 ] && note "✓ 无"
findings=$((findings + bad))
echo

# ── 汇总 ─────────────────────────────────────────────────────────────────────
if [ "$findings" -eq 0 ]; then
  echo "plan-lint: ✓ 未发现漂移"
  exit 0
fi
echo "plan-lint: ✗ 共 $findings 项发现（只读报告，未改动任何文件）"
exit 1

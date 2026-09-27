#!/usr/bin/env bash
# Install plan-view skills into the DSH agent-presets install state.
# Called by postinstall or manually: bash scripts/install-skills.sh
#
# Destination is ~/.dsh/.agent-presets/full/skills (ticket 04): the live install
# state that ~/.zcode/skills symlinks point at. The old ~/.dsh/skills target was
# a dead directory — installs went nowhere. Backfill check (ticket 04): no DSH
# process repopulates agent-presets; this script (or manual copy) is the only
# sync path, so installing here is final.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SKILLS_SRC="$SCRIPT_DIR/../skills"
SKILLS_DST="${SKILLS_DST:-$HOME/.dsh/.agent-presets/full/skills}"

if [ ! -d "$SKILLS_SRC" ]; then
  echo "Error: skills directory not found at $SKILLS_SRC" >&2
  exit 1
fi

mkdir -p "$SKILLS_DST"

# Validate every SKILL.md frontmatter before installing. Two silent-failure modes
# have bitten this directory: an unquoted colon inside `description` makes the YAML
# unparseable (the loader logs "invalid YAML frontmatter" and drops the skill), and a
# restrictive file mode (0600) hides it from the scanner. Either way the skill
# installs and then simply never appears — so fail loudly here instead.
validate_skill() {
  local file="$1"
  python3 - "$file" <<'PY' || return 1
import re, sys
path = sys.argv[1]
raw = open(path, encoding='utf-8').read()
lines = raw.split('\n')
if lines[0] != '---':
    sys.exit(f'{path}: frontmatter must start on line 1 with ---')
try:
    close = lines.index('---', 1)
except ValueError:
    sys.exit(f'{path}: frontmatter is never closed with ---')
block = lines[1:close]
for line in block:
    if line.startswith('name:') or line.startswith('description:'):
        value = line.split(':', 1)[1]
        # A colon followed by a space inside an unquoted scalar starts a nested
        # mapping in YAML and aborts the parse.
        if re.search(r':\s', value):
            sys.exit(f'{path}: unquoted colon in "{line.split(":",1)[0]}" breaks YAML — quote the value or drop the colon')
for key in ('name', 'description'):
    if not any(l.startswith(f'{key}:') for l in block):
        sys.exit(f'{path}: frontmatter requires {key}')
PY
}

# Copy every skill shipped in skills/ (glob, so a new skill directory installs
# without editing this script). skill_id defaults to the source dir name; the
# case below only overrides where the installed id differs from it.
for src in "$SKILLS_SRC"/*/; do
  skill="$(basename "$src")"
  case "$skill" in
    grill-me)        skill_id="mp-grill-me" ;;
    grilling)        skill_id="mp-grilling" ;;
    to-approval)     skill_id="mp-to-approval" ;;
    plan-approve)    skill_id="mp-plan-approve" ;;
    plan-sync)       skill_id="mp-plan-sync" ;;
    plan-archive)    skill_id="mp-plan-archive" ;;
    plan-protocol)   skill_id="mp-plan-protocol" ;;
    diagnosing-bugs) skill_id="mp-diagnosing-bugs" ;;
    grill-with-docs) skill_id="mp-grill-with-docs" ;;
    improve-codebase-architecture) skill_id="mp-improve-codebase-architecture" ;;
    to-tickets)      skill_id="mp-to-tickets" ;;
    implement)       skill_id="mp-implement" ;;
    implement-spec)  skill_id="mp-implement-spec" ;;
    to-spec)         skill_id="mp-to-spec" ;;
    *)               skill_id="$skill" ;;
  esac
  if [ -f "$SKILLS_SRC/$skill/SKILL.md" ]; then
    validate_skill "$SKILLS_SRC/$skill/SKILL.md" || { echo "Error: refusing to install $skill (invalid SKILL.md)" >&2; exit 1; }
  fi
  rm -rf "$SKILLS_DST/$skill_id"
  cp -R "$SKILLS_SRC/$skill" "$SKILLS_DST/$skill_id"
  # cp -R preserves the source file mode; a SKILL.md written with a restrictive
  # umask (0600) is silently skipped by the skill loader — the skill installs but
  # never appears in the catalog. Force world-readable so loading cannot depend
  # on how the file happened to be created.
  chmod -R a+rX "$SKILLS_DST/$skill_id"
  echo "Installed: $skill -> $SKILLS_DST/$skill_id"
done

# Inject the plan-lint gate into every installed plan-family skill that runs it
# (ticket 03: plan-lint ships with the skill so any repo can run it; the script's
# single source copy lives at skills/plan-approve/scripts/plan-lint.sh).
# 2026-09-24 拍板：收口动作（approve/sync/qa 执行/缺陷诊断/implement*）收尾都要过
# lint，注入面扩到 diagnosing-bugs 与 run-qa-testcases；mp-implement /
# mp-implement-spec 无源仓正本（安装态直改），脚本注入按目录存在条件执行。
PLAN_LINT_SRC="$SKILLS_SRC/plan-approve/scripts/plan-lint.sh"
for skill_id in mp-plan-approve mp-plan-sync mp-diagnosing-bugs run-qa-testcases mp-implement mp-implement-spec plan-loop; do
  if [ -d "$SKILLS_DST/$skill_id" ] && [ -f "$PLAN_LINT_SRC" ]; then
    mkdir -p "$SKILLS_DST/$skill_id/scripts"
    cp "$PLAN_LINT_SRC" "$SKILLS_DST/$skill_id/scripts/plan-lint.sh"
    chmod a+rX "$SKILLS_DST/$skill_id/scripts/plan-lint.sh"
    echo "Injected: plan-lint.sh -> $SKILLS_DST/$skill_id/scripts/"
  fi
done

# Copy optional skills — seeded once, then left alone.
#
# These are upstream skills the user may have customized in place, so a re-copy
# would destroy local edits; they install only when the target is absent. Skills
# this repo owns the source of truth for (implement / implement-spec / to-spec,
# which carry project-specific rules) live in the main `skills/` loop above and
# are re-synced on every install — do not move them back here.
for skill in $(ls "$SKILLS_SRC/.optional/" 2>/dev/null); do
  skill_id="mp-$(echo "$skill" | sed 's/-//g')"
  if [ ! -d "$SKILLS_DST/$skill_id" ]; then
    cp -R "$SKILLS_SRC/.optional/$skill" "$SKILLS_DST/$skill_id"
    chmod -R a+rX "$SKILLS_DST/$skill_id"
    echo "Installed (optional): $skill -> $SKILLS_DST/$skill_id"
  fi
done

# Post-install self-check (ticket 04): the plan gate must exist in the install
# state, otherwise plan-approve/plan-sync step 1 is a dangling reference again.
# 只断言有源仓正本、由本脚本管理的 skill。
for skill_id in mp-plan-approve mp-plan-sync mp-diagnosing-bugs run-qa-testcases plan-loop mp-implement mp-implement-spec; do
  if [ ! -f "$SKILLS_DST/$skill_id/scripts/plan-lint.sh" ]; then
    echo "Error: $SKILLS_DST/$skill_id/scripts/plan-lint.sh missing after install" >&2
    exit 1
  fi
done
echo "Self-check: plan-lint.sh present in mp-plan-approve, mp-plan-sync, mp-diagnosing-bugs, run-qa-testcases, plan-loop, mp-implement, mp-implement-spec."

# 必装 skill 自检：implement / implement-spec / to-spec 已从 .optional/ 移入主
# 循环，属「后续 install 必须安装」——缺任一即安装失败（不再是可选的播种项）。
for skill_id in mp-implement mp-implement-spec mp-to-spec; do
  if [ ! -f "$SKILLS_DST/$skill_id/SKILL.md" ]; then
    echo "Error: $SKILLS_DST/$skill_id/SKILL.md missing after install" >&2
    exit 1
  fi
done
echo "Self-check: required skills present (mp-implement, mp-implement-spec, mp-to-spec)."

echo "Done. Skills installed to $SKILLS_DST"

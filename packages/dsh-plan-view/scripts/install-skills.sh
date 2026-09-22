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
SKILLS_DST="$HOME/.dsh/.agent-presets/full/skills"

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

# Copy main skills (wayfinder-maps, grill-me, research, prototype, domain-modeling, to-approval, plan-approve, plan-sync, to-qa-testcases, run-qa-testcases)
for skill in wayfinder-maps grill-me research prototype domain-modeling to-approval plan-approve plan-sync to-qa-testcases run-qa-testcases; do
  if [ -d "$SKILLS_SRC/$skill" ]; then
    if [ -f "$SKILLS_SRC/$skill/SKILL.md" ]; then
      validate_skill "$SKILLS_SRC/$skill/SKILL.md" || { echo "Error: refusing to install $skill (invalid SKILL.md)" >&2; exit 1; }
    fi
    case "$skill" in
      grill-me)       skill_id="grilling" ;;
      research)       skill_id="research" ;;
      prototype)      skill_id="prototype" ;;
      domain-modeling) skill_id="domain-modeling" ;;
      wayfinder-maps) skill_id="wayfinder" ;;
      to-approval)    skill_id="mp-to-approval" ;;
      plan-approve)   skill_id="mp-plan-approve" ;;
      plan-sync)      skill_id="mp-plan-sync" ;;
      to-qa-testcases)  skill_id="to-qa-testcases" ;;
      run-qa-testcases) skill_id="run-qa-testcases" ;;
    esac
    rm -rf "$SKILLS_DST/$skill_id"
    cp -R "$SKILLS_SRC/$skill" "$SKILLS_DST/$skill_id"
    # cp -R preserves the source file mode; a SKILL.md written with a restrictive
    # umask (0600) is silently skipped by the skill loader — the skill installs but
    # never appears in the catalog. Force world-readable so loading cannot depend
    # on how the file happened to be created.
    chmod -R a+rX "$SKILLS_DST/$skill_id"
    echo "Installed: $skill -> $SKILLS_DST/$skill_id"
  fi
done

# Inject the plan-lint gate into every installed plan-family skill that runs it
# (ticket 03: plan-lint ships with the skill so any repo can run it; the script's
# single source copy lives at skills/plan-approve/scripts/plan-lint.sh).
PLAN_LINT_SRC="$SKILLS_SRC/plan-approve/scripts/plan-lint.sh"
for skill_id in mp-plan-approve mp-plan-sync; do
  if [ -d "$SKILLS_DST/$skill_id" ] && [ -f "$PLAN_LINT_SRC" ]; then
    mkdir -p "$SKILLS_DST/$skill_id/scripts"
    cp "$PLAN_LINT_SRC" "$SKILLS_DST/$skill_id/scripts/plan-lint.sh"
    chmod a+rX "$SKILLS_DST/$skill_id/scripts/plan-lint.sh"
    echo "Injected: plan-lint.sh -> $SKILLS_DST/$skill_id/scripts/"
  fi
done

# Copy optional skills (only if they don't already exist)
for skill in $(ls "$SKILLS_SRC/.optional/" 2>/dev/null); do
  skill_id=$(echo "$skill" | sed 's/-//g')
  if [ ! -d "$SKILLS_DST/$skill_id" ]; then
    cp -R "$SKILLS_SRC/.optional/$skill" "$SKILLS_DST/$skill_id"
    chmod -R a+rX "$SKILLS_DST/$skill_id"
    echo "Installed (optional): $skill -> $SKILLS_DST/$skill_id"
  fi
done

# Post-install self-check (ticket 04): the plan gate must exist in the install
# state, otherwise plan-approve/plan-sync step 1 is a dangling reference again.
for skill_id in mp-plan-approve mp-plan-sync; do
  if [ ! -f "$SKILLS_DST/$skill_id/scripts/plan-lint.sh" ]; then
    echo "Error: $SKILLS_DST/$skill_id/scripts/plan-lint.sh missing after install" >&2
    exit 1
  fi
done
echo "Self-check: plan-lint.sh present in mp-plan-approve and mp-plan-sync."

echo "Done. Skills installed to $SKILLS_DST"

#!/usr/bin/env bash
# Install wayfinder-maps skills into ~/.dsh/skills/
# Called by postinstall or manually: bash scripts/install-skills.sh

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SKILLS_SRC="$SCRIPT_DIR/../skills"
SKILLS_DST="$HOME/.dsh/skills"

if [ ! -d "$SKILLS_SRC" ]; then
  echo "Error: skills directory not found at $SKILLS_SRC" >&2
  exit 1
fi

mkdir -p "$SKILLS_DST"

# Copy main skills (wayfinder-maps, grill-me, research, prototype, domain-modeling)
for skill in wayfinder-maps grill-me research prototype domain-modeling; do
  if [ -d "$SKILLS_SRC/$skill" ]; then
    case "$skill" in
      grill-me)       skill_id="grilling" ;;
      research)       skill_id="research" ;;
      prototype)      skill_id="prototype" ;;
      domain-modeling) skill_id="domain-modeling" ;;
      wayfinder-maps) skill_id="wayfinder" ;;
    esac
    rm -rf "$SKILLS_DST/$skill_id"
    cp -R "$SKILLS_SRC/$skill" "$SKILLS_DST/$skill_id"
    echo "Installed: $skill -> $SKILLS_DST/$skill_id"
  fi
done

# Copy optional skills (only if they don't already exist)
for skill in $(ls "$SKILLS_SRC/.optional/" 2>/dev/null); do
  skill_id=$(echo "$skill" | sed 's/-//g')
  if [ ! -d "$SKILLS_DST/$skill_id" ]; then
    cp -R "$SKILLS_SRC/.optional/$skill" "$SKILLS_DST/$skill_id"
    echo "Installed (optional): $skill -> $SKILLS_DST/$skill_id"
  fi
done

echo "Done. Skills installed to $SKILLS_DST"

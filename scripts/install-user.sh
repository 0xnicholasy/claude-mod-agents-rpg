#!/bin/sh
# Install the agents-office mod user-wide: symlink
# ${CLAUDE_CONFIG_DIR:-$HOME/.claude}/skills/agents-office to this checkout's mod folder.
# Then make sure the renderer's playwright dependency and Chromium are installed
# (npm ci when node_modules/playwright is missing, then `npx playwright install chromium`).
# Usage: install-user.sh [--force] [--no-chromium]
set -eu

force=0
chromium=1
for arg in "$@"; do
  case "$arg" in
    --force) force=1 ;;
    --no-chromium) chromium=0 ;;
    *) echo "install:user: unknown argument: $arg (only --force and --no-chromium are accepted)" >&2; exit 2 ;;
  esac
done

repo=$(cd "$(dirname "$0")/.." && pwd -P)
src="$repo/.claude/skills/agents-office"
config="${CLAUDE_CONFIG_DIR:-${HOME:-}/.claude}"
if [ -z "$config" ] || [ "$config" = "/.claude" ]; then
  echo "install:user: set CLAUDE_CONFIG_DIR or HOME" >&2
  exit 1
fi
case "$config" in
  /*) ;;
  *) echo "install:user: config dir must be an absolute path: $config" >&2; exit 1 ;;
esac
dest="$config/skills/agents-office"

if [ ! -d "$src" ]; then
  echo "install:user: mod folder not found: $src" >&2
  exit 1
fi

link_needed=1
replaced=""
if [ -L "$dest" ]; then
  current=$(readlink "$dest")
  if [ "$current" = "$src" ]; then
    echo "install:user: link already in place: $dest -> $src (nothing changed)"
    link_needed=0
  fi
  if [ "$link_needed" -eq 1 ]; then
    if [ "$force" -ne 1 ]; then
      echo "install:user: $dest is a symlink to $current, not this repo. Re-run with --force to replace it." >&2
      exit 1
    fi
    replaced="symlink $dest -> $current"
  fi
elif [ -e "$dest" ]; then
  if [ "$force" -ne 1 ]; then
    echo "install:user: $dest exists and is not a symlink. Re-run with --force to replace it." >&2
    exit 1
  fi
  replaced="directory $dest"
fi

if [ "$link_needed" -eq 1 ]; then
  # Build the new link beside the old target first, so a failure never leaves nothing behind.
  mkdir -p "$config/skills"
  tmp="$dest.new.$$"
  ln -s "$src" "$tmp"
  if [ -n "$replaced" ]; then
    if [ -L "$dest" ]; then rm "$dest"; else rm -R "$dest"; fi
    echo "install:user: removed $replaced (--force)"
  fi
  mv "$tmp" "$dest"
  echo "install:user: linked $dest -> $src"
fi

# Chromium for the image office. A failure here never undoes the link; it is reported and
# reflected in the exit status. The browser cache (PLAYWRIGHT_BROWSERS_PATH, else the
# playwright default) is shared across checkouts.
if [ "$chromium" -eq 0 ]; then
  echo "install:user: skipped Chromium (--no-chromium); the office falls back to text until it is installed"
  exit 0
fi
if ! command -v npm >/dev/null 2>&1 || ! command -v npx >/dev/null 2>&1; then
  echo "install:user: npm/npx not found; Chromium not installed. Install node 20+, then re-run." >&2
  exit 1
fi
if [ ! -d "$repo/node_modules/playwright" ]; then
  echo "install:user: node_modules/playwright missing; running npm ci in $repo"
  if ! (cd "$repo" && npm ci); then
    echo "install:user: npm ci failed; Chromium not installed" >&2
    exit 1
  fi
else
  echo "install:user: node_modules/playwright present; skipped npm ci"
fi
echo "install:user: running npx playwright install chromium"
if ! (cd "$repo" && npx --no-install playwright install chromium); then
  echo "install:user: npx playwright install chromium failed; the link is in place" >&2
  exit 1
fi
echo "install:user: Chromium installed"

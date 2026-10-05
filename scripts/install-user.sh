#!/bin/sh
# Install the agents-office mod user-wide: symlink
# ${CLAUDE_CONFIG_DIR:-$HOME/.claude}/skills/agents-office to this checkout's mod folder.
# Usage: install-user.sh [--force]
set -eu

force=0
for arg in "$@"; do
  case "$arg" in
    --force) force=1 ;;
    *) echo "install:user: unknown argument: $arg (only --force is accepted)" >&2; exit 2 ;;
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

replaced=""
if [ -L "$dest" ]; then
  current=$(readlink "$dest")
  if [ "$current" = "$src" ]; then
    echo "install:user: already installed: $dest -> $src (nothing changed)"
    exit 0
  fi
  if [ "$force" -ne 1 ]; then
    echo "install:user: $dest is a symlink to $current, not this repo. Re-run with --force to replace it." >&2
    exit 1
  fi
  replaced="symlink $dest -> $current"
elif [ -e "$dest" ]; then
  if [ "$force" -ne 1 ]; then
    echo "install:user: $dest exists and is not a symlink. Re-run with --force to replace it." >&2
    exit 1
  fi
  replaced="directory $dest"
fi

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

#!/bin/sh
# Remove the user-wide agents-office symlink, only if it points at this checkout.
set -eu

repo=$(cd "$(dirname "$0")/.." && pwd -P)
src="$repo/.claude/skills/agents-office"
config="${CLAUDE_CONFIG_DIR:-${HOME:-}/.claude}"
if [ -z "$config" ] || [ "$config" = "/.claude" ]; then
  echo "uninstall:user: set CLAUDE_CONFIG_DIR or HOME" >&2
  exit 1
fi
dest="$config/skills/agents-office"

if [ -L "$dest" ]; then
  current=$(readlink "$dest")
  if [ "$current" = "$src" ]; then
    rm "$dest"
    echo "uninstall:user: removed $dest -> $src"
    exit 0
  fi
  echo "uninstall:user: $dest points at $current, not this repo (installed from another checkout?); left in place" >&2
  exit 1
fi
if [ -e "$dest" ]; then
  echo "uninstall:user: $dest is not a symlink; left in place" >&2
  exit 1
fi
echo "uninstall:user: nothing to remove ($dest does not exist)"

#!/bin/sh
# Remove the user-wide agents-office symlink, only if it points at this checkout.
# The Chromium download is left alone: the playwright browser cache is shared with other
# projects. Remove it by hand if you want the space back.
set -eu

repo=$(cd "$(dirname "$0")/.." && pwd -P)
src="$repo/.claude/skills/agents-office"
config="${CLAUDE_CONFIG_DIR:-${HOME:-}/.claude}"
if [ -z "$config" ] || [ "$config" = "/.claude" ]; then
  echo "uninstall:user: set CLAUDE_CONFIG_DIR or HOME" >&2
  exit 1
fi
dest="$config/skills/agents-office"

case "$(uname -s)" in
  Darwin) default_cache="${HOME:-}/Library/Caches/ms-playwright" ;;
  *) default_cache="${XDG_CACHE_HOME:-${HOME:-}/.cache}/ms-playwright" ;;
esac
if [ "${PLAYWRIGHT_BROWSERS_PATH:-}" = "0" ]; then
  cache="$repo/node_modules/playwright-core/.local-browsers"
else
  cache="${PLAYWRIGHT_BROWSERS_PATH:-$default_cache}"
fi
note_cache() {
  echo "uninstall:user: left the Chromium download in place: $cache (default location, or PLAYWRIGHT_BROWSERS_PATH if it was set at install; delete it by hand if unused)"
}

if [ -L "$dest" ]; then
  current=$(readlink "$dest")
  if [ "$current" = "$src" ]; then
    rm "$dest"
    echo "uninstall:user: removed $dest -> $src"
    note_cache
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
note_cache

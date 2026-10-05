// Shared durations in milliseconds, so code and tests agree on them.
export const TICK_MS = 100
export const BUBBLE_MS = 4000
export const DESPAWN_MS = 5000
export const LIST_MS = 10000
// Rows under the raster reserved for the T10 interaction log strip.
export const STRIP_ROWS = 5
// Strip rows while the map is still growing to FULL_ROWS.
export const STRIP_SMALL_ROWS = 2
// A resting agent toggles its work frame every this many ticks (D12).
export const WORK_FRAME_TICKS = 3
// The pad Input takes focus this long after the pane opens (spike S1b, D13).
export const PAD_FOCUS_MS = 1500
// A movement key stays fresh this long (D13).
export const INTENT_MS = 250
export const EMOTE_MS = 3000
// A chat line shows above its player this long (D23).
export const CHAT_MS = 5000
// A chat line is cut to this many code points (D23).
export const CHAT_MAX = 40
// The inspect line stays up this long (D16).
export const INSPECT_MS = 6000
export const PRESENCE_MS = 1000
export const HEARTBEAT_MS = 3000
// A presence file or heartbeat older than this drops its session (D18).
export const STALE_MS = 10000
// The office cat rests this long between walks (D24).
export const CAT_REST_MIN_MS = 5000
export const CAT_REST_MAX_MS = 15000

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

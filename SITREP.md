# SITREP: Reasoning & Exploration Fixes

## Current State: 2026-06-05

**Version:** v1.3.2
**Codex Compatibility:** v26.602.30954
**Patch Count:** 14/14 working (6 exact + 2 already-applied + 6 auto-healed)

## Changes in v1.3.2

1. **Deleted `no-layout-position`** — Codex removed `layout:"position"` from Framer Motion entirely. Dead code.
2. **Fixed `reasoning-no-animate-height` skeleton** — Variable renamed from `P` to `R`. Used `className:\`pb-0\`` anchor to uniquely match the reasoning accordion's framer-motion div (was matching 9 occurrences).
3. **Rewrote `reasoning-no-autocollapse`** — Old `if(!o){S(!1);return}` replaced by `()=>{o||S(!1)}` in useEffect callback. Patch now removes the `||S(!1)` call.
4. **Rewrote `thought-fade-disable-un`** — Old `function Un(...)` was refactored into loop-based `rr()` function. Fade conditional is now `if(!n){c.push(s)...}c.push(jsx('span',{fadeIn}...))`. Patch removes the fade branch, keeping only the non-fade push path.
5. **Fixed `verify-patches.js`** — Bug where `STRUCTURAL_REWRITE` was set prematurely for the first bundle file, preventing skeleton matches in subsequent files from being checked.

## Architecture

The tweak no longer contains or invokes an app-bundle patcher. Source-backed behavior
now follows the regular Codex++ shape:

- `index.js` owns the renderer settings page, live CSS, and the exploration fiber hook.
- `source-patcher.js` owns main-process source transformation with auto-healing skeletons.
- The main-process tweak wraps Electron's `protocol.handle("app", handler)` registration
  and patches matching JavaScript responses in memory.

## Source-Backed Features

The source patcher targets these Codex chunks:

- `split-items-into-render-groups-*.js` (show-reasoning, show-exploration-items, fix-assistant-order, file-edits-no-tool-group)
- `local-conversation-thread-*.js` (render-standalone-reasoning, reasoning-start-expanded, reasoning-no-autocollapse, reasoning-no-blink, reasoning-no-animate-height, auto-expand-exec, expand-tool-activity)
- `thinking-shimmer-*.js` (disable-shimmer)
- `markdown-*.js` (thought-fade-disable, thought-fade-disable-un)

## Auto-Healing

Each patch has a `skeleton` with a loose regex (`\w+` captures) that survives minified
variable renames. When the exact Tier-1 match fails, the skeleton auto-heals by:
1. Matching with captured variables
2. Regenerating the replacement text from captures
3. Verifying with a loose patched regex

This survives typical Codex updates (variable renames). Structural rewrites (code
reorganization) still require manual patch updates.

## Compatibility Model

Each source rule reports status per bundle file:
- `active` / `available` / `bundled_active` / `unsupported` / `mixed` / `healed_auto`

The renderer groups statuses by setting and shows warnings for unsupported rules.

## Files

```text
manifest.json
index.js
source-patcher.js
scripts/verify-patches.js
README.md
SITREP.md
handoff/HANDOFF-2026-06-05.md
```

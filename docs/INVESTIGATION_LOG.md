# Investigation Log: Active Reasoning Text Shimmer

## Branch: fix/shimmer-active-thinking

### Attempt 1: Disable `fadeType: "indexed"` via source patch

**What we tried:** Added a new PATCHES rule `shimmer-no-fade-in` in `source-patcher.js` that
changes `fadeType:o?\`indexed\`:\`none\`` → `fadeType:\`none\`` in the composer chunk.

This was triggered under the existing `disable-shimmer` setting.

**Reasoning:** The reasoning item renderer (`XM` function in `composer-CNnjHdHK.js`) passes
`fadeType: o ? \`indexed\` : \`none\`` to the markdown renderer (`Xt`), where `o` is
`!n.completed` (true while streaming). When `"indexed"`, the markdown renderer does two things:
1. Adds a CSS class that triggers `_fade-in_7mcvb_1` keyframes on each new markdown element
   (paragraphs, headings, code blocks, etc.) — 0.2s fade from opacity 0 → 1.
2. Wraps individual words with per-word staggered animation via `DLe`/`ILe` handlers.

**Result:** The shimmer was still present. The patch either:
- Didn't apply (timing issue with protocol handler registration)
- Targeted the wrong code path (the shimmer comes from somewhere else)
- The `fadeType` change had partial effect but the main visual shimmer is from a different source

**Reverted:** Yes. Branch preserved for reference.

### Next steps:
- Investigate the `loading-shimmer-pure-text` class applied when `r.status === "active"`
- Look for CSS animations in `index-DJG96UDN.css` that target reasoning content
- Consider inspecting the running Codex DOM

## Branch: fix/codex_update_26.519.22136

### Attempt 1: Fix 4 broken patches after Codex v26.519.22136 update

**What we tried:** Identified that Codex now ships TWO route variants of each bundle
(app-main route and remote-conversation route) with different minified variable names.
Applied 3 regex fixes:

1. **reasoning-start-expanded**: Changed `\$` → `[$\w]` to match both `$.useState` (new
   route) and `Q.useState` (old route).
2. **reasoning-no-animate-height**: Changed `Po` → `\w+` to match both `Po` (new route)
   and `ha` (old route) transition variables.
3. **fix-assistant-order**: Changed `Xe` → `\w{2}` to match both `Xe` (new route) and
   `me` (old route) function names.

**Result:** 27/28 patch-bundle combinations verified OK. The only expected failure is
`reasoning-no-blink-fade` on the old-route thread bundle (BEJL-MdX.js) which doesn't
use `fadeType` at all — it passes `isStreaming` directly instead.

**Status:** Committed and deployed. Ready for testing.

# Reasoning & Exploration Fixes

A [Codex++](https://github.com/b-nnett/codex-plusplus) tweak that improves the
conversation UI in Codex Desktop by fixing two issues with the exploration
accordion and reasoning item display.

## Features

| Feature | Mechanism | Description |
|---|---|---|
| **prevent-collapse** | React fiber hook (codex++ API) | Keeps the exploration accordion expanded after Codex finishes exploring files — no more auto-collapsing to zero height. |
| **show-reasoning** | ASAR binary patch | Prevents "Thinking…" / "Thought for Xs" items from being silently hidden inside the exploration accordion. Reasoning items now render as standalone turn items with the proper `YM` reasoning component. |
| **reasoning-no-autocollapse** | ASAR binary patch | Stops the reasoning output panel from collapsing when thinking completes — the content stays visible. |

## How it works

### prevent-collapse (fiber-based)

Uses the codex++ `api.react.getFiber()` API to walk React's fiber tree from
the exploration accordion DOM element upward. It finds the `useState` hook
that controls the panel state (preview / expanded / collapsed) and wraps
the dispatch function to intercept any `"collapsed"` value, rewriting it
to `"preview"`.

### show-reasoning (ASAR patch)

The original Codex bundle groups turn items into "render groups" via the
`split-items-into-render-groups` chunk. Reasoning items were being pushed
into the exploration buffer alongside `exec` commands. Inside the exploration
accordion, the sub-item renderer (`AO` function) filters out all non-`exec`
items with `if (e.type !== 'exec') return null;` — so reasoning silently
disappeared.

The patch changes the render-group builder (`at()` function) so that
reasoning items flush the exploration buffer first and render as standalone
turn items instead. The turn-level renderer already has a `case 'reasoning': <YM>`
handler (imported from `reasoning-minimal-*.js`), so reasoning now renders
properly.

## Installation

```bash
# Clone into Codex++ tweaks directory
git clone https://github.com/shivam2014/codex-plusplus-reasoning-fixes.git \
  ~/Library/Application\ Support/codex-plusplus/tweaks/co.shivam94.reasoning-fixes

# Then enable features from Settings → Codex Plus Plus → Tweaks
```

Or use the codex++ CLI:

```bash
codexplusplus tweaks install co.shivam94.reasoning-fixes
```

For the ASAR-patched features (`show-reasoning`, `reasoning-no-autocollapse`),
toggle them in the settings page — the tweak applies the patches via its
main-process IPC handler and re-signs the app.

## Acknowledgments

- **Codex++** ([b-nnett/codex-plusplus](https://github.com/b-nnett/codex-plusplus)) —
  The tweak runtime and React fiber introspection API that makes the
  prevent-collapse feature possible.
- **Original patch** ([andrew-kramer-inno's gist](https://gist.github.com/andrew-kramer-inno/3fa1063b967cfad2bc6f7cd9af1249fd)) —
  The inspiration for the ASAR patching approach and the 5-patch strategy
  that this project builds on and adapts to the current Codex bundle structure.

## Files

```
co.shivam94.reasoning-fixes/
├── manifest.json          # Codex++ tweak manifest
├── index.js               # Main tweak source (codex++ format)
└── patch_codex_app_asar.py  # Standalone ASAR patching script
```

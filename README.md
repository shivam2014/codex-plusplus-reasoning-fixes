# Reasoning & Exploration Fixes

A [Codex++](https://github.com/b-nnett/codex-plusplus) tweak that improves the
conversation UI in Codex Desktop using in-memory source patching — no ASAR
modification, codesigning, or app bundle changes needed.

## Settings

The tweak adds a settings page with two sections:

### Exploration

| Option | Default | Effect |
|---|---|---|
| **Keep accordion open** | ON | Exploration panel stays expanded after Codex finishes searching. Uses a React fiber hook — no reload needed. |

### Reasoning

| Option | Default | Effect |
|---|---|---|
| **Show in conversation** | ON | Source-backed. Thinking steps and reasoning items render as standalone conversation items instead of being hidden inside the exploration accordion. |
| **Content display** | Expanded | Live CSS. **Expanded** removes the scroll box so the full text is visible. **Scroll** re-adds Codex's compact scroll box. |

## How it works

### Source patcher (main process)

The tweak wraps Electron's `protocol.handle("app")` handler to intercept Codex's
JavaScript chunks as they're served to the renderer. Matching chunks are
transformed in memory using regex replacements — no ASAR extraction, no
`codesign`, no backup/restore.

Current source-backed rules:
- Render reasoning outside the exploration buffer
- Keep reasoning items expanded after thinking completes
- Start reasoning items expanded
- Keep the agent item body expanded above the assistant response

If a Codex update changes a minified chunk enough that a rule no longer matches,
the relevant toggle shows a compatibility warning.

### Fiber hook (renderer, live)

`exploration-keep-open` uses `api.react.getFiber()` to walk React's fiber tree
from the exploration accordion DOM element upward, find the `useState` hook
controlling panel state, and intercept `"collapsed"` dispatches by rewriting
them to `"preview"`.

### CSS injection (renderer, live)

The reasoning content display toggle injects or removes a `<style>` element
that constrains the reasoning body height. Expanded mode removes the constraint;
Scroll mode adds `max-height: 140px; overflow-y: auto` via CSS.

## Installation

Clone into the Codex++ tweaks directory:

```bash
git clone https://github.com/shivam2014/codex-plusplus-reasoning-fixes.git \
  ~/Library/Application\ Support/codex-plusplus/tweaks/co.shivam94.reasoning-fixes
```

Restart Codex. No ASAR patching or codesigning needed.

## Files

```
co.shivam94.reasoning-fixes/
├── manifest.json       # Codex++ tweak manifest
├── index.js            # Renderer settings UI, fiber hook, CSS injection
└── source-patcher.js   # Main-process in-memory source transformer
```

## Acknowledgments

- **Codex++** ([b-nnett/codex-plusplus](https://github.com/b-nnett/codex-plusplus)) —
  Tweak runtime, settings injection, IPC, and React fiber introspection API.
- **Original patch** ([andrew-kramer-inno's gist](https://gist.github.com/andrew-kramer-inno/3fa1063b967cfad2bc6f7cd9af1249fd)) —
  Inspiration for the source transformations.
- **Alex Naidis** ([TheCrazyLex](https://github.com/TheCrazyLex)) —
  In-memory protocol-level source patching architecture.

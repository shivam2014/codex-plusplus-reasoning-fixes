# Reasoning & Exploration Fixes

A [Codex++](https://github.com/b-nnett/codex-plusplus) tweak that improves the
conversation UI in Codex Desktop.

## Settings

The tweak adds a settings page with three sections:

### Exploration

| Option | Default | Effect |
|---|---|---|
| **Keep accordion open** | ON | Exploration panel stays expanded after Codex finishes searching and reading files. Uses React fiber hook — no restart needed. |

### Reasoning

| Option | Default | Effect |
|---|---|---|
| **Show in conversation** | ON | Thinking steps and reasoning items appear in the conversation log. When off, they're hidden inside the exploration accordion. Requires ASAR patch. |
| **Content display** | Scroll | **Scroll**: reasoning text fits in a compact box with vertical scrolling. **Expanded**: no height limit, full text visible without scrolling. Requires ASAR patch. |

### Tool Outputs

| Option | Default | Effect |
|---|---|---|
| **Show in conversation** | OFF | Tool call outputs (command results, file contents, search results) stay visible after execution instead of collapsing. Requires ASAR patch. |

## How it works

### prevent-collapse (fiber-based)

Uses the codex++ `api.react.getFiber()` API to walk React's fiber tree from
the exploration accordion DOM element upward. It finds the `useState` hook
that controls the panel state (preview / expanded / collapsed) and wraps
the dispatch function to intercept any `"collapsed"` value, rewriting it
to `"preview"`.

### show-reasoning (ASAR patch)

The render-group builder in `split-items-into-render-groups` was pushing
reasoning items into the exploration buffer. Inside the exploration
accordion, the sub-item renderer (`AO`) filters out all non-`exec` items.
The patch makes reasoning items flush the exploration buffer and render as
standalone turn items instead — where the existing `YM` reasoning component
renders them properly.

### reasoning-full-expand (ASAR patch)

Removes the `max-h-35 overflow-y-auto` CSS constraint on the reasoning
content container so the full text is visible without internal scrolling.

### show-tool-outputs (ASAR patch)

Shell command outputs (inside `fj` component) start expanded so results
are visible without manual expansion.

## Installation

```bash
codexplusplus tweaks install co.shivam94.reasoning-fixes
```

Or clone directly:
```bash
git clone https://github.com/shivam2014/codex-plusplus-reasoning-fixes.git \
  ~/Library/Application\ Support/codex-plusplus/tweaks/co.shivam94.reasoning-fixes
```

## Files

```
co.shivam94.reasoning-fixes/
├── manifest.json              # Codex++ tweak manifest
├── index.js                   # Tweak source with settings UI
└── patch_codex_app_asar.py    # ASAR patching script
```

## Acknowledgments

- **Codex++** ([b-nnett/codex-plusplus](https://github.com/b-nnett/codex-plusplus)) —
  Tweak runtime and React fiber introspection API.
- **Original patch** ([andrew-kramer-inno's gist](https://gist.github.com/andrew-kramer-inno/3fa1063b967cfad2bc6f7cd9af1249fd)) —
  Inspiration for the ASAR patching approach.

### Keep agent body expanded

Prevents the agent items section (containing reasoning, tool calls, and exploration)
from auto-collapsing after the assistant response starts streaming. By default, Codex
collapses this section once the assistant begins responding — your reasoning and
tool outputs end up hidden behind a "N items" badge below the answer.

This patch keeps the agent body always expanded so reasoning stays visible above
the assistant response, where you'd expect to see it.

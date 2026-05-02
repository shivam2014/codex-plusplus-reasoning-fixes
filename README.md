# Reasoning & Exploration Fixes

A [Codex++](https://github.com/b-nnett/codex-plusplus) tweak that improves the
conversation UI in Codex Desktop.

## Settings

The tweak adds a settings page with three sections. All settings persist across
restarts via `api.storage`.

### Exploration

| Option | Default | Effect |
|---|---|---|
| **Keep accordion open** | ON | Exploration panel stays expanded after Codex finishes searching and reading files. Uses React fiber hook — no restart needed. |

### Reasoning

| Option | Default | Effect |
|---|---|---|
| **Show in conversation** | ON | Thinking steps and reasoning items appear in the conversation log instead of being hidden inside the exploration accordion. Requires ASAR patch. |
| **Content display** | Expanded | **Expanded**: no height limit, full reasoning text visible without scrolling. **Scroll**: reasoning text fits in a compact box with vertical scrolling. The ASAR baseline is scroll-free (Expanded); Scroll mode injects the constraint at runtime via CSS. |

### Tool Outputs

| Option | Default | Effect |
|---|---|---|
| **Show in conversation** | OFF | Tool call outputs (command results, file contents, search results) stay visible after execution instead of collapsing. Requires ASAR patch. |

## How it works

### prevent-collapse (fiber-based, no restart)

Uses the codex++ `api.react.getFiber()` API to walk React's fiber tree from
the exploration accordion DOM element (`data-testid="exploration-accordion-body"`)
upward. It finds the `useState` hook controlling the panel state (preview /
expanded / collapsed) and wraps the dispatch function to intercept any
`"collapsed"` value, rewriting it to `"preview"`.

### keep-agent-expanded (ASAR patch)

The agent items section (containing reasoning, tool calls, and exploration)
auto-collapses after the assistant response starts streaming. By default, Codex
collapses this section once the assistant begins responding — reasoning and
tool outputs end up hidden behind a "N items" badge below the answer.

This patch keeps the agent body always expanded by setting the collapsed state
to `false` unconditionally in the render function (`at=!1`), so reasoning stays
visible above the assistant response.

### show-reasoning (ASAR patch)

The render-group builder in `split-items-into-render-groups` was pushing
reasoning items into the exploration buffer. Inside the exploration accordion,
the sub-item renderer filters out all non-`exec` items, which meant reasoning
items were silently dropped.

The patch makes reasoning items flush the exploration buffer and push as
standalone turn items instead — where the existing reasoning component renders
them properly.

### reasoning-no-autocollapse (ASAR patch)

When the model finishes thinking, the reasoning component's `useEffect` fires
and sets the expanded state to `false`, collapsing the content. The patch
removes the `setExpanded(false)` call in that effect (`S(!1)` → removed), so
reasoning content stays visible after completion.

### reasoning-full-expand (ASAR patch)

Removes the `max-h-35 overflow-y-auto` CSS constraint from the reasoning
content container, so the full text is visible without internal scrolling.
The Scroll/Expanded toggle in settings works by injecting CSS at runtime:
Expanded is the ASAR baseline; Scroll re-adds `max-height: 140px;
overflow-y: auto` via a `document.createElement("style")` injection.

### show-tool-outputs (ASAR patch)

Shell command outputs (inside the `fj` component) start expanded so results
are visible without manual expansion.

## Installation

```bash
codexplusplus tweaks install co.shivam94.reasoning-fixes
```

Or clone directly and symlink:

```bash
git clone https://github.com/shivam2014/codex-plusplus-reasoning-fixes.git \
  ~/Library/Application\ Support/codex-plusplus/tweaks/co.shivam94.reasoning-fixes
```

After cloning, run the ASAR patcher:

```bash
python3 ~/Library/Application\ Support/codex-plusplus/tweaks/co.shivam94.reasoning-fixes/patch_codex_app_asar.py
```

Then restart Codex.

## Files

```
co.shivam94.reasoning-fixes/
├── manifest.json              # Codex++ tweak manifest
├── index.js                   # Tweak source with settings UI and fiber hooks
└── patch_codex_app_asar.py    # ASAR patching script
```

## Patch inventory

| Patch | Mechanism | Restart needed |
|---|---|---|
| `prevent-collapse` | React fiber dispatch wrapper | No |
| `keep-agent-expanded` | ASAR — render function | Yes |
| `show-reasoning` | ASAR — split-items chunk | Yes |
| `reasoning-no-autocollapse` | ASAR — useEffect | Yes |
| `reasoning-full-expand` | ASAR — className strip | Yes |
| `show-tool-outputs` | ASAR — component | Yes |
| Content display toggle | CSS injection | No |

## Acknowledgments

- **Codex++** ([b-nnett/codex-plusplus](https://github.com/b-nnett/codex-plusplus)) —
  Tweak runtime and React fiber introspection API.
- **Original patch** ([andrew-kramer-inno's gist](https://gist.github.com/andrew-kramer-inno/3fa1063b967cfad2bc6f7cd9af1249fd)) —
  Inspiration for the ASAR patching approach.

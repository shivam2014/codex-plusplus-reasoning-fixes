# Reasoning & Exploration Fixes

A [Codex++](https://github.com/b-nnett/codex-plusplus) tweak that keeps
reasoning, exploration, file edits, and tool outputs visible in the conversation
— no app bundle modifications needed.

## Settings

All settings persist across restarts via Codex++ storage. Source-backed toggles
take effect on the next conversation. The settings page shows a warning near any
toggle whose source rule no longer matches the current Codex version — the
matcher is deliberately strict so failures are visible instead of silently wrong.

### Exploration

| Option | Default | Effect |
|---|---:|---|
| **Keep accordion open** | ON | Exploration panels stay expanded after Codex finishes searching. Uses a React fiber hook — no reload needed. |

### Reasoning

| Option | Default | Effect |
|---|---:|---|
| **Show reasoning** | ON | Thinking steps and reasoning items render as standalone conversation items. |
| **Reasoning display** | Expanded | Live CSS. **Expanded** removes the internal scroll box. **Scroll** restores the stock compact box. |
| **Disable thinking animation** | ON | Keeps the "Thinking" label steady instead of pulsing. Immediate CSS fallback; full effect after reload. |
| **Disable streaming pulse** | ON | Stops the color pulse on the reasoning text while it is actively streaming. Source-backed. |

### File Edits

| Option | Default | Effect |
|---|---:|---|
| **Show file edits in chat** | ON | File-edit cards stay as standalone chat items instead of being grouped into collapsed tool activity. |

### Tool Outputs

| Option | Default | Effect |
|---|---:|---|
| **Keep output visible** | OFF | Tool output sections stay visible in the conversation. |

## Architecture

### How a source-backed setting change flows

```
You toggle "Show reasoning" → ON
        │
        ▼
index.js (renderer process)
  ├─ writes feature:show-reasoning=true to Codex++ storage
  └─ calls ipc.invoke("source-patches-v1",
          { action: "set-feature", id: "show-reasoning", value: true })
        │
        ▼
source-patcher.js (main process)
  ├─ receives IPC in handleIpc()
  ├─ stores the feature flag
  ├─ schedules a Codex window reload in 150ms (debounced)
  └─ returns the current status so the settings page can
     update any warnings immediately
        │
        ▼
Codex window reloads
  │
  ├─ Renderer requests app://-/assets/composer-xxx.js
  │   │
  │   ▼
  │   protocol.handle("app") → wrapped handler (source-patcher.js)
  │     ├─ reads response.text()
  │     ├─ patchSource() runs each PATCHES rule for the "composer" bundle
  │     ├─ inspectRule() checks: does the source match the unpatched regex?
  │     │   • YES, 1 match → apply .replace(unpatched, replacement)
  │     │   • NO, but patched regex matches → already patched, skip
  │     │   • NO pattern matches → "unsupported", emit warning
  │     └─ returns new Response(patchedString)
  │
  ├─ Renderer also requests split-items-into-render-groups-xxx.js
  │   → same flow, applies the "show-reasoning" rule in that chunk
  │
  └─ Renderer receives modified JS → reasoning items now render
     as standalone conversation items, not hidden in exploration
```

### Live (no-reload) features

**Exploration keep-open** — walks React's internal fiber tree from
the accordion DOM element, finds the `useState` hook managing
collapsed/preview/expanded state, and wraps its dispatch function
so every `"collapsed"` call is rewritten to `"preview"`.

**Reasoning display** — injects or removes a `<style>` element that
overrides `max-h-35 overflow-y-auto` on the reasoning body container with
`max-height: none !important`.

## Source Patches

The main-process `source-patcher.js` wraps Electron's `protocol.handle("app")`
and transforms matching JavaScript chunks in memory as Codex serves them. No
ASAR extraction, repacking, or codesigning is involved.

### Current patch rules

| Rule | Target chunk | Effect |
|---|---|---|
| `show-reasoning` | split-items | Reasoning items pushed as standalone render items instead of into the exploration buffer |
| `render-standalone-reasoning` | composer | Reasoning items bypass the null-renderer branch and reach the default renderer |
| `reasoning-no-autocollapse` | composer | Removes the `setExpanded(false)` call when thinking finishes |
| `reasoning-start-expanded` | composer | Changes `useState(o)` → `useState(true)` so reasoning starts expanded |
| `reasoning-no-blink` | composer | Disables the streaming blink flag on the reasoning label |
| `keep-agent-expanded` | composer | Keeps the agent item body expanded above the assistant response |
| `disable-shimmer` | shimmer | Disables the pulsing text animation on the "Thinking" label |
| `file-edits-no-tool-group` | split-items | Keeps `patch`-type items out of collapsed tool-activity grouping |

### Compatibility model

Each rule is exact-match. When Codex loads, `inspectRule()` tests
every PATCHES regex against the served source:

- **`not_applied`**: unpatched pattern found → apply replacement
- **`already`**: patched pattern already present → skip
- **`unsupported`**: neither pattern matches → chunk shape changed, warn user
- **`mixed`**: ambiguous matches → treat as unsupported

Unsupported rules display a warning next to the setting toggle and
leave the source unmodified. The tweak never guesses a replacement.

### Expanded vs. Scroll

Codex's stock CSS gives reasoning items `max-h-35 overflow-y-auto` (a 140px
scroll box). Expanded mode overrides that with `max-height: none` via injected
CSS. Scroll mode is Codex's unmodified baseline — the injected style is simply
not applied.

## Installation

```bash
git clone https://github.com/shivam2014/codex-plusplus-reasoning-fixes.git \
  ~/Library/Application\ Support/codex-plusplus/tweaks/co.shivam94.reasoning-fixes
```

For local development from an existing checkout, link it into the tweaks
directory:

```bash
codexplusplus dev . --no-watch --replace
```

## Files

```text
co.shivam94.reasoning-fixes/
├── manifest.json       # Codex++ tweak manifest
├── index.js            # Renderer settings UI, CSS injection, fiber hook
├── source-patcher.js   # Main-process protocol-wrapper and source transformer
└── SITREP.md           # Architecture notes, patch inventory, compatibility model
```

## Patch Inventory

| Setting or rule | Mechanism | Window reload needed |
|---|---|---|
| Keep accordion open | React fiber dispatch wrapper | No |
| Show reasoning | Source patch on split-items and composer chunks | Automatic |
| Reasoning display | CSS injection | No |
| Disable thinking animation | Source patch plus CSS fallback | Automatic |
| Disable streaming pulse | Source patch on composer chunk | Automatic |
| Show file edits in chat | Source patch on split-items chunk | Automatic |
| Keep output visible | Source patch on composer chunk | Automatic |

## Acknowledgments

- **Alex Naidis** ([TheCrazyLex](https://github.com/TheCrazyLex)) —
  contributed the in-memory protocol-level source patching architecture that
  replaced the ASAR rewrite approach, and added the file-edits, shimmer, and
  keep-agent-expanded source patches (PR #2).
- **Codex++** ([b-nnett/codex-plusplus](https://github.com/b-nnett/codex-plusplus)) —
  tweak runtime, settings injection, IPC, and the `api.react.getFiber()` API.
- **Original patch** ([andrew-kramer-inno's gist](https://gist.github.com/andrew-kramer-inno/3fa1063b967cfad2bc6f7cd9af1249fd)) —
  inspiration for the source transformations.

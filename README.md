# Reasoning & Exploration Fixes

A [Codex++](https://github.com/b-nnett/codex-plusplus) tweak that improves the
conversation UI in Codex Desktop without modifying `Codex.app` on disk.

## Settings

The tweak adds a settings page with live renderer controls and per-feature
compatibility warnings when Codex changes. Settings persist across restarts via
Codex++ storage.

### Exploration

| Option | Default | Effect |
|---|---:|---|
| **Keep accordion open** | ON | Exploration panels stay expanded after Codex finishes searching and reading files. Uses a React fiber hook and does not require reload. |

### Reasoning

| Option | Default | Effect |
|---|---:|---|
| **Show reasoning** | ON | Source-backed. Thinking steps and reasoning items render as standalone conversation items. |
| **Reasoning display** | Expanded | Live CSS. **Expanded** removes Codex's internal reasoning scroll box. **Scroll** restores the compact reasoning box. |
| **Disable thinking animation** | ON | Source-backed with an immediate CSS fallback. Keeps the Thinking label steady instead of pulsing. |

### File Edits

| Option | Default | Effect |
|---|---:|---|
| **Show file edits in chat** | ON | Source-backed. File-edit cards stay as standalone main-chat items instead of being grouped into collapsed tool activity. |

### Tool Outputs

| Option | Default | Effect |
|---|---:|---|
| **Keep output visible** | OFF | Source-backed. Tool output sections stay visible. |

Source-backed options are applied by the Codex++ main-process tweak as Codex
serves its `app://` JavaScript chunks. The tweak wraps Electron's `protocol`
handler and transforms matching chunks in memory. Source-backed setting changes
schedule a Codex window reload through the main-process tweak when needed. It
does not extract, repack, sign, or rewrite the app bundle.

If Codex changes a minified chunk enough that a source rule no longer matches,
the relevant setting shows a warning near its toggle:

> This Codex version does not match the known source shape for this feature. The
> tweak likely needs an update.

The matcher is deliberately strict. Unsupported features fail visibly instead of
guessing a replacement.

## How It Works

### Renderer fiber hook

The live `exploration-keep-open` feature uses `api.react.getFiber()` to find the
exploration accordion state hook and rewrite `"collapsed"` dispatches to
`"preview"`.

### Source patches

The main-process side patches source as Codex serves app assets. The current
source-backed rules:

- render reasoning outside the exploration buffer
- let standalone reasoning items reach Codex's reasoning renderer
- keep reasoning expanded after thinking completes
- start reasoning expanded
- keep the agent item body expanded above the assistant response
- keep file-edit cards out of collapsed tool activity
- optionally disable the thinking shimmer
- disable streaming blink

The upstream `v0.7.1` ASAR patch fixed the old `reasoning-no-autocollapse`
matcher and inverted the Scroll/Expanded CSS behavior because its ASAR baseline
removed Codex's reasoning height class. This source-backed version keeps that
no-autocollapse behavior as an in-memory source rule, but intentionally leaves
the reasoning height class in Codex's source. Expanded mode is therefore the CSS
override, and Scroll mode remains Codex's unmodified baseline.

## Installation

Codex++ loads tweaks from its local tweaks directory. On macOS:

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
├── index.js            # Renderer settings UI and live CSS/fiber features
└── source-patcher.js   # Main-process source transformer
```

## Patch Inventory

| Setting or rule | Mechanism | Window reload needed |
|---|---|---|
| Keep accordion open | React fiber dispatch wrapper | No |
| Show reasoning | Source patch on split-items and composer chunks | Automatic |
| Reasoning display | CSS injection | No |
| Disable thinking animation | Source patch plus CSS fallback | Automatic |
| Show file edits in chat | Source patch on split-items chunk | Automatic |
| Keep output visible | Source patch on composer chunk | Automatic |

## Acknowledgments

- **Codex++** ([b-nnett/codex-plusplus](https://github.com/b-nnett/codex-plusplus)) -
  tweak runtime, settings injection, IPC, and React fiber introspection API.
- **Original patch** ([andrew-kramer-inno's gist](https://gist.github.com/andrew-kramer-inno/3fa1063b967cfad2bc6f7cd9af1249fd)) -
  inspiration for the source transformations.

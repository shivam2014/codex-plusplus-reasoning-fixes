# SITREP: Reasoning & Exploration Fixes

**Date**: 2026-05-02 | **Version**: 0.9.0

## Architecture

- **index.js** (renderer): Settings page, fiber-based exploration-keep-open, CSS injection for expanded/scroll toggle.
- **source-patcher.js** (main process): Wraps Electron's `protocol.handle("app")` to patch JS chunks in memory as Codex serves them.
- No ASAR extraction, repacking, codesigning, or backup/restore needed.

## Settings

| Setting | Default | Mechanism |
|---|---|---|
| Keep accordion open | ON | Fiber hook (live) |
| Show in conversation | ON | Source patch (auto-reload) |
| Content display | Expanded | CSS injection (live) |

## Patch inventory

| Rule | Bundle | Effect |
|---|---|---|
| `show-reasoning` | split-items | Reasoning rendering outside exploration buffer |
| `render-standalone-reasoning` | composer | Reasoning reaches the default renderer |
| `reasoning-no-autocollapse` | composer | No collapse on completion |
| `reasoning-start-expanded` | composer | Initial expanded state |
| `keep-agent-expanded` | composer | Agent body stays expanded |
| `reasoning-no-blink` | composer | No stream blink |

Future updates may add: `disable-shimmer`, `file-edits-no-tool-group`, `show-tool-outputs`.

## Acknowledgments

- Codex++: https://github.com/b-nnett/codex-plusplus
- Original ASAR patch: andrew-kramer-inno's gist
- In-memory source patching: Alex Naidis (TheCrazyLex)

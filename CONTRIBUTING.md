# Contributing: Fixing Codex UI Behavior via Source Patching

This documents the methodology used in v1.0. Read it before starting a new fix so
you don't retry approaches already ruled out in `docs/INVESTIGATION_LOG.md`.

## The Full Loop

### 1. Get the reference code

Always extract the current Codex ASAR before looking for patterns:

```bash
npx asar extract /Applications/Codex.app/Contents/Resources/app.asar /tmp/asar
```

The chunks you'll most often target live under `/tmp/asar/webview/assets/`:

| Chunk pattern | What it contains |
|---|---|
| `composer-*.js` | Turn renderer (`TF`), reasoning item renderer (`XM`), markdown renderer props |
| `split-items-into-render-groups-*.js` | Item categorizer (`ct`), render-group builder (`at`) |
| `thinking-shimmer-*.js` | Shimmer component for "Thinking" label |

### 2. Trace the data flow

Search the chunk for keywords matching what the user described (CSS class
names, prop names like `fadeType`, variable patterns, item types).

Key Codex variable naming patterns in minified code:

| Name pattern | Meaning |
|---|---|
| `o = !n.completed` | `isStreaming` (true while item is being generated) |
| `e.type === \`reasoning\`` | Item type check |
| `fadeType: o ? \`indexed\` : \`none\`` | Streaming animation control |
| `at` (function) | Render-group builder in split-items chunk |
| `ct` (function, exported as `Dp`) | Turn item categorizer |
| `r = []` | Result array being built |
| `i = null` | Current exploration buffer |

### 3. Design the regex patch

All patches live in the `PATCHES` object in `source-patcher.js`:

```javascript
"patch-name": {
    name: "descriptive_function_name",
    bundle: "composer",           // which chunk to target
    unpatched: /original_pattern/,
    patched: /expected_pattern_after_replacement/,
    replacement: "replacement_string",
},
```

**Critical rule:** the `replacement` string must NOT contain the `unpatched`
pattern as a substring. Otherwise `inspectRule()` returns `"mixed"` on the next
reload and the patch stops applying. Restructure the condition instead
(e.g. `_am.length>0` → `0<_am.length`).

**Bundle mapping** is in `bundleForUrl()`:
- `composer-*.js` → `"composer"`
- `split-items-*.js` → `"split-items"`
- `thinking-shimmer-*.js` → `"shimmer"`

### 4. Test the regex against the real chunk

Before committing, verify the regex matches exactly 1 occurrence:

```bash
python3 -c "
import re
t = open('/tmp/asar/webview/assets/composer-xxx.js').read()
u = re.compile(r'unpatched_pattern')
p = re.compile(r'patched_pattern')
print('unpatched:', len(u.findall(t)), 'patched:', len(p.findall(t)))
t2 = u.sub('replacement', t)
print('after replace - unpatched:', len(u.findall(t2)), 'patched:', len(p.findall(t2)))
"
```

Expected output: `unpatched: 1 patched: 0` → `after replace - unpatched: 0 patched: 1`

### 5. Wire it up

If the patch needs a toggle:
- Add the setting ID to `DEFAULTS` and `SETTING_FEATURES` in `source-patcher.js`
- Add the setting ID to `state.defaults` and the toggle UI in `index.js`
- Add the setting ID to the sync arrays in `index.js` (lines 489, 523)

If the patch is always-on (no toggle):
- Just add it to an existing `SETTING_FEATURES` list (e.g. `show-reasoning`)

### 6. Sync and restart

```bash
# Copy files to the tweaks directory Codex++ actually reads from
cp source-patcher.js ~/Library/Application\ Support/codex-plusplus/tweaks/co.shivam94.reasoning-fixes/
cp index.js ~/Library/Application\ Support/codex-plusplus/tweaks/co.shivam94.reasoning-fixes/

# Restart Codex
pkill -x "Codex" && sleep 2 && open /Applications/Codex.app
```

### 7. If it doesn't work, investigate the real source

The extracted ASAR chunk might differ from what Codex serves at runtime.
Add a logging line to `patchSource()` in `source-patcher.js` to confirm
the regex matched. If not, the served chunk has a different hash/pattern.

### 8. When there's a tradeoff between two fixes

If removing one behavior reintroduces another (e.g. reordering fixes
single-pair but breaks multi-pair), don't toggle on/off — find the
**condition that distinguishes the two cases**. In v1.0 we used:
"only reorder when the first item is an output" instead of "always reorder"
or "never reorder".

## Branch & Release

```bash
git checkout -b fix/descriptive-name
# ... implement ...
git commit -m "description"
git checkout main && git merge fix/descriptive-name && git branch -d fix/descriptive-name
git push origin main
git tag v1.x.x   # after significant feature additions
```

Log failed attempts in `docs/INVESTIGATION_LOG.md` with the patch name,
why it was tried, and why it didn't work.

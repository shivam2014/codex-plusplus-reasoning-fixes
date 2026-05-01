# SITREP: Reasoning & Exploration Fixes for Codex Desktop

**Date**: 2026-05-01 | **Codex**: 26.429.20946 (Electron 41.2, Chrome 146) | **codex++**: 0.1.1 | **Author**: shivam94

---

## 1. Problem

Two UI issues in Codex Desktop's conversation view:

**(A) Exploration panel auto-collapses** — After the model finishes exploring files, the exploration accordion collapses to zero height (framer-motion animate to `{height: 0, opacity: 0}`). User wants it to stay in "preview" state.

**(B) Reasoning items not visible** — "Thinking…" / "Thought for Xs" entries are hidden. Code analysis shows they're explicitly nulled out in the exploration sub-item renderer via `k = null`.

---

## 2. Architecture

### Bundle structure

Codex is a Vite/Rollup Electron SPA. The `app.asar` (~134 MB) has:
```
webview/assets/
  index-XXXXXXXX.js     # entry chunk (~685 KB)
  composer-XXXXXXXX.js  # composer + conversation rendering (~1.18 MB)
  reasoning-minimal-*.js   # reasoning utility components
  split-items-into-render-groups-*.js  # turn item grouping
  300+ other chunk files
```

### codex++ injection mechanism

codex++ replaces `package.json#main` with a 2 KB loader stub that:
1. Imports the runtime's `main.js` from `~/.codex-plusplus/runtime/`
2. Then imports the original entry (`.vite/build/bootstrap.js`)
The runtime hooks `session.registerPreloadScript()` (Electron 35+ API) to inject an additional preload that provides the tweak API. The renderer runs with `sandbox: true` — no `require()`, so tweak source is fetched from main via IPC and evaluated with `new Function()`.

### Exploration panel component

**Location**: `composer-XXXXXXXX.js` (minified function name `_O`)
**Props**: `{ items, status, hideHeader, threadDetailLevel, resolvedApps }`

**Key state**:
```js
// d = (status === "exploring")
[f, p] = useState(d ? "preview" : "collapsed")  // panel state
```

**Auto-collapse logic** (the target of patch 1):
```js
k = () => { p(d ? "preview" : "collapsed") }     // callback
A = useEffectEvent(k)                             // stable callback wrapper
j = () => { A() }                                 // calls the callback
useEffect(j, [d])                                 // fires when d changes
```

When `d` goes from `true` → `false` (exploration finishes), `j` fires, calls `p("collapsed")`, and framer-motion animates height to 0.

**DOM marker**: `data-testid="exploration-accordion-body"` on the framer-motion `motion.div`

### Reasoning items hiding (the target of patch 3)

Inside the exploration sub-item renderer (same `_O` component or adjacent helper):
```js
if (e.type === "todo-list") { k = <TodoItem/> }
else if (e.type === "hook") { k = <HookItem/> }
else if (e.type === "reasoning") { k = null }    // ← HIDDEN
else { k = <DefaultItem/> }
```

Note: There is a SEPARATE `case "reasoning":` handler at the turn level that renders reasoning items properly via a `YM` component. The `k=null` only affects reasoning items that appear as exploration sub-items.

---

## 3. Approaches tried

### 3a. ASAR binary patching (3 regex patches)

**Script**: `patch_codex_app_asar.py` (attached below)
**Target**: `composer-XXXXXXXX.js` inside `app.asar`

**Patch 1 — no_autocollapse**:
```
BEFORE: k = () => { p(d ? `preview` : `collapsed`) }
AFTER:  k = () => { d && p("preview") }
```
Prevents the useEffect from setting "collapsed" when exploration finishes.

**Patch 2 — init_preview**:
```
BEFORE: useState(d ? `preview` : `collapsed`)
AFTER:  useState("preview")
```
Ensures that even if the component mounts after exploration finished, it starts expanded.

**Patch 3 — show_reasoning**:
```
BEFORE: else if (e.type === `reasoning`) k = null; else {
AFTER:  else {
```
Removes the `k=null` branch so reasoning items fall through to the default renderer.

**Verification**: All 3 patches confirmed via regex on extracted ASAR:
```
no_autocollapse: 1    ✅
init_preview: 1       ✅  
show_reasoning: true  ✅ (reasoning_hide count = 0)
```

**Result**: Patches on disk but NO behavioral change. V8 code caches cleared. Possible causes:
- Wrong component patched
- Electron serving cached compilation
- React reconciliation bypasses this code path

### 3b. codex++ tweak CSS injection (ABANDONED — broke layout)

Injected `!important` CSS targeting `[data-testid="exploration-accordion-body"]`. A broad `[style*="height: 0px"]` selector matched every animated element on the page, collapsing the entire conversation container. Fixed by scoping, but framer-motion's inline styles fight CSS overrides.

### 3c. codex++ tweak React fiber walking (CURRENT)

Uses `api.react.getFiber(domNode)` from the codex++ SDK to walk React's fiber tree and directly intercept the `useState` dispatch.

**Critical bug found & fixed (line 184)**: The function definition was inside a dangling `/**` JSDoc comment due to a botched string replacement, making `FEATURES["prevent-collapse"]` undefined and logging "unknown feature". The log now shows `activated prevent-collapse`.

---

## 4. Current tweak source (tweak-index.js)

```js
// @type {import("@codex-plusplus/sdk").Tweak}
module.exports = {
  start(api) {
    try {
      if (api.process === "main") {
        startMainHandler(api);
        return;
      }
    } catch (e) {
      api.log.error("[reasoning-fixes] start failed in main:", e?.message || String(e), e?.stack || "");
      return;
    }

    const state = {
      api,
      features: new Map(),
      defaults: { "prevent-collapse": true, "show-reasoning": true },
    };
    this._state = state;

    if (typeof api.settings?.registerPage === "function") {
      this._pageHandle = api.settings.registerPage({
        id: "main",
        title: "Reasoning & Exploration Fixes",
        description: "Toggle display fixes for reasoning and exploration panels.",
        iconSvg: /* ... */,
        render: (root) => renderSettings(root, state),
      });
    }

    for (const id of Object.keys(state.defaults)) {
      const enabled = readFlag(api, id, state.defaults[id]);
      if (enabled) activateFeature(state, id);
    }
  },

  stop() {
    const s = this._state;
    if (!s) return;
    for (const [, f] of s.features) {
      try { f.dispose?.(); } catch (e) { s.api.log.warn("dispose failed", e); }
    }
    s.features.clear();
    this._pageHandle?.unregister();
  },
};
```

### FIBER-BASED prevent-collapse implementation:

```js
const FEATURES = {
  "prevent-collapse"(api) {
    const SEL = '[data-testid="exploration-accordion-body"]';
    let disposed = false;

    const hookCollapse = (domEl) => {
      try {
        let fiber = api.react.getFiber(domEl);
        while (fiber) {
          let hook = fiber.memoizedState;
          while (hook) {
            const val = hook.memoizedState;
            if (val === "preview" || val === "collapsed" || val === "expanded") {
              if (val === "collapsed") {
                try { hook.queue.dispatch("preview"); } catch(e) {}
              }
              const origDispatch = hook.queue.dispatch;
              hook.queue.dispatch = (newVal) => {
                if (newVal === "collapsed") newVal = "preview";
                origDispatch(newVal);
              };
              api.log.info("hooked exploration panel state, was=" + val);
              return;
            }
            hook = hook.next;
          }
          fiber = fiber.return;
        }
        api.log.info("fiber walk found no collapse state hook");
      } catch(e) {
        api.log.error("fiber walk error: " + (e.message || String(e)));
      }
    };

    const observer = new MutationObserver(() => {
      if (disposed) return;
      const el = document.querySelector(SEL);
      if (el) { observer.disconnect(); hookCollapse(el); }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });

    const existing = document.querySelector(SEL);
    if (existing) { observer.disconnect(); hookCollapse(existing); }

    return () => { disposed = true; observer.disconnect(); };
  },
};
```

### Main process handler (ASAR patching for show-reasoning):

```js
const REASONING_FIXES_IPC_KEY = "__reasoningFixesIpcHandler";
function startMainHandler(api) {
  if (globalThis[REASONING_FIXES_IPC_KEY]) {
    api.log.info("[reasoning-fixes] main handler already registered, skipping");
    return;
  }
  globalThis[REASONING_FIXES_IPC_KEY] = true;
  api.ipc.handle("reasoning-fixes:patch-asar", async (_event, { action }) => {
    try {
      const result = await handleAsarPatch(action);
      return result;
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  });
  api.log.info("[reasoning-fixes] main handler ready");
}

async function handleAsarPatch(action) {
  const path = require("node:path");
  const fs = require("node:fs");
  const { execSync } = require("node:child_process");

  const ASAR = "/Applications/Codex.app/Contents/Resources/app.asar";
  const PLIST = "/Applications/Codex.app/Contents/Info.plist";
  const SCRIPT = path.join(__dirname, "patch_codex_app_asar.py");

  if (action === "apply") {
    // ... runs python3 patch script, re-signs
  }
  if (action === "revert") {
    // ... restores from backup, re-signs
  }
}
```

---

## 5. codex++ API surface (from runtime source)

The `api` object exposed to tweaks includes:

```js
api.react = {
  getFiber: (node) => fiberForNode(node),
  // Walks up: node → fiber → .return → .return ... → matching component
  findOwnerByName: (n, name) => {
    let f = fiberForNode(n);
    while (f) {
      const t = f.type;
      if (t && (t.displayName === name || t.name === name)) return f;
      f = f.return;
    }
    return null;
  },
  waitForElement: (sel, timeoutMs = 5000) => new Promise((resolve, reject) => {
    const existing = document.querySelector(sel);
    if (existing) return resolve(existing);
    const deadline = Date.now() + timeoutMs;
    const obs = new MutationObserver(() => {
      const el = document.querySelector(sel);
      if (el) { obs.disconnect(); resolve(el); }
      else if (Date.now() > deadline) { obs.disconnect(); reject(new Error("timeout")); }
    });
    obs.observe(document.documentElement, { childList: true, subtree: true });
  }),
};

api.settings = {
  register: (section) => SettingsHandle,
  registerPage: (page) => SettingsHandle,
};
api.storage = { get, set, delete, all };
api.ipc = { invoke, on, handle };
api.log = { info, warn, error };
api.process = "main" | "renderer";
```

The React DevTools hook is installed by codex++'s preload before React mounts:

```js
// From react-hook.js:
export function installReactHook() {
  if (window.__REACT_DEVTOOLS_GLOBAL_HOOK__) return;
  const hook = {
    supportsFiber: true,
    renderers: new Map(),
    inject(renderer) {
      const id = nextId++;
      renderers.set(id, renderer);
      return id;
    },
    // ... other DevTools API methods
  };
  window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = hook;
}

export function fiberForNode(node) {
  const renderers = window.__codexpp__?.renderers;
  if (renderers) {
    for (const r of renderers.values()) {
      const f = r.findFiberByHostInstance?.(node);
      if (f) return f;
    }
  }
  // Fallback: read __reactFiber$... property
  for (const k of Object.keys(node)) {
    if (k.startsWith("__reactFiber")) return node[k];
  }
  return null;
}
```

---

## 6. Log excerpts

### Main process log (last session):
```
[2026-05-01T11:06:22.769Z] [error] tweak co.shivam94.reasoning-fixes failed to start: {}
```
The main process fails with an empty error object. Suspected: `api.ipc.handle()` throws in main context. The renderer process works fine despite this.

### Preload log (last session):
```
[2026-05-01T11:07:04.095Z] [info] [tweak co.shivam94.reasoning-fixes] activated prevent-collapse
[2026-05-01T11:07:04.095Z] [warn] [tweak co.shivam94.reasoning-fixes] unknown feature show-reasoning
[2026-05-01T11:07:04.097Z] [info] renderer host loaded 3 tweak(s): ... co.shivam94.reasoning-fixes
```
`prevent-collapse` IS being activated. `show-reasoning` logs "unknown feature" because it has no renderer implementation (it's ASAR-only).

Earlier logs (before JSDoc comment fix) showed "unknown feature" for BOTH features.

### Preload log (monitoring the accordion):
```
[2026-05-01T10:44:22.920Z] [info] [tweak co.shivam94.reasoning-fixes] monitoring exploration accordion
```
This was from the OLD CSS/setInterval implementation (before the JSDoc bug). The fiber-based implementation doesn't log "monitoring" — it logs "hooked exploration panel state, was=..." when it finds and hooks the state.

---

## 7. ASAR patch script

```python
#!/usr/bin/env python3
# Targets: composer-XXXXXXXX.js inside app.asar
# Two regex replacements:

patches = [
    PatchRule(
        name="no_autocollapse",
        unpatched=re.compile(
            r"\(\)=>\{(?P<setter>\w+)\((?P<cond>\w+)\?`preview`:`collapsed`\)\}"
        ),
        patched=re.compile(r"\(\)=>\{\w+&&\w+\(`preview`\)\}"),
        replacement=lambda m: f"()=>{{{m.group('cond')}&&{m.group('setter')}(\"preview\")}}",
    ),
    PatchRule(
        name="show_reasoning_items",
        unpatched=re.compile(
            r"else if\((?P<item>\w+)\.type===`reasoning`\)\w+=null;else\{"
        ),
        patched=re.compile(r"else\{"),
        replacement=lambda m: "else{",
    ),
]
```

The script extracts the ASAR, applies patches, repacks, and updates `ElectronAsarIntegrity` in `Info.plist`.

---

## 8. Key questions for reviewer

1. **Fiber dispatch override**: `hook.queue.dispatch` replacement — does React 19 support this? Are there edge cases with concurrent mode, strict mode, or framer-motion's internal fibers?

2. **ASAR patches vs fiber approach**: The ASAR patches are verified on disk but produce no behavioral change. Could Electron's V8 code cache (at `~/Library/Application Support/Codex/Code Cache/js/`) still serve the old compiled code despite clearing? Or is the `_O` component not actually the exploration panel?

3. **Exploration panel component hierarchy**: `data-testid="exploration-accordion-body"` → framer-motion `motion.div` → ??? → `_O` component. Walking up from this DOM node via `findFiberByHostInstance` — will it correctly traverse framer-motion's internal fiber wrappers to reach the `_O` component with the `useState` hook?

4. **show-reasoning**: The `k=null` branch is inside the exploration sub-item renderer. The fallthrough `else` handler uses component `YN` for generic items. Can `YN` render reasoning content? Or should reasoning in exploration entries be rendered some other way?

---

## 9. Files included

All files are flat in the same directory:

- `SITREP.md` — This file
- `tweak-index.js` — Full current tweak source (409 lines)
- `patch_codex_app_asar.py` — ASAR patching script (204 lines)
- `manifest.json` — Tweak manifest
- `codexpp-main.log` — Main process logs
- `codexpp-preload.log` — Renderer preload logs

External references:
- codex++: https://github.com/b-nnett/codex-plusplus
- SDK: @codex-plusplus/sdk (npm)
- Reference tweaks: https://github.com/b-nnett/codex-plusplus-bennett-ui
- Gist this started from: https://gist.github.com/andrew-kramer-inno/3fa1063b967cfad2bc6f7cd9af1249fd

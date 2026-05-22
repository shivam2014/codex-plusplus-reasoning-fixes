const STATE_KEY = "__reasoningFixesSourcePatcherV2";
const IPC_KEY = "__reasoningFixesSourcePatcherIpcV2";
const RELOAD_TOKEN_KEY = "__reasoningFixesSourceReloadTokenV2";
const HEAL_CACHE_KEY = "source:healed:v26_519_31651";

const DEFAULTS = {
  "show-reasoning": true,
  "disable-shimmer": true,
  "show-file-edits": true,
  "show-exploration-items": true,
  "auto-expand-exec": true,
  "expand-tool-activity": true,
};

const SETTING_FEATURES = {
  "show-reasoning": [
    "show-reasoning",
    "render-standalone-reasoning",
    "reasoning-start-expanded",
    "reasoning-no-autocollapse",
    "reasoning-no-blink",
    "no-layout-position",
    "reasoning-no-blink-fade",
    "reasoning-no-animate-height",
    "fix-assistant-order",
    "auto-expand-exec",
    "expand-tool-activity",
    "thought-fade-disable",
    "thought-fade-disable-un",
  ],
  "show-exploration-items": [
    "show-exploration-items",
  ],
  "auto-expand-exec": ["auto-expand-exec"],
  "expand-tool-activity": ["expand-tool-activity"],
  "disable-shimmer": ["disable-shimmer"],
  "show-file-edits": ["file-edits-no-tool-group"],
};

// ── Skeleton / Patch definitions ──────────────────────────────────────
//
// Each entry now has a `skeleton` object for Tier-2 auto-healing:
//   match:   Loose regex with (\w+) capture groups for all JS identifiers.
//            Must match exactly 1 occurrence in the target bundle.
//   replacement: (captures) => string  — regenerates the replacement text.
//   verify:  Looser version of patched regex, used to confirm healing worked.
//
// The existing `unpatched`/`patched`/`replacement` fields stay as Tier 1.

const PATCHES = {
  "show-reasoning": {
    name: "split_items_drop_reasoning_from_exploration",
    bundle: "split-items",
    unpatched: /if\(t\.type===`reasoning`\)\{i&&i\.push\(t\);continue\}/,
    patched: /if\(t\.type===`reasoning`\)\{i&&s\(`explored`\);r\.push\(\{kind:`item`,item:t\}\);continue\}/,
    replacement: "if(t.type===`reasoning`){console.log('[reasoning-fixes:Ge] reasoning item standalone',t.type);i&&s(`explored`);r.push({kind:`item`,item:t});continue}",
    skeleton: {
      match: /if\((\w+)\.type===`reasoning`\)\{(\w+)&&\2\.push\(\1\);continue\}/,
      replacement: (m) => `if(${m[1]}.type===\`reasoning\`){console.log('[reasoning-fixes:Ge] reasoning item standalone',${m[1]}.type);${m[2]}&&s(\`explored\`);r.push({kind:\`item\`,item:${m[1]}});continue}`,
      verify: /if\((\w+)\.type===`reasoning`\)\{console\.log\('[^']+',\w+\.type\);(\w+)&&s\(`explored`\);r\.push\(\{kind:`item`,item:\w+\}\);continue\}/,
    },
  },
  "disable-shimmer": {
    name: "disable_thinking_shimmer",
    bundle: "shimmer",
    unpatched: /!\((\w+)===void 0\|\|\1\)/,
    patched: /,true\)\{/,
    replacement: "true",
    skeleton: {
      match: /!\((\w+)===void 0\|\|\1\)/,
      replacement: () => "true",
      verify: /,true\)\{/,
    },
  },
  "render-standalone-reasoning": {
    name: "agent_item_render_reasoning_via_default_renderer",
    bundle: "thread",
    unpatched: /}else if\(e\.type===`reasoning`\)F=null;/,
    patched: /}else if\(false\){}/,
    replacement: "}else if(false){}",
    skeleton: {
      match: /}else if\((\w+)\.type===`reasoning`\)(\w+)=null;/,
      replacement: () => "}else if(false){}",
      verify: /}else if\(false\)\{\}/,
    },
  },
  "reasoning-start-expanded": {
    name: "reasoning_start_expanded_useState",
    bundle: "thread",
    unpatched: /\[d,f\]=\(0,Q\.useState\)\(o\)/,
    patched: /\[d,f\]=\(0,Q\.useState\)\(!0\)/,
    replacement: "[d,f]=(0,Q.useState)(!0)",
    skeleton: {
      match: /\[(\w+),(\w+)\]\s*=\s*\(0,([a-zA-Z_$]+)\.useState\)\((\w+)\)/,
      replacement: (m) => `[${m[1]},${m[2]}]=(0,${m[3]}.useState)(!0)`,
      verify: /\[(\w+),(\w+)\]\s*=\s*\(0,([a-zA-Z_$]+)\.useState\)\(!0\)/,
    },
  },
  "reasoning-no-autocollapse": {
    name: "reasoning_no_autocollapse_on_finish",
    bundle: "thread",
    unpatched: /if\(!o\)\{S\(!1\);return\}/,
    patched: /if\(!o\)\{return\}/,
    replacement: "if(!o){return}",
    skeleton: {
      match: /if\(!(\w+)\)\{(\w+)\(!1\);return\}/,
      replacement: (m) => `if(!${m[1]}){return}`,
      verify: /if\(!\w+\)\{return\}/,
    },
  },
  "reasoning-no-blink": {
    name: "reasoning_no_blink_during_stream",
    bundle: "thread",
    unpatched: /g=o\?!!h:d/,
    patched: /g=o\?!0:d/,
    replacement: "g=o?!0:d",
    skeleton: {
      match: /(\w+)=(\w+)\?\!!(\w+):(\w+)/,
      replacement: (m) => `${m[1]}=${m[2]}?!0:${m[4]}`,
      verify: /\w+=\w+\?!0:\w+/,
    },
  },
  "no-layout-position": {
    name: "framer_motion_layout_position_off_thread",
    bundle: "thread",
    unpatched: /layout:`position`,/,
    patched: /layout:!1,/,
    replacement: "layout:!1,",
    skeleton: {
      match: /layout:`position`,/,
      replacement: () => "layout:!1,",
      verify: /layout:!1,/,
    },
  },
  "reasoning-no-blink-fade": {
    name: "reasoning_no_blink_markdown_fade",
    bundle: "thread",
    unpatched: /fadeType:o\?`indexed`:`none`/,
    patched: /fadeType:`none`/,
    replacement: "fadeType:`none`",
    skeleton: {
      match: /fadeType:(\w+)\?`indexed`:`none`/,
      replacement: () => "fadeType:`none`",
      verify: /fadeType:`none`/,
    },
  },
  "reasoning-no-animate-height": {
    name: "reasoning_no_height_transition",
    bundle: "thread",
    unpatched: /initial:!1,animate:P,transition:yo/,
    patched: /initial:!1,animate:P,transition:{duration:0}/,
    replacement: "initial:!1,animate:P,transition:{duration:0}",
    skeleton: {
      match: /initial:!1,animate:P,transition:(\w+)/,
      replacement: () => "initial:!1,animate:P,transition:{duration:0}",
      verify: /initial:!1,animate:P,transition:\{duration:0\}/,
    },
  },
  "show-exploration-items": {
    name: "exploration_items_as_standalone",
    bundle: "split-items",
    unpatched: /function (\w+)\(e\)\{return e\.type!==`exec`\|\|e\.parsedCmd\.type===`read`&&!e\.parsedCmd\.isFinished&&\w+\(\{summary:e\.parsedCmd,cwd:e\.cwd\}\)\?!1:e\.parsedCmd\.type===`list_files`\|\|e\.parsedCmd\.type===`search`\|\|e\.parsedCmd\.type===`read`\}/,
    patched: /function \w+\(e\)\{return false\}/,
    replacement: "function $1(e){console.log('[reasoning-fixes:Ke] exploration item prevented');return false}",
    skeleton: {
      match: /function (\w+)\((\w+)\)\{return (\w+)\.type!==`exec`\|\|\2\.parsedCmd\.type===`read`&&!\2\.parsedCmd\.isFinished&&(\w+)\(\{summary:\2\.parsedCmd,cwd:\2\.cwd\}\)\?!1:\2\.parsedCmd\.type===`list_files`\|\|\2\.parsedCmd\.type===`search`\|\|\2\.parsedCmd\.type===`read`\}/,
      replacement: (m) => `function ${m[1]}(${m[2]}){console.log('[reasoning-fixes:Ke] exploration item prevented');return false}`,
      verify: /function \w+\((\w+)\)\{console\.log\('[^']+'\);return false\}/,
    },
  },
  "fix-assistant-order": {
    name: "find_assistant_anywhere_in_agent_items",
    bundle: "split-items",
    unpatched: /D=E\[E\.length-1\],O=Xe\(D\)\?D:null,k=\(O\?\.content\?\.trim\(\)\.length\?\?0\)>0\|\|!!O\?\.structuredOutput;O\?\(E\.pop\(\),g\.push\(\.\.\.T\)\):E\.push\(\.\.\.T\);/,
    patched: /let O=null;for\(let i=E\.length-1;i>=0;--i\)if\(Xe\(E\[i\]\)\)\{O=E\.splice\(i,1\)\[0\];break\}/,
    replacement: "O=null;for(let i=E.length-1;i>=0;--i)if(Xe(E[i])){O=E.splice(i,1)[0];break}let k=(O?.content?.trim().length??0)>0||!!O?.structuredOutput;O?g.push(...T):E.push(...T);",
    skeleton: {
      match: /(\w+)=(\w+)\[(\w+)\.length-1\],(\w+)=(\w+)\((\w+)\)\?\6:null,(\w+)=\(\4\?\.content\?\.trim\(\)\.length\?\?0\)>0\|\|!!\4\?\.structuredOutput;\4\?\(\2\.pop\(\),(\w+)\.push\(\.\.\.(\w+)\)\):\2\.push\(\.\.\.(\w+)\);/,
      replacement: (m) => {
        // captures: 1=w, 2=C, 3=C, 4=T, 5=me, 6=w, 7=E, 8=h, 9=S, 10=S
        const resultVar = m[4];       // T
        const arrayVar = m[2];        // C
        const checkFn = m[5];         // me
        const checkArg = m[6];        // w (same as first element)
        const otherVar = m[7];        // E
        const pushTarget = m[8];      // h
        const spreadTarget = m[9];    // S (or m[10])
        return `${resultVar}=null;for(let i=${arrayVar}.length-1;i>=0;--i)if(${checkFn}(${arrayVar}[i])){${resultVar}=${arrayVar}.splice(i,1)[0];break}let ${otherVar}=(${resultVar}?.content?.trim().length??0)>0||!!${resultVar}?.structuredOutput;${resultVar}?${pushTarget}.push(...${spreadTarget}):${arrayVar}.push(...${spreadTarget});`;
      },
      verify: /(\w+)=null;for\(let i=\w+\.length-1;i>=0;--i\)if\(\w+\(\w+\[i\]\)\)\{(\w+)=\w+\.splice\(i,1\)\[0\];break\}let (\w+)=\(\2\?\.content\?\.trim\(\)\.length\?\?0\)>0\|\|!!\2\?\.structuredOutput;\2\?\w+\.push\(\.\.\.\w+\):\w+\.push\(\.\.\.\w+\);/,
    },
  },
  "file-edits-no-tool-group": {
    name: "file_edits_not_collapsed_tool_activity",
    bundle: "split-items",
    unpatched: /e\.type===`exploration`\|\|e\.type===`patch`\|\|e\.type===`exec`/,
    patched: /e\.type===`exploration`\?!0:e\.type===`patch`\?!1:e\.type===`exec`/,
    replacement: "e.type===`exploration`?!0:e.type===`patch`?!1:e.type===`exec`",
    skeleton: {
      match: /(\w+)\.type===`exploration`\|\|\1\.type===`patch`\|\|\1\.type===`exec`/,
      replacement: (m) => `${m[1]}.type===\`exploration\`?!0:${m[1]}.type===\`patch\`?!1:${m[1]}.type===\`exec\``,
      verify: /(\w+)\.type===`exploration`\?!0:\1\.type===`patch`\?!1:\1\.type===`exec`/,
    },
  },
  "auto-expand-exec": {
    name: "auto_expand_exec_shells_by_default",
    bundle: "thread",
    unpatched: /defaultExpandExecShell:\w+!==[^,}]+/,
    patched: /defaultExpandExecShell:!0/,
    replacement: "defaultExpandExecShell:!0",
    skeleton: {
      match: /defaultExpandExecShell:(\w+)!==([^,}]+)/,
      replacement: () => "defaultExpandExecShell:!0",
      verify: /defaultExpandExecShell:!0/,
    },
  },
  "expand-tool-activity": {
    name: "expand_tool_activity_sections",
    bundle: "thread",
    unpatched: /defaultExpanded:!1,onExpand:/g,
    patched: /defaultExpanded:!0,onExpand:/g,
    replacement: "defaultExpanded:!0,onExpand:",
    skeleton: {
      match: /defaultExpanded:!1,(onExpand:)/,
      replacement: () => "defaultExpanded:!0,onExpand:",
      verify: /defaultExpanded:!0,(onExpand:)/,
    },
  },
  
  "thought-fade-disable": {
    name: "disable_markdown_fade_wn",
    bundle: "markdown",
    unpatched: /function Wn\(\{fadeText:e,fadeSegmentStartIndex:t,segments:n\}\)\{return e\?n\.map\(\(e,n\)=>\{let r=t\+n;return\(0,Z\.jsx\)\(`span`,\{className:W\.fadeIn,children:e\},`fade-\$\{r\}`\)\}\):n\}/,
    patched: /function Wn\(\{fadeText:e,fadeSegmentStartIndex:t,segments:n\}\)\{return n\}/,
    replacement: "function Wn({fadeText:e,fadeSegmentStartIndex:t,segments:n}){return n}",
    skeleton: {
      match: /function (\w+)\(\{fadeText:(\w+),fadeSegmentStartIndex:(\w+),segments:(\w+)\}\)\{return \2\?\4\.map\(\(\2,\4\)=>\{let (\w+)=\3\+\4;return\(0,(\w+)\.jsx\)\(`span`,\{className:(\w+)\.fadeIn,children:\2\},`fade-\$\{\5\}`\)\}\):\4\}/,
      replacement: (m) => `function ${m[1]}({fadeText:${m[2]},fadeSegmentStartIndex:${m[3]},segments:${m[4]}}){return ${m[4]}}`,
      verify: /function \w+\(\{fadeText:\w+,fadeSegmentStartIndex:\w+,segments:\w+\}\)\{return \w+\}/,
    },
  },

"thought-fade-disable-un": {
    name: "disable_markdown_fade_un",
    bundle: "markdown",
    unpatched: /function Un\(\{content:e,cwd:t,fadeText:n,fadeSegmentIndex:r,hostId:i,key:a,onFileLinkOpen:o,openFileLinksInSidePanel:s\}\)\{let c=Mt\(\{content:e,cwd:t,hostId:i,key:n\?void 0:a,onFileLinkOpen:o,openFileLinksInSidePanel:s\}\);return n\?\(0,Z\.jsx\)\(`span`,\{className:W\.fadeIn,children:c\},`fade-\$\{r\}`\):c\}/,
    patched: /function Un\(\{content:e,cwd:t,fadeText:n,fadeSegmentIndex:r,hostId:i,key:a,onFileLinkOpen:o,openFileLinksInSidePanel:s\}\)\{let c=Mt\(\{content:e,cwd:t,hostId:i,key:a,onFileLinkOpen:o,openFileLinksInSidePanel:s\}\);return c\}/,
    replacement: "function Un({content:e,cwd:t,fadeText:n,fadeSegmentIndex:r,hostId:i,key:a,onFileLinkOpen:o,openFileLinksInSidePanel:s}){let c=Mt({content:e,cwd:t,hostId:i,key:a,onFileLinkOpen:o,openFileLinksInSidePanel:s});return c}",
    skeleton: {
      match: /function (\w+)\(\{content:(\w+),cwd:(\w+),fadeText:(\w+),fadeSegmentIndex:(\w+),hostId:(\w+),key:(\w+),onFileLinkOpen:(\w+),openFileLinksInSidePanel:(\w+)\}\)\{let (\w+)=Mt\(\{content:\2,cwd:\3,hostId:\6,key:n\?void 0:\7,onFileLinkOpen:\8,openFileLinksInSidePanel:\9\}\);return \4\?\(0,(\w+)\.jsx\)\(`span`,\{className:(\w+)\.fadeIn,children:\10\},`fade-\$\{\5\}`\):\10\}/,
      replacement: (m) => {
        return `function ${m[1]}({content:${m[2]},cwd:${m[3]},fadeText:${m[4]},fadeSegmentIndex:${m[5]},hostId:${m[6]},key:${m[7]},onFileLinkOpen:${m[8]},openFileLinksInSidePanel:${m[9]}}){let ${m[10]}=Mt({content:${m[2]},cwd:${m[3]},hostId:${m[6]},key:${m[7]},onFileLinkOpen:${m[8]},openFileLinksInSidePanel:${m[9]}});return ${m[10]}}`;
      },
      verify: /function \w+\(\{content:\w+,cwd:\w+,fadeText:\w+,fadeSegmentIndex:\w+,hostId:\w+,key:\w+,onFileLinkOpen:\w+,openFileLinksInSidePanel:\w+\}\)\{let \w+=Mt\(\{[^}]+\}\);return \w+\}/,
    },
  },
};

// ── Main process entry point ──────────────────────────────────────────

function startReasoningFixesMain(api) {
  // Reset state on each start to ensure protocol handler re-installs
  const old = globalThis[STATE_KEY];
  if (old && old.disposeProtocol) {
    try { old.disposeProtocol(); } catch(e) {}
  }
  const state = {
    protocolPatched: false,
    observations: Object.create(null),
    patchedAssets: new Set(),
    healedCache: new Map(), // patchName -> { unpatched, replacement, patched }
  };
  state.api = api;
  state.enabled = true;
  globalThis[STATE_KEY] = state;

  installProtocolPatch(state);
  installIpc(state);
  api.log.info("[reasoning-fixes] source patcher v2 ready with auto-heal");
  return () => {
    state.enabled = false;
    if (state.reloadTimer) {
      clearTimeout(state.reloadTimer);
      state.reloadTimer = null;
    }
    api.log.info("[reasoning-fixes] source patcher disabled");
  };
}

function installProtocolPatch(state) {
  if (state.protocolPatched) return;
  const { protocol } = require("electron");
  const originalHandle = protocol.handle;

  const reasoningFixesProtocolHandle = function reasoningFixesProtocolHandle(scheme, handler) {
    if (scheme !== "app" || typeof handler !== "function") {
      return originalHandle.apply(this, arguments);
    }

    const wrappedHandler = async (request) => {
      const response = await handler(request);
      const bundle = bundleForUrl(request?.url);
      if (!bundle || !state.enabled) return response;

      let originalText = null;
      try {
        originalText = await response.text();
        state.api.log.info("[reasoning-fixes] patching " + bundle + " bundle (" + originalText.length + " bytes)");
        const result = patchSource(state, request.url, originalText, bundle);
        if (result.changed) {
          state.api.log.info("[reasoning-fixes] " + bundle + " bundle changed: " + originalText.length + " -> " + result.text.length + " bytes");
        }
        if (result.healed) {
          state.api.log.info("[reasoning-fixes] auto-healed " + result.healed.length + " patches: " + result.healed.join(", "));
        }
        const headers = new Headers(response.headers);
        headers.delete("content-length");
        headers.set("content-type", "text/javascript; charset=utf-8");
        return new Response(result.text, {
          status: response.status,
          statusText: response.statusText,
          headers,
        });
      } catch (error) {
        state.api.log.warn("[reasoning-fixes] failed to patch renderer asset", {
          url: request?.url,
          error: error?.stack || error?.message || String(error),
        });
        if (originalText != null) {
          const headers = new Headers(response.headers);
          headers.delete("content-length");
          return new Response(originalText, {
            status: response.status,
            statusText: response.statusText,
            headers,
          });
        }
        return response;
      }
    };

    return originalHandle.call(this, scheme, wrappedHandler);
  };
  protocol.handle = reasoningFixesProtocolHandle;

  state.protocolPatched = true;
  state.disposeProtocol = () => {
    try {
      if (protocol.handle === reasoningFixesProtocolHandle) {
        protocol.handle = originalHandle;
      }
    } catch(e) {}
    state.protocolPatched = false;
  };

  try {
    const { BrowserWindow } = require("electron");
    for (const window of BrowserWindow.getAllWindows()) {
      if (window.isDestroyed()) continue;
      const url = window.webContents.getURL();
      if (url.startsWith("app://-/") || url === "about:blank") {
        state.api.log.info("[reasoning-fixes] reloading window for new patches, url=" + url);
        window.webContents.reloadIgnoringCache();
      }
    }
  } catch(e) {}
}

function installIpc(state) {
  const shared = globalThis[IPC_KEY] || { registered: false };
  shared.impl = (request) => handleIpc(state, request);
  globalThis[IPC_KEY] = shared;
  if (shared.registered) return;

  state.api.ipc.handle("source-patches-v2", async (request) => {
    try {
      return await globalThis[IPC_KEY].impl(request);
    } catch (error) {
      return { ok: false, error: error?.message || String(error) };
    }
  });
  shared.registered = true;
}

async function handleIpc(state, request) {
  const action = request?.action || "status";
  if (action === "status") return buildStatus(state);
  if (action === "set-feature") {
    const id = request?.id;
    if (!Object.prototype.hasOwnProperty.call(DEFAULTS, id)) {
      return { ok: false, error: `unknown feature: ${id}` };
    }
    state.api.storage.set(`feature:${id}`, !!request.value);
    scheduleCodexWindowReload(state);
    return buildStatus(state);
  }
  if (action === "sync-features") {
    const values = request?.values || {};
    for (const id of Object.keys(DEFAULTS)) {
      if (typeof values[id] === "boolean") state.api.storage.set(`feature:${id}`, values[id]);
    }
    return buildStatus(state);
  }
  if (action === "reload-window") {
    scheduleCodexWindowReload(state);
    return buildStatus(state);
  }
  if (action === "heal-status") {
    return { ok: true, healed: Array.from(state.healedCache.keys()) };
  }
  if (action === "clear-heal-cache") {
    state.healedCache.clear();
    state.api.storage.delete(HEAL_CACHE_KEY);
    return { ok: true };
  }
  return { ok: false, error: `unknown action: ${action}` };
}

// ── Core patching engine with auto-heal ────────────────────────────────

function patchSource(state, rawUrl, source, bundle) {
  const settings = readSettings(state.api.storage);
  const enabled = enabledLowLevelFeatures(settings);
  const basename = basenameForUrl(rawUrl);
  let text = source;
  let changed = false;
  const healed = [];

  for (const [feature, rule] of Object.entries(PATCHES)) {
    if (rule.bundle !== bundle) continue;
    const desired = enabled.has(feature);
    const before = inspectRule(text, rule, state);

    if (!desired) {
      recordObservation(state, feature, rule, before === "already" ? "bundled_active" : before === "not_applied" ? "available" : before, bundle, basename);
      continue;
    }

    if (before === "not_applied") {
      // Tier 1: exact match
      const next = text.replace(rule.unpatched, rule.replacement);
      if (next !== text) {
        text = next;
        changed = true;
        recordObservation(state, feature, rule, "active", bundle, basename);
        continue;
      }
      // If replacement didn't change text, it means the match failed despite inspectRule saying not_applied
      // This shouldn't happen but guard against it
      recordObservation(state, feature, rule, "unsupported", bundle, basename);
      continue;
    }

    if (before === "already") {
      recordObservation(state, feature, rule, "active", bundle, basename);
      continue;
    }

    // ── Auto-heal path: inspectRule returned "unsupported" ──
    const healResult = autoHeal(state, feature, rule, text);
    if (healResult.status === "ok") {
      text = healResult.text;
      changed = true;
      healed.push(feature);
      recordObservation(state, feature, rule, "healed_auto", bundle, basename);
      if (healResult.captured) {
        state.api.log.info("[reasoning-fixes] auto-healed " + feature + " (matched: " + healResult.matched + ")");
      }
      // Save healed pattern to cache
      state.healedCache.set(feature, {
        unpatched: healResult.savedUnpatched,
        replacement: healResult.savedReplacement,
      });
    } else if (healResult.status === "structural_rewrite") {
      state.api.log.info("[reasoning-fixes] " + feature + ": structural rewrite (skeleton found 0 matches in " + bundle + ")");
      recordObservation(state, feature, rule, "structural_rewrite", bundle, basename);
    } else if (healResult.status === "ambiguous") {
      state.api.log.warn("[reasoning-fixes] " + feature + ": ambiguous skeleton (" + healResult.count + " matches)");
      recordObservation(state, feature, rule, "ambiguous_heal", bundle, basename);
    } else if (healResult.status === "no_skeleton") {
      recordObservation(state, feature, rule, "unsupported", bundle, basename);
    } else if (healResult.status === "heal_verification_failed") {
      state.api.log.warn("[reasoning-fixes] " + feature + ": heal verification failed");
      recordObservation(state, feature, rule, "heal_failed", bundle, basename);
    } else {
      recordObservation(state, feature, rule, "unsupported", bundle, basename);
    }
  }

  if (changed && !state.patchedAssets.has(basename)) {
    state.patchedAssets.add(basename);
    state.api.log.info("[reasoning-fixes] patched renderer asset", { asset: basename, bundle });
  }
  return { text, changed, healed: healed.length > 0 ? healed : undefined };
}

// ── Auto-heal engine ──────────────────────────────────────────────────

function autoHeal(state, feature, rule, text) {
  // Step 0: Check if we have a cached healed pattern for this patch
  const cached = state.healedCache.get(feature) || tryLoadCachedHeal(state, feature);
  if (cached) {
    const testResult = text.replace(new RegExp(cached.unpatched, "g"), cached.replacement);
    if (testResult !== text) {
      // Verify with cached patched pattern if available
      if (cached.patched) {
        const patchedCount = countMatches(testResult, new RegExp(cached.patched, "g"));
        if (patchedCount >= 1) {
          return { status: "ok", text: testResult, savedUnpatched: cached.unpatched, savedReplacement: cached.replacement, matched: "(cached)" };
        }
      } else {
        return { status: "ok", text: testResult, savedUnpatched: cached.unpatched, savedReplacement: cached.replacement, matched: "(cached)" };
      }
    }
  }

  // Step 1: Check skeleton definition exists
  if (!rule.skeleton) {
    return { status: "no_skeleton" };
  }

  // Step 2: Try the skeleton match
  const skeleton = rule.skeleton;
  const matchResult = matchSkeleton(text, skeleton.match);

  if (matchResult.count === 0) {
    return { status: "structural_rewrite" };
  }
  if (matchResult.count > 1) {
    return { status: "ambiguous", count: matchResult.count };
  }

  // Step 3: Exactly 1 match — regenerate replacement
  const matchedText = matchResult.matchText;
  const captures = matchResult.captures;
  const healedReplacement = typeof skeleton.replacement === "function"
    ? skeleton.replacement(captures)
    : skeleton.replacement;

  // Step 4: Apply the healed replacement
  const healedResult = text.replace(skeleton.match, () => healedReplacement);
  if (healedResult === text) {
    return { status: "heal_verification_failed", reason: "replace didn't change text" };
  }

  // Step 5: Verify with skeleton.verify
  if (skeleton.verify) {
    const verifyCount = countMatches(healedResult, skeleton.verify);
    if (verifyCount >= 1) {
      return {
        status: "ok",
        text: healedResult,
        matched: matchedText,
        captures: captures,
        savedUnpatched: skeleton.match.source,
        savedReplacement: healedReplacement,
      };
    }
    // If verify didn't match, try checking if the original patched regex matches
    const originalPatchedCount = countMatches(healedResult, rule.patched);
    if (originalPatchedCount >= 1) {
      return {
        status: "ok",
        text: healedResult,
        matched: matchedText,
        captures: captures,
        savedUnpatched: skeleton.match.source,
        savedReplacement: healedReplacement,
      };
    }
    return { status: "heal_verification_failed", reason: "verify pattern didn't match after heal" };
  }

  // No verify defined — accept the healed result anyway
  return {
    status: "ok",
    text: healedResult,
    matched: matchedText,
    captures: captures,
    savedUnpatched: skeleton.match.source,
    savedReplacement: healedReplacement,
  };
}

function matchSkeleton(text, skeletonRe) {
  const globalRe = new RegExp(skeletonRe.source, "g" + (skeletonRe.flags.includes("g") ? "" : ""));
  const allMatches = Array.from(text.matchAll(globalRe));
  if (allMatches.length === 0) {
    return { count: 0 };
  }
  if (allMatches.length > 1) {
    return { count: allMatches.length };
  }
  const m = allMatches[0];
  const captures = {};
  let idx = 0;
  for (const g of m) {
    if (idx > 0) {
      captures[idx] = g;
    }
    idx++;
  }
  // Also add named groups if any
  if (m.groups) {
    for (const [k, v] of Object.entries(m.groups)) {
      captures[k] = v;
    }
  }
  return {
    count: 1,
    matchText: m[0],
    captures: captures,
  };
}

function tryLoadCachedHeal(state, feature) {
  try {
    const raw = state.api.storage.get(HEAL_CACHE_KEY, undefined);
    if (raw && typeof raw === "object" && raw[feature]) {
      const entry = raw[feature];
      state.healedCache.set(feature, entry);
      return entry;
    }
  } catch(e) {}
  return null;
}

function saveHealedPatches(state) {
  if (state.healedCache.size === 0) return;
  try {
    const existing = state.api.storage.get(HEAL_CACHE_KEY, undefined) || {};
    for (const [key, val] of state.healedCache) {
      existing[key] = val;
    }
    state.api.storage.set(HEAL_CACHE_KEY, existing);
  } catch(e) {
    state.api.log.warn("[reasoning-fixes] failed to save heal cache", e?.message || String(e));
  }
}

// ── Rule inspection (modified for skeleton verify fallback) ───────────

function inspectRule(source, rule, state) {
  const unpatchedCount = countMatches(source, rule.unpatched);
  const patchedCount = countMatches(source, rule.patched);

  // Tier 1: exact match
  if (unpatchedCount >= 1 && patchedCount === 0) return "not_applied";
  if (unpatchedCount === 0 && patchedCount >= 1) return "already";

  // Fallback: check if skeleton.verify matches (handles the show-exploration-items
  // meta-bug where the patched regex didn't match the console.log-enhanced output)
  if (unpatchedCount === 0 && patchedCount === 0 && rule.skeleton && rule.skeleton.verify) {
    const verifyCount = countMatches(source, rule.skeleton.verify);
    if (verifyCount >= 1) return "already";
  }

  if (unpatchedCount === 0 && patchedCount === 0) return "unsupported";
  return "mixed";
}

function countMatches(source, re) {
  // Ensure global flag
  const flags = re.flags.includes("g") ? re.flags : `${re.flags}g`;
  const global = new RegExp(re.source, flags);
  return Array.from(source.matchAll(global)).length;
}

function recordObservation(state, feature, rule, status, bundle, asset) {
  state.observations[feature] = {
    feature,
    rule: rule.name,
    status,
    bundle,
    asset,
    updatedAt: new Date().toISOString(),
  };
}

function buildStatus(state) {
  const settings = readSettings(state.api.storage);
  const groups = {};
  for (const id of Object.keys(SETTING_FEATURES)) {
    groups[id] = aggregateSettingStatus(id, settings[id], state.observations);
  }
  return {
    ok: true,
    settings,
    groups,
    features: Object.values(state.observations),
    patchedAssets: Array.from(state.patchedAssets),
    reloadNeeded: state.api.storage.get("source:reload-needed", false) === true,
    healedCount: state.healedCache.size,
    healedFeatures: Array.from(state.healedCache.keys()),
  };
}

function aggregateSettingStatus(id, enabled, observations) {
  const features = SETTING_FEATURES[id];
  const seen = features.map((feature) => observations[feature]).filter(Boolean);
  if (!enabled) {
    const bundled = seen.find((item) => item.status === "bundled_active");
    return {
      status: bundled ? "forced_active" : "disabled",
      message: bundled
        ? "Codex's served source already contains this change, so this toggle cannot disable it until Codex is restored or updated."
        : "",
      details: seen,
    };
  }
  const unsupported = seen.find((item) =>
    item.status === "unsupported" ||
    item.status === "heal_failed" ||
    item.status === "ambiguous_heal" ||
    item.status === "structural_rewrite" ||
    item.status === "mixed"
  );
  if (unsupported) {
    return {
      status: "unsupported",
      message: "This Codex version does not match the known source shape for this feature. The tweak likely needs an update.",
      details: seen,
    };
  }
  if (seen.length < features.length) {
    return {
      status: "unknown",
      message: "Waiting for Codex to load the source chunk for this feature.",
      details: seen,
    };
  }
  return { status: "active", message: "", details: seen };
}

function readSettings(storage) {
  const out = {};
  for (const [id, fallback] of Object.entries(DEFAULTS)) {
    const value = storage.get(`feature:${id}`, undefined);
    out[id] = typeof value === "boolean" ? value : fallback;
  }
  return out;
}

function enabledLowLevelFeatures(settings) {
  const enabled = new Set();
  for (const [setting, features] of Object.entries(SETTING_FEATURES)) {
    if (!settings[setting]) continue;
    for (const feature of features) enabled.add(feature);
  }
  return enabled;
}

function bundleForUrl(rawUrl) {
  const basename = basenameForUrl(rawUrl);
  if (!basename) return null;
  if (/^composer-[A-Za-z0-9_-]+\.js$/.test(basename)) return "composer";
  if (/^split-items-into-render-groups-[A-Za-z0-9_-]+\.js$/.test(basename)) return "split-items";
  if (/^thinking-shimmer-[A-Za-z0-9_-]+\.js$/.test(basename)) return "shimmer";
  if (/^lt-[A-Za-z0-9_-]+\.js$/.test(basename)) return "lt";
  if (/^local-environments-settings-page-[A-Za-z0-9_-]+\.js$/.test(basename)) return "settings-page";
  if (/^markdown-[A-Za-z0-9_-]+\.js$/.test(basename)) return "markdown";
  if (/^conversation-markdown-[A-Za-z0-9_-]+\.js$/.test(basename)) return "markdown";
  if (/^local-conversation-thread-[A-Za-z0-9_-]+\.js$/.test(basename)) return "thread";
  return null;
}

function basenameForUrl(rawUrl) {
  if (typeof rawUrl !== "string") return null;
  try {
    const pathname = new URL(rawUrl).pathname;
    return pathname.slice(pathname.lastIndexOf("/") + 1);
  } catch {
    return null;
  }
}

function reloadCodexWindows(state) {
  const { BrowserWindow } = require("electron");
  const token = `${Date.now()}`;
  if (globalThis[RELOAD_TOKEN_KEY] === token) return;
  globalThis[RELOAD_TOKEN_KEY] = token;

  for (const window of BrowserWindow.getAllWindows()) {
    if (window.isDestroyed()) continue;
    const url = window.webContents.getURL();
    if (!url.startsWith("app://-/")) continue;
    state.api.log.info("[reasoning-fixes] reloading Codex window for source patch settings");
    window.webContents.reloadIgnoringCache();
  }
}

function scheduleCodexWindowReload(state) {
  state.api.storage.set("source:reload-needed", false);
  if (state.reloadTimer) clearTimeout(state.reloadTimer);
  state.reloadTimer = setTimeout(() => {
    state.reloadTimer = null;
    reloadCodexWindows(state);
  }, 150);
}

module.exports = {
  startReasoningFixesMain,
};

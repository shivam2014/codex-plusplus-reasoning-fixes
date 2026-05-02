/**
 * Reasoning & Exploration Fixes
 *
 * A Codex++ tweak (https://github.com/b-nnett/codex-plusplus) that improves
 * Codex Desktop's conversation UI.
 *
 * Features
 * --------
 *  • Exploration accordion stays open (fiber hook, live)
 *  • Reasoning items visible in conversation (ASAR patch)
 *  • Reasoning display: scrollable or fully expanded (CSS injection, live)
 *  • Tool outputs stay visible (ASAR patch)
 *
 * Acknowledgments
 *  • codex++: https://github.com/b-nnett/codex-plusplus
 *  • Original ASAR patch inspiration:
 *    https://gist.github.com/andrew-kramer-inno/3fa1063b967cfad2bc6f7cd9af1249fd
 * License: MIT
 */

/** @type {import("@codex-plusplus/sdk").Tweak} */
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
      cssInjections: new Map(),
      defaults: {
        "exploration-keep-open": true,
        "show-reasoning": true,
        "reasoning-style": "expanded",  // "expanded" or "scroll"
        "show-tool-outputs": false,
      },
    };
    this._state = state;

    if (typeof api.settings?.registerPage === "function") {
      this._pageHandle = api.settings.registerPage({
        id: "main",
        title: "Reasoning & Exploration Fixes",
        description: "Improve how reasoning, exploration, and tool outputs display in the conversation.",
        iconSvg:
          '<svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" class="icon-sm inline-block align-middle">' +
          '<path d="M10 3v14M3 10h14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>' +
          '<circle cx="10" cy="10" r="7" stroke="currentColor" stroke-width="1.5" fill="none"/>' +
          "</svg>",
        render: (root) => renderSettings(root, state),
      });
    }

    // Activate runtime features
    this._state.reasoningStyle = readStyle(state.api, "reasoning-style", "expanded");
    applyReasoningStyle(state, this._state.reasoningStyle);

    if (readFlag(state.api, "exploration-keep-open", true)) {
      activateFeature(state, "exploration-keep-open");
    }
  },

  stop() {
    const s = this._state;
    if (!s) return;
    for (const [, f] of s.features) {
      try { f.dispose?.(); } catch (e) { s.api.log.warn("dispose failed", e); }
    }
    s.features.clear();
    for (const [, dispose] of s.cssInjections) {
      try { dispose?.(); } catch (e) {}
    }
    s.cssInjections.clear();
    this._pageHandle?.unregister();
  },
};

// ─────────────────────────────────────────────────────────── settings UI ──

function renderSettings(root, state) {
  const container = el("div", "flex flex-col gap-4");

  // Section: Exploration
  const expSection = el("section", "flex flex-col gap-2");
  expSection.appendChild(sectionTitle("Exploration"));
  const expCard = roundedCard();
  expCard.appendChild(featureRow(state, {
    id: "exploration-keep-open",
    label: "Keep accordion open",
    desc: "Exploration panel stays expanded after Codex finishes searching and reading files. No restart needed.",
  }));
  expSection.appendChild(expCard);
  container.appendChild(expSection);

  // Section: Reasoning
  const rsnSection = el("section", "flex flex-col gap-2");
  rsnSection.appendChild(sectionTitle("Reasoning"));
  const rsnCard = roundedCard();

  rsnCard.appendChild(featureRow(state, {
    id: "show-reasoning",
    label: "Show in conversation",
    desc: "Thinking steps and reasoning items appear in the message log. Requires ASAR patch + restart.",
    asar: true,
  }));

  rsnCard.appendChild(styleChoiceRow(state, {
    id: "reasoning-style",
    label: "Content display",
    desc: "How reasoning text fits inside each item.",
    choices: [
      { value: "expanded", label: "Expanded" },
      { value: "scroll", label: "Scroll" },
    ],
  }));

  rsnSection.appendChild(rsnCard);
  container.appendChild(rsnSection);

  // Section: Tool Outputs
  const tlSection = el("section", "flex flex-col gap-2");
  tlSection.appendChild(sectionTitle("Tool Outputs"));
  const tlCard = roundedCard();
  tlCard.appendChild(featureRow(state, {
    id: "show-tool-outputs",
    label: "Show in conversation",
    desc: "Tool call outputs stay visible after execution instead of collapsing. Requires ASAR patch + restart.",
    asar: true,
  }));
  tlSection.appendChild(tlCard);
  container.appendChild(tlSection);

  root.appendChild(container);
}

function featureRow(state, f) {
  const row = el("div", "flex items-center justify-between gap-4 p-3");
  const left = el("div", "flex min-w-0 flex-col gap-1");
  const label = el("div", "min-w-0 text-sm text-token-text-primary");
  label.textContent = f.label;
  left.appendChild(label);
  if (f.desc) {
    const desc = el("div", "text-token-text-secondary min-w-0 text-sm");
    desc.textContent = f.desc;
    left.appendChild(desc);
  }
  row.appendChild(left);

  const initial = readFlag(state.api, f.id, state.defaults[f.id] === true);
  const sw = switchControl(initial, async (next) => {
    writeFlag(state.api, f.id, next);
    if (f.asar) {
      try {
        const action = next ? "apply" : "revert";
        const result = await state.api.ipc.invoke("reasoning-fixes:patch-asar", { action, features: [f.id] });
        if (result?.ok) state.api.log.info("asar patch", action, f.id, "ok");
        else state.api.log.error("asar patch", f.id, "failed", result?.error);
      } catch (e) {
        state.api.log.error("asar patch invoke failed", e);
      }
    } else {
      if (next) activateFeature(state, f.id);
      else deactivateFeature(state, f.id);
    }
  });
  row.appendChild(sw);
  return row;
}

function styleChoiceRow(state, f) {
  const row = el("div", "flex flex-col gap-2 p-3");

  const left = el("div", "flex flex-col gap-1");
  const label = el("div", "text-sm text-token-text-primary");
  label.textContent = f.label;
  left.appendChild(label);
  if (f.desc) {
    const desc = el("div", "text-token-text-secondary min-w-0 text-sm");
    desc.textContent = f.desc;
    left.appendChild(desc);
  }
  row.appendChild(left);

  // Segmented control: Expanded | Scroll
  const current = readStyle(state.api, "reasoning-style", "expanded");
  const segGroup = el("div", "flex gap-1");

  for (const choice of f.choices) {
    const isSelected = current === choice.value;

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className =
      "flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors " +
      (isSelected
        ? "bg-token-charts-blue text-white"
        : "bg-token-foreground/5 text-token-text-secondary hover:bg-token-foreground/10");
    btn.textContent = choice.label;

    btn.addEventListener("click", () => {
      const oldVal = readStyle(state.api, "reasoning-style", "expanded");
      if (choice.value === oldVal) return;
      writeStyle(state.api, "reasoning-style", choice.value);
      applyReasoningStyle(state, choice.value);
      // Re-render this row to update the selection highlight
      row.replaceWith(styleChoiceRow(state, f));
    });

    segGroup.appendChild(btn);
  }
  row.appendChild(segGroup);
  return row;
}

// ───────────────────────────────────────────────────── CSS injection ──

function applyReasoningStyle(state, style) {
  // Remove any previous CSS injection
  const prev = state.cssInjections.get("reasoning-style");
  if (prev) { try { prev(); } catch(e) {} state.cssInjections.delete("reasoning-style"); }

  const api = state.api;

  if (style === "expanded") {
    // Expanded mode: the ASAR patch removed max-h-35 already.
    // Just clean up any "scroll" CSS that might add constraints back.
    api.log.info("reasoning style: expanded (ASAR baseline)");
  } else {
    // Scroll mode: the ASAR patch removed max-h-35 from the bundle,
    // so we inject CSS to RE-ADD the scroll constraint at runtime.
    const styleEl = document.createElement("style");
    styleEl.id = "reasoning-fixes-scroll";
    styleEl.textContent = [
      '[class="[--edge-fade-distance:1rem]"] {',
      '  max-height: 140px !important;',
      '  overflow-y: auto !important;',
      '}',
    ].join("\n");
    document.head.appendChild(styleEl);

    state.cssInjections.set("reasoning-style", () => {
      styleEl.remove();
    });
    api.log.info("reasoning style: scroll (CSS injected)");
  }
}

// ─────────────────────────────────────────────────────────── feature reg ──

function activateFeature(state, id) {
  if (state.features.has(id)) return;
  const fn = FEATURES[id];
  if (!fn) { state.api.log.warn("unknown feature", id); return; }
  try {
    const dispose = fn(state.api);
    state.features.set(id, { dispose });
    state.api.log.info("activated", id);
  } catch (e) {
    state.api.log.error("activate failed", id, e);
  }
}

function deactivateFeature(state, id) {
  const f = state.features.get(id);
  if (!f) return;
  try { f.dispose?.(); } finally {
    state.features.delete(id);
    state.api.log.info("deactivated", id);
  }
}

const FEATURES = {
  "exploration-keep-open"(api) {
    const SEL = '[data-testid="exploration-accordion-body"]';
    let disposed = false;
    let retryCount = 0;

    const tryHook = () => {
      if (disposed) return;
      const domEl = document.querySelector(SEL);
      if (!domEl) {
        if (retryCount < 20) { retryCount++; setTimeout(tryHook, 1000); }
        return;
      }
      retryCount = 0;

      const allKeys = Object.keys(domEl);
      const reactKeys = allKeys.filter(k => k.startsWith("__"));
      let fiber = api.react.getFiber(domEl);
      if (!fiber) {
        for (const k of reactKeys) {
          if (k.startsWith("__reactFiber$")) { fiber = domEl[k]; if (fiber) break; }
        }
        if (!fiber) { setTimeout(tryHook, 2000); return; }
      }

      let depth = 0;
      while (fiber && depth < 20) {
        const hookVals = [];
        let h = fiber.memoizedState;
        while (h) { const v = h.memoizedState; if (typeof v === "string") hookVals.push(v); h = h.next; }
        for (const val of hookVals) {
          if (val === "preview" || val === "collapsed" || val === "expanded") {
            let hook = fiber.memoizedState;
            while (hook) {
              if (hook.memoizedState === val) {
                if (val === "collapsed") { try { hook.queue.dispatch("preview"); } catch(e) {} }
                const orig = hook.queue.dispatch;
                hook.queue.dispatch = (nv) => { if (nv === "collapsed") nv = "preview"; orig(nv); };
                return;
              }
              hook = hook.next;
            }
          }
        }
        fiber = fiber.return; depth++;
      }
    };

    setTimeout(tryHook, 500);
    const iv = setInterval(() => {
      if (disposed) { clearInterval(iv); return; }
      if (document.querySelector(SEL)) tryHook();
    }, 3000);

    return () => { disposed = true; };
  },
};

// ─────────────────────────────────────────────────────── main process ──

const REASONING_FIXES_IPC_KEY = "__reasoningFixesIpcHandler";
function startMainHandler(api) {
  if (globalThis[REASONING_FIXES_IPC_KEY]) { api.log.info("[reasoning-fixes] main handler already registered"); return; }
  globalThis[REASONING_FIXES_IPC_KEY] = true;
  try {
    if (typeof api.ipc?.handle !== "function") { api.log.error("[reasoning-fixes] api.ipc.handle not available"); return; }
    api.ipc.handle("reasoning-fixes:patch-asar", async (_event, { action, features }) => {
      try { return await handleAsarPatch(action, features); }
      catch (e) { return { ok: false, error: String(e) }; }
    });
    api.log.info("[reasoning-fixes] main handler ready");
  } catch (e) {
    api.log.error("[reasoning-fixes] failed to register IPC handler: " + (e?.message || String(e)));
  }
}

async function handleAsarPatch(action, features) {
  const path = require("node:path");
  const fs = require("node:fs");
  const { execSync } = require("node:child_process");
  const ASAR = "/Applications/Codex.app/Contents/Resources/app.asar";
  const PLIST = "/Applications/Codex.app/Contents/Info.plist";
  const SCRIPT = path.join(__dirname, "patch_codex_app_asar.py");
  const featureFlags = Array.isArray(features) && features.length ? features : ["all"];

  if (action === "apply") {
    if (!fs.existsSync(SCRIPT)) return { ok: false, error: `patch script not found` };
    try { execSync("which npx", { stdio: "ignore" }); } catch { return { ok: false, error: "npx not found" }; }
    try {
      const flags = featureFlags.map(f => `--enable "${f}"`).join(" ");
      execSync(`python3 "${SCRIPT}" --asar "${ASAR}" --info-plist "${PLIST}" ${flags}`, { stdio: "pipe", timeout: 30_000 });
      try { execSync(`codesign --force --deep --sign - "/Applications/Codex.app"`, { stdio: "pipe", timeout: 15_000 }); } catch {}
      return { ok: true };
    } catch (e) { return { ok: false, error: e.stderr?.toString() || e.stdout?.toString() || String(e) }; }
  }

  if (action === "revert") {
    const dir = path.dirname(ASAR);
    let backups;
    try { backups = fs.readdirSync(dir).filter(f => f.startsWith("app.asar.bak.")); } catch { return { ok: false, error: "cannot read backups" }; }
    if (!backups.length) return { ok: false, error: "no backup found" };
    backups.sort().reverse();
    try {
      fs.copyFileSync(path.join(dir, backups[0]), ASAR);
      const pb = fs.readdirSync(dir).filter(f => f.startsWith("Info.plist.bak."));
      if (pb.length) { pb.sort().reverse(); fs.copyFileSync(path.join(dir, pb[0]), PLIST); }
      try { execSync(`codesign --force --deep --sign - "/Applications/Codex.app"`, { stdio: "pipe", timeout: 15_000 }); } catch {}
      return { ok: true };
    } catch (e) { return { ok: false, error: String(e) }; }
  }
  return { ok: false, error: `unknown action: ${action}` };
}

// ─────────────────────────────────────────────────────────────── helpers ──

function readFlag(api, id, fallback) {
  const v = api.storage.get(`feature:${id}`, undefined);
  return typeof v === "boolean" ? v : !!fallback;
}
function writeFlag(api, id, on) { api.storage.set(`feature:${id}`, !!on); }

function readStyle(api, id, fallback) {
  const v = api.storage.get(`style:${id}`, undefined);
  return typeof v === "string" ? v : fallback;
}
function writeStyle(api, id, val) { api.storage.set(`style:${id}`, val); }

function el(tag, c) { const n = document.createElement(tag); if (c) n.className = c; return n; }
function sectionTitle(text) {
  const r = el("div", "flex h-toolbar items-center justify-between gap-2 px-0 py-0");
  const inner = el("div", "flex min-w-0 flex-1 flex-col gap-1");
  const t = el("div", "text-base font-medium text-token-text-primary");
  t.textContent = text; inner.appendChild(t); r.appendChild(inner); return r;
}
function roundedCard() {
  const c = el("div", "border-token-border flex flex-col divide-y-[0.5px] divide-token-border rounded-lg border");
  c.style.backgroundColor = "var(--color-background-panel, var(--color-token-bg-fog))";
  return c;
}
function switchControl(initial, onChange) {
  const btn = document.createElement("button");
  btn.type = "button"; btn.setAttribute("role", "switch");
  const pill = document.createElement("span");
  const knob = document.createElement("span");
  knob.className = "rounded-full border border-[color:var(--gray-0)] bg-[color:var(--gray-0)] shadow-sm transition-transform duration-200 ease-out h-4 w-4";
  pill.appendChild(knob);
  const apply = (on) => {
    btn.setAttribute("aria-checked", String(on));
    btn.dataset.state = on ? "checked" : "unchecked";
    btn.className = "inline-flex items-center text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-token-focus-border focus-visible:rounded-full cursor-interaction";
    pill.className = "relative inline-flex shrink-0 items-center rounded-full transition-colors duration-200 ease-out h-5 w-8 " + (on ? "bg-token-charts-blue" : "bg-token-foreground/20");
    pill.dataset.state = on ? "checked" : "unchecked";
    knob.dataset.state = on ? "checked" : "unchecked";
    knob.style.transform = on ? "translateX(14px)" : "translateX(2px)";
  };
  apply(initial);
  btn.appendChild(pill);
  btn.addEventListener("click", async (e) => {
    e.preventDefault(); e.stopPropagation();
    const next = btn.getAttribute("aria-checked") !== "true";
    apply(next); btn.disabled = true;
    try { await onChange?.(next); } finally { btn.disabled = false; }
  });
  return btn;
}

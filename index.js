/**
 * Reasoning & Exploration Fixes
 *
 * A Codex++ tweak (https://github.com/b-nnett/codex-plusplus) that improves
 * Codex Desktop's conversation UI.
 *
 * Features
 * --------
 *  • Exploration accordion stays open (fiber hook, live)
 *  • Reasoning items visible in conversation (source patch)
 *  • Reasoning display: scrollable or fully expanded (CSS injection, live)
 *
 * Architecture
 * ------------
 *  Source-backed features use a Codex++ main-process source patcher that
 *  wraps Electron's protocol.handle("app") to transform JS chunks in memory.
 *  No ASAR extraction, repacking, or codesigning needed.
 *
 *  The exploration-keep-open feature walks React's fiber tree from the
 *  exploration accordion DOM element upward to find the useState hook and
 *  intercept "collapsed" dispatch → rewrite to "preview".
 *
 * Acknowledgments
 *  • codex++: https://github.com/b-nnett/codex-plusplus
 *  • Original source-patch inspiration:
 *    https://gist.github.com/andrew-kramer-inno/3fa1063b967cfad2bc6f7cd9af1249fd
 * License: MIT
 */

const MAIN_STOP_KEY = "__reasoningFixesMainStop";
const RENDERER_STATE_KEY = "__reasoningFixesRendererState";
const SETTINGS_PAGE_KEY = "__reasoningFixesSettingsPage";

/** @type {import("@codex-plusplus/sdk").Tweak} */
module.exports = {
  start(api) {
    try {
      if (api.process === "main") {
        const { startReasoningFixesMain } = require("./source-patcher.js");
        globalThis[MAIN_STOP_KEY] = startReasoningFixesMain(api);
        return;
      }
    } catch (e) {
      api.log.error("[reasoning-fixes] start failed in main:", e?.message || String(e), e?.stack || "");
      return;
    }

    // ── renderer ──────────────────────────────────────────────────────
    const state = {
      api,
      features: new Map(),
      cssInjections: new Map(),
      defaults: {
        "exploration-keep-open": true,
        "show-reasoning": true,
        "reasoning-style": "expanded",
      },
    };
    globalThis[RENDERER_STATE_KEY] = state;

    // Register settings page
    if (typeof api.settings?.registerPage === "function") {
      globalThis[SETTINGS_PAGE_KEY] = api.settings.registerPage({
        id: "main",
        title: "Reasoning & Exploration Fixes",
        description: "Control how reasoning and exploration display in conversations.",
        iconSvg:
          '<svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" class="icon-sm inline-block align-middle">' +
          '<path d="M10 3v14M3 10h14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>' +
          '<circle cx="10" cy="10" r="7" stroke="currentColor" stroke-width="1.5" fill="none"/>' +
          "</svg>",
        render: (root) => renderSettings(root, state),
      });
    }

    // Activate live features
    if (readFlag(state.api, "exploration-keep-open", true)) {
      activateFeature(state, "exploration-keep-open");
    }
    applyReasoningStyle(state, readStyle(state.api, "reasoning-style", "expanded"));
  },

  stop() {
    try {
      const mainStop = globalThis[MAIN_STOP_KEY];
      if (mainStop) { try { mainStop(); } catch (e) {} }
    } catch (e) {}
    globalThis[MAIN_STOP_KEY] = null;

    const s = globalThis[RENDERER_STATE_KEY];
    if (!s) return;
    for (const [, f] of s.features) {
      try { f.dispose?.(); } catch (e) { s.api.log.warn("dispose failed", e); }
    }
    s.features.clear();
    for (const [, dispose] of s.cssInjections) {
      try { dispose?.(); } catch (e) {}
    }
    s.cssInjections.clear();

    try {
      const page = globalThis[SETTINGS_PAGE_KEY];
      if (page) page.unregister();
    } catch (e) {}
    globalThis[SETTINGS_PAGE_KEY] = null;
    globalThis[RENDERER_STATE_KEY] = null;
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
    desc: "Exploration panel stays expanded after Codex finishes searching. No restart needed.",
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
    desc: "Thinking steps and reasoning items appear in the message log.",
    source: true,
  }));

  rsnCard.appendChild(styleChoiceRow(state, {
    id: "reasoning-style",
    label: "Content display",
    desc: "Expanded shows full text; Scroll uses a compact box.",
    choices: [
      { value: "expanded", label: "Expanded" },
      { value: "scroll", label: "Scroll" },
    ],
  }));

  rsnSection.appendChild(rsnCard);
  container.appendChild(rsnSection);

  root.appendChild(container);
}

function featureRow(state, f) {
  const row = el("div", "flex items-center justify-between gap-4 p-3");
  const left = el("div", "flex min-w-0 flex-1 flex-col gap-1");
  const label = el("div", "min-w-0 text-sm text-token-text-primary");
  label.textContent = f.label;
  left.appendChild(label);
  if (f.desc) {
    const desc = el("div", "text-token-text-secondary min-w-0 text-sm");
    desc.textContent = f.desc;
    left.appendChild(desc);
  }
  if (f.source) {
    const warn = sourceWarningLine();
    left.appendChild(warn);
    const update = () => updateSourceWarning(state, f.id, warn);
    state.sourceStatusSubscribers ??= new Set();
    state.sourceStatusSubscribers.add(update);
    update();
  }
  row.appendChild(left);

  const initial = readFlag(state.api, f.id, state.defaults[f.id] === true);
  const sw = switchControl(initial, async (next) => {
    writeFlag(state.api, f.id, next);
    state.api.log.info("feature toggle", f.id, next);
    await setSourceFeature(state, f.id, next);
  });
  row.appendChild(sw);
  return row;
}

function sourceWarningLine() {
  return el("div", "hidden rounded-md bg-token-editor-warning-background px-2 py-1 text-xs text-token-editor-warning-foreground");
}

function updateSourceWarning(state, id, line) {
  const group = state.sourceStatus?.groups?.[id];
  const msg = group?.status === "unsupported" || group?.status === "forced_active" ? group.message : "";
  line.textContent = msg || "";
  line.classList.toggle("hidden", !msg);
}

function styleChoiceRow(state, f) {
  const row = el("div", "flex flex-col gap-2 p-3");

  const left = el("div", "flex flex-col gap-1");
  const label = el("div", "text-sm text-token-text-primary");
  label.textContent = f.label;
  left.appendChild(label);
  const desc = el("div", "text-token-text-secondary min-w-0 text-sm");
  desc.textContent = f.desc || "";
  left.appendChild(desc);
  row.appendChild(left);

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
      row.replaceWith(styleChoiceRow(state, f));
    });
    segGroup.appendChild(btn);
  }
  row.appendChild(segGroup);
  return row;
}

// ───────────────────────────────────────────────────── CSS injection ──

function applyReasoningStyle(state, style) {
  const prev = state.cssInjections.get("reasoning-style");
  if (prev) { try { prev(); } catch(e) {} state.cssInjections.delete("reasoning-style"); }

  if (style === "expanded") {
    // Expanded: no special CSS needed since the source patch already
    // keeps the full text visible. Just clean up any scroll CSS.
    state.api.log.info("reasoning style: expanded");
  } else {
    // Scroll: re-add the scroll constraint that the source patch removed.
    const styleEl = document.createElement("style");
    styleEl.id = "reasoning-fixes-scroll";
    styleEl.textContent = [
      '[class="[--edge-fade-distance:1rem]"] {',
      "  max-height: 140px !important;",
      "  overflow-y: auto !important;",
      "}",
    ].join("\n");
    document.head.appendChild(styleEl);
    state.cssInjections.set("reasoning-style", () => { styleEl.remove(); });
    state.api.log.info("reasoning style: scroll");
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

    const tryHook = () => {
      if (disposed) return;
      const domEl = document.querySelector(SEL);
      if (!domEl) { setTimeout(tryHook, 1000); return; }

      let fiber = api.react.getFiber(domEl);
      if (!fiber) {
        const fiberKey = Object.keys(domEl).find(k => k.startsWith("__reactFiber$"));
        if (fiberKey) fiber = domEl[fiberKey];
        if (!fiber) { setTimeout(tryHook, 2000); return; }
      }

      let depth = 0;
      while (fiber && depth < 20) {
        const strHooks = [];
        let h = fiber.memoizedState;
        while (h) {
          if (typeof h.memoizedState === "string") strHooks.push(h.memoizedState);
          h = h.next;
        }
        for (const val of strHooks) {
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
        fiber = fiber.return;
        depth++;
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

// ───────────────────────────────────────────────────────── source IPC ──

async function refreshSourceStatus(state) {
  try {
    const result = await state.api.ipc.invoke("source-patches-v1", { action: "status" });
    state.sourceStatus = result;
    if (result?.settings) syncSourceFlags(state, result.settings);
    for (const cb of state.sourceStatusSubscribers || []) {
      try { cb(); } catch (e) {}
    }
  } catch (e) {
    state.api.log.warn("source status refresh failed", e?.message || String(e));
  }
}

async function setSourceFeature(state, id, value) {
  try {
    const result = await state.api.ipc.invoke("source-patches-v1", { action: "set-feature", id, value });
    state.sourceStatus = result;
    await refreshSourceStatus(state);
  } catch (e) {
    state.api.log.warn("source feature update failed", id, e?.message || String(e));
  }
}

function syncSourceFlags(state, settings) {
  for (const id of ["show-reasoning"]) {
    if (typeof settings[id] === "boolean") writeFlag(state.api, id, settings[id]);
  }
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
  knob.className =
    "rounded-full border border-[color:var(--gray-0)] bg-[color:var(--gray-0)] " +
    "shadow-sm transition-transform duration-200 ease-out h-4 w-4";
  pill.appendChild(knob);
  const apply = (on) => {
    btn.setAttribute("aria-checked", String(on));
    btn.dataset.state = on ? "checked" : "unchecked";
    btn.className =
      "inline-flex shrink-0 items-center text-sm focus-visible:outline-none " +
      "focus-visible:ring-2 focus-visible:ring-token-focus-border focus-visible:rounded-full " +
      "cursor-interaction";
    pill.className =
      "relative inline-flex shrink-0 items-center rounded-full transition-colors " +
      "duration-200 ease-out h-5 w-8 " +
      (on ? "bg-token-charts-blue" : "bg-token-foreground/20");
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

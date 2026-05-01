/**
 * Reasoning & Exploration Fixes
 *
 * A Codex++ tweak (https://github.com/b-nnett/codex-plusplus) that improves
 * Codex Desktop's conversation UI.
 *
 * Features
 * --------
 *  • prevent-collapse         Keep the exploration accordion expanded after it
 *                             finishes exploring.
 *  • show-reasoning           Show "Thinking…" / "Thought for Xs" items in the
 *                             message log instead of hiding them inside the
 *                             exploration accordion.
 *  • reasoning-start-expanded Make reasoning items start expanded so you can
 *                             read them without clicking each one.
 *  • reasoning-full-expand    Remove the max-height scroll constraint on
 *                             expanded reasoning content — the full text is
 *                             visible without scrolling.
 *
 * Architecture
 * ------------
 *   prevent-collapse walks React's fiber tree from the exploration accordion
 *   DOM element upward, finds the useState hook controlling panel state, and
 *   wraps dispatch to intercept "collapsed" → rewrite to "preview".
 *
 *   All other features modify the app.asar on disk using patch_codex_app_asar.py.
 *   The main-process IPC handler runs the script and updates ElectronAsarIntegrity.
 *
 * Acknowledgments
 * --------------
 *  • codex++ runtime & API: https://github.com/b-nnett/codex-plusplus
 *  • Original ASAR patch inspiration: andrew-kramer-inno's gist
 *    https://gist.github.com/andrew-kramer-inno/3fa1063b967cfad2bc6f7cd9af1249fd
 *
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

    // ── renderer ──────────────────────────────────────────────────────
    const state = {
      api,
      features: new Map(),
      defaults: {
        "prevent-collapse": true,
        "show-reasoning": true,
        "reasoning-start-expanded": true,
        "reasoning-full-expand": false,
      },
    };
    this._state = state;

    // Register settings page
    if (typeof api.settings?.registerPage === "function") {
      this._pageHandle = api.settings.registerPage({
        id: "main",
        title: "Reasoning & Exploration Fixes",
        description: "Toggle display fixes for reasoning and exploration panels.",
        iconSvg:
          '<svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" class="icon-sm inline-block align-middle">' +
          '<path d="M10 3v14M3 10h14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>' +
          '<circle cx="10" cy="10" r="7" stroke="currentColor" stroke-width="1.5" fill="none"/>' +
          "</svg>",
        render: (root) => renderSettings(root, state),
      });
    }

    // Activate features per stored prefs
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

// ─────────────────────────────────────────────────────────── settings UI ──

function renderSettings(root, state) {
  const features = [
    {
      id: "prevent-collapse",
      title: "Prevent exploration auto-collapse",
      description:
        "Keep the exploration accordion expanded after Codex finishes exploring files and running commands.",
    },
    {
      id: "show-reasoning",
      title: "Show reasoning items in chat",
      description:
        'Show "Thinking…" / "Thought for Xs" entries in the conversation log. Applies an ASAR patch. Restart required.',
    },
    {
      id: "reasoning-start-expanded",
      title: "Reasoning starts expanded",
      description:
        "Reasoning items open expanded by default so you can read them without clicking each one. Applies an ASAR patch. Restart required.",
    },
    {
      id: "reasoning-full-expand",
      title: "Full reasoning without scrolling",
      description:
        "Remove the max-height scroll constraint on reasoning content — the entire reasoning text is visible without scrolling inside each item. Applies an ASAR patch. Restart required.",
    },
  ];

  const section = el("section", "flex flex-col gap-2");
  section.appendChild(sectionTitle("Features"));

  const card = roundedCard();
  for (const f of features) {
    card.appendChild(featureRow(state, f));
  }
  section.appendChild(card);
  root.appendChild(section);
}

function featureRow(state, f) {
  const row = el("div", "flex items-center justify-between gap-4 p-3");

  const left = el("div", "flex min-w-0 flex-col gap-1");
  const label = el("div", "min-w-0 text-sm text-token-text-primary");
  label.textContent = f.title;
  left.appendChild(label);
  if (f.description) {
    const desc = el("div", "text-token-text-secondary min-w-0 text-sm");
    desc.textContent = f.description;
    left.appendChild(desc);
  }
  row.appendChild(left);

  const needsAsar = f.id !== "prevent-collapse";
  const initial = readFlag(state.api, f.id, state.defaults[f.id]);
  const sw = switchControl(initial, async (next) => {
    writeFlag(state.api, f.id, next);
    if (needsAsar) {
      try {
        const action = next ? "apply" : "revert";
        const result = await state.api.ipc.invoke("reasoning-fixes:patch-asar", { action, features: [f.id] });
        if (result?.ok) {
          state.api.log.info("asar patch", action, f.id, "ok");
        } else {
          state.api.log.error("asar patch", action, f.id, "failed", result?.error);
        }
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

// ─────────────────────────────────────────────────────────── feature reg ──

function activateFeature(state, id) {
  if (state.features.has(id)) return;
  const fn = FEATURES[id];
  if (!fn) {
    state.api.log.warn("unknown feature", id);
    return;
  }
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

// ─────────────────────────────────────────────────────────────── features ──

const FEATURES = {
  "prevent-collapse"(api) {
    const SEL = '[data-testid="exploration-accordion-body"]';
    let disposed = false;
    let retryCount = 0;

    const tryHook = () => {
      if (disposed) return;
      const domEl = document.querySelector(SEL);
      if (!domEl) {
        if (retryCount < 20) {
          retryCount++;
          setTimeout(tryHook, 1000);
        }
        return;
      }
      retryCount = 0;

      // Log all React-internal properties for debugging
      const allKeys = Object.keys(domEl);
      const reactKeys = allKeys.filter(function(k) { return k.startsWith("__"); });
      api.log.info("domEl __props: " + (reactKeys.length > 0 ? reactKeys.join(", ") : "NONE"));

      // Try the codex++ getFiber API first
      let fiber = api.react.getFiber(domEl);
      if (fiber) {
        api.log.info("FIBER OK: type=" + (fiber.type?.name || typeof fiber.type) + " tag=" + fiber.tag);
      } else {
        // Fallback: read the __reactFiber$ property directly from the DOM node
        for (const k of reactKeys) {
          if (k.startsWith("__reactFiber$")) {
            const f = domEl[k];
            if (f) {
              api.log.info("MANUAL fiber: type=" + (f.type?.name || typeof f.type) + " tag=" + f.tag);
              fiber = f;
              break;
            }
          }
        }
        if (!fiber) {
          api.log.info("NO FIBER FOUND - retrying in 2s");
          setTimeout(tryHook, 2000);
          return;
        }
      }

      // Walk fiber ancestors looking for the useState hook that controls
      // exploration panel state (values: "preview", "collapsed", "expanded")
      let depth = 0;
      while (fiber && depth < 20) {
        const typeName = fiber.type?.name || fiber.type?.displayName || (typeof fiber.type === "string" ? fiber.type : "?");
        const hookVals = [];
        let h = fiber.memoizedState;
        while (h) {
          const v = h.memoizedState;
          if (typeof v === "string") hookVals.push(v);
          h = h.next;
        }

        if (hookVals.length > 0) {
          api.log.info("fib[" + depth + "] " + typeName + " hooks=" + hookVals.join(","));
        }

        // Check for our target hook — the one with "preview"/"collapsed"/"expanded"
        for (const val of hookVals) {
          if (val === "preview" || val === "collapsed" || val === "expanded") {
            let hook = fiber.memoizedState;
            while (hook) {
              if (hook.memoizedState === val) {
                if (val === "collapsed") {
                  try { hook.queue.dispatch("preview"); } catch(e) {}
                }
                const orig = hook.queue.dispatch;
                hook.queue.dispatch = (nv) => {
                  if (nv === "collapsed") nv = "preview";
                  orig(nv);
                };
                api.log.info("HOK: " + val + " → preview at " + typeName + " d=" + depth);
                return;
              }
              hook = hook.next;
            }
          }
        }
        fiber = fiber.return;
        depth++;
      }
      api.log.info("walk end at depth " + depth);
    };

    // Initial attempt with delay
    setTimeout(tryHook, 500);
    // Periodic retry in case element appears later (dynamic rendering)
    const iv = setInterval(function() {
      if (disposed) { clearInterval(iv); return; }
      const el = document.querySelector(SEL);
      if (el) tryHook();
    }, 3000);

    return () => { disposed = true; };
  },
};

// ─────────────────────────────────────────────────────── main process ──

const REASONING_FIXES_IPC_KEY = "__reasoningFixesIpcHandler";
function startMainHandler(api) {
  if (globalThis[REASONING_FIXES_IPC_KEY]) {
    api.log.info("[reasoning-fixes] main handler already registered, skipping");
    return;
  }
  globalThis[REASONING_FIXES_IPC_KEY] = true;
  try {
    if (typeof api.ipc?.handle !== "function") {
      api.log.error("[reasoning-fixes] api.ipc.handle not available");
      return;
    }
    api.ipc.handle("reasoning-fixes:patch-asar", async (_event, { action, features }) => {
      try {
        return await handleAsarPatch(action, features);
      } catch (e) {
        return { ok: false, error: String(e) };
      }
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

  // Build feature flags for the patch script
  const featureFlags = Array.isArray(features) ? features : ["all"];

  if (action === "apply") {
    if (!fs.existsSync(SCRIPT)) {
      return { ok: false, error: `patch script not found: ${SCRIPT}` };
    }
    try {
      execSync("which npx", { stdio: "ignore" });
    } catch {
      return { ok: false, error: "npx not found on PATH" };
    }
    try {
      const flags = featureFlags.map(f => `--enable "${f}"`).join(" ");
      execSync(`python3 "${SCRIPT}" --asar "${ASAR}" --info-plist "${PLIST}" ${flags}`, {
        stdio: "pipe",
        timeout: 30_000,
      });
      try {
        execSync(`codesign --force --deep --sign - "/Applications/Codex.app"`, {
          stdio: "pipe",
          timeout: 15_000,
        });
      } catch { /* ad-hoc signing is best-effort */ }
      return { ok: true };
    } catch (e) {
      const msg = e.stderr?.toString() || e.stdout?.toString() || String(e);
      return { ok: false, error: msg };
    }
  }

  if (action === "revert") {
    const dir = path.dirname(ASAR);
    let backups;
    try {
      backups = fs.readdirSync(dir).filter((f) => f.startsWith("app.asar.bak."));
    } catch {
      return { ok: false, error: "cannot read backups dir" };
    }
    if (backups.length === 0) {
      return { ok: false, error: "no backup found to restore" };
    }
    backups.sort().reverse();
    const bakPath = path.join(dir, backups[0]);
    try {
      fs.copyFileSync(bakPath, ASAR);
      const plistBaks = fs.readdirSync(dir).filter((f) => f.startsWith("Info.plist.bak."));
      if (plistBaks.length > 0) {
        plistBaks.sort().reverse();
        fs.copyFileSync(path.join(dir, plistBaks[0]), PLIST);
      }
      try {
        execSync(`codesign --force --deep --sign - "/Applications/Codex.app"`, {
          stdio: "pipe",
          timeout: 15_000,
        });
      } catch { /* not critical */ }
      return { ok: true };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  }

  return { ok: false, error: `unknown action: ${action}` };
}

// ─────────────────────────────────────────────────────────────── helpers ──

function readFlag(api, id, fallback) {
  const v = api.storage.get(`feature:${id}`, undefined);
  return typeof v === "boolean" ? v : !!fallback;
}

function writeFlag(api, id, on) {
  api.storage.set(`feature:${id}`, !!on);
}

function el(tag, className) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

function sectionTitle(text) {
  const titleRow = el("div", "flex h-toolbar items-center justify-between gap-2 px-0 py-0");
  const inner = el("div", "flex min-w-0 flex-1 flex-col gap-1");
  const t = el("div", "text-base font-medium text-token-text-primary");
  t.textContent = text;
  inner.appendChild(t);
  titleRow.appendChild(inner);
  return titleRow;
}

function roundedCard() {
  const card = el(
    "div",
    "border-token-border flex flex-col divide-y-[0.5px] divide-token-border rounded-lg border",
  );
  card.style.backgroundColor =
    "var(--color-background-panel, var(--color-token-bg-fog))";
  return card;
}

function switchControl(initial, onChange) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.setAttribute("role", "switch");
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
      "inline-flex items-center text-sm focus-visible:outline-none focus-visible:ring-2 " +
      "focus-visible:ring-token-focus-border focus-visible:rounded-full cursor-interaction";
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
    e.preventDefault();
    e.stopPropagation();
    const next = btn.getAttribute("aria-checked") !== "true";
    apply(next);
    btn.disabled = true;
    try { await onChange?.(next); } finally { btn.disabled = false; }
  });
  return btn;
}

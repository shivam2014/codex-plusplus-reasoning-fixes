#!/usr/bin/env node
/**
 * verify-patches.js — Standalone verification script
 *
 * Extracts the current Codex ASAR, runs all patches against the bundle files,
 * and reports which patches match, auto-heal, or are dead.
 *
 * Usage: node scripts/verify-patches.js
 *        ASAR_DIR=/tmp/asar node scripts/verify-patches.js
 */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

// Load the source-patcher module (from repo root)
const patcher = require("../source-patcher.js");

// The PATCHES and bundleForUrl are internal — we need them for verification
// Extract PATCHES and bundleForUrl from the file by requiring the module
// Since they're not exported, we just re-replicate the bundle-matching logic

const ASAR_DIR = process.env.ASAR_DIR || "/tmp/asar";
const APP_ASAR = "/Applications/Codex.app/Contents/Resources/app.asar";

// Parse the PATCHES out of source-patcher.js
const sourceText = fs.readFileSync(path.join(__dirname, "..", "source-patcher.js"), "utf8");

// Eval to get the PATCHES const. Safer: we just parse the text ourselves.
// But since it's our own code, we can use a simple regex to extract the PATCHES object
// Actually, the cleanest approach: copy the PATCHES definitions here directly.
// Instead, let's re-implement the key functions by extracting them.

// Better approach: read the file and use Function() to get the const.
// We extract each PATCHES entry manually for verification.

// Just re-use the bundle matching logic
function bundleForUrl(basename) {
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

// Extract PATCHES by eval'ing the relevant section
function extractPatches() {
  // We need to extract the PATCHES, DEFAULTS, SETTING_FEATURES, and helper functions
  // from source-patcher.js. Use module require to get the raw source access is tricky.
  // Instead, let's load the whole file and run the relevant functions.

  // The source-patcher exports startReasoningFixesMain, but the PATCHES are internal.
  // We need to replicate the matching logic here.
  const patchesText = sourceText.match(/const PATCHES = (\{[^]*?\n\});/);
  if (!patchesText) {
    console.error("Could not extract PATCHES from source-patcher.js");
    process.exit(1);
  }

  // Evaluate in a sandbox
  const PATCHES = eval("(" + patchesText[1] + ")");
  return PATCHES;
}

function countMatches(source, re) {
  const flags = re.flags.includes("g") ? re.flags : `${re.flags}g`;
  const global = new RegExp(re.source, flags);
  return Array.from(source.matchAll(global)).length;
}

function matchSkeleton(text, skeletonRe) {
  const flags = skeletonRe.flags.includes("g") ? skeletonRe.flags : `${skeletonRe.flags}g`;
  const globalRe = new RegExp(skeletonRe.source, flags);
  const allMatches = Array.from(text.matchAll(globalRe));
  if (allMatches.length === 0) return { count: 0 };
  if (allMatches.length > 1) return { count: allMatches.length };
  const m = allMatches[0];
  const captures = {};
  for (let i = 1; i < m.length; i++) captures[i] = m[i];
  return { count: 1, matchText: m[0], captures };
}

function runVerification() {
  console.log("=".repeat(72));
  console.log("AUTO-HEALING PATCH VERIFICATION");
  console.log("Base: v1.2.0 source-patcher.js with skeleton definitions");
  console.log("Target: Codex " + getCodexVersion());
  console.log("ASAR: " + APP_ASAR);
  console.log("=".repeat(72));

  // Extract ASAR if not already
  if (!fs.existsSync(ASAR_DIR)) {
    console.log("\nExtracting ASAR...");
    execSync(`npx asar extract "${APP_ASAR}" "${ASAR_DIR}"`, { stdio: "pipe" });
    console.log("Done.");
  }

  // Read all JS files from the webview assets directory
  const assetsDir = path.join(ASAR_DIR, "webview", "assets");
  if (!fs.existsSync(assetsDir)) {
    console.error("Assets directory not found:", assetsDir);
    process.exit(1);
  }

  const allFiles = fs.readdirSync(assetsDir).filter(f => f.endsWith(".js"));

  // Get PATCHES
  const PATCHES = extractPatches();

  // Group files by bundle type
  const bundleFiles = {};
  for (const f of allFiles) {
    const bundle = bundleForUrl(f);
    if (bundle) {
      if (!bundleFiles[bundle]) bundleFiles[bundle] = [];
      bundleFiles[bundle].push(f);
    }
  }

  console.log("\nBundle files found:");
  for (const [bundle, files] of Object.entries(bundleFiles)) {
    console.log(`  ${bundle}: ${files.join(", ")}`);
  }

  // Results tracking
  const results = {};
  let exactOk = 0, healed = 0, structuralRewrite = 0, ambiguous = 0, alreadyApplied = 0, noSkeleton = 0, other = 0;

  // For each patch
  for (const [feature, rule] of Object.entries(PATCHES)) {
    const bundleType = rule.bundle;
    const files = bundleFiles[bundleType] || [];

    if (files.length === 0) {
      results[feature] = { status: "no_bundle_files", bundle: bundleType, detail: "No matching bundle files found" };
      noSkeleton++;
      continue;
    }

    let best = null;

    for (const fname of files) {
      const fpath = path.join(assetsDir, fname);
      const text = fs.readFileSync(fpath, "utf8");

      // Tier 1: exact match
      const unpatchedCount = countMatches(text, rule.unpatched);
      const patchedCount = countMatches(text, rule.patched);

      if (unpatchedCount >= 1 && patchedCount === 0) {
        // Try applying and verify
        const replaced = text.replace(rule.unpatched, rule.replacement);
        if (replaced !== text) {
          const newPatchedCount = countMatches(replaced, rule.patched);
          if (newPatchedCount >= 1 || rule.patched.test(replaced)) {
            best = { status: "EXACT_OK", bundle: bundleType, file: fname, detail: `exact match` };
            break;
          }
        }
      } else if (unpatchedCount === 0 && patchedCount >= 1) {
        best = { status: "ALREADY_APPLIED", bundle: bundleType, file: fname, detail: `already patched (${patchedCount} matches)` };
      }

      // If Tier 1 failed or partially failed, try auto-heal
      if (!best && rule.skeleton) {
        // Check if skeleton.verify matches first (already-applied check)
        if (rule.skeleton.verify) {
          const verifyCount = countMatches(text, rule.skeleton.verify);
          if (verifyCount >= 1) {
            best = { status: "ALREADY_APPLIED", bundle: bundleType, file: fname, detail: `already patched (skeleton verify: ${verifyCount})` };
            continue;
          }
        }

        const matchResult = matchSkeleton(text, rule.skeleton.match);
        if (matchResult.count === 0) {
          // No skeleton match in this file — try next file
          continue;
        } else if (matchResult.count > 1) {
          best = { status: "AMBIGUOUS", bundle: bundleType, file: fname, detail: `${matchResult.count} skeleton matches — fingerprint too loose` };
          continue;
        }

        // Exactly 1 match — try healing
        const capturedGroups = [];
        for (let i = 1; i <= Object.keys(matchResult.captures).length; i++) {
          capturedGroups.push(matchResult.captures[i]);
        }

        let healedReplacement;
        if (typeof rule.skeleton.replacement === "function") {
          healedReplacement = rule.skeleton.replacement(matchResult.captures);
        } else {
          healedReplacement = rule.skeleton.replacement;
        }

        const healedText = text.replace(rule.skeleton.match, () => healedReplacement);
        if (healedText !== text) {
          // Verify
          let verified = false;
          if (rule.skeleton.verify) {
            const vc = countMatches(healedText, rule.skeleton.verify);
            if (vc >= 1) verified = true;
          }
          if (!verified) {
            const pc = countMatches(healedText, rule.patched);
            if (pc >= 1) verified = true;
          }
          if (verified) {
            const capStrs = Object.values(matchResult.captures).slice(0, 5).join(", ");
            best = { status: "HEALED", bundle: bundleType, file: fname, detail: `skeleton matched, captured: [${capStrs}]${Object.keys(matchResult.captures).length > 5 ? "..." : ""}` };
            break;
          } else {
            best = { status: "HEAL_VERIFY_FAILED", bundle: bundleType, file: fname, detail: "replacement applied but verify pattern didn't match" };
          }
        }
      } else if (!best && !rule.skeleton) {
        best = { status: "NO_SKELETON", bundle: bundleType, file: fname, detail: "no skeleton defined, exact match unavailable" };
      }
    }

    if (!best) best = { status: "STRUCTURAL_REWRITE", bundle: bundleType, detail: "0 skeleton matches in any bundle file — code may have moved/been removed" };
    results[feature] = best;

    // Tally
    const s = best?.status || "UNKNOWN";
    if (s === "EXACT_OK") exactOk++;
    else if (s === "HEALED") healed++;
    else if (s === "STRUCTURAL_REWRITE") structuralRewrite++;
    else if (s === "AMBIGUOUS") ambiguous++;
    else if (s === "ALREADY_APPLIED") alreadyApplied++;
    else if (s === "NO_SKELETON") noSkeleton++;
    else other++;
  }

  // Print results table
  console.log("\n" + "=".repeat(72));
  console.log("VERIFICATION RESULTS");
  console.log("=".repeat(72));
  console.log();
  console.log(`${"PATCH".padEnd(32)} ${"STATUS".padEnd(20)} ${"DETAIL"}`);
  console.log("-".repeat(72));

  for (const [feature, r] of Object.entries(results)) {
    const status = r.status.padEnd(20);
    const detail = r.detail || "";
    const icon = r.status === "EXACT_OK" ? "✅" :
                 r.status === "HEALED" ? "🩹" :
                 r.status === "ALREADY_APPLIED" ? "🔁" :
                 r.status === "STRUCTURAL_REWRITE" ? "💀" :
                 r.status === "AMBIGUOUS" ? "⚠️" :
                 r.status === "HEAL_VERIFY_FAILED" ? "❌" : "❓";
    console.log(`${icon} ${feature.padEnd(28)} ${status} ${detail.slice(0, 60)}`);
  }

  console.log("\n" + "-".repeat(72));
  console.log("SUMMARY");
  console.log("-".repeat(72));
  console.log(`  ✅ Exact OK:           ${exactOk}`);
  console.log(`  🔁 Already applied:    ${alreadyApplied}`);
  console.log(`  🩹 Auto-healed:        ${healed}`);
  console.log(`  💀 Structural rewrite: ${structuralRewrite}`);
  console.log(`  ⚠️  Ambiguous:          ${ambiguous}`);
  console.log(`  ❓ No skeleton:        ${noSkeleton}`);
  console.log(`  ❌ Other failures:     ${other}`);
  console.log(`  ─────────────────────────────`);
  console.log(`  Total:                ${Object.keys(results).length}`);
  console.log();
  console.log(`  Patches working:      ${exactOk + alreadyApplied + healed}/${Object.keys(results).length}`);
  console.log(`  (exact or auto-healed)`);

  // Return exit code
  if (healed > 0) {
    console.log("\n✅ AUTO-HEALING SUCCESSFUL: " + healed + " patches auto-healed!");
  }
  if (structuralRewrite > 0) {
    console.log("\n💀 " + structuralRewrite + " patches are structural rewrites — manual re-implementation needed.");
  }
}

function getCodexVersion() {
  try {
    const plist = fs.readFileSync("/Applications/Codex.app/Contents/Info.plist", "utf8");
    const match = plist.match(/CFBundleShortVersionString.*?<string>([^<]+)<\/string>/);
    return match ? "v" + match[1] : "unknown";
  } catch {
    return "unknown";
  }
}

runVerification();

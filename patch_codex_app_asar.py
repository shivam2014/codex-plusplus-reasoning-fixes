#!/usr/bin/env python3
"""
Patch the installed Codex macOS app by editing its Electron ASAR webview bundle.

Adapted from andrew-kramer-inno's original gist:
  https://gist.github.com/andrew-kramer-inno/3fa1063b967cfad2bc6f7cd9af1249fd

Patches:
  1. split_items_drop_reasoning_from_exploration
     — Don't aggregate reasoning into exploration, render as standalone
  2. exploration_no_autocollapse_on_finish
     — Keep accordion expanded after exploring
  3. reasoning_no_autocollapse_on_finish
     — Keep reasoning output visible after thinking completes
  4. reasoning_start_expanded
     — Change useState(o) to useState(!0) so reasoning items start expanded
  5. reasoning_full_expand
     — Remove max-h-35 overflow-y-auto so full text is visible without scrolling

Use --enable <feature> to apply only specific patches, or omit for all.

Built on Codex++ (https://github.com/b-nnett/codex-plusplus).
"""
from __future__ import annotations
import argparse, datetime as dt, hashlib, plistlib, re, struct, subprocess, sys, tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Match

DEFAULT_APP_ASAR = Path("/Applications/Codex.app/Contents/Resources/app.asar")
DEFAULT_INFO_PLIST = Path("/Applications/Codex.app/Contents/Info.plist")
Replacement = str | Callable[[Match[str]], str]

@dataclass(frozen=True)
class PatchRule:
    name: str
    unpatched: re.Pattern[str]
    replacement: Replacement
    patched: re.Pattern[str] | None = None
    expected_replacements: int = 1

def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""): h.update(chunk)
    return h.hexdigest()

def sha256_asar_header_json(path: Path) -> str:
    blob = path.read_bytes()
    json_len = struct.unpack_from("<I", blob, 12)[0]
    return hashlib.sha256(blob[16:16+json_len]).hexdigest()

def update_electron_asar_integrity(info_plist, *, asar_rel_key, header_hash):
    data = plistlib.loads(info_plist.read_bytes())
    entry = data["ElectronAsarIntegrity"][asar_rel_key]
    if entry.get("algorithm") != "SHA256":
        raise RuntimeError(f'Unexpected algorithm: {entry.get("algorithm")!r}')
    entry["hash"] = header_hash
    info_plist.write_bytes(plistlib.dumps(data, fmt=plistlib.FMT_XML, sort_keys=False))

def run_checked(*args, cwd=None):
    proc = subprocess.run(list(args), cwd=str(cwd) if cwd else None,
                          stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    if proc.returncode != 0:
        raise RuntimeError(f"Command failed ({proc.returncode}): {' '.join(args)}\n{proc.stdout}")
    return proc.stdout

def apply_rule(text, rule, *, dry_run):
    if rule.patched and rule.patched.search(text) and not rule.unpatched.search(text):
        return text, "already"
    if dry_run:
        count = len(list(rule.unpatched.finditer(text)))
        if count == 0 and rule.patched and rule.patched.search(text): return text, "already"
        if count != rule.expected_replacements:
            raise RuntimeError(f"{rule.name}: expected {rule.expected_replacements}, found {count}")
        return text, "would_apply"
    new_text, replaced = rule.unpatched.subn(rule.replacement, text)
    if replaced == 0 and rule.patched and rule.patched.search(text): return text, "already"
    if replaced != rule.expected_replacements:
        raise RuntimeError(f"{rule.name}: expected {rule.expected_replacements}, got {replaced}")
    return new_text, "applied"

def find_webview_bundle(extracted_root):
    idx = extracted_root / "webview/index.html"
    html = idx.read_text("utf-8", errors="strict")
    m = re.search(r'src=["\'][^"\']*assets/(index-[^"\']+\.js)["\']', html)
    if not m: raise RuntimeError("Could not locate webview bundle")
    return extracted_root / "webview/assets" / m.group(1)

def find_split_items_chunk(extracted_root):
    for f in (extracted_root / "webview/assets").iterdir():
        if f.name.startswith("split-items-into-render-groups-") and f.suffix == ".js": return f
    raise RuntimeError("Could not find split-items chunk")

def find_shimmer_chunk(extracted_root):
    for f in (extracted_root / "webview/assets").iterdir():
        if f.name.startswith("thinking-shimmer-") and f.suffix == ".js": return f
    raise RuntimeError("Could not find thinking-shimmer chunk")

PATCHES = {
    # 1. Render-group builder: don't aggregate reasoning into exploration
    "show-reasoning": PatchRule(name="split_items_drop_reasoning_from_exploration",
        unpatched=re.compile(r'if\(t\.type===`reasoning`\)\{i&&i\.push\(t\);continue\}'),
        patched=re.compile(r'if\(t\.type===`reasoning`\)\{i&&s\(`explored`\);r\.push\(\{kind:`item`,item:t\}\);continue\}'),
        replacement=r'if(t.type===`reasoning`){i&&s(`explored`);r.push({kind:`item`,item:t});continue}'),
    # 2. Don't collapse exploration accordion when done
    "prevent-collapse": PatchRule(name="exploration_no_autocollapse_on_finish",
        unpatched=re.compile(r'\(\)=>\{\w+\((\w+)\?`preview`:`collapsed`\)\}'),
        patched=re.compile(r'\(\)=>\{\w+&&\w+\(`preview`\)\}'),
        replacement=r'()=>{\1&&\2("preview")}'),
    # 3. Don't collapse reasoning output when thinking completes
    "reasoning-start-expanded": PatchRule(name="reasoning_no_autocollapse_on_finish",
        unpatched=re.compile(r'if\(!\w+\)\{\w+\(!1\);return\}'),
        patched=re.compile(r'if\(!\w+\)\{return\}'),
        replacement=r'if(!\1){return}'),
    # 4. Reasoning items start expanded (useState(!0) instead of useState(o))
    "reasoning-start-expanded": PatchRule(name="reasoning_start_expanded_useState",
        unpatched=re.compile(r'\[d,f\]=\\(0,Z\\.useState\\)\(o\),p=!o'),
        patched=re.compile(r'\[d,f\]=\\(0,Z\\.useState\\)\(!0\\),p=!o'),
        replacement=r'[d,f]=(0,Z.useState)(!0),p=!o'),
    # 5. Remove max-height scroll constraint on reasoning body
    "disable-shimmer": PatchRule(name="disable_thinking_shimmer",
        unpatched=re.compile(r'!\(\w+===void 0\|\|\1\)'),
        patched=re.compile(r'true'),
        replacement=r'true',
        expected_replacements=1),
    "reasoning-no-blink": PatchRule(name="reasoning_no_blink_during_stream",
        unpatched=re.compile(r'g=o\?\!\!h:d'),
        patched=re.compile(r'g=o\?\!0:d'),
        replacement=r'g=o?!0:d'),
    "reasoning-full-expand": PatchRule(name="reasoning_full_expand_no_scroll",
        unpatched=re.compile(r'`vertical-scroll-fade-mask max-h-35 overflow-y-auto \[--edge-fade-distance:1rem\]`'),
        patched=re.compile(r'`\[--edge-fade-distance:1rem\]`'),
        replacement=r'`[--edge-fade-distance:1rem]`'),
}

# Map feature names to which bundles they patch
FEATURE_BUNDLES = {
    "show-reasoning": "split-items",
    "prevent-collapse": "composer",
    "reasoning-start-expanded": "composer",
    "reasoning-full-expand": "composer",
    "disable-shimmer": "shimmer",
}

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--asar", default=str(DEFAULT_APP_ASAR))
    parser.add_argument("--info-plist", default=str(DEFAULT_INFO_PLIST))
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--enable", action="append", default=[],
                        help="Enable specific feature (can repeat). If omitted, all apply.")
    parser.add_argument("--no-beautify", action="store_true")
    parser.add_argument("--keep-extracted", action="store_true")
    parser.add_argument("--no-update-asar-integrity", action="store_true")
    args = parser.parse_args()
    app_asar = Path(args.asar).expanduser()
    if not app_asar.exists():
        print(f"ERROR: not found: {app_asar}", file=sys.stderr); return 2

    # Determine which features to apply
    features_to_apply = args.enable if args.enable else list(PATCHES.keys())

    ts = dt.datetime.now(dt.UTC).strftime("%Y%m%dT%H%M%SZ")
    backup_asar = app_asar.with_suffix(app_asar.suffix + f".bak.{ts}")
    tmp_out = Path(tempfile.gettempdir()) / f"codex.app.asar.patched.{ts}.asar"
    info_plist = Path(args.info_plist).expanduser()

    with tempfile.TemporaryDirectory(prefix="codex_app_asar_extract_") as tmpdir:
        extracted = Path(tmpdir)
        run_checked("npx", "-y", "asar", "extract", str(app_asar), str(extracted))

        bundles = {
            "composer": find_webview_bundle(extracted),
            "split-items": find_split_items_chunk(extracted),
            "shimmer": find_shimmer_chunk(extracted),
        }

        all_statuses = []
        bundle_texts = {k: v.read_text("utf-8", errors="strict") for k, v in bundles.items()}

        for feat_name in features_to_apply:
            rule = PATCHES.get(feat_name)
            if not rule:
                print(f"⚠️  unknown feature: {feat_name}")
                continue
            bundle_key = FEATURE_BUNDLES.get(feat_name, "composer")
            text = bundle_texts[bundle_key]
            text, status = apply_rule(text, rule, dry_run=args.dry_run)
            bundle_texts[bundle_key] = text
            all_statuses.append((feat_name, status))

        for name, status in all_statuses:
            print(f"{name}: {status}")

        if args.dry_run:
            return 0

        for key, text in bundle_texts.items():
            bundles[key].write_text(text, "utf-8")
            run_checked("node", "--check", str(bundles[key]))

        run_checked("npx", "-y", "asar", "pack", str(extracted), str(tmp_out))
        backup_asar.write_bytes(app_asar.read_bytes())
        app_asar.write_bytes(tmp_out.read_bytes())

        if not args.no_update_asar_integrity:
            h = sha256_asar_header_json(app_asar)
            update_electron_asar_integrity(info_plist, asar_rel_key="Resources/app.asar", header_hash=h)
            run_checked("plutil", "-lint", str(info_plist))

        if args.keep_extracted:
            keep = Path(tempfile.gettempdir()) / f"codex_app_asar_extract_keep.{ts}"
            extracted.replace(keep); print(f"kept_extracted: {keep}")

    print("PATCHED")
    print(f"asar: {app_asar}")
    print(f"backup: {backup_asar.name}")
    print(f"sha256(new): {sha256_file(app_asar)[:16]}...")
    if not args.no_update_asar_integrity:
        print(f"asar_header_sha256: {sha256_asar_header_json(app_asar)[:16]}...")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())

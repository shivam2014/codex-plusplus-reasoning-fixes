#!/usr/bin/env python3
"""
Patch the installed Codex macOS app by editing its Electron ASAR webview bundle.

Adapted from andrew-kramer-inno's original gist:
  https://gist.github.com/andrew-kramer-inno/3fa1063b967cfad2bc6f7cd9af1249fd

Uses the same 5-patch strategy with patterns updated for the current
Codex bundle structure (v26.429.20946, composer-B5UwBne4.js).

Patches:
  1. exploration_continuation_drop_reasoning    — Don't aggregate reasoning into exploration
  2. exploration_no_autocollapse_on_finish      — Keep accordion expanded after exploring
  3. show_reasoning_items_in_log                — Stop nulling reasoning in renderers
  4. reasoning_no_autocollapse_on_finish        — Keep reasoning output visible
  5. reasoning_autoscroll_user_scroll_flag       — Smart auto-scroll for reasoning panel

Built on Codex++ (https://github.com/b-nnett/codex-plusplus).

WARNING: Modifying files inside /Applications/Codex.app will break the app's code signature.
You may need to re-sign the app (or adjust Gatekeeper settings) after patching.

Codex.app also enables Electron's ASAR integrity check. After repacking app.asar, you must
update ElectronAsarIntegrity in Codex.app/Contents/Info.plist, otherwise the app will exit
on startup with:

  FATAL: .../asar_util.cc:143 Integrity check failed for asar archive (...)
"""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import plistlib
import re
import struct
import subprocess
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Match

# -----------------------------------------------------------------------------
# Manual configuration (edit if needed)
# -----------------------------------------------------------------------------

DEFAULT_APP_ASAR = Path("/Applications/Codex.app/Contents/Resources/app.asar")
DEFAULT_INFO_PLIST = Path("/Applications/Codex.app/Contents/Info.plist")

# -----------------------------------------------------------------------------

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
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def sha256_asar_header_json(path: Path) -> str:
    blob = path.read_bytes()
    json_len = struct.unpack_from("<I", blob, 12)[0]
    header_json = blob[16 : 16 + json_len]
    return hashlib.sha256(header_json).hexdigest()


def update_electron_asar_integrity(info_plist: Path, *, asar_rel_key: str, header_hash: str) -> None:
    data = plistlib.loads(info_plist.read_bytes())
    integrity = data.get("ElectronAsarIntegrity")
    if not isinstance(integrity, dict):
        raise RuntimeError("Info.plist missing ElectronAsarIntegrity dict")
    entry = integrity.get(asar_rel_key)
    if not isinstance(entry, dict):
        raise RuntimeError(f'Info.plist missing ElectronAsarIntegrity["{asar_rel_key}"] dict')
    if entry.get("algorithm") != "SHA256":
        raise RuntimeError(
            f'Unexpected ElectronAsarIntegrity["{asar_rel_key}"].algorithm: {entry.get("algorithm")!r}'
        )
    entry["hash"] = header_hash
    info_plist.write_bytes(plistlib.dumps(data, fmt=plistlib.FMT_XML, sort_keys=False))


def run_checked(*args: str, cwd: Path | None = None) -> str:
    proc = subprocess.run(
        list(args),
        cwd=str(cwd) if cwd is not None else None,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )
    if proc.returncode != 0:
        cmd = " ".join(args)
        raise RuntimeError(f"Command failed ({proc.returncode}): {cmd}\n{proc.stdout}")
    return proc.stdout


def apply_rule(text: str, rule: PatchRule, *, dry_run: bool) -> tuple[str, str]:
    if rule.patched is not None and rule.patched.search(text) and not rule.unpatched.search(text):
        return text, "already"

    if dry_run:
        count = len(list(rule.unpatched.finditer(text)))
        if count == 0 and rule.patched is not None and rule.patched.search(text):
            return text, "already"
        if count != rule.expected_replacements:
            raise RuntimeError(
                f"{rule.name}: expected {rule.expected_replacements} match(es), found {count}"
            )
        return text, "would_apply"

    new_text, replaced = rule.unpatched.subn(rule.replacement, text)
    if replaced == 0 and rule.patched is not None and rule.patched.search(text):
        return text, "already"
    if replaced != rule.expected_replacements:
        raise RuntimeError(
            f"{rule.name}: expected {rule.expected_replacements} replacement(s), got {replaced}"
        )
    return new_text, "applied"


def find_webview_bundle_from_index_html(extracted_root: Path) -> Path:
    """Find the main entry bundle referenced by webview/index.html."""
    index_html = extracted_root / "webview/index.html"
    if not index_html.exists():
        raise RuntimeError(f"Missing expected file: {index_html}")
    html = index_html.read_text("utf-8", errors="strict")

    m = re.search(r'src=["\'][^"\']*assets/(index-[^"\']+\.js)["\']', html)
    if not m:
        raise RuntimeError("Could not locate webview bundle in webview/index.html")
    rel = Path("webview/assets") / m.group(1)
    bundle = extracted_root / rel
    if not bundle.exists():
        raise RuntimeError(f"Bundle referenced by index.html does not exist: {bundle}")
    return bundle


def find_split_items_chunk(extracted_root: Path) -> Path:
    """Find the split-items-into-render-groups chunk."""
    assets = extracted_root / "webview" / "assets"
    for f in assets.iterdir():
        if f.name.startswith("split-items-into-render-groups-") and f.suffix == ".js":
            return f
    raise RuntimeError("Could not find split-items chunk in extracted ASAR")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--asar",
        default=str(DEFAULT_APP_ASAR),
        help="Path to Codex app.asar (default: /Applications/Codex.app/.../app.asar).",
    )
    parser.add_argument(
        "--info-plist",
        default=str(DEFAULT_INFO_PLIST),
        help="Path to Codex Info.plist (default: /Applications/Codex.app/Contents/Info.plist).",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Do not write changes; only validate that patches would apply cleanly.",
    )
    parser.add_argument(
        "--no-beautify",
        action="store_true",
        help="Skip regenerating a .beautified.js copy inside the extracted assets folder.",
    )
    parser.add_argument(
        "--keep-extracted",
        action="store_true",
        help="Do not delete the extracted folder (for manual inspection).",
    )
    parser.add_argument(
        "--no-update-asar-integrity",
        action="store_true",
        help="Do not update ElectronAsarIntegrity in Info.plist after repacking (will likely crash on startup).",
    )
    args = parser.parse_args()

    app_asar = Path(args.asar).expanduser()
    if not app_asar.exists():
        print(f"ERROR: not found: {app_asar}", file=sys.stderr)
        return 2

    # Patch rules — adapted from andrew-kramer-inno's original gist, updated
    # for composer-B5UwBne4.js and split-items-into-render-groups-DXacaguN.js.
    #
    # Original inspiration: https://gist.github.com/andrew-kramer-inno/3fa1063b967cfad2bc6f7cd9af1249fd

    patches: list[PatchRule] = [
        # ── Render-group builder: don't aggregate reasoning into exploration ──
        PatchRule(
            name="split_items_drop_reasoning_from_exploration",
            unpatched=re.compile(
                r'if\(t\.type===`reasoning`\)\{i&&i\.push\(t\);continue\}'
            ),
            patched=re.compile(
                r'if\(t\.type===`reasoning`\)\{i&&s\(`explored`\);r\.push\(\{kind:`item`,item:t\}\);continue\}'
            ),
            replacement=(
                r'if(t.type===`reasoning`){i&&s(`explored`);r.push({kind:`item`,item:t});continue}'
            ),
        ),
        # ── Composer bundle patches ──
        PatchRule(
            name="exploration_no_autocollapse_on_finish",
            unpatched=re.compile(
                r'\(\)=>\{\w+\((\w+)\?`preview`:`collapsed`\)\}'
            ),
            patched=re.compile(
                r'\(\)=>\{\w+&&\w+\(`preview`\)\}'
            ),
            replacement=r'()=>{\1&&\2("preview")}',
            expected_replacements=1,
        ),
        PatchRule(
            name="reasoning_no_autocollapse_on_finish",
            unpatched=re.compile(
                r'if\(!\w+\)\{\w+\(!1\);return\}'
            ),
            patched=re.compile(
                r'if\(!\w+\)\{return\}'
            ),
            replacement='if(!\\1){return}',
            expected_replacements=1,
        ),
    ]

    ts = dt.datetime.now(dt.UTC).strftime("%Y%m%dT%H%M%SZ")
    backup_asar = app_asar.with_suffix(app_asar.suffix + f".bak.{ts}")
    tmp_out_asar = Path(tempfile.gettempdir()) / f"codex.app.asar.patched.{ts}.asar"
    info_plist = Path(args.info_plist).expanduser()
    info_plist_backup = info_plist.with_suffix(info_plist.suffix + f".bak.{ts}")

    with tempfile.TemporaryDirectory(prefix="codex_app_asar_extract_") as tmpdir:
        extracted = Path(tmpdir)
        run_checked("npx", "-y", "asar", "extract", str(app_asar), str(extracted))

        # Patch both the composer bundle and the split-items chunk
        bundles_to_patch = [
            ("composer", find_webview_bundle_from_index_html(extracted)),
            ("split-items", find_split_items_chunk(extracted)),
        ]

        all_statuses = []
        all_text = {}

        for label, bundle_path in bundles_to_patch:
            text = bundle_path.read_text("utf-8", errors="strict")
            statuses = []
            for rule in patches:
                # Only apply composer patches to composer, split-items to split-items
                is_composer_patch = "composer" in label
                is_split_patch = "split" in label
                
                if is_composer_patch and rule.name == "split_items_drop_reasoning_from_exploration":
                    continue
                if is_split_patch and rule.name != "split_items_drop_reasoning_from_exploration":
                    continue
                    
                text, status = apply_rule(text, rule, dry_run=args.dry_run)
                statuses.append((rule.name, status))

            all_statuses.extend(statuses)
            all_text[label] = text

        for name, status in all_statuses:
            print(f"{name}: {status}")

        if args.dry_run:
            return 0

        # Write patched files
        for label, bundle_path in bundles_to_patch:
            bundle_path.write_text(all_text[label], "utf-8")
            run_checked("node", "--check", str(bundle_path))

        if not args.no_beautify:
            for label, bundle_path in bundles_to_patch:
                beautified = bundle_path.with_suffix(".beautified.js")
                run_checked(
                    "npx",
                    "-y",
                    "js-beautify@1.15.1",
                    str(bundle_path),
                    "-o",
                    str(beautified),
                    "--indent-size",
                    "2",
                    "--wrap-line-length",
                    "100",
                    "--max-preserve-newlines",
                    "2",
                    "--end-with-newline",
                )

        run_checked("npx", "-y", "asar", "pack", str(extracted), str(tmp_out_asar))

        backup_asar.write_bytes(app_asar.read_bytes())
        app_asar.write_bytes(tmp_out_asar.read_bytes())

        if not args.no_update_asar_integrity:
            if not info_plist.exists():
                raise RuntimeError(f"Info.plist not found: {info_plist}")
            header_hash = sha256_asar_header_json(app_asar)
            info_plist_backup.write_bytes(info_plist.read_bytes())
            update_electron_asar_integrity(
                info_plist,
                asar_rel_key="Resources/app.asar",
                header_hash=header_hash,
            )
            run_checked("plutil", "-lint", str(info_plist))

        if args.keep_extracted:
            keep_dir = Path(tempfile.gettempdir()) / f"codex_app_asar_extract_keep.{ts}"
            if keep_dir.exists():
                raise RuntimeError(f"Refusing to overwrite: {keep_dir}")
            extracted.replace(keep_dir)
            print(f"kept_extracted: {keep_dir}")

    print("PATCHED")
    print(f"asar:        {app_asar}")
    print(f"backup:      {backup_asar}")
    print(f"sha256(new): {sha256_file(app_asar)}")
    print(f"sha256(bak): {sha256_file(backup_asar)}")
    if not args.no_update_asar_integrity:
        print(f"info.plist:   {info_plist}")
        print(f"plist_backup: {info_plist_backup}")
        print(f"asar_header_sha256: {sha256_asar_header_json(app_asar)}")
    print("NOTE: Codex.app macOS code signature will likely be invalid until re-signed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

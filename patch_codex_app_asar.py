#!/usr/bin/env python3
"""
Adapted patch for Codex macOS app (v26.429.20946).

Patches the composer chunk bundle (composer-XXXXXXXX.js) inside app.asar.
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
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()

def sha256_asar_header_json(path: Path) -> str:
    blob = path.read_bytes()
    json_len = struct.unpack_from("<I", blob, 12)[0]
    header_json = blob[16 : 16 + json_len]
    return hashlib.sha256(header_json).hexdigest()

def update_electron_asar_integrity(info_plist, *, asar_rel_key, header_hash):
    data = plistlib.loads(info_plist.read_bytes())
    integrity = data.get("ElectronAsarIntegrity")
    if not isinstance(integrity, dict):
        raise RuntimeError("Info.plist missing ElectronAsarIntegrity dict")
    entry = integrity.get(asar_rel_key)
    if not isinstance(entry, dict):
        raise RuntimeError(f'Info.plist missing ElectronAsarIntegrity["{asar_rel_key}"] dict')
    if entry.get("algorithm") != "SHA256":
        raise RuntimeError(f'Unexpected algorithm: {entry.get("algorithm")!r}')
    entry["hash"] = header_hash
    info_plist.write_bytes(plistlib.dumps(data, fmt=plistlib.FMT_XML, sort_keys=False))

def run_checked(*args, cwd=None):
    proc = subprocess.run(
        list(args), cwd=str(cwd) if cwd else None,
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
    )
    if proc.returncode != 0:
        raise RuntimeError(f"Command failed ({proc.returncode}): {' '.join(args)}\n{proc.stdout}")
    return proc.stdout

def apply_rule(text, rule, *, dry_run):
    if dry_run:
        count = len(list(rule.unpatched.finditer(text)))
        if rule.patched and rule.patched.search(text) and count == 0:
            return text, "already"
        if count != rule.expected_replacements:
            raise RuntimeError(f"{rule.name}: expected {rule.expected_replacements}, found {count}")
        return text, "would_apply"
    new_text, replaced = rule.unpatched.subn(rule.replacement, text)
    if replaced == 0 and rule.patched and rule.patched.search(text):
        return text, "already"
    if replaced != rule.expected_replacements:
        raise RuntimeError(f"{rule.name}: expected {rule.expected_replacements}, got {replaced}")
    return new_text, "applied"

def find_composer_bundle(extracted_root):
    """Find the composer chunk bundle - that's where the patterns live."""
    assets = extracted_root / "webview" / "assets"
    for f in assets.iterdir():
        if f.name.startswith("composer-") and f.suffix == ".js":
            return f
    raise RuntimeError("Could not find composer bundle in extracted ASAR")

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--asar", default=str(DEFAULT_APP_ASAR))
    parser.add_argument("--info-plist", default=str(DEFAULT_INFO_PLIST))
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--no-beautify", action="store_true")
    parser.add_argument("--keep-extracted", action="store_true")
    parser.add_argument("--no-update-asar-integrity", action="store_true")
    args = parser.parse_args()

    app_asar = Path(args.asar).expanduser()
    if not app_asar.exists():
        print(f"ERROR: not found: {app_asar}", file=sys.stderr)
        return 2

    def repl_no_autocollapse(m):
        setter = m.group("setter")
        cond = m.group("cond")
        return f"()=>{{{cond}&&{setter}(\"preview\")}}"

    patches = [
        PatchRule(
            name="no_autocollapse",
            unpatched=re.compile(
                r"\(\)=>\{(?P<setter>\w+)\((?P<cond>\w+)\?`preview`:`collapsed`\)\}"
            ),
            patched=re.compile(r"\(\)=>\{\w+&&\w+\(`preview`\)\}"),
            replacement=repl_no_autocollapse,
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

    ts = dt.datetime.now(dt.UTC).strftime("%Y%m%dT%H%M%SZ")
    backup_asar = app_asar.with_suffix(app_asar.suffix + f".bak.{ts}")
    tmp_out_asar = Path(tempfile.gettempdir()) / f"codex.app.asar.patched.{ts}.asar"
    info_plist = Path(args.info_plist).expanduser()
    info_plist_backup = info_plist.with_suffix(info_plist.suffix + f".bak.{ts}")

    with tempfile.TemporaryDirectory(prefix="codex_app_asar_extract_") as tmpdir:
        extracted = Path(tmpdir)
        run_checked("npx", "-y", "asar", "extract", str(app_asar), str(extracted))

        bundle = find_composer_bundle(extracted)
        print(f"Patching: {bundle.name}")
        original_js = bundle.read_text("utf-8", errors="strict")

        text = original_js
        statuses = []
        for rule in patches:
            text, status = apply_rule(text, rule, dry_run=args.dry_run)
            statuses.append((rule.name, status))

        for name, status in statuses:
            print(f"  {name}: {status}")

        if args.dry_run:
            return 0

        if text == original_js:
            print("No changes needed.")
            return 0

        bundle.write_text(text, "utf-8")
        run_checked("node", "--check", str(bundle))

        if not args.no_beautify:
            beautified = bundle.with_suffix(".beautified.js")
            run_checked("npx", "-y", "js-beautify@1.15.1", str(bundle), "-o", str(beautified),
                        "--indent-size", "2", "--wrap-line-length", "100",
                        "--max-preserve-newlines", "2", "--end-with-newline")

        run_checked("npx", "-y", "asar", "pack", str(extracted), str(tmp_out_asar))

        backup_asar.write_bytes(app_asar.read_bytes())
        app_asar.write_bytes(tmp_out_asar.read_bytes())

        if not args.no_update_asar_integrity:
            if not info_plist.exists():
                raise RuntimeError(f"Info.plist not found: {info_plist}")
            header_hash = sha256_asar_header_json(app_asar)
            info_plist_backup.write_bytes(info_plist.read_bytes())
            update_electron_asar_integrity(info_plist, asar_rel_key="Resources/app.asar", header_hash=header_hash)
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
    print("NOTE: Codex.app code signature will be invalid until re-signed.")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())

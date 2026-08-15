#!/usr/bin/env python3
"""fastlane/metadata/ios/<locale>/ の内容を App Store Connect に反映する。

編集可能な状態（PREPARE_FOR_SUBMISSION など）のバージョンだけを対象にする。
審査中や公開済みのものは触らない。

実行前に必ず現状を /tmp/asc_backup.json に控えるので、
取り違えたときはそこから戻せる。
"""

import json
import sys
from pathlib import Path

SRC = Path(__file__).resolve().parent.parent / "fastlane/metadata/ios"
EDITABLE = {"PREPARE_FOR_SUBMISSION", "DEVELOPER_REJECTED", "REJECTED",
            "METADATA_REJECTED", "INVALID_BINARY"}

# ファイル名 → ASC の属性名
FIELDS = {
    "release_notes.txt": "whatsNew",
    "promotional_text.txt": "promotionalText",
    "description.txt": "description",
    "keywords.txt": "keywords",
}

_ns: dict = {}
exec(compile((Path(__file__).resolve().parent / "asc.py").read_text(encoding="utf-8")
             .split("if __name__")[0], "asc.py", "exec"), _ns)
call, app_id = _ns["call"], _ns["app_id"]


def main(new_version: str | None, apply: bool) -> None:
    aid = app_id()
    versions = call("GET", f"/apps/{aid}/appStoreVersions?limit=10")["data"]
    editable = [v for v in versions if v["attributes"]["appStoreState"] in EDITABLE]
    if len(editable) != 1:
        raise SystemExit(f"編集可能なバージョンが {len(editable)} 件。手で確認してください。")
    ver = editable[0]
    vid, cur = ver["id"], ver["attributes"]["versionString"]
    print(f"対象: {cur}  ({ver['attributes']['appStoreState']})")

    locs = call("GET", f"/appStoreVersions/{vid}/appStoreVersionLocalizations?limit=50")["data"]
    Path("/tmp/asc_backup.json").write_text(json.dumps(
        {"versionId": vid, "versionString": cur,
         "localizations": {l["attributes"]["locale"]: l for l in locs}},
        ensure_ascii=False, indent=2), encoding="utf-8")
    print("控え: /tmp/asc_backup.json\n")

    plan = []
    if new_version and new_version != cur:
        plan.append(("version", "versionString", cur, new_version, vid))

    for l in locs:
        loc, lid, attrs = l["attributes"]["locale"], l["id"], l["attributes"]
        d = SRC / loc
        if not d.is_dir():
            print(f"{loc}: 手元にファイルなし → 触らない")
            continue
        for fname, key in FIELDS.items():
            f = d / fname
            if not f.exists():
                continue
            want = f.read_text(encoding="utf-8").strip()
            have = (attrs.get(key) or "").strip()
            if want != have:
                plan.append((loc, key, have, want, lid))

    if not plan:
        print("差分なし。")
        return

    print("=== 変更する項目 ===")
    for scope, key, have, want, _ in plan:
        h = "（空）" if not have else f"{len(have)}字"
        print(f"  {scope:8s} {key:16s} {h:>8s} → {len(want)}字")

    if not apply:
        print("\n（--apply を付けると実際に書き込みます）")
        return

    for scope, key, _, want, rid in plan:
        if scope == "version":
            call("PATCH", f"/appStoreVersions/{rid}",
                 {"data": {"id": rid, "type": "appStoreVersions",
                           "attributes": {key: want}}})
        else:
            call("PATCH", f"/appStoreVersionLocalizations/{rid}",
                 {"data": {"id": rid, "type": "appStoreVersionLocalizations",
                           "attributes": {key: want}}})
        print(f"  書き込み: {scope}/{key}")
    print("\n完了。")


if __name__ == "__main__":
    args = sys.argv[1:]
    apply = "--apply" in args
    ver = next((a for a in args if not a.startswith("--")), None)
    main(ver, apply)

#!/usr/bin/env python3
"""英語版スクリーンショットを、指定したロケールのスクショ枠に流し込む。

言語ごとにスクショを撮り分けていないので、新しく増やしたロケールには英語版を
そのまま使う。App Store は各ロケールに1セットずつ持たせる作りなので、同じ画像を
ロケール数ぶんアップロードすることになる。

アップロードは3段構え（Apple の仕様）:
  1. POST /appScreenshots でファイル名とサイズを予約 → uploadOperations が返る
  2. その指示どおりに実体を PUT（別ホスト。ASC の Authorization は付けない）
  3. PATCH で uploaded:true と MD5 を送って確定
"""

import hashlib
import io
import ssl
import sys
import time
import urllib.request
from pathlib import Path

import certifi
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
import asc  # noqa: E402

SRC_DIR = Path(__file__).resolve().parent.parent / "appstore_screenshots_en"
# 既存の en-US / ja に合わせる。1290x2796 で撮ってあるので 6.5 インチ枠に縮める。
DISPLAY_TYPE = "APP_IPHONE_65"
TARGET = (1284, 2778)
FILES = ["01_カレンダー共有.png", "02_AIで予定作成.png", "03_バイト分析.png",
         "04_あとでやる.png", "05_ウィジェット.png", "06_週表示.png"]

UPLOAD_CTX = ssl.create_default_context(cafile=certifi.where())


def fit(path: Path) -> bytes:
    """幅を合わせてから縦を中央で切る。単純な引き伸ばしだと 0.2% 潰れる。"""
    im = Image.open(path).convert("RGB")
    w, h = TARGET
    scaled = im.resize((w, round(im.height * w / im.width)), Image.LANCZOS)
    top = max(0, (scaled.height - h) // 2)
    out = io.BytesIO()
    scaled.crop((0, top, w, top + h)).save(out, "PNG", optimize=True)
    return out.getvalue()


def retry(fn, tries: int = 4):
    """Apple 側が散発的に 500 を返す。数十枚も上げると必ず1回は踏む。"""
    for i in range(tries):
        try:
            return fn()
        except SystemExit as e:
            if "HTTP 5" not in str(e) or i == tries - 1:
                raise
            wait = 2 ** i
            print(f"      500 を踏んだので {wait}s 待って再試行 ({i + 1}/{tries - 1})")
            time.sleep(wait)


def upload(blob: bytes, ops: list) -> None:
    for op in ops:
        chunk = blob[op["offset"]: op["offset"] + op["length"]]
        req = urllib.request.Request(op["url"], data=chunk, method=op["method"])
        for h in op.get("requestHeaders") or []:
            req.add_header(h["name"], h["value"])
        with urllib.request.urlopen(req, context=UPLOAD_CTX) as r:
            r.read()


def put_screenshots(localization_id: str, blobs: dict) -> None:
    """既存セットがあれば足りないぶんだけ足す。500 で中断しても再実行で続きから。"""
    sets = asc.call("GET", f"/appStoreVersionLocalizations/{localization_id}"
                           f"/appScreenshotSets?limit=10")["data"]
    if sets:
        sid = sets[0]["id"]
        have = asc.call("GET", f"/appScreenshotSets/{sid}/appScreenshots?limit=20")["data"]
        # 中途半端に予約だけされた枠は消してから作り直す。
        done = {}
        for sh in have:
            state = (sh["attributes"].get("assetDeliveryState") or {}).get("state")
            if state == "COMPLETE":
                done[sh["attributes"]["fileName"]] = sh["id"]
            else:
                asc.call("DELETE", f'/appScreenshots/{sh["id"]}')
    else:
        s = asc.call("POST", "/appScreenshotSets", {"data": {
            "type": "appScreenshotSets",
            "attributes": {"screenshotDisplayType": DISPLAY_TYPE},
            "relationships": {"appStoreVersionLocalization": {"data": {
                "type": "appStoreVersionLocalizations", "id": localization_id}}}}})
        sid, done = s["data"]["id"], {}

    ids = []
    for name in FILES:
        if name in done:
            ids.append(done[name])
            continue
        blob = blobs[name]
        r = retry(lambda: asc.call("POST", "/appScreenshots", {"data": {
            "type": "appScreenshots",
            "attributes": {"fileSize": len(blob), "fileName": name},
            "relationships": {"appScreenshotSet": {"data": {
                "type": "appScreenshotSets", "id": sid}}}}}))
        shot_id = r["data"]["id"]
        upload(blob, r["data"]["attributes"]["uploadOperations"])
        retry(lambda: asc.call("PATCH", f"/appScreenshots/{shot_id}", {"data": {
            "id": shot_id, "type": "appScreenshots",
            "attributes": {"uploaded": True,
                           "sourceFileChecksum": hashlib.md5(blob).hexdigest()}}}))
        ids.append(shot_id)

    # 並び順は関係のパッチでしか決められない。ファイル名順＝見せたい順。
    asc.call("PATCH", f"/appScreenshotSets/{sid}/relationships/appScreenshots",
             {"data": [{"type": "appScreenshots", "id": i} for i in ids]})


def main(locales: list[str]) -> None:
    blobs = {n: fit(SRC_DIR / n) for n in FILES}
    print(f"素材 {len(blobs)}枚 → {TARGET[0]}x{TARGET[1]}")

    aid = asc.app_id()
    ver = next(v for v in asc.call("GET", f"/apps/{aid}/appStoreVersions?limit=10")["data"]
               if v["attributes"]["appStoreState"] == "PREPARE_FOR_SUBMISSION")
    print(f'対象バージョン: {ver["attributes"]["versionString"]}')

    locs = asc.call("GET", f'/appStoreVersions/{ver["id"]}/appStoreVersionLocalizations?limit=50')["data"]
    by_locale = {l["attributes"]["locale"]: l["id"] for l in locs}

    for loc in locales:
        lid = by_locale.get(loc)
        if not lid:
            print(f"  {loc:<9} ロケールなし → 飛ばす")
            continue
        put_screenshots(lid, blobs)
        print(f"  {loc:<9} {len(FILES)}枚そろった")


if __name__ == "__main__":
    main(sys.argv[1:] or ["ko", "zh-Hans", "zh-Hant", "de-DE", "fr-FR",
                          "es-ES", "pt-BR", "th", "id"])

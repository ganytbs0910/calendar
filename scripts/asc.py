#!/usr/bin/env python3
"""App Store Connect API の薄いクライアント。

認証は 3 点セット（issuer id / key id / .p8 秘密鍵）で、
ES256 の JWT を自分で組んで Authorization ヘッダに載せる。

資格情報はこのリポジトリに置かない。既に存在する
~/Desktop/Brawl/scripts/.asc-credentials.json を読む。
（公開リポジトリなので、鍵の類は絶対に持ち込まないこと。）
"""

import json
import ssl
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

import certifi
import jwt

# python.org 版の Python はシステムのルート証明書を見ないので、
# 明示しないと Apple の API に対して CERTIFICATE_VERIFY_FAILED になる。
SSL_CTX = ssl.create_default_context(cafile=certifi.where())

CRED = Path.home() / "Desktop/Brawl/scripts/.asc-credentials.json"
API = "https://api.appstoreconnect.apple.com/v1"
BUNDLE_ID = "org.reactjs.native.example.CalendarAppGan"


def token() -> str:
    c = json.loads(CRED.read_text(encoding="utf-8"))
    key = Path(c["keyPath"]).read_text(encoding="utf-8")
    now = int(time.time())
    return jwt.encode(
        # aud は固定値。exp は最長20分だが、余裕を持って15分にしておく。
        {"iss": c["issuerId"], "iat": now, "exp": now + 15 * 60, "aud": "appstoreconnect-v1"},
        key,
        algorithm="ES256",
        headers={"kid": c["keyId"], "typ": "JWT"},
    )


_TOKEN = None


def call(method: str, path: str, body: dict | None = None) -> dict:
    global _TOKEN
    if _TOKEN is None:
        _TOKEN = token()
    url = path if path.startswith("http") else API + path
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Authorization", f"Bearer {_TOKEN}")
    if data:
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, context=SSL_CTX) as r:
            raw = r.read()
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        detail = e.read().decode(errors="replace")
        raise SystemExit(f"HTTP {e.code} {method} {url}\n{detail[:1200]}") from None


def app_id() -> str:
    q = urllib.parse.urlencode({"filter[bundleId]": BUNDLE_ID})
    apps = call("GET", f"/apps?{q}")["data"]
    if not apps:
        raise SystemExit(f"{BUNDLE_ID} が見つかりません")
    return apps[0]["id"]


if __name__ == "__main__":
    aid = app_id()
    app = call("GET", f"/apps/{aid}")["data"]["attributes"]
    print(f"{app['name']}  ({app['bundleId']})  id={aid}")
    if len(sys.argv) > 1 and sys.argv[1] == "versions":
        vs = call("GET", f"/apps/{aid}/appStoreVersions?limit=10")["data"]
        for v in vs:
            a = v["attributes"]
            print(f"  {a['versionString']:8s} {a['appStoreState']:24s} {a.get('createdDate','')[:10]}")

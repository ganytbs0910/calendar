# Gemini フォールバックのセットアップ手順

「書くだけで予定作り」のルールベース解析（`src/agent/intentionParser.ts`）が
**本当に何の手がかりも掴めなかった**断片だけを Gemini（無料枠）に再解析させる
機能を動かすために**人手で行う必要がある作業**をまとめる。
コード（Worker・クライアント側とも）は実装済みで、残っているのは
Google AI Studio と Cloudflare の設定だけ。

**キーを発行するまでは何も壊れない。** `checkWithGemini` は通信できない間
常に `{ok:false, reason:'network'}` を返し、呼び出し側（`AgentScreen.tsx`）は
ローカルの推測結果をそのまま使う。精度が上がらないだけで、動作は変わらない。

---

## この構成の要点

```
[intentionParser.ts]（端末内・無料・即時）
        │ lowConfidence な断片だけ
        ▼
[geminiFallbackService.ts] --fetch--> [Cloudflare Worker: intention-parser]
                                              │ X-Fallback-Token を検証
                                              ▼
                                    Gemini API（無料枠、構造化JSON出力）
                                              │
                                              ▼
                                    { intentions: [...] } を返す
```

`GEMINI_API_KEY` は Worker の secret にのみ置く。クライアントには一切渡らない。
`X-Fallback-Token`（`geminiFallbackService.ts` と `wrangler.toml` の
`FALLBACK_SHARED_TOKEN`）は秘密ではなく、無関係な第三者がURLを見つけて
直叩きするのを軽く防ぐだけ。実質的な歯止めは Gemini 無料枠のレート制限そのもの
（意見ボックスの anon キー + RLS と同じ考え方 — `discord-setup.md` 参照）。

---

## 手順

### 1. Gemini APIキーを発行する

1. https://aistudio.google.com/apikey を開く
2. 「Create API key」
3. 発行されたキーを控える（このキーは後で Worker の secret として登録するだけで、
   コードには一切書かない）

無料枠の詳細・現在のレート制限は https://ai.google.dev/pricing で確認すること。
`cloudflare/intention-parser/src/index.ts` 冒頭の `GEMINI_MODEL` 定数
（実装時点では `gemini-2.0-flash`）も、無料枠モデルの現行ラインナップに
合わせて必要なら更新する。

### 2. Worker をデプロイする

```sh
cd cloudflare/intention-parser
npm install
npx wrangler login        # 未認証なら
npx wrangler secret put GEMINI_API_KEY
# プロンプトに 1. のキーを貼り付け
npx wrangler deploy
```

デプロイ後に表示される `https://intention-parser.<サブドメイン>.workers.dev` を控える。

### 3. クライアント側にURLを設定する

`src/services/geminiFallbackService.ts` 冒頭の `WORKER_URL` を、
2. で控えたURL + `/parse` に書き換える。

```ts
const WORKER_URL = 'https://intention-parser.<サブドメイン>.workers.dev/parse';
```

### 4. 確認する

```sh
curl -X POST https://intention-parser.<サブドメイン>.workers.dev/parse \
  -H 'Content-Type: application/json' \
  -H 'X-Fallback-Token: calendar-intention-fallback-v1' \
  -d '{"fragments":["月1で美容院"],"now":"2026-08-31T00:00:00.000Z"}'
```

`{"intentions":[{"kind":"monthly", ...}]}` のような応答が返れば疎通成功。

そのうえで**実機のアプリから**、ルールベースが必ず低確信になる文
（例:「なるはやでメール返信」）を「決定」ボタンから送信し、
Gemini経由で妥当な `kind`/`title` が付いた予定として確認画面に出ることを確認する。
`X-Fallback-Token` の経路は curl（サーバー側キー）では検証できず、
壊れているとしてもここでしか出ない。

---

## 設計上の制約・フォローアップ

- **プライバシー方針の更新が必要。** 低確信の断片に限られるとはいえ、
  予定の文言がGoogleに送られる経路が新たにできる。`discord-setup.md` の
  「外に出るもの」表と同じ形式で追記し、App Store Connect / Google Play の
  プライバシー申告も更新すること。**このセッションでは未実施**（意見ボックスの
  ときと同じ扱い — コンソール操作は人手が必要）。
- Worker には `.env` 等を使わず、`geminiFallbackService.ts` 側もURLを
  直書きの定数にしている（このアプリに環境変数の仕組みが無いのは
  `feedbackService.ts` と同じ）。
- レート制限は Gemini 無料枠まかせ。個人利用の範囲では十分だが、
  `X-Fallback-Token` が漏れた場合はトークンをローテーションすること
  （クライアント側の定数を変えて再ビルド + Worker の `vars` を更新）。

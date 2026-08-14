# Discord 連携のセットアップ手順

意見ボックスと日次レポートを動かすために**人手で行う必要がある作業**をまとめる。
コードとSQLは実装済みで、残っているのは Discord と Supabase の設定だけ。

移植元: `~/Desktop/Brawl/docs/discord-ops-kit.md`

---

## この構成の要点

BrawlStatus と**同じ Supabase プロジェクト・同じ Bot・同じ Discord サーバー**を使い、
チャンネルとテーブルだけを増やす。追加費用は $0。

```
[FeedbackScreen.tsx]
        │ fetch → PostgREST（anon キーで INSERT のみ）
        ▼
[Postgres calendar_feedback]
   ├ BEFORE INSERT: calendar_feedback_rate_limit()   IPハッシュでレート制限
   ├ RLS WITH CHECK:                                 長さ / カテゴリ / リンク連投を検証
   └ AFTER INSERT:  calendar_feedback_notify()  ──┐
                                                   │
[pg_cron 0 0 * * * (=JST 9:00)]                    │
   └ send_calendar_daily_digest() ─────────────────┤
                                                   ▼
                              notify_discord_to('calendar_feedback' | 'calendar_analytics', …)
                                        ※ BrawlStatus の既存関数をそのまま再利用
                                                   ▼
                                        [#calendar-feedback / #calendar-analytics]
```

**BrawlStatus 側のオブジェクトは1つも書き換えていない。**
`notify_discord_to(purpose, …)` が `'discord_channel_' || purpose` を引く作りなので、
purpose を変えるだけで宛先を分けられる。これが相乗りできる理由。

---

## 手順

### 1. Bot トークンを取り出す

Supabase ダッシュボード（プロジェクト `llxmsbnqtdlqypnwapzz`）→ SQL Editor:

```sql
select decrypted_secret from vault.decrypted_secrets where name = 'discord_bot_token';
```

### 2. Discord のチャンネルを作る

```sh
export DISCORD_BOT_TOKEN='<1で取り出した値>'
./scripts/create_discord_channels.sh
```

サーバー `1451992089503072443` に「カレンダー」カテゴリと
`calendar-feedback` / `calendar-analytics` を作る。
**二度実行しても増殖しない**（名前で既存を探してから作る）。

最後に貼り付け用の2行が出るので控える。

> Bot に **Manage Channels** 権限が無いと 403 で止まる。
> その場合は Discord 側で手作業で作り、チャンネルIDを控えれば同じこと。

### 3. SQL を流す

`supabase/migrations/20260815_calendar_discord.sql` の
`<FEEDBACK_ID>` / `<ANALYTICS_ID>` を2の出力で置換してから、
SQL Editor に全文を貼って実行する。

先頭に前提チェックが入っているので、pg_net / pg_cron / `notify_discord_to` が
無ければそこで止まる。

### 4. 確認する

ファイル末尾のコメントに確認クエリが7本ある。特に:

```sql
-- BrawlStatus 側を壊していないこと（既存3キーが残り、cron が2本になる）
select key from public.monitoring_config where key like 'discord_channel_%' order by key;
select jobname, schedule from cron.job order by jobname;
```

そのうえで **実機のアプリから1件送る**。
RLS と anon キーの経路は SQL エディタ（service_role）では検証できず、
壊れているとしてもここでしか出ない。

---

## 掲載文とプライバシー方針の更新（**未実施・要判断**）

意見ボックスは「利用者が送信ボタンを押したときだけ」動くが、
それでも**外部送信は発生する**。現在の掲載文はこう書いてある:

| 場所 | 現在の記載 |
|---|---|
| `appstore/STORE_LISTING.md:86` | ・端末内で完結。アカウント登録は不要です |
| `appstore/STORE_LISTING.md:164` | • Everything stays on your device. No account required |

厳密には例外ができるので、次のように直すのを提案する（**未適用**）:

```
・端末内で完結。アカウント登録は不要です
  （意見を送るときだけ、入力内容とアプリのバージョン・OS・表示言語を送信します）

• Everything stays on your device. No account required
  (only when you send feedback does anything leave it: your message,
   the app version, OS and display language)
```

あわせて必要なもの:

- **プライバシー方針**（`gan-67f.pages.dev/privacy?app=calendar`／このリポジトリの外）に
  意見ボックスの送信項目・保存先・保存期間を追記する
- **App Store のプライバシー表示**に
  「ユーザーコンテンツ → その他のユーザーコンテンツ」（アプリの機能／**トラッキングなし・非連結**）を追加
- Google Play の**データセーフティ**に同等の申告

送信しているのは `app_version` / `platform` / `language` / `message` / `contact` の5項目のみ。
予定の内容・カレンダー名・写真・給与設定は**一切送っていない**
（`__tests__/feedbackService.test.ts` の「送る項目」がこれを固定している。
項目を増やすとテストが落ちるので、この表と実装がずれることはない）。

---

## 分かっていること・分かっていないこと

**検証済み**

- 送信サービスの単体テスト17本（検証・エラーの見分け・送信項目の固定）
- 型チェック / lint / テスト全体が通ること
- スクリプトの構文と、トークン未設定・Bot未参加時に正しく止まること

**未検証**

- **Discord への送信が実際に届くこと**。Bot トークンに到達できないため
  （supabase CLI 未インストール、service_role キー無し、
  anon キーでは vault を読めない）チャンネル作成もSQL実行も行えていない。
- **実機からの送信**。上と同じ理由。
- 日次レポートの見た目。`select public.send_calendar_daily_digest();` は
  本文をそのまま返すので、cron を待たずに目視できる。

**設計上の制約**

- 利用者の識別子が無いため、DB側のレート制限は **IPハッシュのみ**。
  BrawlStatus の「同一プレイヤータグ 1分3件」に相当するものは掛けられない。
  共有回線（学校・職場）では1時間20件の上限を複数人で共有することになる。
- 意見ボックスの文言は**日本語のみ**。そのため設定画面の入口は
  表示言語が日本語の端末にしか出ない（`SettingsLauncherScreen.tsx` の `showFeedback`）。
  **他10言語の利用者には意見を送る手段が無い**。
  `src/components/feedbackCopy.ts` に言語を足せば入口も自動で出る。

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

## 掲載文とプライバシー方針（**更新済み**）

意見ボックスは「利用者が送信ボタンを押したときだけ」動くが、
それでも外部送信は発生する。あわせて調べたところ、
**掲載文の「端末内で完結」は意見ボックス以前からすでに不正確**だった。

| 外に出るもの | いつ | 送信先 |
|---|---|---|
| 緯度・経度 | 天気を表示するとき | Open-Meteo（`src/services/weatherService.ts:94`） |
| 広告識別子・IP・端末情報 | 無料版でバナー表示中 | Google AdMob（`App.tsx:2686`） |
| 本文・連絡先・バージョン・OS・言語 | 利用者が送信を押したとき | Supabase（開発者管理） |

対応済み:

- `appstore/STORE_LISTING.md` の該当行を JP/EN とも書き換えた。
  「端末内で完結」→「**予定もタスクも写真も端末の中だけ**」。
  守れる範囲だけを主張する形にしてある。
- 同ファイル冒頭に、両ストアのプライバシー申告に何を足すかの表を追加した。
- **プライバシー方針**を更新し、**本番へ反映済み**
  （`gan-67f.pages.dev/privacy?app=calendar` で確認）。
  9節に意見ボックスを新設し、事実と食い違っていた2箇所を直した:
  - 1節「独自のサーバーを持たないため…送信されることはありません」
  - 11節「開発者側に保管されているデータはありません」

  あわせて削除請求とお問い合わせの窓口が無かったので12節に追加した。

### サポートサイトの更新手順（**git push では反映されない**）

つまずいたので書き残す。

- 原稿は `apps.js` の `calendar` ブロック1箇所。`index.html` と `privacy.html` は
  これを読んで描画するだけなので、文言を直すのは常に `apps.js` だけでよい。
- **同じ内容の複製が2箇所にある。** git 管理下にあるのは Button 側だけ:
  - `~/Desktop/Button/AppStore/support-site/` ← git 管理（`feature/tenbin` ブランチ）
  - `~/Desktop/app-support/` ← **git 管理外**。`~/Desktop` 自体が別リポジトリのため
    紛らわしいが、このディレクトリの中身は追跡されていない
- **Cloudflare Pages はプロジェクト `gan`（`gan-67f.pages.dev`）で、git 連携していない。**
  GitHub に push しても本番は変わらない。反映には直接アップロードが要る:

```sh
cd ~/Desktop/Button
npx wrangler@3 pages deploy AppStore/support-site \
  --project-name=gan --branch=main --commit-dirty=true
```

`wrangler@3` を指定しているのは、最新版が Node 22 以上を要求し、
既定の Node が 20 のため（`volta list node` に 22 もあるので、そちらでも可）。
認証は `~/.wrangler/config/default.toml` の OAuth トークンが使われる。

反映確認:

```sh
curl -s https://gan-67f.pages.dev/apps.js | grep -c 意見ボックス   # 0 なら未反映
```

**未実施**（両コンソールのUI操作なので、こちらからは行えない）:

- App Store Connect → App のプライバシー に
  「ユーザーコンテンツ → その他のユーザーコンテンツ」と
  「連絡先情報 → メールアドレス」を追加（用途: アプリの機能 / 非連結 / トラッキングなし）
- Google Play → データセーフティ に同等の申告

送信しているのは `message` / `contact` / `app_version` / `platform` / `language` の5項目のみ。
予定の内容・カレンダー名・写真・給与設定は**一切送っていない**
（`__tests__/feedbackService.test.ts` の「送る項目」がこれを固定している。
項目を増やすとテストが落ちるので、この表と実装がずれることはない）。

---

## セットアップの実施状況（2026-08-15 完了）

手順1〜4はすべて実施済み。**再セットアップの必要はない。**

| | 結果 |
|---|---|
| Discord チャンネル | 作成済み。サーバー「アプリ管理」→ カテゴリ「カレンダー」 |
| `calendar-feedback` | `1537885368693555280` |
| `calendar-analytics` | `1537885370253840515` |
| SQL | 実行済み。cron `calendar-daily-digest` はジョブID 62 |
| Brawl への影響 | **無し**（下記の突き合わせで確認） |

**実測で確認したこと**

- **アプリと同じ経路（anon キー + RLS）で1件送信 → Discord に届いた。**
  `net._http_response` が 200 を返し、本文が
  `**[カレンダー 意見ボックス]** 🐛 不具合 …` になっていること。
- 不正なカテゴリ / 1001文字 / URL 2本 の3件は**いずれも保存されず**弾かれた。
  保存された1件だけが残り、`client_iph` にハッシュが入っていた。
- **他人の投稿は読めない。** anon キーで GET すると `[]`（SELECT ポリシー無し）。
- 日次レポートの本文を目視確認し、桁が揃っていること。
- **Brawl が無傷であること**を実行前後の突き合わせで確認:
  `notify_discord_to` と `send_daily_digest` の `pg_get_functiondef` の md5 が一致、
  `app_feedback` 30件のまま、既存の設定キー3件と cron 15本が健在（16本目が今回追加分）。

**実機のアプリ画面から2通送って確認済み**（iOS 18.0 シミュレータ、開発ビルド）。
設定 →「意見を送る」→ 入力 → 送信 →「送信しました」→ Discord 着弾までを通した。
`app_version: 2.9.0` / `platform: ios` / `language: ja` が実行時に正しく入ることも
DBの行で確認した。

**実測して分かった注意点（どちらも静かに失敗する型）**

1. **通知が5秒のタイムアウトで消える。** 実機からの1通目がこれで失われた。

   ```
   Timeout of 5000 ms reached. Total time: 5889 ms
   (DNS time: 4289 ms, TCP/SSL handshake 1600 ms, HTTP Request/Response 0 ms)
   ```

   DNS だけで4.3秒かかり、`net.http_post` の既定タイムアウトを使い切っていた。
   リクエストは1バイトも送られていない。**意見はDBに保存され、利用者には
   「送信しました」と出て、トリガーも正常終了する。消えるのは通知だけ**で、
   `net._http_response` を覗かない限り気付けない。しかも間欠的で、
   直前の2通は同じ経路で届いていた。

   → `20260815b_calendar_notify_timeout.sql` で `calendar_notify_discord()` を
   新設し、タイムアウトを 20 秒にした（`notify_discord_to` は共有なので触らない）。
   あわせて日次レポートに「届かなかった通知」の件数を出すようにした。
   通知が落ちても翌朝には見える。

   > **BrawlStatus 側の `notify_discord_to` も既定の5秒のまま**で、同じ穴を持つ。
   > 向こうのアプリの判断なので、こちらでは直していない。

2. **RLS 違反のHTTPステータスは 403 ではなく 401 で返る。** 本文は正しく
   `{"code":"42501"}` なので、判定は必ず**本文の `code`** で行うこと。
   `feedbackService.ts` はそうしている。ステータスで見ていたら、
   内容の問題を「認証エラー」として扱ってしまうところだった。

**残っているもの**

- テスト用の投稿が `#calendar-feedback` に2通残っている（削除して構わない）。
  DB のテスト行は削除済みで、日次レポートの数字は0から始まる。

**設計上の制約**

- 利用者の識別子が無いため、DB側のレート制限は **IPハッシュのみ**。
  BrawlStatus の「同一プレイヤータグ 1分3件」に相当するものは掛けられない。
  共有回線（学校・職場）では1時間20件の上限を複数人で共有することになる。
- 意見ボックスの文言は**日本語のみ**。そのため設定画面の入口は
  表示言語が日本語の端末にしか出ない（`SettingsLauncherScreen.tsx` の `showFeedback`）。
  **他10言語の利用者には意見を送る手段が無い**。
  `src/components/feedbackCopy.ts` に言語を足せば入口も自動で出る。

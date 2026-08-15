# Store listing copy — 理想のカレンダー / Ideal Calendar (v2.10.0)

Paste-ready text for **App Store Connect** (App 情報 → 各ローカライズ) and
**Google Play Console** (メインのストアの掲載情報 → 各言語).

Field limits — App Store: Name 30 / Subtitle 30 / Keywords 100 / Promo 170 /
Description 4000. Play: Title 30 / Short description 80 / Full description 4000.

Note: the **年収の壁 (income wall)** feature is Japan-specific, so it appears in
the **Japanese** copy only. The English/international copy uses the neutral
"shift & pay tracking" framing instead.

## ⚠️ Privacy declarations — update these before the next submission

The "everything stays on your device" line used to overclaim. Three things do
leave the device, and the declarations in both consoles have to match:

| What leaves | When | Where to |
|---|---|---|
| Latitude / longitude | Weather is shown | Open-Meteo (`api.open-meteo.com`) |
| Ad identifier, IP, device info | Free version, banner shown | Google AdMob |
| Feedback text, optional contact, app version, OS, language | User taps 送信 in 意見を送る | Supabase (developer-run) |

Nothing else does — no analytics or crash SDK is linked, and event contents,
photos and pay settings are never transmitted. `__tests__/feedbackService.test.ts`
pins the feedback payload to exactly those five fields, so the table above cannot
drift from the code without a test failing.

**App Store Connect → App のプライバシー** — the feedback box adds one item that
was not there before:

- **ユーザーコンテンツ → その他のユーザーコンテンツ** — 用途「アプリの機能」/
  ユーザーに**リンクされていない** / **トラッキングには使用しない**
- 連絡先を任意で受け取るため、**連絡先情報 → メールアドレス** も同じ扱いで申告
  （必須ではなく、入力された場合のみ）

**Google Play → データ セーフティ** — the same two, declared as collected,
not shared, optional, and with in-app deletion request routed to the support
address in the privacy policy §12.

The privacy policy itself (`~/Desktop/app-support/apps.js`, `calendar` block,
deployed at `gan-67f.pages.dev/privacy?app=calendar`) already describes all
three — §5 weather, §6 ads, §9 feedback box.

---

## 🇯🇵 日本語 (primary / 主要言語)

**App名 / タイトル**
```
理想のカレンダー
```

**サブタイトル / 短い説明 (App Store 30字 / Play 80字)**
```
今日、あと何時間空いてる？
```

**キーワード (App Store, 100字)** — ユーザー指定
```
カレンダー,予定,スケジュール,日程,週間,月間,予定表,タスク,リマインダー,ドラッグ,手帳,ダークモード,シンプル,無料
```

**プロモーションテキスト (170字)**
```
予定を「埋める」ためのカレンダーは、もう十分あります。これは残りを見るためのカレンダー。起きている時間から予定を引いて、今日あと何時間自由なのかをホーム画面に出します。説明書は要りません。思った通りに動きます。
```

**説明 / 概要 (4000字)**
```
今日あと何時間自由に使えるかが、開いた瞬間に数字で出るカレンダーです。

カレンダーは、予定が「入っている時間」しか教えてくれません。
でも本当に知りたいのは、その逆ではありませんか。


■ 残り自由時間が、ホーム画面に出ます

起きている時間から、これからの予定を引く。
それだけです。

「23時に寝る。今は19時。予定は21時から1時間」
——残り3時間。

カレンダーを開いた瞬間、この数字が目に入ります。
予定を1件入れれば、その場で減ります。


■ 説明書はありません

長押しすれば予定ができる。
ドラッグすれば時間が変わる。
スワイプすれば消せる。

あなたがスマホを使ってきた経験、
それがそのまま操作マニュアルです。

「たぶんこうすれば動くよな」
——その直感、全部正解です。


■ その時間が、何に換わっているか

バイトのシフトを入れると、時給から給料を自動計算。
深夜・残業・休日の割増にも対応しています。
年収の壁までの残りも確認できます。

自由時間を何と交換したのか、あとから分かります。


■ そのほか

・月表示と週表示をワンタップで切り替え
・週表示は指でなぞって予定を作成、ドラッグで移動
・色で分類して、ひと目で把握
・予定に写真を貼って、あとから振り返る
・ロック画面ウィジェットで、今日の空き時間を確認
・予定もタスクも写真も端末の中だけ。アカウント登録は不要です


あなたの1日を、あなたの感覚で組み立ててください。
```

**リリースノート / 最新情報 (What's New)**
```
■ 新しくできること
・今日あと何時間自由に使えるかを、開いた瞬間に数字で出すようにしました
・週表示でも、日ごとの空き時間が見られます
・バックアップと復元に対応しました。写真も含めてファイル1つに書き出せます
・繰り返しに「毎年」を追加しました。誕生日や記念日にどうぞ
・設定に「意見を送る」を追加しました。ご意見や不具合の報告が開発者へ直接届きます
・色での絞り込みを使えるようにしました

■ 変わったところ
・タブをホーム・タスク・統計の3つに整理し、設定はヘッダーの歯車にまとめました
・はじめの設定を2画面に短縮しました。開いてすぐ残り自由時間が出ます
・年収の壁の初期値を、いまの制度に合わせて130・150・160・188万円にしました

■ 不具合の修正
・月末に日付を選ぶと、1か月先になってしまうことがある問題を修正しました
・週表示の週のはじまりを、月表示と揃えました
・複数日にまたがる終日の予定が、週表示で初日にしか出ない問題を修正しました
・終了が開始と同じ終日の予定が、どこにも表示されない問題を修正しました
・サマータイムのある地域で、深夜割増の時間帯が1時間ずれる問題を修正しました
・「毎日」の繰り返しが1年経たずに終わってしまう問題を修正しました
・予定・シフト・タスクの編集で、入力した内容が保存されないことがある問題を修正しました
・薄くて読みにくかった文字のコントラストを改善しました
・ダークモードで起動画面が一瞬明るく光る問題を修正しました
・権限の確認画面が、日本語以外の端末でも各言語で表示されるようにしました
```

---

## 🇺🇸 English (international)

**App Name / Title**
```
Ideal Calendar
```

**Subtitle / Short description**
```
How much of today is yours?
```
（Play の短い説明は 80 字まで入るので `How much of today is still yours?` のままでよい。
App Store のサブタイトルは 30 字上限で、still を入れると 33 字になり弾かれる。）

**Keywords (App Store)**
```
calendar,schedule,planner,weekly,monthly,timetable,tasks,reminder,drag,diary,dark mode,simple,free
```

**Promotional text**
```
Plenty of calendars fill your day. This one shows what's left: your events subtracted from your waking hours, on the home screen. No manual needed.
```

**Description**
```
A calendar that opens on one number: how many hours of today are still yours.

A calendar tells you which hours are taken. What you actually want to know is the opposite.


■ Your free time, on the home screen

Take the hours you're awake. Subtract what's ahead of you.

"Bed at 11. It's 7 now. One hour booked at 9."
— three hours left.

That number is the first thing you see when you open the app. Add an event and it drops, right there.


■ No manual

Long-press to add an event.
Drag to move it.
Swipe to delete it.

Every year you've spent with a phone is the only instruction manual you need.

"It probably works like this…"
— and your instinct is always right.


■ What that time is being traded for

Add a shift and your pay is worked out from your hourly rate, including night, overtime and holiday premiums. You can see what your free time turned into.


■ Also

• One tap between month and week view
• Drag across the week view to create; drag an event to move it
• Colour-code your events and read the month at a glance
• Attach photos to events and look back on them
• A lock-screen widget for today's free time
• Your events, tasks and photos stay on your device. No account required


Build your day, your way.
```

**What's New / Release notes**
```
■ New
• The hours still yours today, as a number, the moment you open the app
• Free time per day in the week view too
• Backup and restore — everything, photos included, in a single file
• A yearly repeat, for birthdays and anniversaries
• Send feedback from Settings; it reaches the developer directly
• Filtering by colour is now reachable

■ Changed
• Three tabs — Home, Tasks, Stats — with settings behind the gear
• Setup is two screens now, so your free time shows up right away
• Pay thresholds updated to the ones a student actually hits

■ Fixed
• Picking a date while on the last day of a month could land a month later
• The week view now starts its week on the same day as everything else
• Multi-day all-day events showed only on their first day in the week view
• All-day events whose end matched their start didn't show at all
• Night-shift pay rates shifted by an hour across a daylight saving change
• A daily repeat could stop before the year was out
• Edits to events, shifts and tasks could fail to save
• Raised the contrast on text that was too faint to read
• The launch screen no longer flashes light in dark mode
• Permission prompts now appear in the language of the device
```

---

**リリースノートの全11言語版**は `fastlane/metadata/ios/<locale>/release_notes.txt` にある。
貼り付けでも `fastlane deliver` でも同じものが使える。

---

## Other languages — Name + Short description

Full descriptions can be added later; these cover the two required fields so the
listing is live in each language. (App names match the in-app localization.)

**App Store のサブタイトルは 30 字上限**で、下表の短い説明はそのままでは 2 言語が
超える。`fastlane/metadata/ios/<locale>/subtitle.txt` には収まる形を入れてある:

| Lang | 表の文（Play 用・80字まで） | App Store 用（30字以内） |
|---|---|---|
| en | How much of today is still yours? (33) | How much of today is yours? (27) |
| fr | Combien du jour te reste-t-il ? (32) | Il te reste combien de temps ? (30) |

| Lang | App name | Short description |
|------|----------|-------------------|
| de | Idealer Kalender | Wie viel vom Tag gehört dir? |
| es | Calendario Ideal | ¿Cuánto te queda del día? |
| fr | Agenda Idéal | Combien du jour te reste-t-il ? |
| id | Kalender Ideal | Berapa sisa harimu? |
| ko | 이상적인 캘린더 | 오늘, 얼마나 남았을까? |
| pt | Calendário Ideal | Quanto do dia ainda é seu? |
| th | ปฏิทินในฝัน | วันนี้เหลือเวลาเท่าไร? |
| zh-Hans | 理想日历 | 今天还剩多少时间是你的？ |
| zh-Hant | 理想行事曆 | 今天還剩多少時間是你的？ |

---

## Screenshots

Submit the 1290×2796 set in `appstore_screenshots_en/` (English) and
`appstore_screenshots_framed/` (Japanese). Income-wall (07) is intentionally
omitted from the English set (Japan-specific).

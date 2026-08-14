# Store listing copy — 理想のカレンダー / Ideal Calendar (v2.7.0)

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
・英語ほか10言語に完全対応しました
・アプリ全体の動作を高速化し、タブ切り替えをよりスムーズに
・細かな表示や翻訳を改善
```

---

## 🇺🇸 English (international)

**App Name / Title**
```
Ideal Calendar
```

**Subtitle / Short description**
```
How much of today is still yours?
```

**Keywords (App Store)**
```
calendar,schedule,planner,weekly,monthly,timetable,tasks,reminder,drag,diary,dark mode,simple,free
```

**Promotional text**
```
There are enough calendars for filling your day. This one shows you what's left of it. Your events subtracted from your waking hours, on the home screen: the time today that's still yours. No manual needed.
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
• Now available in English and 10 languages in total
• Faster and smoother throughout
• Various display and translation fixes
```

---

## Other languages — Name + Short description

Full descriptions can be added later; these cover the two required fields so the
listing is live in each language. (App names match the in-app localization.)

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

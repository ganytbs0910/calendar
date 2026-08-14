# 発注書 01 — アプリアイコン（主アイコン・差し替え）

> **保留（2026-08-14）**: 現行アイコンのまま行く判断。生成は不要。
> 再開する場合に備えて仕様は残す。なお現行アイコンには「2月」の文字が
> 焼き込まれており、年中2月と表示され、日本語のため英語圏にもそのまま出る。
> 月別切り替えの素材と実装は削除済みなので、将来直すならこの発注書から。

## なぜ必要か
現在出荷中の `Icon-1024.png` には「**2月**」という文字が焼き込まれている。
今日が何月であっても年中「2月」と表示され、日本語の文字なので英語圏の利用者にも
そのまま出る。軸（残り自由時間）も一切表していない。
※採用するかどうかはブランドの判断。生成前に方針だけ確認すること。

## 素材名
アプリ主アイコン（テキストなし）

## 用途
iOS / Android のアプリアイコン。ホーム画面・App Store・Google Play の一覧。

## 保存先（すべて実在を確認済み）
| 用途 | パス | 寸法 |
|---|---|---|
| iOS マーケティング用 | `ios/CalendarApp/Images.xcassets/AppIcon.appiconset/Icon-1024.png` | 1024×1024 |
| Play ストア用 | `fastlane/metadata/android/ja-JP/images/icon.png` | 512×512（1024から縮小） |

iOS の他サイズ（`Icon-20@2x` 〜 `Icon-60@3x`）は 1024 から機械的に縮小して差し替える。
縮小はこちらで行うので、**納品は 1024×1024 の1枚のみでよい**。

## 仕様
- 寸法: 1024×1024 px（正方形・1倍）
- 透過: **不可**。App Store はアルファ付きアイコンを受け付けない。背景まで塗り切ること
  （このため「マゼンタで塗って後で抜く」手順は本素材には適用しない）
- 明暗テーマ: **不要**。アイコンは1種類のみ（OSがホーム画面側で処理する）
- 角丸は付けない。**OS が自動でマスクする**ので、四隅まで塗った正方形で納品する
- 容量: 1 MB 以下
- 形式: PNG（アルファチャンネルなし＝RGB）

## そのまま貼れる英語プロンプト

```
A flat vector app icon for a calendar app whose single idea is "how much of today
is still yours". Fill the entire square canvas edge to edge with one solid
background colour. On top of it place EXACTLY TWO shapes and nothing else:

1. One thick circular ring, centred, occupying about 62% of the canvas width,
   drawn in a single flat colour, with a clean gap of exactly one quarter of the
   circle removed from the upper right.
2. One solid filled wedge sitting inside that same ring's band, starting at the
   top of the ring and sweeping clockwise for about one third of the circle,
   drawn in a second, clearly different flat colour.

STYLE CHARTER — apply exactly as written:
Flat vector. Solid fills only. No gradients, no texture, no noise, no lighting,
no 3D, no bevel, no reflection. Geometry is simple, symmetrical and centred.
High contrast between every adjacent colour. The whole image must remain clearly
legible when scaled down to 64x64 pixels, so no detail may be thinner than 3% of
the canvas width. Absolutely no text, no letters, no numbers, no digits, no
glyphs, no kanji, no kana, no logo wordmark of any kind anywhere in the image.
Do not draw a rounded-corner frame, an outer glow, a vignette, a pedestal, a
base plate, a ground plane, or a drop shadow. Do not add any extra decorative
element, sparkle, star, dot or icon beyond the shapes listed above. The
background must be a single flat colour filling the full square with no border
and no inner margin.
```

## 受け取ったときの確認項目
- [ ] 1024×1024 ちょうどか
- [ ] **アルファチャンネルが無いか**（`python3 -c "from PIL import Image;print(Image.open(p).mode)"` が `RGB`）
- [ ] **文字・数字が1つも入っていないか**（特に「2月」「Feb」等の再混入）
- [ ] 64×64 に縮小して、何のアイコンか判別できるか
- [ ] 図形がちょうど2つか（余計な装飾が足されていないか）
- [ ] 角丸・外周グロー・影・台座が付いていないか。四隅まで塗られているか
- [ ] ライト／ダーク両方のホーム画面壁紙に置いて沈まないか
- [ ] 容量 1 MB 以下
- [ ] 画像だけが意味を運んでいないか（アイコン名「理想のカレンダー」と併せて成立するか）

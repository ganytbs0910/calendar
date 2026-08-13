# 発注書 02 — Google Play フィーチャーグラフィック（背景のみ）

## なぜ必要か
Google Play の掲載情報はフィーチャーグラフィック（1024×500）が必須だが、
`fastlane/metadata/android/ja-JP/images/` には `icon.png` しか無く、**未作成**。
現状 Play の掲載面が1枚欠けている。

## 素材名
Play フィーチャーグラフィック用の背景（**文字なし・図版のみ**）

## 用途
Google Play ストアの掲載ヘッダー画像。

## 保存先（ディレクトリの実在を確認済み）
- `fastlane/metadata/android/ja-JP/images/featureGraphic.png`
- （英語版を出す場合は `fastlane/metadata/android/en-US/images/featureGraphic.png`。
  en-US ディレクトリは未作成なので、必要になった時点でこちらで作る）

## 仕様
- 寸法: 1024×500 px（1倍・横長 2.048:1）
- 透過: **不可**。Play は透過を推奨しない。背景まで塗り切ること
  （このため「マゼンタで塗って後で抜く」手順は本素材には適用しない）
- 明暗テーマ: **不要**。Play 側で反転表示されないため1種類でよい
- 容量: 1 MB 以下
- 形式: PNG（RGB）
- **文字は入れない**。日本語のキャッチコピーは納品後にこちらで合成する
  （`appstore_screenshots/_recompose.py` と同じ Hiragino Sans W6 で重ねる）。
  そのため **画面中央から右側 45% は、文字を載せられる余白として静かに保つこと**

## そのまま貼れる英語プロンプト

```
A flat vector banner illustration, 1024 wide by 500 tall, for a calendar app
whose single idea is "how much of today is still yours". Fill the entire canvas
edge to edge with one solid background colour. Place EXACTLY THREE shapes and
nothing else, all grouped within the left 40% of the canvas, leaving the right
45% as empty flat background:

1. One thick circular ring in a single flat colour, with a clean gap of exactly
   one quarter of the circle removed from the upper right.
2. One solid filled wedge inside that same ring's band, sweeping clockwise from
   the top for about one third of the circle, in a second clearly different flat
   colour.
3. One plain rectangle with square corners, standing upright, placed behind and
   slightly to the right of the ring so the ring overlaps it, in a third clearly
   different flat colour.

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
background must be a single flat colour filling the full canvas with no border
and no inner margin.
```

## 受け取ったときの確認項目
- [ ] 1024×500 ちょうどか
- [ ] アルファチャンネルが無いか（`mode` が `RGB`）
- [ ] **文字が1つも入っていないか**
- [ ] 右 45% が平坦で、日本語のキャッチコピーを載せても図版と干渉しないか
- [ ] 図形がちょうど3つか
- [ ] 角丸枠・外周グロー・影・台座・ビネットが付いていないか
- [ ] Play の一覧で縮小表示されたときに何のアプリか伝わるか
- [ ] 容量 1 MB 以下
- [ ] 画像だけが意味を運んでいないか（合成する文言と併せて成立するか）

# Build "best-selling app" style App Store screenshots: real device body
# (titanium frame, Dynamic Island, side buttons) on a branded gradient with
# bold copy on top. Source screens are cropped out of the existing composites.
import os
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter

SRC = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(os.path.dirname(SRC), "appstore_screenshots_framed")
os.makedirs(OUT, exist_ok=True)

CANVAS = (1290, 2796)
FONT = "/System/Library/Fonts/Hiragino Sans GB.ttc"
fB = lambda s: ImageFont.truetype(FONT, s, index=2)  # W6 bold
fR = lambda s: ImageFont.truetype(FONT, s, index=0)  # W3 regular


def hx(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


# filename, badge, headline lines, sub lines, gradient top, gradient bottom, badge text color
SHOTS = [
    ("01_カレンダー共有.png", "カレンダー共有",
     ["1画面で、", "ひと月まるごと。"],
     ["スクショ1枚で予定が全部わかる。", "“空いてる日”を友達や家族にサッと共有。"],
     "#3D5AFE", "#7C8CFF", "#3D5AFE"),
    ("02_AIで予定作成.png", "AIで予定作成",
     ["話すだけで、", "予定が組み上がる。"],
     ["「毎週月曜10時から16時まで大学」と話すだけ。", "AIが意図を読み取り、一週間に自動配置。"],
     "#7C4DFF", "#B07BFF", "#7C4DFF"),
    ("03_バイト分析.png", "バイト分析",
     ["今月のバイト、", "何時間でいくら？"],
     ["シフトに時給を設定すれば給料を自動集計。", "時給900円×60時間＝¥54,000をその場で計算。"],
     "#00B5A6", "#46D6C7", "#00897B"),
    ("04_あとでやる.png", "あとでやる",
     ["“あとでやる”を、", "ためておく。"],
     ["時間が決まらない用事はメモして後で。", "チェックで管理、タスク管理アプリにも。"],
     "#FF8A3D", "#FFB36B", "#E76A1F"),
    ("05_ウィジェット.png", "ウィジェット",
     ["開かなくても、", "今日がわかる。"],
     ["ウィジェットでホーム画面に今日の予定。", "チェックマークで即管理。"],
     "#13AFC0", "#5BD0DB", "#0E8A98"),
    ("06_週表示.png", "週表示",
     ["予定の多さも、", "ひと目で。"],
     ["週表示は日ごとに“件数バッジ”。", "多彩なカラーで自分好みに整理。"],
     "#FF5C8A", "#FF94B4", "#E63E72"),
    ("07_年収の壁ナビ.png", "年収の壁ナビ",
     ["「あと○円で", "130万の壁」。"],
     ["今年の収入と“壁”までの残りをリアルタイム表示。", "シフトを入れすぎる前に気づける。"],
     "#FF7A45", "#FFB07A", "#E2602A"),
    ("08_空き日シェア.png", "空き日シェア",
     ["空いてる日を、", "そのままLINEへ。"],
     ["今月の空き日をキレイな画像に自動生成。", "「この中で都合いい日ある？」をワンタップ共有。"],
     "#06C755", "#4FE08A", "#04A847"),
]


def screen_box(path):
    """Detect the app-screen rectangle inside an existing composite."""
    a = np.asarray(Image.open(path).convert("RGB")).astype(float)
    H, W, _ = a.shape
    gx = np.abs(np.diff(a, axis=1)).sum(2)
    col = (gx > 60).sum(0)
    left = int(np.argmax(col[:W // 2] > H * 0.4))
    rp = col[W // 2:] > H * 0.4
    right = W // 2 + (len(rp) - 1 - int(np.argmax(rp[::-1])))
    gy = np.abs(np.diff(a, axis=0)).sum(2)
    row = (gy > 60).sum(1)
    top = int(np.argmax(row > W * 0.4))
    rp2 = row > W * 0.4
    bot = len(rp2) - 1 - int(np.argmax(rp2[::-1]))
    return left, top, right, bot


def gradient(top, bot):
    t, b = np.array(hx(top)), np.array(hx(bot))
    W, H = CANVAS
    ramp = np.linspace(0, 1, H)[:, None]
    col = (t[None, :] * (1 - ramp) + b[None, :] * ramp).astype(np.uint8)
    img = np.repeat(col[:, None, :], W, axis=1)
    g = Image.fromarray(img, "RGB")
    # soft light blob top-left for depth
    glow = Image.new("L", CANVAS, 0)
    gd = ImageDraw.Draw(glow)
    gd.ellipse([-300, -500, 900, 700], fill=80)
    glow = glow.filter(ImageFilter.GaussianBlur(260))
    white = Image.new("RGB", CANVAS, (255, 255, 255))
    return Image.composite(white, g, glow.point(lambda x: int(x * 0.35)))


def rounded_mask(size, r):
    m = Image.new("L", size, 0)
    ImageDraw.Draw(m).rounded_rectangle([0, 0, size[0], size[1]], r, fill=255)
    return m


def build(shot):
    fn, badge, head, sub, gtop, gbot, btxt = shot
    box = screen_box(os.path.join(SRC, fn))
    ins = 4
    screen = Image.open(os.path.join(SRC, fn)).convert("RGB").crop(
        (box[0] + ins, box[1] + ins, box[2] - ins, box[3] - ins))

    canvas = gradient(gtop, gbot).convert("RGB")
    draw = ImageDraw.Draw(canvas)
    W, _ = CANVAS
    cx = W // 2

    # ---- device geometry ----
    SW = 742                                   # screen width on canvas
    SH = round(SW * screen.height / screen.width)
    bez = 22
    BW, BH = SW + bez * 2, SH + bez * 2
    body_r = 124
    scr_r = body_r - bez + 2
    bx = (W - BW) // 2
    by = 1052                                   # device body top

    # drop shadow
    sh = Image.new("RGBA", CANVAS, (0, 0, 0, 0))
    ImageDraw.Draw(sh).rounded_rectangle([bx, by + 26, bx + BW, by + BH + 26],
                                         body_r, fill=(0, 0, 0, 110))
    sh = sh.filter(ImageFilter.GaussianBlur(46))
    canvas.paste(Image.new("RGB", CANVAS, (0, 0, 0)), (0, 0), sh)

    # titanium body (subtle vertical gradient) + rim highlight
    body = Image.new("RGB", (BW, BH), 0)
    bt, bb = np.array((46, 46, 51)), np.array((20, 20, 23))
    ramp = np.linspace(0, 1, BH)[:, None]
    bcol = (bt * (1 - ramp) + bb * ramp).astype(np.uint8)
    body = Image.fromarray(np.repeat(bcol[:, None, :], BW, axis=1), "RGB")
    bmask = rounded_mask((BW, BH), body_r)
    canvas.paste(body, (bx, by), bmask)
    draw.rounded_rectangle([bx, by, bx + BW - 1, by + BH - 1], body_r,
                           outline=(92, 92, 100), width=2)

    # side buttons (left: action+volume, right: power) flush with body
    btn = (58, 58, 64)
    draw.rounded_rectangle([bx - 4, by + 250, bx + 3, by + 320], 4, fill=btn)      # action
    draw.rounded_rectangle([bx - 4, by + 360, bx + 3, by + 470], 4, fill=btn)      # vol up
    draw.rounded_rectangle([bx - 4, by + 500, bx + 3, by + 610], 4, fill=btn)      # vol dn
    draw.rounded_rectangle([bx + BW - 3, by + 380, bx + BW + 4, by + 560], 4, fill=btn)  # power

    # screen with rounded corners
    sresz = screen.resize((SW, SH), Image.LANCZOS)
    canvas.paste(sresz, (bx + bez, by + bez), rounded_mask((SW, SH), scr_r))

    # ---- copy ----
    pad = 96
    y = 150
    # badge pill
    bf = fB(40)
    tb = draw.textbbox((0, 0), badge, font=bf)
    bw, bh = tb[2] - tb[0], tb[3] - tb[1]
    px, py = 34, 20
    pill = [cx - bw // 2 - px, y, cx + bw // 2 + px, y + bh + py * 2]
    draw.rounded_rectangle(pill, (pill[3] - pill[1]) // 2, fill=(255, 255, 255))
    draw.text((cx, y + (bh + py * 2) // 2), badge, font=bf, fill=hx(btxt),
              anchor="mm")
    y = pill[3] + 56

    # headline
    hf = fB(82)
    lh = 102
    for line in head:
        draw.text((cx, y), line, font=hf, fill=(255, 255, 255), anchor="ma")
        y += lh
    y += 26

    # subtitle
    sf = fR(36)
    slh = 52
    for line in sub:
        draw.text((cx, y), line, font=sf, fill=(255, 255, 255, 230),
                  anchor="ma")
        y += slh

    canvas.save(os.path.join(OUT, fn))
    return fn


for s in SHOTS:
    print("built", build(s))
print("=> ", OUT)

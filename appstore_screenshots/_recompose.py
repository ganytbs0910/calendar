# Update the submitted App Store screenshots in place.
#
# Why this exists rather than a full generator: the script that produced the
# approved framed set (correct Japanese Hiragino glyphs, the current wording,
# the device body and gradient) was lost before it was committed, and the
# version still in git regresses the font and the copy. So the approved PNGs in
# appstore_screenshots_framed/ ARE the source of truth, and this edits them:
# it repaints the badge and headline, and swaps the screen, leaving the
# background, device body and layout exactly as approved.
#
# Everything it needs is measured off the image itself, so it stays correct if
# the artwork is ever regenerated:
#   - the badge pill is found as the first band of white pixels near the top
#   - its text colour is sampled from inside it
#   - the background used to paint over the old text is taken from the clean
#     full-width strip above the pill, tiled — same gradient, same grain, so
#     there is no seam to notice
#
# Usage: python3 _recompose.py            (rewrites every slide listed below)
import os

import numpy as np
from PIL import Image, ImageDraw, ImageFont

SRC = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(SRC)
FRAMED = os.path.join(ROOT, "appstore_screenshots_framed")
SHOTS_DIR = os.path.join(SRC, "_screens")

# The English set is built from the same artwork rather than its own: it used to
# be 1284x2778, a size Apple no longer asks for, and keeping two geometries
# meant two sets of measurements to get wrong. Same frames, English screens,
# English copy.
FRAMED_EN = os.path.join(ROOT, "appstore_screenshots_en")
SHOTS_DIR_EN = os.path.join(SRC, "_screens_en")

FONT_W6 = "/System/Library/Fonts/ヒラギノ角ゴシック W6.ttc"
FONT_INDEX = 0  # 'Hiragino Sans' — the face iOS itself uses, with JP glyph forms

# Measured off the approved artwork.
CANVAS_W = 1290
HEADLINE_TOP = 247       # ink top of the first line
HEADLINE_PITCH = 103     # ink top to ink top
HEADLINE_SIZE = 90
HEADLINE_MAX_W = 1160
BADGE_SIZE = 41
BADGE_PAD_X = 38         # each side, from pill edge to text ink
SCREEN_BOX = (145, 547, 1000, 2189)   # x, y, w, h
SCREEN_RADIUS = 127
SUPERSAMPLE = 3          # render text large and downsample, to keep edges crisp


def ink_bbox(text, font):
    """Bounding box of the drawn pixels, which is what the layout is measured in.

    The probe has to be wider than any line could ever be at the supersampled
    size, or the bbox comes back clipped and the headline is silently rendered
    with its last word cut off. Latin lines are far longer in pixels than the
    Japanese ones this was first written for: "it lands on your week" at 3x is
    over 3000px, which the original probe truncated.
    """
    probe = Image.new("L", (9000, 900), 0)
    ImageDraw.Draw(probe).text((100, 100), text, font=font, fill=255)
    return probe.getbbox()


def find_pill(img):
    """The badge pill: the topmost run of rows containing near-white pixels."""
    px = img.load()
    w, h = img.size
    rows = []
    for y in range(0, 600):
        found = False
        for x in range(0, w, 3):
            r, g, b = px[x, y][:3]
            if min(r, g, b) > 225:
                found = True
                break
        rows.append(found)
    y0 = rows.index(True)
    y1 = y0
    while y1 + 1 < len(rows) and rows[y1 + 1]:
        y1 += 1
    xs = [x for x in range(w) if min(px[x, (y0 + y1) // 2][:3]) > 225]
    return xs[0], y0, xs[-1], y1


def badge_text_colour(img, pill):
    """The most saturated colour inside the pill is its text."""
    x0, y0, x1, y1 = pill
    px = img.load()
    best, best_sat = (0, 0, 0), -1
    for y in range(y0 + 6, y1 - 6, 2):
        for x in range(x0 + 6, x1 - 6, 2):
            r, g, b = px[x, y][:3]
            sat = max(r, g, b) - min(r, g, b)
            if sat > best_sat:
                best, best_sat = (r, g, b), sat
    return best


def fill_background(img, y0, y1, ref=14):
    """Erase everything between y0 and y1, leaving only background behind.

    The gradient is not flat, so pasting a strip copied from elsewhere leaves
    visible banding. Instead the band is rebuilt: a smooth base interpolated
    between the real rows just above and just below it (so it meets both edges
    exactly), plus the grain lifted from those same rows, so the reconstructed
    area has the same texture as the rest of the artwork.
    """
    a = np.asarray(img).astype(np.float64)
    h = y1 - y0 + 1

    def smooth_rows(block):
        """Average the rows, then smooth along x — leaves the gradient, drops the grain."""
        row = block.mean(axis=0)
        k = 61
        pad = np.pad(row, ((k // 2, k // 2), (0, 0)), mode="edge")
        kernel = np.ones(k) / k
        return np.stack([np.convolve(pad[:, c], kernel, mode="valid") for c in range(3)], axis=1)

    above = a[max(0, y0 - ref):y0]
    below = a[y1 + 1:y1 + 1 + ref]
    top = smooth_rows(above)
    bottom = smooth_rows(below)

    t = np.linspace(0.0, 1.0, h)[:, None, None]
    base = top[None, :, :] * (1.0 - t) + bottom[None, :, :] * t

    # Grain, taken from the same artwork rather than invented: the reference
    # rows minus their own smooth version, tiled to cover the band.
    grain_src = np.concatenate([above - smooth_rows(above)[None, :, :],
                                below - smooth_rows(below)[None, :, :]], axis=0)
    reps = int(np.ceil(h / grain_src.shape[0]))
    grain = np.concatenate([grain_src] * reps, axis=0)[:h]

    a[y0:y1 + 1] = np.clip(base + grain, 0, 255)
    return Image.fromarray(a.astype(np.uint8))


def draw_text_centred(img, text, font_path, size, ink_top, colour):
    """Draw `text` centred on the canvas with its ink starting at `ink_top`."""
    font = ImageFont.truetype(font_path, size * SUPERSAMPLE, index=FONT_INDEX)
    bbox = ink_bbox(text, font)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    layer = Image.new("RGBA", (tw + 40, th + 40), (0, 0, 0, 0))
    ImageDraw.Draw(layer).text((20 - (bbox[0] - 100), 20 - (bbox[1] - 100)),
                               text, font=font, fill=colour + (255,))
    layer = layer.resize(
        (round(layer.width / SUPERSAMPLE), round(layer.height / SUPERSAMPLE)),
        Image.LANCZOS,
    )
    x = round(CANVAS_W / 2 - layer.width / 2)
    img.paste(layer, (x, ink_top - round(20 / SUPERSAMPLE)), layer)


def fit_size(lines, base):
    """Shrink the headline just enough that its longest line fits the canvas."""
    size = base
    while size > 40:
        font = ImageFont.truetype(FONT_W6, size, index=FONT_INDEX)
        widest = max(ink_bbox(l, font)[2] - ink_bbox(l, font)[0] for l in lines)
        if widest <= HEADLINE_MAX_W:
            return size
        size -= 2
    return size


def set_badge(img, text):
    pill = find_pill(img)
    colour = badge_text_colour(img, pill)
    x0, y0, x1, y1 = pill
    height = y1 - y0 + 1

    font = ImageFont.truetype(FONT_W6, BADGE_SIZE, index=FONT_INDEX)
    b = ink_bbox(text, font)
    ink_w, ink_h = b[2] - b[0], b[3] - b[1]
    pill_w = ink_w + BADGE_PAD_X * 2

    # Wipe the old pill, then draw the new one at the same vertical position.
    img.paste(fill_background(img, y0 - 4, y1 + 4), (0, 0))

    left = round(CANVAS_W / 2 - pill_w / 2)
    ImageDraw.Draw(img).rounded_rectangle(
        [left, y0, left + pill_w, y1], radius=height // 2, fill=(255, 255, 255)
    )
    draw_text_centred(img, text, FONT_W6, BADGE_SIZE,
                      y0 + (height - ink_h) // 2, colour)


def set_headline(img, lines):
    top = HEADLINE_TOP - 12
    bottom = HEADLINE_TOP + HEADLINE_PITCH * (len(lines) - 1) + HEADLINE_SIZE + 24
    img.paste(fill_background(img, top, bottom), (0, 0))

    size = fit_size(lines, HEADLINE_SIZE)
    for i, line in enumerate(lines):
        draw_text_centred(img, line, FONT_W6, size,
                          HEADLINE_TOP + HEADLINE_PITCH * i, (255, 255, 255))


def set_screen(img, capture_path):
    """Drop a fresh simulator capture into the device's screen, corners and all."""
    x, y, w, h = SCREEN_BOX
    shot = Image.open(capture_path).convert("RGB")

    # Cover the slot, then centre-crop — the capture's aspect is very close, so
    # this trims a few pixels at the sides rather than distorting the UI.
    scale = max(w / shot.width, h / shot.height)
    shot = shot.resize((round(shot.width * scale), round(shot.height * scale)), Image.LANCZOS)
    shot = shot.crop((
        (shot.width - w) // 2,
        (shot.height - h) // 2,
        (shot.width - w) // 2 + w,
        (shot.height - h) // 2 + h,
    ))

    mask = Image.new("L", (w * 2, h * 2), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        [0, 0, w * 2 - 1, h * 2 - 1], radius=SCREEN_RADIUS * 2, fill=255
    )
    mask = mask.resize((w, h), Image.LANCZOS)
    img.paste(shot, (x, y), mask)


# filename → what to change. Omit a key to leave that part of the slide alone.
SLIDES = [
    {
        "file": "01_カレンダー共有.png",
        "badge": "残り自由時間",
        "headline": ["今日、あと何時間", "空いてる？"],
        "screen": "01_month.png",
    },
    {
        "file": "02_AIで予定作成.png",
        "badge": "時間管理エージェント",
        "headline": ["やりたいことを書けば", "一週間に置かれる"],
        "screen": "02_agent.png",
    },
    {
        "file": "03_バイト分析.png",
        "headline": ["その時間は、", "いくらになった？"],
        "screen": "03_stats.png",
    },
    {
        "file": "04_あとでやる.png",
        "screen": "04_later.png",
    },
    {
        "file": "05_ウィジェット.png",
        "headline": ["開かなくても、", "今日の余白がわかる"],
    },
    {
        "file": "06_週表示.png",
        "badge": "週表示",
        "headline": ["一週間ぶんの余白が、", "ひと目で。"],
        "screen": "06_week.png",
    },
    {
        "file": "07_年収の壁ナビ.png",
        "screen": "07_wall.png",
    },
    {
        "file": "08_空き日シェア.png",
    },
]


# The Japanese-only income-wall slide is deliberately absent from the English
# set: it is guidance on Japanese tax thresholds, and the screen behind it is
# Japanese. The old English set shipped it untranslated.
SLIDES_EN = [
    {
        "file": "01_カレンダー共有.png",
        "badge": "Free time left",
        "headline": ["How much of today", "is still yours?"],
        "screen": "01_month.png",
    },
    {
        "file": "02_AIで予定作成.png",
        "badge": "Plan by writing",
        "headline": ["Write it once,", "it lands on your week"],
        "screen": "02_agent.png",
    },
    {
        "file": "03_バイト分析.png",
        "badge": "Insights",
        "headline": ["What did those", "hours turn into?"],
        "screen": "03_stats.png",
    },
    {
        "file": "04_あとでやる.png",
        "badge": "Later list",
        "headline": ["No time for it yet?", "Park it for later"],
        "screen": "04_later.png",
    },
    {
        "file": "05_ウィジェット.png",
        "badge": "Widget",
        "headline": ["Your free hours,", "without opening the app"],
        "screen": "05_widget.png",
    },
    {
        "file": "06_週表示.png",
        "badge": "Week view",
        "headline": ["A whole week", "of breathing room"],
        "screen": "06_week.png",
    },
    {
        "file": "08_空き日シェア.png",
        "badge": "Free days",
        "headline": ["Share the days", "you are free"],
        "screen": "08_share.png",
    },
]


def build(slides, framed_dir, shots_dir):
    os.makedirs(framed_dir, exist_ok=True)
    for slide in slides:
        path = os.path.join(framed_dir, slide["file"])
        # The English set is regenerated from the Japanese artwork, so seed it
        # from there the first time (or whenever the base is refreshed).
        if framed_dir != FRAMED:
            base = Image.open(os.path.join(FRAMED, slide["file"])).convert("RGB")
            base.save(path)
        img = Image.open(path).convert("RGB")

        # A slide whose capture hasn't been taken yet is left exactly as it is,
        # so a half-finished run never ships a slide with new copy over an old
        # screen (or vice versa).
        if "screen" in slide:
            capture = os.path.join(shots_dir, slide["screen"])
            if not os.path.exists(capture):
                print(f"{slide['file']}: SKIPPED — no capture at {slide['screen']}")
                continue
            set_screen(img, capture)
        if "badge" in slide:
            set_badge(img, slide["badge"])
        if "headline" in slide:
            set_headline(img, slide["headline"])

        img.save(path)
        changed = [k for k in ("screen", "badge", "headline") if k in slide]
        print(f"{slide['file']}: {', '.join(changed) if changed else 'unchanged'}")


def main():
    print("— 日本語 —")
    build(SLIDES, FRAMED, SHOTS_DIR)
    print("— English —")
    build(SLIDES_EN, FRAMED_EN, SHOTS_DIR_EN)


if __name__ == "__main__":
    main()

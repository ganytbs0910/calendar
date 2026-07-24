# English App Store screenshots: reuse the approved Japanese framed images
# wholesale (device + app screen + gradient stay pixel-identical), erase only
# the Japanese marketing copy in the top strip via inpainting, and redraw the
# badge + 2-line headline in English with SF Pro. The in-app screen content
# stays Japanese by design (copy-only English pass).
import os, sys
import numpy as np
import cv2
from PIL import Image, ImageDraw, ImageFont

SRC = '/Users/gan/Desktop/calendar/appstore_screenshots_framed'
OUT = '/Users/gan/Desktop/calendar/appstore_screenshots_en'
os.makedirs(OUT, exist_ok=True)

W, H = 1290, 2796
BODY_TOP = 523           # phone body top (same for all shots)
STRIP = 505              # erase/redraw only above this (text lives y 108..433)
SF = '/System/Library/Fonts/SFNS.ttf'

def font(size, weight='Bold'):
    f = ImageFont.truetype(SF, size)
    try:
        f.set_variation_by_name(weight)
    except Exception:
        pass
    return f

def hx(h):
    h = h.lstrip('#'); return tuple(int(h[i:i+2], 16) for i in (0, 2, 4))

# filename, badge, [headline lines], badge-text color
SHOTS = [
    ('01_カレンダー共有.png', 'Share',        ['A whole month,', 'in one screen'],       '#3D5AFE'),
    ('02_AIで予定作成.png',  'AI Planning',  ['Say it once —', 'your week fills in'],    '#7C4DFF'),
    ('03_バイト分析.png',    'Insights',     ['See where', 'your time goes'], '#00897B'),
    ('04_あとでやる.png',    'Later List',   ['Park it now,', 'do it later'],            '#E76A1F'),
    ('05_ウィジェット.png',  'Widget',       ['See your day', 'without opening'],        '#0E8A98'),
    ('06_週表示.png',        'Week View',    ['See how busy', 'each day is'],            '#E63E72'),
    ('07_年収の壁ナビ.png',  'Income Wall',  ['Know how far to', 'your income limit'],   '#E2602A'),
    ('08_空き日シェア.png',  'Free Days',    ['Share your free days', 'in one tap'],     '#04A847'),
]

def erase_top(img_bgr):
    """Remove the Japanese copy in the top strip, leaving clean gradient."""
    gray = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2GRAY).astype(int)
    mask = np.zeros((H, W), np.uint8)
    region = gray[:STRIP]
    med = np.median(region, axis=1, keepdims=True)      # per-row background
    dev = np.abs(region - med)
    m = dev > 26                                         # white text + dark shadow
    m[:, :90] = False; m[:, 1200:] = False               # text is centred
    mask[:STRIP][m] = 255
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, np.ones((25, 25), np.uint8))
    mask = cv2.dilate(mask, np.ones((9, 9), np.uint8))
    out = cv2.inpaint(img_bgr, mask, 7, cv2.INPAINT_TELEA)
    # Smooth any residual patch (pill fill) — background is smooth, so blending a
    # blurred copy under the mask is lossless-looking. Keep clear of the phone.
    safe = mask.copy(); safe[STRIP - 40:] = 0
    blur = cv2.GaussianBlur(out, (0, 0), 13)
    feather = cv2.GaussianBlur(safe, (0, 0), 9).astype(float)[..., None] / 255.0
    out = (out * (1 - feather) + blur * feather).astype(np.uint8)
    return out

def draw_text(base_rgb, badge, head, btxt):
    """Draw badge pill + 2-line headline at 2x supersample for crisp edges."""
    S = 2
    layer = Image.new('RGBA', (W * S, H * S), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    cx = W * S // 2

    # ---- headline: auto-fit so the widest line stays within the margin ----
    maxw = int(1170 * S)
    size = 92 * S
    hf = font(size, 'Heavy')
    while size > 60 * S:
        hf = font(size, 'Heavy')
        if max(d.textlength(l, font=hf) for l in head) <= maxw:
            break
        size -= 2 * S
    lh = int(size * 1.16)
    total = lh * len(head)
    y = int(300 * S) - total // 2      # vertically centre the block around y=300
    for line in head:
        # soft shadow then white fill
        d.text((cx + 3 * S, y + 4 * S), line, font=hf, fill=(0, 0, 0, 70), anchor='ma')
        d.text((cx, y), line, font=hf, fill=(255, 255, 255, 255), anchor='ma')
        y += lh

    # ---- badge pill above the headline ----
    bf = font(40 * S, 'Bold')
    tb = d.textbbox((0, 0), badge, font=bf)
    bw, bh = tb[2] - tb[0], tb[3] - tb[1]
    px, py = 34 * S, 18 * S
    by = int(150 * S)                  # pill top
    pill = [cx - bw // 2 - px, by, cx + bw // 2 + px, by + bh + py * 2]
    r = (pill[3] - pill[1]) // 2
    d.rounded_rectangle(pill, r, fill=(255, 255, 255, 255))
    d.text((cx, by + (bh + py * 2) // 2 - tb[1]), badge, font=bf, fill=hx(btxt) + (255,), anchor='mm')

    layer = layer.resize((W, H), Image.LANCZOS)
    out = base_rgb.convert('RGBA'); out.alpha_composite(layer)
    return out.convert('RGB')

def build(shot):
    fn, badge, head, btxt = shot
    img = cv2.cvtColor(np.asarray(Image.open(os.path.join(SRC, fn)).convert('RGB')), cv2.COLOR_RGB2BGR)
    erased = erase_top(img)
    base = Image.fromarray(cv2.cvtColor(erased, cv2.COLOR_BGR2RGB))
    final = draw_text(base, badge, head, btxt)
    final.save(os.path.join(OUT, fn))
    return fn

if __name__ == '__main__':
    only = sys.argv[1] if len(sys.argv) > 1 else None
    for s in SHOTS:
        if only and only not in s[0]:
            continue
        print('built', build(s))
    print('=>', OUT)

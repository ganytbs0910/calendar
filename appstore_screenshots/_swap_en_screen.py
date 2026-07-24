# English App Store pipeline (2 steps):
#  1) _make_en.py  -> redraws badge + English headline onto appstore_screenshots_framed/,
#     writing to ../appstore_screenshots_en/ (app screen inside still the JP crop).
#  2) this script  -> swaps a fresh English simulator capture into that frame.
# Run _make_en.py FIRST, then swap each shot. Re-running _make_en.py reverts
# the screens to the JP crop, so re-swap afterwards.
#
# Swap a fresh English app-screen capture into an existing English framed shot,
# keeping the device body, gradient and English marketing copy intact.
import sys
import numpy as np
from PIL import Image, ImageDraw

FRAMED = sys.argv[1]   # target framed png (appstore_screenshots_en/..)
CAP = sys.argv[2]      # simulator capture png (1320x2868)

# screen rect measured off the framed set (body_top 523, consistent across all 8)
SX, SY, SW, SH = 145, 547, 1000, 2186
SCR_R = 141
BODY = (118, 523, 1172, 2759)

canvas = Image.open(FRAMED).convert('RGB')

# 1) repaint the device-body gradient over the old screen so nothing shows through
bt, bb = np.array((46, 46, 51)), np.array((20, 20, 23))
BH = BODY[3] - BODY[1]
ramp = ((np.arange(SY, SY + SH) - BODY[1]) / BH)[:, None]
col = (bt * (1 - ramp) + bb * ramp).astype(np.uint8)
canvas.paste(Image.fromarray(np.repeat(col[:, None, :], SW, axis=1), 'RGB'), (SX, SY))

# 2) scale the capture to cover the screen rect, centre-crop the overflow
src = Image.open(CAP).convert('RGB')
scale = max(SW / src.width, SH / src.height)
rw, rh = round(src.width * scale), round(src.height * scale)
src = src.resize((rw, rh), Image.LANCZOS).crop(
    ((rw - SW) // 2, (rh - SH) // 2, (rw - SW) // 2 + SW, (rh - SH) // 2 + SH))

mask = Image.new('L', (SW, SH), 0)
ImageDraw.Draw(mask).rounded_rectangle([0, 0, SW, SH], SCR_R, fill=255)
canvas.paste(src, (SX, SY), mask)
canvas.save(FRAMED)
print('swapped screen into', FRAMED)

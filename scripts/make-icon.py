#!/usr/bin/env python3
"""Generate a 100x100 RGBA PNG launcher icon — stylised front-facing tram."""
import math, struct, zlib, os

W = H = 100
grid = [[(0, 0, 0, 255)] * W for _ in range(H)]

# ── Primitive helpers ────────────────────────────────────────────────────────

def blend(x, y, r, g, b, alpha):
    if 0 <= x < W and 0 <= y < H:
        pr, pg, pb, _ = grid[y][x]
        a = alpha / 255.0
        grid[y][x] = (
            int(pr + (r - pr) * a),
            int(pg + (g - pg) * a),
            int(pb + (b - pb) * a),
            255,
        )

def fill_rrect(x1, y1, x2, y2, rad, col, alpha=255):
    r, g, b = col
    for y in range(max(0, y1 - 1), min(H, y2 + 2)):
        for x in range(max(0, x1 - 1), min(W, x2 + 2)):
            dx = max(x1 + rad - x, x - (x2 - rad), 0)
            dy = max(y1 + rad - y, y - (y2 - rad), 0)
            d  = math.sqrt(dx * dx + dy * dy)
            aa = min(1.0, max(0.0, rad + 0.5 - d))
            blend(x, y, r, g, b, int(alpha * aa))

def fill_circle(cx, cy, rad, col, alpha=255):
    r, g, b = col
    for y in range(max(0, int(cy - rad) - 1), min(H, int(cy + rad) + 2)):
        for x in range(max(0, int(cx - rad) - 1), min(W, int(cx + rad) + 2)):
            d  = math.sqrt((x - cx) ** 2 + (y - cy) ** 2)
            aa = min(1.0, max(0.0, rad + 0.5 - d))
            blend(x, y, r, g, b, int(alpha * aa))

def draw_line(x0, y0, x1, y1, col, width=1.5):
    r, g, b = col
    dx = x1 - x0; dy = y1 - y0
    length = math.sqrt(dx * dx + dy * dy)
    if length == 0: return
    steps = int(length * 3) + 1
    for i in range(steps + 1):
        t = i / steps
        px = x0 + dx * t
        py = y0 + dy * t
        for oy in range(-2, 3):
            for ox in range(-2, 3):
                ix, iy = int(px) + ox, int(py) + oy
                d = math.sqrt((px - ix) ** 2 + (py - iy) ** 2)
                aa = max(0.0, width - d)
                blend(ix, iy, r, g, b, int(255 * min(1.0, aa)))

# ── Palette ──────────────────────────────────────────────────────────────────
BG       = (10,  14,  22)   # very dark navy
BODY     = (0,  180, 230)   # tram cyan
BODY_LO  = (0,  130, 170)   # darker underbelly
ROOF     = (0,  210, 255)   # brighter roof highlight
WIN_BG   = (12,  30,  55)   # deep-blue window interior
WIN_SHIN = (80, 160, 220)   # subtle window shine
DEST_BG  = (15,  20,  40)   # destination-board dark strip
DEST_TXT = (0,  220, 255)   # destination number dots
LIGHT_L  = (255, 240, 180)  # left headlight (warm)
LIGHT_R  = (220, 240, 255)  # right headlight (cool running light)
WHEEL    = (35,  40,  55)   # tyre
HUB      = (80,  95, 120)   # wheel hub
BUMP     = (0,  100, 140)   # front bumper
PANTO    = (0,  160, 200)   # pantograph arm
WIRE     = (60,  80, 110)   # overhead wire

# ── Background circle ────────────────────────────────────────────────────────
fill_rrect(0, 0, 99, 99, 20, BG)

# ── Pantograph (electric collector arm above roof) ───────────────────────────
# Overhead wire
draw_line(5, 14, 95, 14, WIRE, 0.7)
# Two diagonal arms meeting at the wire
draw_line(34, 26, 44, 14, PANTO, 1.0)
draw_line(66, 26, 56, 14, PANTO, 1.0)
# Collector bar at wire level
draw_line(44, 14, 56, 14, ROOF, 1.2)

# ── Roof ─────────────────────────────────────────────────────────────────────
fill_rrect(18, 24, 82, 32, 4, ROOF)

# ── Destination board (narrow dark strip at top of cab) ──────────────────────
fill_rrect(20, 19, 80, 26, 2, DEST_BG)
# Dots representing line number "22"
for dx in [28, 32, 36, 44, 48, 52]:
    fill_circle(dx, 22.5, 1.5, DEST_TXT)

# ── Main tram body ────────────────────────────────────────────────────────────
fill_rrect(14, 30, 86, 74, 5, BODY)

# ── Windscreen (large front glass) ───────────────────────────────────────────
fill_rrect(20, 33, 80, 60, 3, WIN_BG)
# Windscreen divider bar
fill_rrect(48, 33, 52, 60, 0, BODY)
# Top corner shine strips
fill_rrect(21, 34, 36, 37, 2, WIN_SHIN, 120)
fill_rrect(64, 34, 79, 37, 2, WIN_SHIN, 120)

# ── Cab fascia (panel below windscreen) ──────────────────────────────────────
fill_rrect(14, 60, 86, 68, 3, BODY_LO)

# ── Headlights ───────────────────────────────────────────────────────────────
fill_circle(27.0, 64.0, 5.5, LIGHT_L)         # left — warm white
fill_circle(73.0, 64.0, 5.5, LIGHT_R)         # right — cool white
fill_circle(27.0, 64.0, 2.5, (255, 255, 240)) # left glow core
fill_circle(73.0, 64.0, 2.5, (240, 248, 255)) # right glow core

# Centre badge (route number plate)
fill_rrect(42, 61, 58, 68, 2, DEST_BG)
fill_circle(47.0, 64.5, 1.5, DEST_TXT)
fill_circle(50.0, 64.5, 1.5, DEST_TXT)
fill_circle(53.0, 64.5, 1.5, DEST_TXT)

# ── Front bumper ─────────────────────────────────────────────────────────────
fill_rrect(18, 72, 82, 76, 3, BUMP)

# ── Wheels ───────────────────────────────────────────────────────────────────
for wx in [30.0, 70.0]:
    fill_circle(wx, 81.0, 8.0, WHEEL)
    fill_circle(wx, 81.0, 4.5, HUB)
    fill_circle(wx, 81.0, 2.0, (110, 125, 150))

# ── Wheel arch cutouts in body ────────────────────────────────────────────────
for wx in [30.0, 70.0]:
    fill_circle(wx, 81.0, 7.0, BODY_LO, 60)

# ── PNG encode ───────────────────────────────────────────────────────────────
def png_chunk(tag, data):
    payload = tag + data
    return (struct.pack('>I', len(data)) + payload
            + struct.pack('>I', zlib.crc32(payload) & 0xFFFFFFFF))

raw = bytearray()
for row in grid:
    raw.append(0)
    for r, g, b, a in row:
        raw += bytes([r, g, b, a])

sig  = b'\x89PNG\r\n\x1a\n'
ihdr = png_chunk(b'IHDR', struct.pack('>IIBBBBB', W, H, 8, 6, 0, 0, 0))
idat = png_chunk(b'IDAT', zlib.compress(bytes(raw), 9))
iend = png_chunk(b'IEND', b'')

out = os.path.join(os.path.dirname(__file__), '..', 'connectiq-watch',
                   'resources', 'drawables', 'launcher_icon.png')
with open(out, 'wb') as f:
    f.write(sig + ihdr + idat + iend)
print('Written', os.path.getsize(out), 'bytes to', out)

#!/usr/bin/env python3
"""Generate a 40x40 RGBA PNG refresh/reload icon for the in-app Menu2."""
import math, struct, zlib, os

W = H = 40
cx = cy = (W - 1) / 2.0

# RGBA pixel grid (R, G, B, A)
grid = [[(0, 0, 0, 0)] * W for _ in range(H)]

def blend(x, y, alpha):
    if 0 <= x < W and 0 <= y < H:
        old_a = grid[y][x][3]
        new_a = min(255, old_a + alpha * (255 - old_a) // 255)
        grid[y][x] = (255, 255, 255, new_a)

R_OUT = cx * 0.84
R_IN  = cx * 0.50

# ── Draw arc ring ───────────────────────────────────────────────────────────
# Arc spans from GAP_END to GAP_START (clockwise); leave a ~50° gap at top
# so there's room for the arrowhead.
GAP_CENTER = 285.0   # where the gap (arrowhead) sits, in degrees
GAP_HALF   = 28.0

def in_arc(deg):
    d = deg % 360
    lo = (GAP_CENTER - GAP_HALF) % 360
    hi = (GAP_CENTER + GAP_HALF) % 360
    if lo < hi:
        return not (lo <= d <= hi)
    else:
        return d >= lo or d <= hi

for py in range(H):
    for px in range(W):
        dx = px - cx
        dy = py - cy
        dist = math.sqrt(dx * dx + dy * dy)
        if R_IN <= dist <= R_OUT:
            # Anti-alias ring edges
            edge_inner = dist - R_IN
            edge_outer = R_OUT - dist
            ring_aa = min(1.0, edge_inner) * min(1.0, edge_outer)
            # Arc angle coverage
            angle = math.degrees(math.atan2(dy, dx)) % 360
            if in_arc(angle):
                # Soft arc edges near gap
                nearest_gap = min(
                    abs(angle - (GAP_CENTER - GAP_HALF)) % 360,
                    abs(angle - (GAP_CENTER + GAP_HALF)) % 360
                )
                arc_aa = min(1.0, nearest_gap / 4.0)
                aa = int(255 * ring_aa * arc_aa)
                blend(px, py, aa)

# ── Draw arrowhead at gap (pointing clockwise) ──────────────────────────────
# Tip of the arrowhead sits on the arc midline at GAP_CENTER degrees.
# Arrow points in the clockwise tangent direction = GAP_CENTER + 90.
tip_angle  = math.radians(GAP_CENTER)
point_dir  = math.radians(GAP_CENTER + 90)   # clockwise tangent
perp_dir   = math.radians(GAP_CENTER)         # radial

R_MID = (R_OUT + R_IN) / 2
arrow_len  = (R_OUT - R_IN) * 1.6
arrow_half = (R_OUT - R_IN) * 0.8

tip_x = cx + R_MID * math.cos(tip_angle)
tip_y = cy + R_MID * math.sin(tip_angle)

# Three vertices: tip, left wing, right wing
v_tip = (tip_x + arrow_len * math.cos(point_dir),
         tip_y + arrow_len * math.sin(point_dir))
v_l   = (tip_x - arrow_half * math.cos(perp_dir),
         tip_y - arrow_half * math.sin(perp_dir))
v_r   = (tip_x + arrow_half * math.cos(perp_dir),
         tip_y + arrow_half * math.sin(perp_dir))

def cross2d(o, a, b):
    return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])

def in_triangle(p, a, b, c):
    d1 = cross2d(a, b, p)
    d2 = cross2d(b, c, p)
    d3 = cross2d(c, a, p)
    has_neg = d1 < 0 or d2 < 0 or d3 < 0
    has_pos = d1 > 0 or d2 > 0 or d3 > 0
    return not (has_neg and has_pos)

for py in range(H):
    for px in range(W):
        if in_triangle((px + 0.5, py + 0.5), v_tip, v_l, v_r):
            blend(px, py, 255)

# ── Encode PNG ───────────────────────────────────────────────────────────────
def png_chunk(tag, data):
    payload = tag + data
    return struct.pack('>I', len(data)) + payload + struct.pack('>I', zlib.crc32(payload) & 0xFFFFFFFF)

raw = bytearray()
for row in grid:
    raw.append(0)
    for r, g, b, a in row:
        raw += bytes([r, g, b, a])

sig  = b'\x89PNG\r\n\x1a\n'
ihdr = png_chunk(b'IHDR', struct.pack('>IIBBBBB', W, H, 8, 6, 0, 0, 0))  # RGBA
idat = png_chunk(b'IDAT', zlib.compress(bytes(raw), 9))
iend = png_chunk(b'IEND', b'')

out = os.path.join(os.path.dirname(__file__), '..', 'connectiq-watch',
                   'resources', 'drawables', 'menu_refresh.png')
with open(out, 'wb') as f:
    f.write(sig + ihdr + idat + iend)
print(f'Written {os.path.getsize(out)} bytes → {out}')

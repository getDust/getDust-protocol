# Produces src/assets/dust-logo.png (premultiplied resize of the transparent brand PNG,
# whose transparent pixels carry pure-black RGB) and src/assets/favicon.svg traced from
# the real pixel grid of the opaque brand PNG.
import numpy as np
from PIL import Image

SRC_T = 'brand/LOGO DUST PNG...png'
SRC_O = 'brand/LOGO DUST PNG.png'

# palette = real pixel coordinates in SRC_O (see tokens.css provenance)
PAL = {'ground': (0, 0), 'orange': (889, 797), 'cream': (953, 581)}

def premul_resize(im, size):
    a = np.asarray(im.convert('RGBA'), dtype=np.float64) / 255.0
    pm = a.copy(); pm[..., :3] *= a[..., 3:4]
    chans = [Image.fromarray(pm[..., i].astype(np.float32), mode='F').resize(size, Image.LANCZOS) for i in range(4)]
    r = np.stack([np.asarray(c) for c in chans], -1)
    al = np.clip(r[..., 3:4], 0, 1)
    rgb = np.where(al > 1e-6, r[..., :3] / np.maximum(al, 1e-6), 0)
    out = np.concatenate([np.clip(rgb, 0, 1), al], -1)
    return Image.fromarray((out * 255 + 0.5).astype(np.uint8), 'RGBA')

t = Image.open(SRC_T).convert('RGBA')
al = np.asarray(t)[..., 3]
ys, xs = np.where(al > 8)
x0, x1, y0, y1 = xs.min(), xs.max() + 1, ys.min(), ys.max() + 1
pad = 12
crop = t.crop((x0 - pad, y0 - pad, x1 + pad, y1 + pad))
print('bbox', x0, y0, x1, y1, 'crop', crop.size)
w, h = crop.size
out = premul_resize(crop, (720, round(720 * h / w)))
out.save('src/assets/dust-logo.png', optimize=True)
print('logo', out.size)

# favicon: 32x32 grid over a square window of the opaque PNG around the same bbox
o = np.asarray(Image.open(SRC_O).convert('RGB'), dtype=np.float64)
pal = {k: o[y, x] for k, (x, y) in PAL.items()}
side = max(x1 - x0, y1 - y0) + 2 * 40
cx, cy = (x0 + x1) // 2, (y0 + y1) // 2
sx, sy = cx - side // 2, cy - side // 2
cell = side / 32
names = list(pal)
grid = []
for gy in range(32):
    row = []
    for gx in range(32):
        blk = o[int(sy + gy * cell):int(sy + (gy + 1) * cell), int(sx + gx * cell):int(sx + (gx + 1) * cell)].reshape(-1, 3)
        votes = [min(names, key=lambda n: ((p - pal[n]) ** 2).sum()) for p in blk[::3]]
        cnt = {n: votes.count(n) * (2.4 if n == 'ground' else 1) for n in names}; row.append(max(cnt, key=cnt.get))
    grid.append(row)

def hx(n): return '#%02x%02x%02x' % tuple(int(v) for v in pal[n])
parts = ['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="32" height="32" shape-rendering="crispEdges">',
         '<rect width="32" height="32" rx="6" fill="%s"/>' % hx('ground')]
for name in ('orange', 'cream'):
    d = []
    for y, row in enumerate(grid):
        x = 0
        while x < 32:
            if row[x] == name:
                s = x
                while x < 32 and row[x] == name: x += 1
                d.append('M%d %dh%dv1h-%dz' % (s, y, x - s, x - s))
            else: x += 1
    parts.append('<path fill="%s" d="%s"/>' % (hx(name), ''.join(d)))
parts.append('</svg>')
open('src/assets/favicon.svg', 'w').write(''.join(parts))
print('favicon bytes', len(''.join(parts)), {n: hx(n) for n in pal})
print('\n'.join(''.join({'ground': '.', 'orange': 'o', 'cream': 'c'}[c] for c in r) for r in grid))

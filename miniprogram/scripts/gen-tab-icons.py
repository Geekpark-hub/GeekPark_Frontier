"""Tab icons: unified 2px stroke @24dp, round joins, brand selected / muted idle."""
from PIL import Image, ImageDraw
import os

OUT = os.path.join(os.path.dirname(__file__), '..', 'assets')
DP = 24
SCALE = 3
SIZE = DP * SCALE
STROKE = 2 * SCALE
RADIUS = 2 * SCALE
PAD = 3 * SCALE

INK = (20, 32, 43, 255)
MUTED = (168, 160, 150, 255)


def new_canvas():
    return Image.new('RGBA', (SIZE, SIZE), (0, 0, 0, 0))


def save(img, name):
    path = os.path.join(OUT, name)
    img.save(path, 'PNG')
    print('wrote', name)


def line(d, a, b, color):
    d.line([a, b], fill=color, width=STROKE)


def rounded_rect_outline(d, box, color, radius=RADIUS):
    d.rounded_rectangle(box, radius=radius, outline=color, width=STROKE)


def circle_outline(d, cx, cy, r, color):
    d.ellipse([cx - r, cy - r, cx + r, cy + r], outline=color, width=STROKE)


def draw_feed(color):
    im = new_canvas()
    d = ImageDraw.Draw(im)
    rail_x = PAD + SCALE
    d.rounded_rectangle(
        [rail_x, PAD + SCALE * 2, rail_x + STROKE, SIZE - PAD - SCALE * 2],
        radius=STROKE // 2,
        fill=color,
    )
    lx0 = rail_x + STROKE + 3 * SCALE
    x1 = SIZE - PAD
    ys = [PAD + 5 * SCALE, SIZE // 2, SIZE - PAD - 5 * SCALE]
    for y, ratio in zip(ys, (1.0, 0.78, 0.58)):
        line(d, (lx0, y), (lx0 + (x1 - lx0) * ratio, y), color)
    return im


def draw_event(color):
    """Clean calendar: frame + header rule + two top stems + one date mark."""
    im = new_canvas()
    d = ImageDraw.Draw(im)
    x0, y0 = PAD, PAD + 4 * SCALE
    x1, y1 = SIZE - PAD, SIZE - PAD
    rounded_rect_outline(d, [x0, y0, x1, y1], color, radius=RADIUS + SCALE)
    hy = y0 + 6 * SCALE
    line(d, (x0 + STROKE * 0.8, hy), (x1 - STROKE * 0.8, hy), color)
    # two top stems (calendar rings) — short verticals only, clearer than circles
    for cx in (SIZE * 0.35, SIZE * 0.65):
        line(d, (cx, PAD + SCALE), (cx, y0 + STROKE * 0.3), color)
    # single date square
    s0 = SIZE * 0.36
    s1 = SIZE * 0.54
    t0 = SIZE * 0.52
    t1 = SIZE * 0.70
    rounded_rect_outline(d, [s0, t0, s1, t1], color, radius=SCALE)
    return im


def draw_mine(color):
    """Identity card: frame + avatar circle + two text lines."""
    im = new_canvas()
    d = ImageDraw.Draw(im)
    x0, y0 = PAD, PAD + 3 * SCALE
    x1, y1 = SIZE - PAD, SIZE - PAD - 3 * SCALE
    rounded_rect_outline(d, [x0, y0, x1, y1], color, radius=RADIUS + SCALE)
    circle_outline(d, SIZE * 0.34, SIZE * 0.5, 3.1 * SCALE, color)
    lx0, lx1 = SIZE * 0.50, SIZE * 0.74
    line(d, (lx0, SIZE * 0.42), (lx1, SIZE * 0.42), color)
    line(d, (lx0, SIZE * 0.58), (lx1 - 2 * SCALE, SIZE * 0.58), color)
    return im


def main():
    for name, fn, color in [
        ('tab-feed.png', draw_feed, MUTED),
        ('tab-feed-active.png', draw_feed, INK),
        ('tab-event.png', draw_event, MUTED),
        ('tab-event-active.png', draw_event, INK),
        ('tab-mine.png', draw_mine, MUTED),
        ('tab-mine-active.png', draw_mine, INK),
    ]:
        save(fn(color), name)
    print('done')


if __name__ == '__main__':
    main()

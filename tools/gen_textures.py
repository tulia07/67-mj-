# -*- coding: utf-8 -*-
"""
CYBERPUNK MEGAPOLIS - texture pipeline (offline, deterministic).

Generates every runtime texture as a real .webp file under assets/textures/,
plus assets/textures/manifest.json consumed by src/world/Assets.js.

Run:  python tools/gen_textures.py
"""
import json
import math
import os
import random
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "assets", "textures")
FONTS = "C:/Windows/Fonts"

random.seed(20261027)

NEON = {
    "cyan": (60, 240, 255),
    "magenta": (255, 60, 190),
    "violet": (150, 90, 255),
    "amber": (255, 170, 60),
    "lime": (160, 255, 110),
    "red": (255, 70, 80),
}

BRANDS = [
    ("NEUROSYNC", "神经同步", "SYNC YOUR GHOST", "cyan"),
    ("HYPERCOLA", "超感可乐", "TASTE THE STATIC", "magenta"),
    ("ZENITH LABS", "天顶实验室", "BUILD A BETTER YOU", "violet"),
    ("BLACK TIDE", "黑潮重工", "OWN THE NIGHT", "amber"),
    ("OMNI-CREDIT", "万能信用", "DEBT IS FREEDOM", "lime"),
    ("KITSUNE 9", "九尾物流", "DELIVERED IN 9 MIN", "red"),
]


def font(path, size):
    try:
        return ImageFont.truetype(os.path.join(FONTS, path), size)
    except Exception:
        return ImageFont.load_default()


def vgradient(size, top, bottom):
    w, h = size
    img = Image.new("RGB", (1, h))
    px = img.load()
    for y in range(h):
        t = y / max(1, h - 1)
        px[0, y] = tuple(int(top[i] + (bottom[i] - top[i]) * t) for i in range(3))
    return img.resize((w, h), Image.BILINEAR)


def noise_overlay(size, amount=10, seed=1):
    rnd = random.Random(seed)
    w, h = size
    n = Image.new("L", (w, h))
    px = n.load()
    for y in range(h):
        for x in range(w):
            px[x, y] = 128 + rnd.randint(-amount, amount)
    return n


def add_scanlines(img, step=3, alpha=26):
    w, h = img.size
    layer = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    for y in range(0, h, step):
        d.line([(0, y), (w, y)], fill=(0, 0, 0, alpha))
    return Image.alpha_composite(img.convert("RGBA"), layer)


def glow_text(base, xy, text, fnt, color, blur=18, alpha=255, anchor="la"):
    layer = Image.new("RGBA", base.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    d.text(xy, text, font=fnt, fill=color + (alpha,), anchor=anchor)
    halo = layer.filter(ImageFilter.GaussianBlur(blur))
    out = Image.alpha_composite(base, halo)
    out = Image.alpha_composite(out, halo)
    return Image.alpha_composite(out, layer)


def tech_lines(d, box, color=(255, 255, 255, 70), step=9):
    x0, y0, x1, y1 = box
    for y in range(y0, y1, step):
        d.line([(x0, y), (x1, y)], fill=color)


def barcode(d, x, y, w, h, color=(235, 240, 255, 210)):
    cursor = x
    rnd = random.Random(int(x * 7 + y * 3))
    while cursor < x + w:
        bw = rnd.choice([1, 1, 2, 3])
        if rnd.random() > 0.42:
            d.rectangle([cursor, y, cursor + bw, y + h], fill=color)
        cursor += bw + rnd.choice([2, 3, 4])


def glitch_slice(img, count=6, seed=3):
    rnd = random.Random(seed)
    w, h = img.size
    out = img.copy()
    for _ in range(count):
        y = rnd.randint(0, h - 8)
        sh = rnd.randint(2, 10)
        dx = rnd.randint(-16, 16)
        strip = img.crop((0, y, w, y + sh))
        out.paste(strip, (dx, y))
    return out


def make_poster(idx, brand, zh, tag, colorkey, size=(512, 768)):
    c = NEON[colorkey]
    w, h = size
    bg_top = (8, 10, 22)
    bg_bot = tuple(max(6, int(v * 0.24)) for v in c)
    img = vgradient(size, bg_top, bg_bot).convert("RGBA")

    # backdrop geometry
    layer = Image.new("RGBA", size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    for i in range(9):
        y = 120 + i * 58
        d.line([(0, y), (w, y - 90)], fill=c + (18 + i * 3,), width=2)
    for i in range(5):
        r = 120 + i * 46
        d.ellipse([w // 2 - r, h // 2 - r + 40, w // 2 + r, h // 2 + r + 40], outline=c + (26,), width=2)
    img = Image.alpha_composite(img, layer)

    # halo behind type
    halo = Image.new("RGBA", size, (0, 0, 0, 0))
    dh = ImageDraw.Draw(halo)
    dh.ellipse([w * 0.1, h * 0.18, w * 0.9, h * 0.62], fill=c + (70,))
    img = Image.alpha_composite(img, halo.filter(ImageFilter.GaussianBlur(70)))

    f_big = font("impact.ttf", 96)
    f_mid = font("impact.ttf", 44)
    f_cn = font("msyh.ttc", 34)
    f_small = font("consola.ttf", 15)
    f_tiny = font("consola.ttf", 12)

    # brand headline, split on purpose for that condensed ad look
    word = brand
    cut = max(3, len(word) // 2)
    img = glow_text(img, (34, 150), word[:cut], f_big, c, blur=26)
    img = glow_text(img, (34, 246), word[cut:], f_big, (255, 255, 255), blur=18)

    d = ImageDraw.Draw(img)
    d.rectangle([34, 352, 34 + 132, 358], fill=c + (255,))
    d.text((36, 372), tag, font=f_small, fill=(215, 230, 245, 235))
    d.text((36, 396), zh, font=f_cn, fill=(240, 245, 255, 240))

    # bottom info block
    d.rectangle([0, h - 176, w, h], fill=(4, 6, 14, 200))
    d.text((34, h - 158), "SERIES " + str(idx + 1) + " / SECTOR 07", font=f_tiny, fill=c + (230,))
    d.text((34, h - 138), "AUTHORIZED DISTRIBUTION ONLY", font=f_tiny, fill=(150, 162, 186, 220))
    barcode(d, 34, h - 106, 190, 34)
    d.text((240, h - 100), "NEO-KOWLOON\nMEGAPOLIS", font=f_tiny, fill=(200, 212, 235, 220))
    d.text((34, h - 56), "// " + brand.replace(" ", "") + ".NET", font=f_mid, fill=(255, 255, 255, 90))
    tech_lines(d, (0, 24, w, h - 180), (255, 255, 255, 16), 14)

    img = glitch_slice(img, 5, seed=idx + 11)
    img = add_scanlines(img, 3, 24)
    img.convert("RGB").save(os.path.join(OUT, "poster_%d.webp" % idx), "WEBP", quality=88, method=6)
    return "poster_%d.webp" % idx


def make_neon_signs():
    """Vertical neon sign atlas: 2 cols x 4 rows, RGBA (alpha = tube mask)."""
    cell_w, cell_h = 256, 512
    img = Image.new("RGBA", (cell_w * 2, cell_h * 4), (0, 0, 0, 0))
    words = ["拉面", "HOTEL", "電脳", "BAR", "薬局", "CLUB", "質屋", "24H"]
    keys = ["magenta", "cyan", "amber", "violet", "lime", "red", "cyan", "magenta"]
    d = ImageDraw.Draw(img)
    for i, (word, key) in enumerate(zip(words, keys)):
        cx = (i % 2) * cell_w
        cy = (i // 2) * cell_h
        c = NEON[key]
        sub = Image.new("RGBA", (cell_w, cell_h), (0, 0, 0, 0))
        sd = ImageDraw.Draw(sub)
        # frame
        sd.rounded_rectangle([18, 18, cell_w - 18, cell_h - 18], radius=14, outline=c + (235,), width=5)
        sd.rounded_rectangle([30, 30, cell_w - 30, cell_h - 30], radius=8, outline=(255, 255, 255, 60), width=2)
        f = font("msyh.ttc", 118) if len(word) <= 2 else font("impact.ttf", 96)
        text = "\n".join(list(word)) if len(word) <= 2 else word
        sd.multiline_text((cell_w // 2, cell_h // 2), text, font=f, fill=c + (255,),
                          anchor="mm", align="center", spacing=12)
        sd.text((cell_w // 2, cell_h - 58), "OPEN", font=font("consola.ttf", 22),
                fill=(255, 255, 255, 200), anchor="mm")
        halo = sub.filter(ImageFilter.GaussianBlur(16))
        img.alpha_composite(halo, (cx, cy))
        img.alpha_composite(halo, (cx, cy))
        img.alpha_composite(sub, (cx, cy))
    img.save(os.path.join(OUT, "neon_signs.webp"), "WEBP", quality=92, method=6)
    return "neon_signs.webp"


def make_ticker():
    """Horizontal scrolling marquee strip, tileable in X."""
    w, h = 1024, 128
    img = Image.new("RGBA", (w, h), (6, 8, 18, 255))
    d = ImageDraw.Draw(img)
    d.rectangle([0, 0, w, 3], fill=(255, 70, 190, 255))
    d.rectangle([0, h - 3, w, h], fill=(60, 240, 255, 255))
    f = font("consola.ttf", 44)
    msg = "NIGHT CITY TRANSIT  //  24H SERVICE  //  SECTOR 07  //  "
    d.text((10, h // 2), msg, font=f, fill=(120, 240, 255, 255), anchor="lm")
    d.text((520, h // 2), "下一站 · 天顶广场", font=font("msyh.ttc", 38), fill=(255, 130, 210, 255), anchor="lm")
    img = add_scanlines(img, 3, 20)
    img.save(os.path.join(OUT, "ticker.webp"), "WEBP", quality=90, method=6)
    return "ticker.webp"


def make_facade_detail():
    """Tileable greyscale panel detail used to modulate building albedo."""
    size = 512
    img = Image.new("L", (size, size), 128)
    d = ImageDraw.Draw(img)
    # panel grid
    for gy in range(4):
        for gx in range(4):
            x0, y0 = gx * 128, gy * 128
            shade = 118 + random.randint(-14, 14)
            d.rectangle([x0 + 2, y0 + 2, x0 + 125, y0 + 125], fill=shade)
            d.rectangle([x0 + 2, y0 + 2, x0 + 125, y0 + 125], outline=70, width=2)
            for _ in range(26):
                px = x0 + random.randint(6, 120)
                py = y0 + random.randint(6, 120)
                d.point((px, py), fill=random.randint(60, 190))
            # rivets
            for rx, ry in ((x0 + 12, y0 + 12), (x0 + 116, y0 + 12), (x0 + 12, y0 + 116), (x0 + 116, y0 + 116)):
                d.ellipse([rx - 2, ry - 2, rx + 2, ry + 2], fill=225)
    # grime streaks
    for _ in range(60):
        x = random.randint(0, size - 1)
        y = random.randint(0, size - 60)
        ln = random.randint(20, 140)
        d.line([(x, y), (x + random.randint(-3, 3), y + ln)], fill=random.randint(50, 90), width=random.randint(1, 3))
    img = Image.eval(img, lambda v: max(0, min(255, v)))
    img.filter(ImageFilter.GaussianBlur(0.6)).save(os.path.join(OUT, "facade_detail.webp"), "WEBP", quality=86, method=6)
    return "facade_detail.webp"


def make_asphalt():
    size = 512
    img = Image.new("RGB", (size, size), (26, 27, 33))
    d = ImageDraw.Draw(img)
    for _ in range(24000):
        x, y = random.randint(0, size - 1), random.randint(0, size - 1)
        v = random.randint(12, 62)
        d.point((x, y), fill=(v, v + random.randint(0, 4), v + random.randint(2, 10)))
    for _ in range(26):
        # cracks
        x, y = random.randint(0, size), random.randint(0, size)
        pts = [(x, y)]
        for _ in range(random.randint(3, 8)):
            x += random.randint(-26, 26)
            y += random.randint(-26, 26)
            pts.append((x, y))
        d.line(pts, fill=(12, 12, 16), width=random.randint(1, 2))
    # faint wet patches
    overlay = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    od = ImageDraw.Draw(overlay)
    for _ in range(18):
        rx, ry = random.randint(0, size), random.randint(0, size)
        rr = random.randint(14, 60)
        od.ellipse([rx - rr, ry - rr // 2, rx + rr, ry + rr // 2], fill=(10, 16, 30, 120))
    img = Image.alpha_composite(img.convert("RGBA"), overlay.filter(ImageFilter.GaussianBlur(8)))
    img.convert("RGB").save(os.path.join(OUT, "asphalt.webp"), "WEBP", quality=84, method=6)
    return "asphalt.webp"


def make_blob():
    size = 128
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    for i in range(40, 0, -1):
        a = int(255 * (i / 40) ** 3 * 0.5)
        r = int(size / 2 * (i / 40))
        d.ellipse([size // 2 - r, size // 2 - r, size // 2 + r, size // 2 + r], fill=(255, 255, 255, a))
    img.filter(ImageFilter.GaussianBlur(3)).save(os.path.join(OUT, "blob.webp"), "WEBP", quality=90, method=6)
    return "blob.webp"


def make_holo():
    """Holographic advertising swirl used for floating sky-ads."""
    size = 512
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    for i in range(7):
        r = 60 + i * 26
        col = (90, 230, 255, 70) if i % 2 == 0 else (255, 80, 200, 55)
        d.ellipse([size // 2 - r, size // 2 - r // 2, size // 2 + r, size // 2 + r // 2], outline=col, width=3)
    f = font("impact.ttf", 62)
    img = glow_text(img, (size // 2, size // 2), "NEON", f, (120, 240, 255), blur=22, anchor="mm")
    img = add_scanlines(img, 4, 40)
    img.save(os.path.join(OUT, "holo.webp"), "WEBP", quality=90, method=6)
    return "holo.webp"


def main():
    os.makedirs(OUT, exist_ok=True)
    files = []
    for i, (brand, zh, tag, key) in enumerate(BRANDS):
        name = make_poster(i, brand, zh, tag, key)
        files.append({"file": name, "role": "poster", "brand": brand})
    files.append({"file": make_neon_signs(), "role": "neon_atlas"})
    files.append({"file": make_ticker(), "role": "ticker"})
    files.append({"file": make_facade_detail(), "role": "detail"})
    files.append({"file": make_asphalt(), "role": "asphalt"})
    files.append({"file": make_blob(), "role": "sprite"})
    files.append({"file": make_holo(), "role": "holo"})

    for f in files:
        p = os.path.join(OUT, f["file"])
        f["bytes"] = os.path.getsize(p)
    manifest = {
        "version": 1,
        "format": "webp",
        "generatedBy": "tools/gen_textures.py",
        "seed": 20261027,
        "items": files,
    }
    with open(os.path.join(OUT, "manifest.json"), "w", encoding="utf-8") as fh:
        json.dump(manifest, fh, ensure_ascii=False, indent=2)
    total = sum(f["bytes"] for f in files)
    print("wrote %d textures, %.1f KB total" % (len(files), total / 1024.0))


if __name__ == "__main__":
    main()

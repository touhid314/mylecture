# Draws build/installerSidebar.bmp (installer welcome/finish side image) from app/assets.
#   python scripts/make-installer-art.py .
import sys
from PIL import Image, ImageDraw, ImageFilter, ImageFont
root = sys.argv[1]
S = 2  # draw at 2x so it stays sharp on high-DPI screens (NSIS scales it to fit)
W, H = 164 * S, 314 * S
bg = Image.new("RGB", (W, H), (17, 16, 16))
# Vertical gradient #111010 -> #0d1a24
top, bottom = (17, 16, 16), (13, 26, 36)
px = bg.load()
for y in range(H):
    t = y / (H - 1)
    c = tuple(int(top[i] + (bottom[i] - top[i]) * t) for i in range(3))
    for x in range(W):
        px[x, y] = c
# Soft accent glow behind the logo
glow = Image.new("L", (W, H), 0)
ImageDraw.Draw(glow).ellipse((-W * 0.4, H * 0.05, W * 1.4, H * 0.62), fill=70)
glow = glow.filter(ImageFilter.GaussianBlur(60 * S))
bg = Image.composite(Image.new("RGB", (W, H), (56, 189, 248)), bg, glow)
icon = Image.open(f"{root}/app/assets/icon.png").convert("RGBA").resize((64 * S, 64 * S), Image.LANCZOS)
bg.paste(icon, ((W - icon.width) // 2, 58 * S), icon)
lock = Image.open(f"{root}/app/assets/lockup.png").convert("RGBA")
lock = lock.crop(lock.getbbox())
lw = 118 * S
lock = lock.resize((lw, int(lock.height * lw / lock.width)), Image.LANCZOS)
ly = 138 * S
bg.paste(lock, ((W - lw) // 2, ly), lock)
d = ImageDraw.Draw(bg)
font = ImageFont.truetype("C:/Windows/Fonts/segoeui.ttf", 11 * S)
small = ImageFont.truetype("C:/Windows/Fonts/segoeui.ttf", 9 * S)
def center(text, y, f, fill):
    w = d.textlength(text, font=f)
    d.text(((W - w) / 2, y), text, font=f, fill=fill)
center("AI video studio", ly + lock.height + 10 * S, font, (214, 211, 206))
# thin accent line and footer
d.line(((W / 2 - 14 * S, ly + lock.height + 32 * S), (W / 2 + 14 * S, ly + lock.height + 32 * S)), fill=(56, 189, 248), width=2 * S)
center("Narrated, animated videos", H - 40 * S, small, (168, 162, 158))
center("made on your PC", H - 27 * S, small, (168, 162, 158))
bg.save(f"{root}/build/installerSidebar.bmp")
bg.save(f"{root}/build/uninstallerSidebar.bmp")

print("ok", bg.size)

# Build packaging/app.ico from the brand logo: white mark centred on a
# purple rounded-square tile (reads well at 16px through 256px).
from pathlib import Path
from PIL import Image, ImageDraw, ImageOps

ROOT = Path(__file__).parent.parent
SRC  = ROOT / "frontend" / "public" / "logo-white.png"
OUT  = Path(__file__).parent / "app.ico"

BG, SIZE = "#7c3aed", 256

canvas = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
d = ImageDraw.Draw(canvas)
d.rounded_rectangle([8, 8, SIZE - 8, SIZE - 8], radius=56, fill=BG)

logo = Image.open(SRC).convert("RGBA")
logo = ImageOps.contain(logo, (int(SIZE * 0.68), int(SIZE * 0.68)))
canvas.alpha_composite(logo, ((SIZE - logo.width) // 2, (SIZE - logo.height) // 2))

canvas.save(OUT, sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
print(f"ICON_OK {OUT} ({OUT.stat().st_size} bytes)")

"""Create synthetic receipt images and ground truth; never read private documents."""
import json
import sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageFilter, ImageEnhance

output = Path(sys.argv[1])
output.mkdir(parents=True, exist_ok=True)
font_path = sys.argv[2] if len(sys.argv) > 2 else '/System/Library/Fonts/Supplemental/Arial.ttf'
font = ImageFont.truetype(font_path, 36)
manifest = []
for number in range(10):
    total_cents = 3880 + 137 * number
    total = f'{total_cents / 100:.2f}'
    date = f'09/{number + 1:02}/2026'
    lines = ['SYNTHETIC CAMPUS CAFE', 'TEST DOCUMENT - NOT A REAL PURCHASE', '',
             f'Purchase Date: {date}', f'Order: TEST-{number:03}', '',
             f'Meal                 {total}', 'Tax                   0.00',
             f'TOTAL USD ${total}', 'PAID', 'Visa ending in 1234']
    original = Image.new('RGB', (1000, 850), 'white')
    draw = ImageDraw.Draw(original)
    for y, line in enumerate(lines):
        draw.text((35, 35 + 65 * y), line, font=font, fill='black')
    variants = {
        'clear': original,
        'mild-blur': original.filter(ImageFilter.GaussianBlur(1.3)),
        'severe-blur': original.filter(ImageFilter.GaussianBlur(3.5)),
        'tilted': original.rotate(12, expand=True, fillcolor='white'),
        'faint': ImageEnhance.Contrast(original).enhance(.22),
    }
    for variant, image in variants.items():
        name = f'synthetic-{number:02}-{variant}.png'
        image.save(output / name)
        manifest.append({'id': f'{number:02}-{variant}', 'variant': variant, 'file': name,
                         'mimeType': 'image/png', 'expected': {'total': total, 'purchaseDate': f'2026-09-{number + 1:02}'}})
(output / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
print(f'Generated {len(manifest)} synthetic receipt fixtures in {output}')

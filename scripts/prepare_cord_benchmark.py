"""Extract the official CORD v2 test parquet without changing source image bytes.
Requires pyarrow. Dataset: NAVER Corp., CC BY 4.0, https://github.com/clovaai/cord
"""
import hashlib, json, sys
from pathlib import Path
import pyarrow.parquet as pq

source = Path(sys.argv[1])
expected_hash = '51c65f1788faff392abe2a0b55b023eb23e9be551c509138eaa3a832514224e7'
assert hashlib.sha256(source.read_bytes()).hexdigest() == expected_hash, 'Unexpected dataset hash'
rows = pq.read_table(source).to_pylist()
assert len(rows) == 100
manifest = []
for index, row in enumerate(rows):
    gt = json.loads(row['ground_truth'])
    raw = row['image']['bytes']
    png = raw.startswith(b'\x89PNG\r\n\x1a\n')
    assert png or raw.startswith(b'\xff\xd8\xff')
    filename = f'test-{index:03d}.{"png" if png else "jpg"}'
    (source.parent / filename).write_bytes(raw)
    manifest.append({'id': f'cord-test-{index:03d}', 'file': filename,
        'mimeType': 'image/png' if png else 'image/jpeg',
        'sha256': hashlib.sha256(raw).hexdigest(),
        'words': [w['text'] for line in gt['valid_line'] for w in line['words']],
        'totalLabels': [w['text'] for line in gt['valid_line'] if line['category'] == 'total.total_price' for w in line['words']],
        'gtParse': gt['gt_parse']})
(source.parent / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2)+'\n')
print(json.dumps({'samples': len(manifest), 'withTotal': sum(bool(x['totalLabels']) for x in manifest), 'maxBytes': max((source.parent/x['file']).stat().st_size for x in manifest)}))

"""Build an allowlisted installable ZIP and verify every entry against source."""
from pathlib import Path
import hashlib
import json
import zipfile

plugin = Path(__file__).resolve().parents[1]
root = plugin.parents[1]
out = root / 'artifacts' / 'wp-metadata-export'
out.mkdir(parents=True, exist_ok=True)
files = ['wp-metadata-export.php', 'includes/core.php', 'includes/admin.php', 'includes/import.php', 'assets/admin.js', 'assets/import.js', 'README.md']
archive = out / 'wp-metadata-export-1.1.0.zip'
with zipfile.ZipFile(archive, 'w', zipfile.ZIP_DEFLATED) as z:
    for name in files:
        z.write(plugin / name, 'wp-metadata-export/' + name)
with zipfile.ZipFile(archive) as z:
    assert z.testzip() is None
    assert sorted(z.namelist()) == sorted('wp-metadata-export/' + n for n in files)
    for name in files:
        assert z.read('wp-metadata-export/' + name) == (plugin / name).read_bytes()
    assert all('..' not in Path(n).parts and not n.startswith('/') for n in z.namelist())
manifest = {'file': archive.name, 'version': '1.1.0', 'size_bytes': archive.stat().st_size,
            'sha256': hashlib.sha256(archive.read_bytes()).hexdigest(),
            'entries': [{'path': 'wp-metadata-export/' + n,
                         'sha256': hashlib.sha256((plugin / n).read_bytes()).hexdigest()} for n in files],
            'checks': 'single plugin root; exact runtime allowlist; CRC and source-byte equality; no tests, fixtures, credentials or private exports'}
(out / 'package-manifest.json').write_text(json.dumps(manifest, indent=2), encoding='utf-8')
with zipfile.ZipFile(out / 'wp-metadata-export-1.1.0-source.zip', 'w', zipfile.ZIP_DEFLATED) as z:
    for p in plugin.rglob('*'):
        if p.is_file() and '__pycache__' not in p.parts:
            z.write(p, 'wp-metadata-export/' + p.relative_to(plugin).as_posix())
    z.write(root / 'docs/WORDPRESS_METADATA_EXPORT.md', 'docs/WORDPRESS_METADATA_EXPORT.md')
print('WPMB_PACKAGE_OK', manifest['sha256'], manifest['size_bytes'], 'bytes; entries=', len(files))

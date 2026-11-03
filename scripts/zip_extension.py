"""Package the extension with the correct layout for either install method."""
import argparse
import json
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

parser = argparse.ArgumentParser()
parser.add_argument('source', type=Path)
parser.add_argument('output', type=Path)
parser.add_argument('--include-parent', action='store_true')
args = parser.parse_args()
source = args.source.resolve()
root = source.parent if args.include_parent else source
args.output.parent.mkdir(parents=True, exist_ok=True)
with ZipFile(args.output, 'w', compression=ZIP_DEFLATED, compresslevel=9) as archive:
    for file in sorted(source.rglob('*')):
        if file.is_file() and file.name != '.DS_Store' and not file.name.startswith('._'):
            archive.write(file, file.relative_to(root).as_posix())
with ZipFile(args.output) as archive:
    manifest_path = f'{source.name}/manifest.json' if args.include_parent else 'manifest.json'
    manifest = json.loads(archive.read(manifest_path))
    prefix = f'{source.name}/' if args.include_parent else ''
    for filename in [manifest['background']['service_worker'], *manifest['icons'].values(), 'index.html', 'pdf-links.js', 'handoff-store.js']:
        if prefix + filename not in archive.namelist():
            raise SystemExit(f'Missing extension file: {filename}')
    if archive.testzip():
        raise SystemExit('ZIP integrity check failed')

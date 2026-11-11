"""Build and validate a runtime-only installable ZIP. No Python enters the package."""
import hashlib
import json
import os
import sys
import zipfile
from pathlib import Path
from types import SimpleNamespace

extension = Path(__file__).resolve().parents[2]
root = extension.parents[2]
sys.path.insert(0, str(root))
os.environ["DEBUG"] = "false"
config = json.loads((extension / "config.json").read_text())
module = extension / config["wasm"]["module"]
if not module.is_file():
    raise SystemExit("Build the component before packaging.")
for source in [*(extension / "dev/src").glob("*.js"), extension / "wasm/lnbits-extension.wit"]:
    if source.stat().st_mtime_ns > module.stat().st_mtime_ns:
        raise SystemExit("Sources changed after the component build; run make build first.")
archive = extension / "dist" / f'{config["id"]}-{config["version"]}.zip'
archive.parent.mkdir(exist_ok=True)
with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as output:
    for path in sorted(extension.rglob("*")):
        relative = path.relative_to(extension)
        if not path.is_file() or relative.parts[0] not in {"config.json","README.md","LICENSE","LICENSE.md","static","ui","storage","wasm"}:
            continue
        if path.suffix.lower() in {".py",".pyc",".pyo",".so",".pyd"}:
            raise SystemExit(f"Forbidden file: {path}")
        output.write(path, str(Path(config["id"]) / relative))
from lnbits.core.models.extensions import InstallableExtension
from lnbits.core.wasm_ext.wasm.config import parse_wasm_extension_config
parse_wasm_extension_config(config["id"], config)
InstallableExtension.validate_archive(SimpleNamespace(id=config["id"],zip_path=archive,meta=None),config)
digest=hashlib.sha256(archive.read_bytes()).hexdigest()
archive.with_suffix(".zip.sha256").write_text(f"{digest}  {archive.name}\n")
print(f"Validated package: {archive} ({archive.stat().st_size} bytes)")

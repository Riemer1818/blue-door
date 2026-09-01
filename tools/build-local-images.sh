#!/usr/bin/env bash
# Builds every adapter image that is defined in this repository rather than
# pulled from a registry.
#
# An adapter with a Dockerfile carries its own recipe, so its image can be
# rebuilt anywhere - which is what makes an agent-authored adapter portable
# before BLU-20 gives us somewhere to push it. Reproducible beats stored: a
# registry can go away, a committed Dockerfile cannot.
#
# The image tag comes from the manifest, so it matches what the manifest
# references. Reading it from anywhere else would let the two drift, and the
# failure would be image_missing in CI - which is exactly how this script
# earned its current shape.
set -euo pipefail
cd "$(dirname "$0")"

python3 - <<'PY' | while IFS=$'\t' read -r adapter image; do
import json, pathlib
for manifest_path in sorted(pathlib.Path(".").glob("*/manifest.json")):
    adapter = manifest_path.parent
    if not (adapter / "Dockerfile").exists():
        continue
    print(f"{adapter}\t{json.loads(manifest_path.read_text())['image']}")
PY
  echo "building $image from $adapter/Dockerfile"
  docker build -q -t "$image" "$adapter" >/dev/null
done
echo "all locally-built adapter images present"

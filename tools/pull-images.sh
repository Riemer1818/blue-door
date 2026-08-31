#!/usr/bin/env bash
# Pulls every registry image the catalogue references, before conformance runs.
#
# Not strictly required - docker run auto-pulls - but doing it explicitly keeps
# pull time out of the measured wall_seconds, and makes a registry outage fail
# here with a clear message rather than inside a conformance check.
set -euo pipefail
cd "$(dirname "$0")"

python3 - <<'PY' | while read -r image; do
import json, pathlib

for manifest in sorted(pathlib.Path(".").glob("*/manifest.json")):
    image = json.loads(manifest.read_text())["image"]
    # Docker's own rule for telling a registry host from a bare namespace: the
    # first path segment is a host only if it contains a dot or a colon.
    # "quay.io/biocontainers/seqkit" is remote; "bluedoor/portlab" is built here
    # by build-local-images.sh and pulling it would fail.
    head = image.split("/")[0]
    if "." in head or ":" in head:
        print(image)
PY
  echo "pulling ${image%%@*}"
  docker pull -q "$image" >/dev/null
done
echo "all registry images present"

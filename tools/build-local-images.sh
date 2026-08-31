#!/usr/bin/env bash
# Builds the adapter images that live in this repo. Third-party adapters pull
# their image from a registry and need nothing here; portlab is ours, so it has
# to be built before the conformance suite can grade it.
set -euo pipefail
cd "$(dirname "$0")"
docker build -q -t bluedoor/portlab:0.1.0 portlab/ >/dev/null
echo "built bluedoor/portlab:0.1.0"

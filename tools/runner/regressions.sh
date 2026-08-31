#!/usr/bin/env bash
# Pipeline regressions declared in the pipelines themselves.
#
# conform.py grades adapters in isolation; this checks what only goes wrong when
# adapters are wired together. BLU-22 passed every adapter-level check and still
# produced a wrong tree, so adapter conformance was never going to catch it.
#
# Every case asserts the file EXISTS before asserting the outcome. Without that,
# a missing fixture makes pipe.py exit non-zero, which is indistinguishable from
# a refusal - so a "must be refused" case would pass for the wrong reason and go
# on passing after the check it tests was deleted. That happened on the first
# run of this script.
set -uo pipefail
cd "$(dirname "$0")/../.."   # repo root: regression paths are repo-relative
fail=0

while read -r expect pipeline file why; do
  [ -z "${expect:-}" ] && continue
  if [ ! -f "$file" ]; then
    echo "  FAIL  missing fixture: $file"
    fail=1
    continue
  fi
  python3 tools/runner/pipe.py "$pipeline" --input "sequences=$file" --check >/dev/null 2>&1
  code=$?
  if { [ "$expect" = refuse ] && [ $code -eq 0 ]; } || \
     { [ "$expect" = accept ] && [ $code -ne 0 ]; }; then
    echo "  FAIL  $(basename "$pipeline") should $expect $(basename "$file") - $why"
    fail=1
  else
    echo "  pass  $(basename "$pipeline") ${expect}s $(basename "$file")"
  fi
done < <(python3 - <<'PY'
import json, pathlib
for pipeline in sorted(pathlib.Path("tools/pipelines").glob("*.json")):
    spec = json.loads(pipeline.read_text()).get("$regression", {})
    for verb, key in (("refuse", "must_be_refused"), ("accept", "must_be_accepted")):
        for path, why in spec.get(key, {}).items():
            print(verb, pipeline, path, why)
PY
)

[ $fail -eq 0 ] && echo "  all pipeline regressions hold"
exit $fail

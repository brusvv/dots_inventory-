#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
command -v node >/dev/null 2>&1 || { echo "Node.js is required" >&2; exit 2; }
count=0
while IFS= read -r -d '' file; do
  node --check < "$file" >/dev/null
  count=$((count + 1))
done < <(find "$ROOT/src/apps_script" "$ROOT/runtime/probes" -type f -name '*.gs' -print0 | sort -z)
echo "PASS: JavaScript syntax check completed for $count .gs files."

#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 2 ]]; then
  echo "Usage: $0 <owned-electron-cdp-url> <evidence-directory>" >&2
  exit 2
fi

cdp_url="$1"
evidence_dir="$2"
mkdir -p "$evidence_dir/screenshots" "$evidence_dir/snapshots"
browser=(agent-browser --session katacode-branding-verify --cdp "$cdp_url")

"${browser[@]}" find role button click --name General --exact
"${browser[@]}" wait --text Organization
"${browser[@]}" screenshot "$evidence_dir/screenshots/before-connections.png"
"${browser[@]}" find role button click --name Connections --exact
"${browser[@]}" wait --text 'This environment'
"${browser[@]}" find role heading text --name 'Kata Code Connect' --exact
"${browser[@]}" snapshot > "$evidence_dir/snapshots/connections.txt"
"${browser[@]}" screenshot "$evidence_dir/screenshots/connections.png"
"${browser[@]}" find role combobox fill 'Kata Code Connect' --name 'Search settings'
"${browser[@]}" find role option text --name 'Kata Code Connect Connections' --exact
"${browser[@]}" snapshot > "$evidence_dir/snapshots/search.txt"
"${browser[@]}" screenshot "$evidence_dir/screenshots/search.png"

if rg -n 'T3 (Code|Connect|Server)' "$evidence_dir/snapshots/connections.txt" "$evidence_dir/snapshots/search.txt"; then
  echo 'FAIL: upstream product branding remains visible' >&2
  exit 1
fi

"${browser[@]}" find role button click --name 'Clear settings search' --exact
echo 'PASS: Connections and Settings search display Kata Code Connect'

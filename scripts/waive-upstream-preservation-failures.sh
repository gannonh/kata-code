#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -eq 0 ]; then
  echo "usage: $0 <checker command...>" >&2
  exit 2
fi

report="$(mktemp)"
trap 'rm -f "$report"' EXIT

status=0
"$@" 2>&1 | tee "$report" || status="${PIPESTATUS[0]}"
if [ "$status" -eq 0 ]; then
  exit 0
fi
failures="$(grep -F 'status=FAIL' "$report" || true)"
if [ -z "$failures" ]; then
  echo "Preservation checker exited $status without a status=FAIL line."
  exit 1
fi
unwaived="$(printf '%s\n' "$failures" | grep -vxF -f <(printf '%s' "${WAIVED_FAILURES:-}"))" || [ "$?" -eq 1 ]
if [ -z "$unwaived" ]; then
  echo "Only waived trusted-assertion failures remain; see docs/upstream/kat-3411-intake.md."
  exit 0
fi
echo "Unwaived preservation failures:"
printf '%s\n' "$unwaived"
exit 1

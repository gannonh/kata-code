#!/usr/bin/env bash
# Runs the upstream preservation checker given as arguments and passes when it
# passes or when it printed at least one status=FAIL line and every one of them
# is an exact line in WAIVED_FAILURES.
set -euo pipefail

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
unwaived="$(printf '%s\n' "$failures" | grep -vxF -f <(printf '%s\n' "${WAIVED_FAILURES:-}") || true)"
if [ -z "$unwaived" ]; then
  echo "Only waived trusted-assertion failures remain; see docs/upstream/kat-3411-intake.md."
  exit 0
fi
echo "Unwaived preservation failures:"
printf '%s\n' "$unwaived"
exit 1

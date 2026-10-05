#!/usr/bin/env bash
# Runs the upstream preservation checker given as arguments and passes when it
# passes or when its only failures are exact lines in WAIVED_FAILURES.
set -euo pipefail

report="$(mktemp)"
trap 'rm -f "$report"' EXIT

if "$@" | tee "$report"; then
  exit 0
fi
unwaived="$(grep '^CHECK .* status=FAIL' "$report" | grep -vxF -f <(printf '%s\n' "${WAIVED_FAILURES:-}") || true)"
if [ -z "$unwaived" ]; then
  echo "Only waived trusted-assertion failures remain; see docs/upstream/kat-3411-intake.md."
  exit 0
fi
echo "Unwaived preservation failures:"
printf '%s\n' "$unwaived"
exit 1

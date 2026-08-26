#!/usr/bin/env bash
# Shared paths for verify-katacode helpers. Source this file; do not run it.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

find_repo_root() {
  local d="$SCRIPT_DIR"
  while [[ "$d" != "/" ]]; do
    if [[ -f "$d/scripts/dev-runner.ts" && -f "$d/package.json" ]]; then
      printf '%s\n' "$d"
      return 0
    fi
    d="$(dirname "$d")"
  done
  echo "verify-katacode: could not find the Kata Code repo root from $SCRIPT_DIR" >&2
  return 1
}

REPO_ROOT="$(find_repo_root)"
SKILL_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
LAST_RUN_FILE="$SKILL_DIR/.last-run"
EVIDENCE_ROOT="$REPO_ROOT/uat-evidence"
SHARED_HOME="${HOME}/.katacode"
WORKTREE_HOME="$REPO_ROOT/.katacode"
TMP_ROOT="${TMPDIR:-/tmp}"
TMP_ROOT="${TMP_ROOT%/}"

normpath() {
  python3 -c 'import os, sys; print(os.path.normpath(sys.argv[1]))' "$1"
}

verify_root_for() {
  local run_id="$1"
  printf '%s/katacode-verify-%s\n' "$TMP_ROOT" "$run_id"
}

home_dir_for() {
  printf '%s/home\n' "$(verify_root_for "$1")"
}

runtime_json_for() {
  printf '%s/userdata/server-runtime.json\n' "$(home_dir_for "$1")"
}

run_json_for() {
  printf '%s/run.json\n' "$(verify_root_for "$1")"
}

pairing_url_file_for() {
  printf '%s/pairing.url\n' "$(verify_root_for "$1")"
}

dev_log_for() {
  printf '%s/dev.log\n' "$(verify_root_for "$1")"
}

evidence_dir_for() {
  printf '%s/%s\n' "$EVIDENCE_ROOT" "$1"
}

resolve_run_id() {
  if [[ "${1:-}" != "" ]]; then
    printf '%s\n' "$1"
    return 0
  fi
  if [[ "${VERIFY_RUN_ID:-}" != "" ]]; then
    printf '%s\n' "$VERIFY_RUN_ID"
    return 0
  fi
  if [[ -f "$LAST_RUN_FILE" ]]; then
    tr -d '[:space:]' <"$LAST_RUN_FILE"
    return 0
  fi
  echo "verify-katacode: pass a run id, set VERIFY_RUN_ID, or run bin/launch first" >&2
  return 1
}

is_forbidden_home() {
  local home
  home="$(normpath "$1")"
  [[ "$home" == "$(normpath "$SHARED_HOME")" || "$home" == "$(normpath "$WORKTREE_HOME")" ]]
}

redact_secrets() {
  sed -E \
    -e 's/#token=[^[:space:]"]*/#token=REDACTED/g' \
    -e 's/(Pairing URL: ).*/\1REDACTED/' \
    -e 's/(Pair URL: ).*/\1REDACTED/' \
    -e 's/^(Token: ).*/\1REDACTED/'
}

pid_alive() {
  local pid="$1"
  [[ "$pid" =~ ^[0-9]+$ ]] && kill -0 "$pid" 2>/dev/null
}

# Walk parents of $1 and return 0 if $2 is an ancestor (or the pid itself).
pid_in_tree() {
  local candidate="$1"
  local root="$2"
  local current="$candidate"
  local parent
  local i
  if [[ "$candidate" == "$root" ]]; then
    return 0
  fi
  for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16; do
    parent="$(ps -o ppid= -p "$current" 2>/dev/null | tr -d ' ')"
    if [[ "$parent" == "" || "$parent" == "0" || "$parent" == "1" ]]; then
      return 1
    fi
    if [[ "$parent" == "$root" ]]; then
      return 0
    fi
    current="$parent"
  done
  return 1
}

kill_tree() {
  local pid="$1"
  local kids
  local k
  if ! pid_alive "$pid"; then
    # Process group of a setsid runner may still have children.
    kill -- "-$pid" 2>/dev/null || true
    return 0
  fi
  kids="$(pgrep -P "$pid" || true)"
  for k in $kids; do
    kill_tree "$k"
  done
  kill -- "-$pid" 2>/dev/null || true
  kill "$pid" 2>/dev/null || true
}

listener_pid_on_port() {
  local port="$1"
  lsof -nP -iTCP:"$port" -sTCP:LISTEN -t 2>/dev/null | head -n 1
}

# Vite binds `localhost`, which is often ::1 on macOS. Probe both names.
# HTTP 200 is not enough: the SPA fallback also 200s unknown paths with HTML.
origin_url() {
  local host="$1"
  local port="$2"
  if [[ "$host" == *:* ]]; then
    printf 'http://[%s]:%s\n' "$host" "$port"
  else
    printf 'http://%s:%s\n' "$host" "$port"
  fi
}

descriptor_from() {
  local url="$1"
  local body
  body="$(curl -fsS --connect-timeout 1 --max-time 2 "$url" 2>/dev/null)" || return 1
  python3 -c 'import json,sys
d=json.loads(sys.argv[1])
if not d.get("environmentId") or not d.get("label") or not d.get("serverVersion"):
    raise SystemExit(1)
' "$body" || return 1
}

web_origin_for_port() {
  local port="$1"
  local host origin
  # Vite's default host is `localhost`, which on macOS is often IPv6-only.
  for host in ::1 127.0.0.1 localhost; do
    origin="$(origin_url "$host" "$port")"
    if descriptor_from "${origin}/.well-known/kata/environment"; then
      printf '%s\n' "$origin"
      return 0
    fi
  done
  return 1
}

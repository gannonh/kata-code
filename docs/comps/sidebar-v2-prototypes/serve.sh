#!/usr/bin/env bash
# Durable local static server for sidebar prototypes.
# Usage: ./serve.sh [port]

set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
PORT="${1:-8765}"
PIDFILE="$DIR/.serve.pid"
LOGFILE="$DIR/.serve.log"

stop_existing() {
  if [[ -f "$PIDFILE" ]]; then
    old_pid="$(cat "$PIDFILE" 2>/dev/null || true)"
    if [[ -n "${old_pid:-}" ]] && kill -0 "$old_pid" 2>/dev/null; then
      kill "$old_pid" 2>/dev/null || true
      sleep 0.2
    fi
    rm -f "$PIDFILE"
  fi
  # Also clear anything else bound to the port
  if command -v lsof >/dev/null 2>&1; then
    lsof -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null | xargs -r kill 2>/dev/null || true
  fi
}

start() {
  stop_existing
  cd "$DIR"
  # Bind 0.0.0.0 so localhost / 127.0.0.1 both work
  nohup python3 -u -m http.server "$PORT" --bind 0.0.0.0 >"$LOGFILE" 2>&1 &
  echo $! >"$PIDFILE"
  sleep 0.4
  if ! kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
    echo "Failed to start server. Log:" >&2
    cat "$LOGFILE" >&2
    exit 1
  fi
  echo "Serving $DIR"
  echo "  http://127.0.0.1:$PORT/c-attention-session.html"
  echo "  http://localhost:$PORT/c-attention-session.html"
  echo "  pid $(cat "$PIDFILE")  log $LOGFILE"
}

case "${2:-start}" in
  stop) stop_existing; echo "Stopped." ;;
  restart) start ;;
  *) start ;;
esac

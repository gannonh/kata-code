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
      # Only kill our previous server if the command line looks like this script's
      # python http.server for the selected port.
      if command -v ps >/dev/null 2>&1; then
        cmdline="$(ps -p "$old_pid" -o args= 2>/dev/null || true)"
        if [[ "$cmdline" == *"http.server $PORT"* ]] || [[ "$cmdline" == *"http.server"*"$PORT"* ]]; then
          kill "$old_pid" 2>/dev/null || true
          sleep 0.2
        else
          echo "Refusing to kill pid $old_pid (not this prototype server): $cmdline" >&2
          echo "Port $PORT may be occupied by another process." >&2
          exit 1
        fi
      else
        kill "$old_pid" 2>/dev/null || true
        sleep 0.2
      fi
    fi
    rm -f "$PIDFILE"
  fi
  if command -v lsof >/dev/null 2>&1; then
    if lsof -tiTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
      echo "Port $PORT is already in use. Stop the other listener or choose another port." >&2
      exit 1
    fi
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

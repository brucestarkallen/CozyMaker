#!/data/data/com.termux/files/usr/bin/bash
# CozyMaker — update, then launch.
#
# Pulls the latest, and makes sure the server actually running is the code
# that was just pulled: an update that leaves an old server holding the port is
# an update you cannot see. An old server is stopped by asking whatever is on
# CozyMaker's own port to leave — never by process name, because Cozy Tavern
# runs a file called serve.py too, and killing by name would take it down.
set -u
# Everything below is inside main() and runs only after bash has read all of
# it. This script pulls a new copy of itself; bash reads a script as it goes,
# so without this a pull that changes the file could run half of each version.
main() {
  HERE="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
  PORT="${COZYMAKER_PORT:-8090}"
  URL="http://127.0.0.1:$PORT"
  PY="$(command -v python || command -v python3)"
  cd "$HERE" || exit 1

  answering() { curl -sf --max-time 2 -o /dev/null "$URL/api/version"; }
  live_commit() { curl -sf --max-time 2 "$URL/api/version" | sed -n 's/.*"commit": *"\([^"]*\)".*/\1/p'; }
  open_it() { command -v termux-open-url >/dev/null 2>&1 && termux-open-url "$URL"; }

  if [ -d .git ]; then
    echo "checking for updates…"
    BEFORE="$(git rev-parse HEAD 2>/dev/null)"
    if git pull --ff-only --quiet; then
      AFTER="$(git rev-parse HEAD 2>/dev/null)"
      [ "$BEFORE" != "$AFTER" ] && echo "updated: $(git log --oneline -1 | cut -c1-72)"
    else
      echo "(could not update — carrying on with what is here)"
    fi
  fi
  WANT="$(git rev-parse HEAD 2>/dev/null || echo none)"

  # A server that is relighting itself after the pull is briefly silent. If one
  # of ours is alive, give it a moment rather than starting a second one.
  if ! answering && command -v pgrep >/dev/null 2>&1 && pgrep -f "$HERE/serve.py" >/dev/null 2>&1; then
    for i in $(seq 1 25); do answering && break; sleep 0.2; done
  fi

  if answering; then
    if [ "$(live_commit)" = "$WANT" ]; then
      echo "CozyMaker is running the latest — $URL"
      open_it
      exit 0
    fi
    echo "an older CozyMaker is running — replacing it"
    curl -s --max-time 3 -X POST "$URL/api/quit" >/dev/null 2>&1
    for i in $(seq 1 30); do answering || break; sleep 0.2; done
    if answering && command -v pkill >/dev/null 2>&1; then
      pkill -f "$HERE/serve.py" 2>/dev/null; sleep 1
    fi
    if answering; then
      echo "port $PORT is held by something that is not this CozyMaker."
      echo "stop it, or run: COZYMAKER_PORT=8091 cozymaker"
      exit 1
    fi
  fi

  # Something answering on the port that is not CozyMaker: say so, never fight it.
  if (exec 3<>"/dev/tcp/127.0.0.1/$PORT") 2>/dev/null; then
    echo "port $PORT is held by something that is not this CozyMaker."
    echo "stop it, or run: COZYMAKER_PORT=8091 cozymaker"
    exit 1
  fi

  ( for i in $(seq 1 50); do answering && { open_it; break; }; sleep 0.2; done ) &
  echo "CozyMaker — $URL   (Ctrl+C stops it)"
  exec "$PY" "$HERE/serve.py"
}
main "$@"
exit

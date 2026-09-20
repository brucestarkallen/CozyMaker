#!/data/data/com.termux/files/usr/bin/bash
# CozyMaker — pull the latest, then make sure the server actually running is
# the one that was just pulled. A server still holding the port after an update
# is an update you cannot see; that has happened before and it is not allowed
# to happen again.
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
PORT="${COZYMAKER_PORT:-8090}"
cd "$HERE" || exit 1

if [ -d .git ]; then
  git pull --ff-only --quiet 2>/dev/null || echo "(could not pull — carrying on with what is here)"
fi

WANT="$(grep -m1 '^VERSION' serve.py | cut -d'"' -f2)"
LIVE="$(curl -s --max-time 2 "http://127.0.0.1:$PORT/api/version" | sed -n 's/.*"version": *"\([^"]*\)".*/\1/p')"

if [ -n "$LIVE" ]; then
  if [ "$LIVE" = "$WANT" ]; then
    echo "CozyMaker $LIVE is already lit — http://127.0.0.1:$PORT"
    exit 0
  fi
  echo "an older CozyMaker ($LIVE) is holding the port — putting it out"
  pkill -f "python.*serve\.py" 2>/dev/null
  sleep 1
fi

echo "CozyMaker $WANT — http://127.0.0.1:$PORT"
exec python serve.py

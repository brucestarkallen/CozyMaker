#!/usr/bin/env bash
# Every suite, in order, exit code intact.
#
# Never pipe a gate through tail or head — they mask the exit code, and a gate
# whose failure cannot be seen is not a gate.
set -u
cd "$(cd "$(dirname "$0")/.." && pwd)" || exit 1
fail=0
echo "— the modules —"; node tests/units.mjs   || fail=1
echo; echo "— saves, through an outage —"; node tests/saves.mjs || fail=1
echo; echo "— the server —"; python3 tests/server.py  || fail=1
echo; echo "— the browser —"; python3 tests/browser.py || fail=1
echo; echo "— worlds, conversations, stop, merge —"; python3 tests/walk_worlds.py || fail=1
echo; echo "— the launcher —"; bash tests/launcher.sh || fail=1
echo
if [ "$fail" -eq 0 ]; then echo "all green"; else echo "SOMETHING IS RED"; fi
exit "$fail"

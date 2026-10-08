#!/usr/bin/env bash
# Every suite, in order, exit code intact.
#
# Never pipe a gate through tail or head — they mask the exit code, and a gate
# whose failure cannot be seen is not a gate.
set -u
cd "$(cd "$(dirname "$0")/.." && pwd)" || exit 1
fail=0
echo "— the modules —"; node tests/units.mjs   || fail=1
echo; echo "— the harness: the one he talks to does the work —"; node tests/harness.mjs || fail=1
echo; echo "— thinking, held to Cozy Tavern's own output —"; node tests/thinking.mjs || fail=1
echo; echo "— saves, through an outage —"; node tests/saves.mjs || fail=1
echo; echo "— two windows, one device: the real store against the real server —"; node tests/two_pages.mjs || fail=1
echo; echo "— the server —"; python3 tests/server.py  || fail=1
echo; echo "— the browser —"; python3 tests/browser.py || fail=1
echo; echo "— worlds, conversations, stop, merge —"; python3 tests/walk_worlds.py || fail=1
echo; echo "— the house, two windows, a page that keeps up —"; python3 tests/walk_house.py || fail=1
echo; echo "— the live stream, measured at a phone's speed —"; python3 tests/perf_stream.py || fail=1
echo; echo "— the live stream, Smooth streaming off —"; SMOOTH=off python3 tests/perf_stream.py || fail=1
echo; echo "— the live stream: talk that becomes a job, and the quiet before a reply —"; python3 tests/stream_flows.py || fail=1
echo; echo "— the launcher —"; bash tests/launcher.sh || fail=1
echo
if [ "$fail" -eq 0 ]; then echo "all green"; else echo "SOMETHING IS RED"; fi
exit "$fail"

#!/usr/bin/env bash
# CozyMaker — tests/launcher.sh
#
# The update-and-launch command, used exactly the way the phone uses it:
# a real clone of a real remote, the real install.sh, the real cozymaker.sh,
# updates pushed to the remote and pulled while the server is running. Next to
# it runs a stand-in for Cozy Tavern — another python process started from a
# file called serve.py — which must still be alive at the end of every step.
set -u
SRC="$(cd "$(dirname "$0")/.." && pwd)"
T="$(mktemp -d)"
PORT=8802
DECOY_PORT=8801
URL="http://127.0.0.1:$PORT"
pass=0; fail=0
ok() { if [ "$2" = 0 ]; then pass=$((pass+1)); else fail=$((fail+1)); echo "  ✗ $1${3:+ — $3}"; fi; }
up() { for i in $(seq 1 60); do curl -sf --max-time 1 -o /dev/null "$URL/api/version" && return 0; sleep 0.2; done; return 1; }
down() { for i in $(seq 1 60); do curl -sf --max-time 1 -o /dev/null "$URL/api/version" || return 0; sleep 0.2; done; return 1; }
commit_live() { curl -sf "$URL/api/version" | sed -n 's/.*"commit": *"\([^"]*\)".*/\1/p'; }
G() { git -c user.email=t@t -c user.name=t "$@"; }

cleanup() {
  curl -s -X POST "$URL/api/quit" >/dev/null 2>&1
  [ -n "${DECOY_PID:-}" ] && kill "$DECOY_PID" 2>/dev/null
  [ -n "${FOREIGN_PID:-}" ] && kill "$FOREIGN_PID" 2>/dev/null
  rm -rf "$T"
}
trap cleanup EXIT

# --- a remote, the way GitHub is one -----------------------------------------
G init -q "$T/dev" && cp -r "$SRC"/. "$T/dev"/ && rm -rf "$T/dev/.git" && G -C "$T/dev" init -q
G -C "$T/dev" add -A && G -C "$T/dev" commit -qm first
G clone -q --bare "$T/dev" "$T/remote.git"
G -C "$T/dev" remote add origin "$T/remote.git"
G -C "$T/dev" branch -M master 2>/dev/null; G -C "$T/dev" push -q origin HEAD 2>/dev/null

# --- the phone: clone, install ------------------------------------------------
G clone -q "$T/remote.git" "$T/phone"
mkdir -p "$T/prefix/bin"
( cd "$T/phone" && PREFIX="$T/prefix" HOME="$T/userhome" bash ./install.sh >/dev/null 2>&1 )
ok "install puts a cozymaker command on the path" "$([ -x "$T/prefix/bin/cozymaker" ]; echo $?)"
grep -q "$T/phone/cozymaker.sh" "$T/prefix/bin/cozymaker"
ok "the command points at this clone's launcher" $?

# --- a stand-in for Cozy Tavern, also running a file called serve.py ----------
mkdir -p "$T/Cozy-Tavern-"
cat > "$T/Cozy-Tavern-/serve.py" <<PY
import http.server, socketserver
socketserver.TCPServer(("127.0.0.1", $DECOY_PORT), http.server.SimpleHTTPRequestHandler).serve_forever()
PY
python3 "$T/Cozy-Tavern-/serve.py" >/dev/null 2>&1 &
DECOY_PID=$!
sleep 0.5
decoy_alive() { kill -0 "$DECOY_PID" 2>/dev/null; }

launch() { ( cd "$T" && COZYMAKER_PORT=$PORT COZYMAKER_HOME="$T/data" bash "$T/phone/cozymaker.sh" > "$T/$1.log" 2>&1 & ); }

# --- first launch -------------------------------------------------------------
launch first
up; ok "the first launch brings CozyMaker up" $?
A="$(G -C "$T/phone" rev-parse HEAD)"
[ "$(commit_live)" = "$A" ]; ok "it is running the code in the folder" $?
curl -sf "$URL/" | grep -q CozyMaker; ok "the app answers" $?

# --- nothing new: launching again changes nothing ----------------------------
PID1="$(pgrep -f "$T/phone/serve.py" | head -1)"
( cd "$T" && COZYMAKER_PORT=$PORT COZYMAKER_HOME="$T/data" bash "$T/phone/cozymaker.sh" > "$T/second.log" 2>&1 )
ok "with nothing new, the second launch finishes on its own" $?
grep -q "running the latest" "$T/second.log"; ok "and says it is already running the latest" $?
[ "$(pgrep -f "$T/phone/serve.py" | head -1)" = "$PID1" ]; ok "the running server was left alone" $?

# --- an update to the app's pages --------------------------------------------
echo "<p>new page</p>" > "$T/dev/fresh.html"
G -C "$T/dev" add -A && G -C "$T/dev" commit -qm "a new page" && G -C "$T/dev" push -q origin HEAD 2>/dev/null
launch third
sleep 1; up
B="$(G -C "$T/dev" rev-parse HEAD)"
for i in $(seq 1 30); do [ "$(commit_live)" = "$B" ] && break; sleep 0.2; done
[ "$(commit_live)" = "$B" ]; ok "an update is pulled and the running server replaced" $? "$(cat "$T/third.log" | tr '\n' ' ')"
curl -sf "$URL/fresh.html" | grep -q "new page"; ok "the new page is actually served" $?
grep -q "updated:" "$T/third.log"; ok "it says what it updated to" $?
decoy_alive; ok "Cozy Tavern's server survived the update" $?

# --- an update that changes the server AND the launcher itself ---------------
sed -i 's/^VERSION = .*/VERSION = "9.9.9"/' "$T/dev/serve.py"
echo "# touched by the test" >> "$T/dev/cozymaker.sh"
G -C "$T/dev" add -A && G -C "$T/dev" commit -qm "server and launcher change" && G -C "$T/dev" push -q origin HEAD 2>/dev/null
launch fourth
C="$(G -C "$T/dev" rev-parse HEAD)"
for i in $(seq 1 60); do [ "$(commit_live)" = "$C" ] && break; sleep 0.2; done
[ "$(commit_live)" = "$C" ]; ok "an update to the server itself comes up on the new code" $? "$(cat "$T/fourth.log" | tr '\n' ' ')"
curl -sf "$URL/api/version" | grep -q '"9.9.9"'; ok "the new server code is the one answering" $?
! grep -qi "already taken\|Traceback\|Address already in use" "$T/fourth.log"
ok "no second server fought the first for the port" $? "$(cat "$T/fourth.log" | tr '\n' ' ')"
[ "$(pgrep -fc "$T/phone/serve.py")" = "1" ]; ok "exactly one CozyMaker is running" $? "$(pgrep -fa "$T/phone/serve.py")"
decoy_alive; ok "Cozy Tavern's server survived a server update" $?

# --- someone else holds the port ---------------------------------------------
curl -s -X POST "$URL/api/quit" >/dev/null; down
python3 -m http.server $PORT --bind 127.0.0.1 >/dev/null 2>&1 &
FOREIGN_PID=$!; sleep 0.6
( cd "$T" && COZYMAKER_PORT=$PORT COZYMAKER_HOME="$T/data" bash "$T/phone/cozymaker.sh" > "$T/fifth.log" 2>&1 )
[ $? -ne 0 ]; ok "a port held by something else is refused, not fought" $?
grep -q "not this CozyMaker" "$T/fifth.log"; ok "and it says so plainly" $? "$(cat "$T/fifth.log" | tr '\n' ' ')"
kill -0 "$FOREIGN_PID" 2>/dev/null; ok "the other program was not killed" $?
decoy_alive; ok "Cozy Tavern's server survived all of it" $?

echo
echo "$pass passed, $fail failed"
[ "$fail" -eq 0 ]

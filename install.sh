#!/data/data/com.termux/files/usr/bin/bash
# One-time setup in Termux.
set -eu
pkg install -y python git curl procps >/dev/null 2>&1 || true
HERE="$(cd "$(dirname "$0")" && pwd)"
BIN="$PREFIX/bin/cozymaker"
printf '#!/data/data/com.termux/files/usr/bin/bash\nexec "%s/cozymaker.sh" "$@"\n' "$HERE" > "$BIN"
chmod +x "$BIN"
mkdir -p "$HOME/.cozymaker"
echo "Done. Type: cozymaker"
echo "Then open http://127.0.0.1:${COZYMAKER_PORT:-8090}"

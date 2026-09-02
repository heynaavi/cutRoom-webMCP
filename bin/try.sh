#!/usr/bin/env bash
# Launch Cutroom in a real Chrome with WebMCP switched on.
#   bin/try.sh              → local build on :4321
#   bin/try.sh <url>        → any deployed URL
set -e
cd "$(dirname "$0")/.."

URL="${1:-http://localhost:4321}"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
PROFILE="/tmp/cutroom-chrome"

[ -x "$CHROME" ] || { echo "Google Chrome not found at $CHROME"; exit 1; }
VER=$("$CHROME" --version | grep -oE '[0-9]+' | head -1)
[ "$VER" -ge 149 ] || { echo "Chrome $VER is too old — WebMCP needs 149+."; exit 1; }

if [ "$URL" = "http://localhost:4321" ]; then
  if ! curl -sf --max-time 2 "$URL" >/dev/null 2>&1; then
    echo "starting static server on :4321"
    npx -y serve app -l 4321 --no-clipboard >/tmp/cutroom-serve.log 2>&1 &
    sleep 2
  fi
fi

cat <<BANNER

  Chrome $VER · WebMCP enabled · $URL

  The pill top-right should read "14 tools live" — that means the page
  registered its tools on document.modelContext.

  Chrome exposes the API, but Chrome is NOT an agent: nothing will call
  those tools on its own. To see them actually run:

    bin/verify.sh $URL     drives them over CDP and prints what happened
    or open the same URL in ChatGPT's browser and ask it for a cut

BANNER
exec "$CHROME" \
  --user-data-dir="$PROFILE" \
  --enable-features=WebMCP \
  --remote-debugging-port=9222 \
  --no-first-run --no-default-browser-check \
  "$URL"

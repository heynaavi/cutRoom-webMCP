#!/usr/bin/env bash
# Build the demo video from scratch. ~6 minutes.
#
#   bash film/build.sh
#
# Needs: ffmpeg, and Google Chrome 149+ (headless, driven over CDP).
set -e
cd "$(dirname "$0")/.."
FILM="$PWD/film"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
PORT=9222

[ -x "$CHROME" ] || { echo "Google Chrome not found at $CHROME"; exit 1; }
command -v ffmpeg >/dev/null || { echo "ffmpeg not on PATH"; exit 1; }

mkdir -p "$FILM/lib"
[ -f "$FILM/lib/gsap.min.js" ] || {
  echo "· fetching gsap"
  curl -sL https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/gsap.min.js -o "$FILM/lib/gsap.min.js"
}

# The app has to be served: file:// would put the transcript fetch on a null
# origin, and the page would boot straight into its own load-failure state.
if ! curl -sf --max-time 2 http://localhost:4321 >/dev/null 2>&1; then
  echo "· starting static server on :4321"
  npx -y serve app -l 4321 --no-clipboard >/tmp/cutroom-serve.log 2>&1 &
  SERVER=$!
  trap 'kill $SERVER 2>/dev/null || true' EXIT
  until curl -sf --max-time 2 http://localhost:4321 >/dev/null; do sleep 1; done
fi

if ! curl -sf --max-time 2 "http://127.0.0.1:$PORT/json/version" >/dev/null 2>&1; then
  echo "· starting headless chrome on :$PORT"
  # --enable-features=WebMCP: make-cut-audio.mjs asks the page for its ffmpeg
  # command through document.modelContext, so the build needs the same bridge a
  # real agent would use. Without it the film cannot be built, which is the
  # point — the last beat claims that command runs.
  "$CHROME" --user-data-dir=/tmp/cutroom-film-chrome --headless=new \
    --enable-features=WebMCP \
    --remote-debugging-port=$PORT --force-device-scale-factor=1 --hide-scrollbars \
    --autoplay-policy=no-user-gesture-required \
    --no-first-run --no-default-browser-check about:blank >/tmp/cutroom-film-chrome.log 2>&1 &
  CHROME_PID=$!
  trap 'kill $SERVER $CHROME_PID 2>/dev/null || true' EXIT
  until curl -sf --max-time 2 "http://127.0.0.1:$PORT/json/version" >/dev/null; do sleep 1; done
fi

echo "· sound"
node "$FILM/make-sfx.mjs" "$FILM/sfx"

echo "· motion cards"
node "$FILM/render-cards.mjs" "file://$FILM/cards.html" "$FILM/frames"

echo "· plate"
node "$FILM/still.mjs" "file://$FILM/slot.html" "$FILM/slot-bg.png"

echo "· app footage"
node "$FILM/capture-app.mjs" http://localhost:4321 "$FILM/app"

# The output beat needs the app's own render and the cut's audio. Both come from
# the page itself rather than being prepared by hand.
if [ ! -f "$FILM/short.mp4" ]; then
  echo "· rendering the short from the app"
  mkdir -p "$FILM/dl"
  node "$FILM/render-short.mjs" http://localhost:4321 "$FILM/dl"
  mv "$FILM/dl/"*.mp4 "$FILM/short.mp4"
fi
[ -f "$FILM/cut.m4a" ] || {
  echo "· cutting the audio with the manifest's own ffmpeg command"
  node "$FILM/make-cut-audio.mjs" http://localhost:4321 app/media/episode.m4a "$FILM/cut.m4a"
}

echo "· assembling"
node "$FILM/assemble.mjs" "$FILM" "$FILM/cutroom-demo.mp4"

# assemble.mjs leaves silent.mp4 (picture) and score.m4a (cues + bed) beside the
# muxed file; the narration goes on last so a re-mix never touches the picture.
if [ -d "$FILM/vo" ]; then
  echo "· narration"
  python3 "$FILM/mix-vo.py"
fi

#!/usr/bin/env bash
# Everything downstream of the film: gallery source frames, the nine gallery
# cards, the Devpost thumbnail, the public copy of the demo.
#   bash film/stills.sh        (after bash film/build.sh; needs Chrome on :9222)
set -e
cd "$(dirname "$0")/.."
S=film/gallery-src; mkdir -p $S submission/gallery
# The screencast's frame count varies with how busy the machine was, so pick
# frames by where they fall in the beat: late enough that the results have landed.
at() { ls film/app/$1 | sed -n "$(python3 -c "import os;print(max(1,int(len(os.listdir('film/app/$1'))*$2)))")p"; }
cp film/app/energy/$(at energy .82)   $S/energy.jpg
cp film/app/propose/$(at propose .82) $S/propose.jpg
cp film/app/clean/$(at clean .82)     $S/clean.jpg
cp film/app/check/$(at check .76)     $S/check.jpg
cp film/app/arrive/$(at arrive .72)   $S/arrive.jpg
# 8s into the output beat, wherever that beat now starts.
OUT_T=$(python3 -c "import json;print(round(json.load(open('film/starts.json'))['output']+8,2))")
ffmpeg -hide_banner -loglevel error -y -ss $OUT_T -i film/cutroom-demo.mp4 -frames:v 1 -q:v 2 $S/output.jpg
ffmpeg -hide_banner -loglevel error -y -ss 9 -i film/short.mp4 -frames:v 1 -q:v 2 $S/short-frame.jpg
# Detail crops — the card shows the thing the headline is about, not the app around it.
ffmpeg -hide_banner -loglevel error -y -i $S/energy.jpg -vf "crop=730:1000:1190:56" -q:v 2 $S/energy-detail.jpg
ffmpeg -hide_banner -loglevel error -y -i $S/clean.jpg  -vf "crop=1190:330:0:750"   -q:v 2 $S/clean-detail.jpg
ffmpeg -hide_banner -loglevel error -y -i $S/check.jpg  -vf "crop=730:1000:1190:56" -q:v 2 $S/check-detail.jpg
node film/render-gallery.mjs "file://$PWD/film/gallery.html" submission/gallery
# 3:2 thumbnail from the title card: 1920×1080 cropped to 1620×1080 keeps the wordmark centred.
ffmpeg -hide_banner -loglevel error -y -ss 3.5 -i film/cutroom-demo.mp4 -frames:v 1 \
  -vf "crop=1620:1080:150:0,scale=1500:1000" -q:v 2 submission/thumbnail.jpg
cp film/cutroom-demo.mp4 app/demo.mp4
ls -la submission/gallery submission/thumbnail.jpg | awk 'NR>1{print $5, $9}'

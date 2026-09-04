#!/usr/bin/env python3
"""Lay the narration over the score and mux it onto the silent picture.

    python3 film/mix-vo.py            # film/silent.mp4 + film/score.m4a + film/vo/*.mp3 → film/cutroom-demo.mp4

Thirteen lines, one per segment, each placed 0.8s after its segment starts on
the finished timeline (s1 waits for the mark to strike, s13 for the wordmark).
The score is side-chained under the voice so a cue never steps on a word; the
real cut at 2:12 has no narration over it and comes through at full level.
Voice gain is 0.55: the lines arrive near full scale and any gain on top only
hands them to the limiter, and a limited voice is a flat one.
"""
import subprocess, os, sys
F = os.path.dirname(os.path.abspath(__file__))
START = {"s1":0,"s2":7.6,"s3":24.2,"arrive":34.8,"s5":43.47,"energy":56.07,"propose":67.74,
         "s8":79.41,"playing":91.01,"check":99.68,"clean":109.35,"s12":120.02,"s13":150.22}
LEAD = {"s1":2.6,"s13":1.3}
inputs = ["-i", f"{F}/score.m4a"]; chains = ["[0:a]volume=1.0[bed]"]; parts = []
for i, k in enumerate(START, 1):
    ms = int(round((START[k] + LEAD.get(k, 0.8)) * 1000))
    inputs += ["-i", f"{F}/vo/{k}.mp3"]
    chains.append(f"[{i}:a]aformat=sample_rates=48000:channel_layouts=mono,volume=0.55,adelay={ms}|{ms}[v{i}]")
    parts.append(f"[v{i}]")
fc = ";".join(chains) + ";" + "".join(parts) + (
    f"amix=inputs={len(parts)}:duration=longest:normalize=0[vo];[vo]asplit=2[vo1][vo2];"
    "[bed][vo2]sidechaincompress=threshold=0.015:ratio=5:attack=40:release=500[ducked];"
    "[ducked][vo1]amix=inputs=2:duration=first:normalize=0,alimiter=limit=0.95[aout]")
subprocess.run(["ffmpeg","-hide_banner","-loglevel","error","-y",*inputs,"-filter_complex",fc,
                "-map","[aout]","-c:a","aac","-b:a","192k",f"{F}/score-vo.m4a"], check=True)
# apad, not -shortest alone: -shortest on its own trimmed 0.6s off the end card.
subprocess.run(["ffmpeg","-hide_banner","-loglevel","error","-y","-i",f"{F}/silent.mp4","-i",f"{F}/score-vo.m4a",
                "-filter_complex","[1:a]apad[a]","-map","0:v","-map","[a]","-c:v","copy","-c:a","aac","-b:a","192k",
                "-movflags","+faststart","-shortest",f"{F}/cutroom-demo.mp4"], check=True)
print("narrated → film/cutroom-demo.mp4")

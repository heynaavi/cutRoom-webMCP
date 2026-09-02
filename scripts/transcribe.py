import json, sys, mlx_whisper
src, out = sys.argv[1], sys.argv[2]
r = mlx_whisper.transcribe(
    src,
    path_or_hf_repo="mlx-community/whisper-large-v3-turbo",
    word_timestamps=True,
    verbose=False,
)
json.dump(r, open(out, "w"))
segs = r.get("segments", [])
print(f"segments={len(segs)} words={sum(len(s.get('words',[])) for s in segs)}")

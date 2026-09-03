# The demo video

`cutroom-demo.mp4` — **2:39, 1920×1080, 30fps, H.264 + AAC.** Under the rules'
three-minute cap, non-fragmented MP4, nothing in it is licensed from anyone.

```bash
bash film/build.sh          # ~6 minutes end to end
```

---

## How it's made

Three sources, one edit.

**Motion cards** are HTML + GSAP, rendered frame by frame. GSAP is detached from
`requestAnimationFrame` (`gsap.ticker.remove(gsap.updateRoot)`) and the renderer
seeks the timeline to an exact time before every capture, so frame N is the same
pixels whether the machine drew it in 4ms or 400 — and a slow font load cannot
shear a tween across two frames. PNG frames, because these are flat colour and
hard-edged type and JPEG leaves mosquito noise around the mono labels.

**App footage** is the real page running the real demo, filmed over
`Page.startScreencast`. Pulling frames with `captureScreenshot` managed 11fps —
the app is running rAF loops and an audio graph while it poses, so every request
queued behind real work. Screencast pushes instead and delivers ~93fps. Nothing
on screen is mocked; every tool call in the ledger is a call that happened.

**The output beat** is the app's own `renderVideo` result, composited into a
plate. The audio under it is the actual cut — the one file in the whole video
that was not synthesised, and the point of the exercise.

## Sound

Synthesised, in `make-sfx.mjs`, on primitives borrowed from the VoiceDumps film
pipeline. Generated rather than sourced for reasons that matter here
specifically: the rules forbid third-party material, so nothing is downloaded
and there is no licence to track; the noise source is a seeded PRNG, so the
audio is as reproducible as the frames; and a cue that has to land on a
particular frame is retuned by editing a number.

The register is an interface, not a mood — a mark struck, a panel arriving, a
tool returning, five clips landing, four words cut. Tonal centre is A, and every
pitched cue is a degree of A minor pentatonic, so cues that overlap at a
crossfade cannot clash. The end card resolves on the same A the wordmark struck
at 0:00.

**It is mixed to be talked over.** Bed at −43dB, cues around −25dB, and the only
loud thing in the film is the cut itself at −11dB. Add a voiceover and nothing
needs re-balancing.

## Timing sheet

Segment starts on the finished timeline. 0.4s dips between segments, so a
segment begins slightly before its card is fully up.

| In | Segment | Len | What's on screen |
| --- | --- | --- | --- |
| 0:00 | `s1` | 8.0s | Title — wordmark, "33 tools live" |
| 0:07 | `s2` | 17.0s | **The problem.** 38 minutes → 547 lines → the hour drawn, five clips marked |
| 0:24 | `s3` | 11.0s | What it is — `document.modelContext.registerTool` × 33, the tool grid |
| 0:34 | `arrive` | 9.1s | App: `listCapabilities`, the agent gets its bearings |
| 0:43 | `s5` | 13.0s | **It can hear.** Five of thirty-three don't read the transcript |
| 0:56 | `energy` | 12.1s | App: `findEnergyMoments`, lift bars, ×2.85 at 29:38 |
| 1:07 | `propose` | 12.1s | App: `proposeCut` — five clips land, drawn across 68% |
| 1:19 | `s8` | 12.0s | Nothing is committed — dashed means pending |
| 1:31 | `playing` | 9.1s | App: the reel playing |
| 1:39 | `check` | 10.1s | App: `checkFlow` — six issues, weak hook |
| 1:49 | `clean` | 11.1s | App: `cleanUpCut` — the "um"s struck out |
| 2:00 | `s12` | 13.0s | The deliverable — 9 spans, the ffmpeg command, "it runs" |
| 2:12 | `output` | 18.0s | **The rendered short, playing, with its real audio** |
| 2:30 | `s13` | 9.0s | End card — URL, 33 tools, MIT |

### Recording a voiceover against it

Two beats want silence from the narrator: **0:56–1:07** (let the energy results
land — it is the one thing here a transcript search cannot do) and **2:12–2:30**
(let the cut play; it is the only moment where the product speaks for itself).

Everything else is open. The visuals carry the argument on their own, so the
narration should say what the *page* is doing rather than describe what is on
screen.

## Files

| | |
| --- | --- |
| `cards.html` | Every motion card, one paused GSAP timeline each |
| `slot.html` | The plate the rendered short is composited into (slot rect is a contract with `assemble.mjs`) |
| `render-cards.mjs` | Deterministic frame renderer |
| `capture-app.mjs` | Screencast capture of the live app, dock parked per beat |
| `still.mjs` | One-frame render, for the plate |
| `make-sfx.mjs` | The score |
| `assemble.mjs` | Normalise → xfade chain → cue-timed audio → mux |
| `lib/dsp.mjs` | Synthesis primitives |

## Two traps, both of which fail silently

**`makeLP`/`makeHP` take `(sample, cutoffHz)`.** Omit the cutoff and
`Math.exp(-2π·undefined/RATE)` is `NaN`, every sample becomes `NaN`, and
`writeInt16LE(NaN)` writes a zero. You get a valid WAV file of pure silence and
no error anywhere. `chord()` has the same shape of trap: it wants voices as
`{ f, g }`, and bare numbers give you `f.f === undefined`.

**JPEG screencast frames decode as full range**, and libx264 carries that
through as `yuvj420p`, which players and social re-encoders then read as limited
range and wash out. The filter chain converts the levels explicitly
(`in_range=full:out_range=tv`) rather than just tagging them, which is what keeps
the paper the same colour in a card and in a screenshot of the app.

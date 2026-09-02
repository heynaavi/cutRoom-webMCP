# Demo video — shot list

**2:40 target. Portrait or 16:9. Screen recording of Chrome 149+ with
`--enable-features=WebMCP`, which is the path that demonstrably works.**

Record with `bin/try.sh https://cutroom-webmcp.vercel.app`, then drive the tools
from a second terminal with `bin/verify.sh` so every on-screen change is a real
tool call. Keep the Agent Activity panel visible the entire time — it is the
proof.

---

## 0:00–0:20 · The problem, stated once

> *"This is a 38-minute NASA podcast. Somewhere in it are about eight lines
> that, in the right order, are a story. Finding them is the whole job — and
> there's no correct answer, only taste."*

**On screen:** the transcript rail scrolling — 547 lines. Let the length land.
Then the provenance bar, empty.

---

## 0:20–0:45 · What a text-only agent can't do

> *"An agent reading the transcript can search for words. But the best moment in
> an hour is rarely the smartest sentence — it's the one with the most life in
> it. You can't see that in text."*

**On screen:** search `amazing` — unremarkable results.
Then open **Energy**. Let these land on screen:

```
lift 2.61 @29:38  "I mean, isn't that amazing that we did that?"
lift 2.24 @31:47  "Are you going to have a giggle fit?"
```

> *"That's `findEnergyMoments`. It reads the waveform, not the words. This page
> lets an agent hear."*

**This is the differentiating beat. Do not rush it.**

---

## 0:45–1:20 · The agent proposes; you judge

**On screen:** Agent Activity fills in real time — `listCapabilities`,
`searchTranscript`, `findEnergyMoments`, `proposeCut`.

Five clips land **dashed** on the reel, each with a one-line *why*.

> *"The agent proposes. Nothing is committed — these are pending until I keep
> them. And it drew from five different places across the hour, which is the
> difference between a story and an excerpt."*

**On screen:** the provenance bar, marks spread wide. Then **press Space.**

**Let the audio play for a full 8 seconds. Say nothing.**

---

## 1:20–1:50 · Taste goes back the other way

> *"Now I tell it what I think."*

**On screen:** thumbs-down one clip. Click **Tighter**.

> *"Both of those go back through `getReelState` as `humanVote` and
> `humanAsked`. It's revising to my taste, not its own."*

---

## 1:50–2:20 · Cleaning the script

> *"Then it cleans up — the ums and the dead air, out of the middle of clips,
> audio closing up behind them."*

**On screen:** `cleanUpCut` in the ledger. Clip text visibly loses its fillers;
the duration meter drops. Show the before/after on one clip:

```
"Um, but, uh, when I was in high school, there was a teacher, um, his name was Mr"
"but, when I was in high school, there was a teacher, his name was Mr"
```

> *"Whisper strips the ums from transcripts — this reads the audio, so it finds
> the hesitation whether the transcript kept it or not."*

---

## 2:20–2:40 · The deliverable

**On screen:** `getCutManifest` — exact timestamps, then the ffmpeg command.

> *"Five clips became nine separate spans. A vague timestamp is useless
> downstream, so it hands over every one to the hundredth of a second — plus
> the ffmpeg command. We decide what to cut. ffmpeg does the cutting."*

**Close on the reel, whole cut playing, ledger full.**

> *"Thirty-three tools. The agent has taste, not just hands."*

---

## Rules for the recording

- **Never fake a tool call.** Everything in the ledger must be real. If a beat
  won't cooperate, cut the beat, not the honesty.
- **Let the audio breathe.** The single most persuasive moment is a stitched cut
  playing cleanly. Silence from the narrator there.
- **Keep Agent Activity on screen throughout.** It is the evidence.
- Click the page once before any agent-driven playback — browsers block
  page-initiated audio until the user has interacted.
- Mention Chrome 149+ once, plainly, and move on. Don't apologise for it.

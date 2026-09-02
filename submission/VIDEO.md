# Demo video — recording kit

**The rules:** under 3:00, publicly visible on YouTube, and it must have *"audio
that covers what you built and how you used WebMCP."* Narration is not optional.
No third-party music. (The episode itself is fine — NASA, public domain, see
`app/data/CREDITS.md`.)

---

## Why presenter mode exists

The demo normally runs on fixed timers — 3.4s, 5.2s, 9s. That's right for
someone watching it and impossible to narrate over: you can't talk for exactly
5.2 seconds on cue, eight times in a row, and land it.

**Presenter mode holds every step until you press `→`.** It puts the line you're
meant to say on screen at reading size and counts up so you can watch the
three-minute limit coming. The tool calls are the same real calls either way —
only the pacing changes.

```bash
bin/try.sh 'https://cutroom-webmcp.vercel.app/?present'
```

Then **"Watch it work"**. Or press `P` at any point to flip an already-running
demo into presenter mode.

| Key | |
| --- | --- |
| `→` | next step — press it when your sentence lands |
| `←` | back a step |
| `P` | toggle presenter mode |
| play button | replays *this* step's action (use it on the playback beat) |
| `Esc` | close |

The clock in the header turns amber at 2:30 and red at 3:00.

## Before you hit record

- **Click the page once.** Browsers block page-initiated audio until a human has
  interacted, and step 5 plays the reel.
- Full screen, **1440×900 or wider**. The dock parks itself beside whatever the
  current step is about.
- **Drag the dock** by its grip if it ever covers something you want on camera —
  it stops following once you've put it somewhere.
- Record system audio *and* your microphone. The stitched cut playing is the most
  persuasive ten seconds in the video and it needs to be audible.
- Do a silent dry run first. `→` eight times, watch where the dock lands.

---

## The script

~365 words. At a normal pace that's about 2:26, plus ten seconds of silence on
the playback beat. Read it — don't improvise, you'll run long.

### 0:00 · Cold open — *no dock yet, scroll the transcript rail*

> This is a thirty-eight minute NASA podcast — Tracy Caldwell Dyson, who went
> from wiring buildings for her dad to walking in space. Five hundred and
> forty-seven lines of transcript. Somewhere in there are five of them that, in
> the right order, are a story worth thirty seconds. Finding them is the whole
> job — and there's no correct answer, only taste.

*Let the scrolling land. Then open the demo.*

### 0:20 · What it is

> So I built Cutroom. It's an ordinary web page, and it registers thirty-three
> WebMCP tools on `document.modelContext`. Everything you're about to see is an
> agent calling those tools. Nothing is faked, and nothing is scraped out of the
> DOM.

### 0:36 · Step 1 — `listCapabilities`

> It arrives cold and asks what's here. Thirty-three tools — and five of them
> read the audio, not the transcript.

### 0:44 · Step 2 — `findEnergyMoments` **← the beat that matters**

> That's the part I care about. This one reads the waveform. The best moment in
> an hour is almost never the smartest sentence — it's the one with the most
> life in it, and you cannot see that in text. The strongest moment in this
> episode is "isn't that amazing that we did that?" — and it's at twenty-nine
> thirty-eight, which no keyword would have taken you to.

**Do not rush this one.** It is the single thing that separates this from a
transcript search. Let the lift bars sit on screen.

### 1:03 · Step 3 — `searchTranscript`

> Then it reads. The clips worth having sit where the words and the audio agree.

### 1:09 · Step 4 — `proposeCut`

> Five lines, from five different places, drawn across sixty-eight percent of
> the episode. They land dashed — that means proposed, not decided. Nothing an
> agent does here is committed until I keep it.

*Point at the provenance bar: the marks are spread wide.*

### 1:21 · Step 5 — `playReel`

> And then it plays it to me. Because that's the only way to judge a cut.

**Then stop talking for ten full seconds and let it play.** If you say one thing
over this, the video is worse.

### 1:37 · Step 6 — `checkFlow`

> It checks its own work the way an editor would. Six things: the hook opens
> mid-thought, one clip ends mid-sentence, and four joins land on speech instead
> of in a pause.

### 1:47 · Step 7 — `cleanUpCut`

> Then it cleans up — hesitations and dead air, out of the middle of clips, with
> the audio closing up behind them. Whisper strips the ums out of transcripts by
> default, so I transcribed this one verbatim. That way the tool finds the
> hesitation whether the transcript kept it or not.

*The teacher clip visibly loses its "um"s and the duration meter drops.*

### 2:07 · Step 8 — `getCutManifest`

> And it hands over the deliverable. Five clips became nine separate spans —
> because four of them have a hesitation cut out of the middle. Every one exact
> to a hundredth of a second, plus the ffmpeg command. We decide what to cut.
> ffmpeg does the cutting.

### 2:21 · Close — *demo finished; thumbs-down a clip, click **Tighter***

> Taste goes back the other way too. A thumbs-down, or "tighter", comes back
> through `getReelState` as `humanVote` and `humanAsked` — so it's revising to
> my judgement, not its own.
>
> Thirty-three tools. The point isn't that the agent has hands. It's that it has
> ears.

---

## Rules for the recording

- **Never fake a tool call.** Everything in the ledger is real. If a beat won't
  cooperate, cut the beat, not the honesty.
- **Keep the Agent Activity panel on screen.** It is the evidence.
- Mention Chrome 149+ once, plainly, and move on. Don't apologise for it.
- If you overrun, the first cut is step 3 (`searchTranscript`, 6s) and then the
  second half of step 7. Never cut step 2 or the ten seconds of playback.

# Cutroom

**Find the short inside the hour — with an agent that has taste, not just hands.**

**Live: <https://cutroom-webmcp.vercel.app/>**

A 38-minute podcast contains maybe five lines that, in the right order, are a
story. Finding them is a search problem with no correct answer — only taste —
and you cannot judge a candidate without *hearing* it.

Cutroom is a WebMCP surface for that problem. The page exposes its cutting tools
to whatever AI agent is visiting, so the agent can search 500 transcript lines,
propose whole cuts, reorder them, and **play them out loud** — while the human
stays in the loop, listening and deciding.

Built for the [WebMCP Challenge](https://webmcp.devpost.com/).

---

## Why this needs WebMCP

An agent driving this page through the DOM would have to scroll a 500-line
transcript and guess which `div` is the right line. With tools it calls
`searchTranscript("the call came")` and gets back `{startSec: 1126.2, endSec:
1132.6}` — a precise, un-clickable operation on the *time domain* of a
recording.

More importantly, the reads are **bidirectional**. `getReelState()` doesn't
return a number; it returns what the human just did — which clips they muted,
which lines they starred, how far over the 60-second budget they are. An agent
that responds to *that* is reading taste, not executing a task.

## The design rules

1. **The agent proposes; the human disposes.** Agent-added clips land as
   *pending* — dashed on the reel — and never silently replace human choices.
2. **Pending clips still play.** A proposal you cannot hear is worthless, and
   hearing it is how you decide. Only muting removes a clip from playback.
3. **Every call is visible.** The Agent Activity ledger shows each tool
   invocation as it happens.
4. **Reasons travel with objects.** Each proposed clip carries a one-line *why*
   on the card, not buried in a chat log.

## Tools

| Tool | What it does |
|---|---|
| `getSource` | Title, duration, line count of the loaded recording |
| `searchTranscript` | Find lines by topic/phrase/emotion, filtered by length |
| `readTranscript` | Read a time window in order, for context |
| `getReelState` | The current cut **and what the human just did to it** |
| `proposeCut` | Propose a complete short as a named candidate |
| `addSpan` | Add one line, surgically |
| `removeClip` / `reorderClip` | Edit the cut — order is most of the story |
| `playReel` | Play the cut out loud so the human can judge it |
| `findEnergyMoments` | **Reads the audio**: where the voice lifts above its own baseline |
| `checkFlow` | An editor's read — weak hook, dangling reference, hard join, budget |
| `snapToBreath` | Move a cut point to the nearest natural pause |
| `setClipRole` | hook / setup / turn / payoff / button — the story's shape |
| `trimClip` | Nudge in/out by fractions of a second, snapped to word boundaries |
| `getCandidates` | Every angle proposed, and how the human reacted |
| `renderVideo` | **Renders a real 1080×1920 video** with burned-in captions, in-browser |
| `exportCut` | EDL / JSON / script, so the cut can leave the browser |
| `tidyClip` | Drop leading/trailing filler words from a clip |
| `tightenClip` | Close up dead air *inside* a clip, read from the audio |
| `omitPhrase` | Delete words from the middle; the audio closes up behind |
| `findPhrase` / `addPhrase` / `reshapeClip` | Cut on words, not transcript lines |
| `listCapabilities` | What's here and the order worth doing it in |
| `fitToBudget` | Trim the whole cut to a target length |
| `playCandidate` | Play an alternative without disturbing the reel |
| `undoLastChange` | An agent can replace the whole reel in one call |
| `loadTranscript` | Load *their* recording — the agent supplies the transcript |

## It produces an actual video

Everything upstream produces a decision — these spans, in this order.
`renderVideo` turns that into a file you can post: canvas draws the audiogram
frame by frame, MediaRecorder muxes it with the real audio, and a 1080×1920
`.webm` lands in your downloads. No server, no upload, no queue.

It records in real time, because the audio has to play through the graph to be
captured — a 40-second cut takes 40 seconds. The UI says so rather than looking
hung. (One known wrinkle: MediaRecorder writes an odd frame-rate into the WebM
header, so some upload pipelines may want a remux.)

## Why the audio matters

Editors will tell you the most clippable moment in an hour is rarely the
smartest sentence — it's the one with the most life in it. A transcript cannot
show you that. Cutroom keeps an RMS envelope of the real audio, so
`findEnergyMoments` can hand an agent the passages where someone's voice lifts
above their own baseline:

```
lift 2.61 @29:38  "I mean, isn't that amazing that we did that?"
lift 2.24 @31:47  "Are you going to have a giggle fit?"
```

Searching the transcript for "amazing" would never rank those. The signal is in
the delivery. The same envelope drives `snapToBreath`, because a splice landing
on top of a word sounds broken however good the line is.

## Three ways material gets in

1. **The bundled demo** — a NASA episode, so you can try it with zero setup.
2. **Drop your own** — media + SRT/VTT/JSON onto the page. Fully client-side;
   nothing uploads, nothing leaves your browser.
3. **The agent brings it** — `loadTranscript` lets ChatGPT hand over a
   transcript it already has. The agent *is* the file picker.

## First run

A judge arriving cold sees a podcast editor and no reason to care — the tools
are the point and they're invisible until something calls one. So the page
opens by saying what it is, detecting whether the browser can do WebMCP at all
(and naming the fix if not), and offering to run the loop in front of you.

The demo drives the **real tools** — the same functions an agent invokes, in the
order an agent would sensibly use them — and it's labelled as scripted. A faked
agent would be both dishonest and less impressive than the truth, which is that
it genuinely works. It leaves a real cut on the reel to carry on with.

## When the agent can't call the tools

Not every runtime bridges WebMCP yet. An agent that can only *fetch* is still
given a real path rather than left to guess: `/.well-known/mcp.json` describes
all 33 tools (generated from the registration code, so it can't drift), and
`/data/transcript.json` plus `/data/peaks.json` are the same transcript and
waveform the tools read.

That's enough to pick real spans and return exact timestamps. It came from
watching an agent with no bridge do precisely this on its own — fetch the
transcript and assemble two workable cuts — so the page now documents the path
instead of leaving it to be rediscovered.

## Trying it

No build, no backend, no API keys — it's static files.

```bash
npx -y serve app -l 4321
```

**With WebMCP on** (macOS, Chrome 149+):

```bash
bin/try.sh
```

That starts the server and opens Chrome with `--enable-features=WebMCP`. The
pill top-right should read **"33 tools live"** — that's registration succeeding.
Point it anywhere with `bin/try.sh https://cutroom-webmcp.vercel.app`.

To let a **real model** discover and drive the tools — the claim WebMCP actually
makes — point an API key at the page:

```bash
ANTHROPIC_API_KEY=… node scripts/agent.mjs "find me 60 seconds on how she went from electrician to astronaut"
# or OPENAI_API_KEY=…
```

It reads `getTools()` from the live page, hands those schemas to the model as
its tool list, executes whatever the model chooses via `executeTool`, and loops.
Nothing is scripted: the model picks the calls. Without a key it still reports
what it discovered and exits.

To prove the tools run through `document.modelContext` without involving a
model:

```bash
bin/verify.sh
```

It drives the page over CDP — searches the transcript, proposes a cut, checks
the pending clips actually appear in the DOM, and confirms `getReelState`
reports back what the human did.

**Without any agent it still works** — *Suggest three cuts* in the Cuts tab
builds keyword-based starters. Playing those against an agent's cut, back to
back, is the fastest way to hear what the agent is actually contributing.

### Notes on the WebMCP API

Two things the docs are quiet about, learned the hard way against Chrome 151:

- `executeTool` takes the **tool object** from `getTools()`, not its name.
- Arguments go in as a **JSON string**, and the result comes back as one too —
  your `{content:[{type:"text",text}]}` envelope is serialised for you.

Also: Chrome will not let a page start audio before the human has interacted
with it, so an agent calling `playReel` first thing gets refused. The tool
detects this and says so rather than claiming it played.

## Keyboard

| Key | |
|---|---|
| `Space` | Play / pause the reel |
| `1`–`9` | Jump to a candidate cut and play it |
| `K` | Keep all pending clips |
| `/` | Search the transcript |

## Layout

```
app/
  index.html
  css/cutroom.css      design tokens + layout
  js/store.js          state, search, all mutations
  js/player.js         <audio> driven as a stitched sequence
  js/ui.js             rendering + interaction
  js/ingest.js         SRT/VTT/JSON parsing, file drop
  js/starters.js       heuristic cuts for no-agent use
  js/tools.js          WebMCP tool definitions
  data/                transcript, waveform peaks, credits
  media/episode.m4a    18 MB — the whole 38 minutes
scripts/               transcript + waveform build steps
```

## Notes on the media

The episode is 64 kbps mono AAC — **18 MB for 38.5 minutes**. Small enough that
the browser caches the whole thing, so seeking is instant and stitched playback
needs no HLS, byte-range tuning, or CDN. Measured: a 25-second cut spanning
three jumps across the file plays in 25.3 seconds of wall clock, each clip
landing within 0.11s of its boundary.

Demo audio is public domain (NASA). See [app/data/CREDITS.md](app/data/CREDITS.md).

## Licence

MIT — see [LICENSE](LICENSE).

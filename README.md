# Cutroom

**Find the short inside the hour — with an agent that has taste, not just hands.**

A 38-minute podcast contains maybe eight lines that, in the right order, are a
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
| `loadTranscript` | Load *their* recording — the agent supplies the transcript |

## Three ways material gets in

1. **The bundled demo** — a NASA episode, so you can try it with zero setup.
2. **Drop your own** — media + SRT/VTT/JSON onto the page. Fully client-side;
   nothing uploads, nothing leaves your browser.
3. **The agent brings it** — `loadTranscript` lets ChatGPT hand over a
   transcript it already has. The agent *is* the file picker.

## Running it

No build, no backend, no API keys — it's static files.

```bash
npx -y serve app -l 4321
```

Then open <http://localhost:4321>.

To connect an agent, open the page in ChatGPT's browser, or in Chrome 149+ with
`chrome://flags/#enable-webmcp-testing` enabled. The dot in the top bar turns
green and reads *"10 tools live"* when registration succeeds.

**Without an agent it still works** — hit *Suggest three cuts* in the Cuts tab
for keyword-built starters. Playing those against an agent's cut is the fastest
way to hear what the agent is actually contributing.

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

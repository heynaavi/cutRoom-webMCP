# Cutroom — Devpost submission

**Live:** https://cutroom-webmcp.vercel.app
**Source:** https://github.com/heynaavi/cutRoom-webMCP (MIT)

---

## Inspiration

A 38-minute podcast contains maybe eight lines that, in the right order, are a
story. Finding them is a search problem with no correct answer — only taste —
and you cannot judge a candidate without hearing it.

Both existing options fail. Doing it by hand means scrubbing 547 transcript
lines while holding a story in your head. Handing it to an AI means it returns
one cut, you feel it's wrong, and you have no vocabulary to say why and no cheap
way to explore what's next to it. You bounce back to doing it by hand.

So the design principle isn't "let the agent write the script." It's:

> **The agent's job is to make your judgment cheap.**

## What it does

Cutroom registers **33 WebMCP tools** on `document.modelContext`. An agent can
search a transcript, propose complete cuts assembled from non-contiguous spans
anywhere in the recording, trim to word boundaries, cut on breath, clean out
hesitations, and **play the result out loud** — while the person listening keeps
every decision that matters.

Three things make it more than a wrapper:

**1. The agent can hear.** `findEnergyMoments` reads the RMS envelope of the
real audio and returns where the voice lifts above its own baseline. Editors
will tell you the most clippable moment in an hour is rarely the smartest
sentence — it's the one with the most life in it. A transcript cannot show you
that. On the demo episode it surfaces *"isn't that amazing that we did that?"*
and *"are you going to have a giggle fit?"* — lines no keyword search ranks,
because the signal is in the delivery. It runs in 4ms over 21,000 samples.

**2. Taste travels both ways.** Agent proposals land as *pending* clips, never
silent overwrites. The human thumbs-down a clip or clicks a steer chip
("Tighter", "Colder open"), and those come back through `getReelState` as
`humanVote`, `humanNote` and `humanAsked`. The agent revises to their taste
rather than its own. Every tool call appears in a visible ledger.

**3. It knows the craft.** `checkFlow` reports what an editor would flag: a hook
that opens mid-thought, a clip starting on a pronoun with no antecedent in the
cut, a join that cuts in mid-flow, everything drawn from one stretch.
`snapToBreath` moves cut points to real pauses. `cleanUpCut` removes stammers
and dead air from the *middle* of a clip and closes the audio up behind them.
`getCutManifest` returns every span to a hundredth of a second, plus a ffmpeg
command — we decide what to cut; ffmpeg does the cutting.

## Why WebMCP fits this use case

The sponsor demos are transactional — storefronts, reservations, returns. There
the agent *completes* a task you'd rather not do by hand.

Cutting a short isn't that shape. There is no correct answer to find, only a
judgement to make, and the person has to hear it to make it. So the work splits
cleanly along the one axis that matters:

| The agent does | The human does |
|---|---|
| read 547 lines in a second | decide which eight are a story |
| hear where the voice lifts across 38 minutes | decide whether that's the right kind of energy |
| trim to word boundaries, cut on breath | say "that's too long" after hearing it |

Neither half works alone. That's why this is a WebMCP app rather than a chatbot
with an API: **the tools have to live where the person is listening.**

## How humans and agents collaborate here

The brief asks for people and agents *creating together*, so the collaboration
runs in both directions rather than one:

- **Agent → human.** Proposals land as *pending* clips on the reel, dashed, each
  with a one-line reason. Nothing is committed. The human plays them and decides.
- **Human → agent.** A thumbs-down on a clip, or a steer chip ("Tighter",
  "Colder open"), is recorded and returned through `getReelState` as
  `humanVote`, `humanNote`, `humanAsked`. The agent revises to their taste
  rather than its own.
- **Both → visible.** Every tool call appears in a live ledger. The human always
  knows what the agent just did, and can undo it.

## Why this needs WebMCP

An agent driving this page through the DOM would scroll 547 lines and guess.
With tools it calls `searchTranscript("the call came")` and gets
`{startSec: 1122.4, endSec: 1128.8}` — a precise operation on the *time domain*
of a recording, which is not something you can click.

And the reads are bidirectional. `getReelState` doesn't return a number; it
returns what the human just did. That's the part a conventional MCP server
can't replicate: the tools live where the person is.

## How we built it

100% static — no backend, no API keys, no database. The intelligence is the
visiting agent; we ship the tools. Vanilla JS, GSAP for motion.

Demo material is NASA's *Houston We Have a Podcast* ep. 327 (public domain),
transcribed locally with whisper.cpp using a **verbatim prompt** — the default
run silently strips disfluencies (0 "um"s), the prompted run keeps them (220),
which is exactly what the cleanup tools exist to remove.

## Challenges

**Cuts derived from audio must be checked against words.** An early cleanup pass
deleted "their office" from a line because that passage was softly spoken and
fell under a global loudness floor. A real pause has no word in it — that's now
the test. Same bug in filler removal, where padding past an "uh" swallowed
"nobody". The envelope tells you where energy is, not where words are.

**Stitched playback is harder than it looks.** `currentTime` still reports the
old position while a seek is in flight, so the clip-boundary check re-fired
instantly and chained through the whole reel — a 25-second cut collapsed to 14.

**A transcript without media.** An agent handing us someone else's transcript
used to leave the previous audio loaded — playing NASA under their words, every
timestamp pointing at the wrong sound. There's now an explicit text-only mode
that does everything except hear it.

## What we learned

Encoding *editorial craft* turned out to matter more than adding tools. The
tools that make the difference — energy, breath, flow, the human's votes — are
the ones that carry judgment, not the ones that carry actions.

## What's next

Speaker diarisation, so "more of her, less of him" becomes a real instruction.
In-browser transcription, to close the media-only gap.

## Try it

Open https://cutroom-webmcp.vercel.app in **Chrome 149+** with
`chrome://flags/#enable-webmcp-testing`, or ChatGPT's browser where site tools
are available. The pill reads **"33 tools live"** on success. `bin/verify.sh`
drives the tools over CDP and prints what came back.

Without any agent it still works by hand, and an agent that can only *fetch*
gets `/.well-known/mcp.json` and the transcript so it can still return real
timestamps rather than inventing them.

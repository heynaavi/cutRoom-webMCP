# Cutroom — brand kit

Cutroom is an editing room, not a dashboard. Everything below follows from that:
warm paper rather than product-blue, one accent that has to mean something, and
motion that eases the way a fader does.

---

## Mark

`app/favicon.svg` — four level bars over a horizontal track. It reads as a
waveform and as a scrubber at the same time, which is the whole product: a
recording, and a position in it. The bars are uneven on purpose (10.5 / 14 / 8 /
12) so it never reads as an equaliser logo.

The SVG carries its own `prefers-color-scheme` block, so the tab icon inverts
with the browser rather than sitting as a bright square in a dark tab strip.
Raster fallbacks are exported from a flat copy — `rsvg-convert` doesn't evaluate
media queries, so a naive export would have baked in the light palette.

| File | Size | Where it's used |
| --- | --- | --- |
| `favicon.svg` | any | Modern browsers; theme-aware |
| `icon-32.png` | 32 | Legacy tab icon |
| `icon-192.png` | 192 | Android home screen |
| `icon-512.png` | 512 | Splash, maskable |
| `apple-touch-icon.png` | 180 | iOS — full-bleed, iOS masks the corners itself |
| `og.png` | 1200×630 | Open Graph / Twitter card |

## Wordmark

`Cut` in Space Grotesk 600, `room` in the same face at 400 italic. Set as one
word, no space, no capital R — a cutting room is one thing. In the top bar it
sits next to a small `WebMCP` label in mono, which is the only place the
technology is named in the UI chrome.

## Palette

One accent. Terracotta appears on the playing clip, the accepted state, and
nothing else — the moment it decorates something, it stops meaning "this one".

### Light — warm paper

| Token | Hex | Role |
| --- | --- | --- |
| `--bg` | `#e6e0cf` | Page — paper, not white |
| `--surface` | `#f8f5ed` | Panels |
| `--surface-2` | `#dcd4c0` | Recessed tracks |
| `--raised` | `#fffdf8` | Cards that sit above the page |
| `--text` | `#211f1a` | Body — 12.49:1 on `--bg`, 10.45:1 as rendered transcript |
| `--muted` | `#5a574e` | Timestamps, secondary — 5.48:1 |
| `--accent` | `#c4582f` | Terracotta — playing, accepted |
| `--ghost` | `#3f6b8a` | Slate — *proposed, not yet yours* |
| `--positive` `--warn` `--danger` | `#557a4a` `#b3711f` `#a23a22` | Flow notes |

### Dark — the room with the lights down

| Token | Hex | Role |
| --- | --- | --- |
| `--bg` | `#0f0e0c` | |
| `--surface` | `#171613` | |
| `--text` | `#ece7dc` | 10.31:1 as rendered transcript (measured in-page) |
| `--accent` | `#e0724a` | Lifted to hold saturation against black |
| `--ghost` | `#6fa3c7` | Same lift |

The two accents are not the same hue rotated — each was picked against its own
ground so the ghost/accent distinction survives both.

### Why two accents

Terracotta is *mine*; slate is *proposed*. An agent's five clips land dashed and
slate, and stay that way until a person keeps them. The colour is the consent
model, so it can't be decorative.

## Type

| Face | Use |
| --- | --- |
| Space Grotesk | Display — wordmark, headings, the stage caption |
| DM Sans | Body — transcript, controls, everything read in quantity |
| JetBrains Mono | Timecodes, tool names, anything an agent wrote |

Mono is load-bearing: **if it's in mono, a machine produced it or a machine will
consume it.** Tool names in the ledger, timestamps in the manifest, the JSON in
the demo dock. Nothing human-authored is ever set in mono.

Numbers use `font-variant-numeric: tabular-nums` everywhere (`.tnum`), so a
running timecode doesn't jitter.

## Motion

GSAP, `power3.out` for entrances, `power2.in` for exits, 0.3–0.5s. Slow enough
to read as deliberate, short enough that you never wait for it.

One hard rule, learned the hard way: **GSAP owns transform and opacity; CSS owns
`left`/`top`.** The demo dock had both fighting over position and ended up
below the fold. If it moves, one system moves it.

The waveform meter is symmetric and in place — it grows and shrinks about its
centre line rather than scrolling. A travelling waveform implies you're seeking
through it, and you aren't.

Anything that can animate is behind `prefers-reduced-motion` at the CSS layer.

## Voice

Short sentences. No exclamation marks. The product never congratulates you.

- Say what happened, not how it went: *"9 spans · exact in/out · ffmpeg command"*
- Name the limit rather than hiding it: *"no audio loaded, so this can't be played"*
- Never claim an agent did something a heuristic did. The standalone suggestions
  are labelled "from the text" because that is all they read.

## Spacing and shape

Radii `6 / 10 / 14 / 20`. Hairlines are colour at 13% alpha, never a grey — a
grey line on warm paper reads as dirt.

Three shadow tiers only, all warm-tinted in light (`rgba(60,40,20,…)`) and plain
black in dark.

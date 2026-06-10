# Corellia explainer — production plan

Source: `media/video-storyboard.md` (locked cut, ~5:10).
Pipeline: hybrid per `ai-video-production` skill — **CODE** lane (HTML/CSS/JS
scenes recorded from the automation browser, all typed text and diagrams) +
**REVE→VEO** lane (textured/atmospheric shots), assembled with ffmpeg.
Decisions (Keith, 2026-06-10): hybrid pipeline · ElevenLabs VO · synthesized
music · Veo 3 Fast, Quality tier for hero shots only.

## Directory layout

```
media/video/
  PRODUCTION.md          this file
  .env                   ELEVENLABS_API_KEY=... (gitignored; Keith provides)
  prompts/               final Reve + Veo prompts as used
  scenes/                HTML scene files (CODE lane)
  assets/stills/         Reve exports        (gitignored)
  assets/clips/          Veo exports         (gitignored)
  assets/vo/             ElevenLabs segments (gitignored)
  assets/music/          synthesized stems   (gitignored)
  build/                 intermediate renders + final master (gitignored)
```

## Build order

1. **VO first.** Generate all 13 ElevenLabs segments from the storyboard VO
   text. Measured segment durations become the authoritative scene timings —
   everything downstream is cut to the VO, not to the storyboard's estimates.
2. **Music stems** (numpy/ffmpeg): low synth pulse, Scene-3 fugue cadence,
   Scene-4 Shepard riser, Scene-11 quick-pulse variant, outro cadence, hard-hat
   clunk.
3. **Reve session** (browser, Keith logged in): build the engraving world,
   generate all stills below, bounding-box edits as needed, export.
4. **Veo via Flow** (browser): animate the 4 clips below from the Reve stills.
5. **CODE scenes**: build each HTML scene timed to its VO segment, record at
   1920×1080/30fps from the automation browser.
6. **Assembly** (ffmpeg): conform clips to timeline, composite overlays, mix
   VO + music + sfx, grade for consistency, export master
   `build/corellia-strange-loop-v1.mp4`.

## Shot list

Durations follow the storyboard; final numbers come from measured VO.

| # | Scene | Cut len | Lane | Notes |
|---|-------|---------|------|-------|
| S1 | Cold open | 0:20 | CODE | terminal type-on, tree detonation, escaping arrow |
| S2 | Factory in 60s | 0:52 | CODE | node operation, harness card, gates, tier ladder |
| S3 | Tame hierarchy | 0:31 | CODE | resolve cycle ×2, annotations, fugue sync |
| S4 | Hofstadter interlude | 0:34 | REVE→VEO + CODE | 3 vignettes (below); ladder diagram is CODE overlay surviving the style cut |
| S5 | The twist | 0:18 | CODE | trees time-lapse, substrate reveal, `4` stamp |
| S6 | Crossing 1: evolve | 0:14 | CODE | + ghosted Drawing-Hands still (R2) composited |
| S7 | Crossing 2: type memory | 0:13 | CODE | panel template |
| S8 | Crossing 3: patterns | 0:15 | CODE | + faint replay of arithmetic beat |
| S9 | Crossing 4: event log | 0:14 | CODE | panel template |
| S10 | Domestication + hard hat | 0:27 | CODE + R4 still | formula is code-crisp; hard hat is a Reve cutout, drop animated in code |
| S11 | Loop fed back | 0:45 | CODE + V4 | wasp beat is the only Veo echo; other 3 beats CODE |
| S12 | The self | 0:18 | CODE | thickening strata, circulating current |
| S13 | Outro card | 0:09 | CODE | shares S1 terminal frame |

### Reve stills

World session: engraving/woodcut, old-book plate aesthetic — ink hatching,
paper texture, serif plate captions, no color except paper cream/ink black.
Lock with a world prompt, then generate:

- **R1 — paper plate texture**: blank engraved book-plate background (S4 base,
  S11 flicker).
- **R2 — Drawing Hands homage**: two hands rendered in monospace-character
  hatching, each drawing the other's cuff. Variant: one hand holding a pen
  poised over a small rectangular box (S6 ghost).
- **R3 — Shepard staircase**: spiral staircase whose steps are piano keys,
  rising through a tower and impossibly meeting its own base landing.
- **R4 — hard hat** (separate, non-engraving): studio-lit yellow construction
  hard hat on pure black, slight 3/4 angle — for cutout; drop is code-animated
  so the chalk formula stays crisp. *Stage-1 stop: still only, no Veo.*
- **R5 — sphex wasp**: woodcut digger wasp in profile walking, engraved
  ground circuit visible as a worn looping path.
- **R6 — arithmetic page**: engraved page densely set with digits and
  arithmetic. Background only — the digits-rearrange-into-sentence animation
  is a CODE overlay so the sentence is legible.

### Veo clips (image→video from the stills)

| Clip | From | Tier | Motion prompt (draft) |
|------|------|------|------------------------|
| V1 | R2 | **Quality** | "Engraved illustration. The two hands continue drawing each other, pen strokes appearing line by line. Camera locked. Subtle paper grain flicker. No new elements." |
| V2 | R3 | Fast | "Camera slowly orbits the spiral staircase upward; the staircase appears to rise forever while never leaving frame. Engraved line-art style, steady." |
| V3 | R6 | Fast | "Locked camera on the engraved page. Faint ink shimmer across the digits, as if the print is alive. Very subtle. No text changes." (text animation is CODE overlay) |
| V4 | R5 | **Quality** | "Woodcut wasp walks a tight closed circuit on the engraved ground, returns precisely to its start, repeats identically. Locked camera, loopable." |

Per skill guidance: 2 takes for the Quality clips, 1 take + retry-on-failure
for Fast; clips 4–8s, loopable where possible.

### VO segments (ElevenLabs)

13 segments, one per scene, text verbatim from the storyboard VO blocks.
Delivery: measured, documentary, slight dry wit for S3 "Yet." and S10.
Voice: Keith's pick or default narrator preset; settings logged in
`prompts/vo.md` once generated.

### Music stems (synthesized)

- `pulse.wav` — low synth pulse, ~52 bpm, scenes 1–3 / 5–9.
- `fugue-cadence.wav` — short contrapuntal figure resolving to a final chord
  (S3, reprised slower/warmer S12–13).
- `shepard.wav` — Shepard-tone rising canon, cut off mid-rise (S4).
- `pulse-fast.wav` — S11 quicker subdivision variant.
- `clunk.wav` — single soft percussive hit (S10 hard hat).

## Decision log (overnight autonomous run, 2026-06-10)

- **VO voice:** George (ElevenLabs premade) — the API key is TTS-only (no
  `voices_read`), so listing voices was impossible; chose from known premade
  IDs. Swap via `ELEVENLABS_VOICE_ID` in `.env` + rerun `tools/generate-vo.js`.
- **Measured VO total 321s vs storyboard 310s** — accepted the natural read;
  final cut ~5:47 with pads (`tools/timeline.json` is authoritative).
- **Recording approach:** scenes render on a 1920×1080 canvas as pure
  functions of time; `tools/record-scene.js` steps frames headlessly into
  ffmpeg (CRF 17). Deterministic, re-recordable.
- **ffmpeg was broken** (missing x265 dylib after a brew upgrade) — fixed via
  `brew reinstall x265`.
- **S4 plates carry placeholder ink sketches** under where Veo clips overlay,
  so the film survives any failed clip.
- **Hard hat:** code-animated drop using a Reve cutout if available, vector
  fallback otherwise — keeps the Gödel formula code-crisp either way.

- **Reve free-plan quota is daily (not hourly):** R1–R4 + variant landed
  (20 generations); R5 (wasp) and R6 (arithmetic) hit the wall — composer
  disabled until ~02:20 tomorrow. Workarounds applied: **R6 skipped** (the S4
  code layer already draws the digits→sentence beat; the Veo shimmer was
  optional), **R5 rerouted to Google Flow's built-in text-to-image** with the
  same engraving style block, then animated i2v as planned — image-first
  pipeline preserved, different image tool for one asset. Reve rerun prompts
  remain logged in `prompts/reve.md` if Keith prefers a Reve version later.

## Status

- [x] Keith: `media/video/.env` with `ELEVENLABS_API_KEY=`
- [x] Keith: logged into Reve + Google Flow in the `~/.chrome-claude` browser
- [x] VO segments generated + measured (13, George voice — `prompts/vo.md`)
- [x] Music stems synthesized (6 — `tools/make_music.py`)
- [x] Reve stills R1–R4 + R2b exported (R5/R6 hit daily quota — see decision log)
- [x] Veo clips: V1 delivered (Fast, credits didn't allow Quality); V2 replaced
      by Ken Burns on the R3 still; V3 skipped (code covers it); V4 replaced by
      in-scene paper-plate wasp vignette (credits exhausted — `prompts/veo.md`)
- [x] CODE scenes built + recorded (all 13, incl. S4 interlude)
- [x] Assembly + mix (`tools/assemble.js`; loudnorm to −16 LUFS)
- [x] **`build/corellia-strange-loop-v1.mp4` delivered — 5:47.5, 1080p30, QC'd**

### v2 candidates (when credits/quota return)
- Veo Quality takes for the Drawing Hands plate; a real Veo staircase climb
  and engraved wasp walk (prompts staged in `prompts/veo.md` / `prompts/reve.md`)
- Optional: re-voice with a custom ElevenLabs voice; tighten S10/S11 pacing

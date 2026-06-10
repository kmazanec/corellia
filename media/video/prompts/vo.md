# VO — as generated

- **Provider:** ElevenLabs, model `eleven_multilingual_v2`, output `mp3_44100_128`
- **Voice:** George (`JBFqnCBsd6RMkjVDRZzb`) — premade narrator. *Decision:* the
  API key is TTS-only (no `voices_read`), so voice listing was unavailable;
  George chosen from known premade IDs as the documentary-narrator default.
  Swap by setting `ELEVENLABS_VOICE_ID` in `.env` and re-running
  `tools/generate-vo.js`.
- **Settings:** stability 0.5 · similarity 0.75 · style 0.15 · speaker boost on
- **Levels:** mean ≈ −24 dB, peak ≈ −5 dB (clean, headroom for mix)
- **Text:** verbatim from `media/video-storyboard.md` VO blocks
  (`tools/vo-segments.json`)

## Measured durations → authoritative scene timings

| Scene | File | VO length | Storyboard est. |
|-------|------|-----------|-----------------|
| S1  | s01-cold-open.mp3      | 15.8s | 20s |
| S2  | s02-factory-in-60s.mp3 | 55.8s | 52s |
| S3  | s03-tame-hierarchy.mp3 | 27.8s | 31s |
| S4  | s04-hofstadter.mp3     | 35.0s | 34s |
| S5  | s05-twist.mp3          | 17.4s | 18s |
| S6  | s06-evolve.mp3         | 13.6s | 14s |
| S7  | s07-type-memory.mp3    | 13.0s | 13s |
| S8  | s08-patterns.mp3       | 16.1s | 15s |
| S9  | s09-event-log.mp3      | 15.3s | 14s |
| S10 | s10-hard-hat.mp3       | 34.1s | 27s |
| S11 | s11-loop-fed-back.mp3  | 53.8s | 45s |
| S12 | s12-the-self.mp3       | 17.6s | 18s |
| S13 | s13-outro.mp3          |  6.1s |  9s |
| **Total** | | **321.3s** | 310s |

*Decision:* measured VO runs ~11s over the storyboard total (S10 and S11 are
the long ones — dense text). Accepting the natural read; final cut lands
~5:35–5:45 with scene pads instead of the 5:10 target. Tightening pads beats
rushing the narration.

# Veo image-to-video generations (Google Flow)

Tool: Google Flow (labs.google/fx/tools/flow), Veo 3.1, image-to-video.

## How image-to-video was driven (this Flow build)
This Flow build routes any image attached to the prompt-bar's Start/End frame slot
into the **Nano Banana** image-editor (the model dropdown then only offers Nano
Banana, no Veo). The working Veo image-to-video path is:
1. Configure the composer: Video > Frames > Veo 3.1, 16:9, 1x (chip reads "Video").
2. Upload the still by a **trusted CDP drag-drop onto the canvas** (Flow's
   file-chooser "Upload media" silently no-ops under automation; and oversized
   files are rejected — see below).
3. On the uploaded image tile, open its "more" menu and click **"Animate"**.
   This sets it as the Veo Start frame and KEEPS the chip on "Video"/Veo.
4. Type the motion prompt into the Lexical editor (via CDP Input.insertText after
   focusing; Selection-API select-all + Backspace to clear), then click generate.

## Upload sizing
Source stills were 24 MB / 4864x3328 etc. — far too large; Flow rejects them.
Downscaled to 1920x1080 16:9 PNGs (center-cropped) for upload; originals kept.
- /tmp/r2-drawing-hands-1080.png, /tmp/r3-shepard-staircase-1080.png

## Credit constraint (IMPORTANT)
- Veo 3.1 **Quality** = 100 credits/clip: UNAFFORDABLE from the start
  ("You need more AI credits to complete this request"). So V1 ran on **Fast**.
- Veo 3.1 **Fast / Lite** and **Omni Flash** = 20 credits/clip.
- After V1's two Fast generations, the balance dropped **below 20 credits**, so
  ALL video models (Fast/Lite/Omni) now report insufficient credits.
  **V2 could not be generated — hard credit wall.**
- Exact remaining balance is not exposed in the DOM and the credits API is
  OAuth-gated, so a number could not be read. Screenshot of the wall:
  assets/stills/v2-credit-wall.png

## V1 — Drawing Hands  [DELIVERED]
- Project: 0618d222-2c68-4675-a43c-e9ac5f4ff3f0
- Source still: assets/stills/r2-drawing-hands.png
- Tier: **Veo 3.1 - Fast** (Quality unaffordable). 20 credits.
- Takes: 2 generations (first showed a transient "Failed" toast; a "Retry" was
  issued; both produced valid 8s clips). Saved the steadier take as the final.
- Output: assets/clips/v1-drawing-hands.mp4 (8.0s, 1280x720, h264) + the second
  take as assets/clips/v1-drawing-hands-take2.mp4
- Prompt: "Antique engraved book plate comes alive: the two hands continue drawing each other, pen nibs laying down fine ink hatching strokes line by line on each other's cuffs. Locked camera, no zoom. Subtle paper-grain flicker like an old print. Monochrome ink on cream paper, engraving style preserved exactly. No new objects, no color."

## V2 — Shepard staircase  [BLOCKED — insufficient credits]
- Project: 8102eef7-4c3a-463c-9798-afcd72b03b1c
- Source still: assets/stills/r3-shepard-staircase.png (uploaded, animated, prompt
  entered, frame attached) — generation blocked by the credit wall before submit.
- Intended tier: Veo 3.1 - Fast (20 credits).
- Prompt: "Antique engraving comes alive: a slow steady climb up the impossible piano-key spiral staircase — the view drifts upward along the stairs yet the tower never ends, loop-like. Engraved line art on cream paper preserved exactly, monochrome, subtle paper-grain flicker. Locked framing otherwise. No new objects, no color."

## Generations consumed
Total Veo generations submitted: **2** (both for V1). V2 submitted 0 (blocked).
Well under the 5-generation budget; the limit hit was credits, not the cap.

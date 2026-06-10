# Reve prompts — explainer video stills

Generated 2026-06-10 in app.reve.com ("Create from scratch" chat flow, project
auto-named per first prompt). UI settings applied via the Preferences menu in
the chat composer, before the first generation:

- Aspect ratio: **16:9**
- Count: **4 images** per generation
- Model/style settings: none exposed in the chat UI beyond the above; the
  engraving style was carried by a style block prepended to every prompt.

Style block used for R1–R3, R5, R6:

> Antique book plate engraving, woodcut style, fine cross-hatched ink lines on
> aged cream paper, 19th-century scientific illustration, monochrome black ink,
> slight paper grain, serif caption space at bottom.

## R1 — r1-paper-plate.png

Prompt (verbatim):

> Antique book plate engraving, woodcut style, fine cross-hatched ink lines on aged cream paper, 19th-century scientific illustration, monochrome black ink, slight paper grain, serif caption space at bottom. An empty engraved book plate: aged cream paper background, ornamental thin-line border frame near the edges, subtle paper texture and light foxing spots, completely empty interior with nothing else — no figures, no text, no objects.

4 variations generated; picked "Empty engraved plate II" (warmest aged paper,
thin ornamental corner border). Saved at native 5376x3072 (API webp converted
to PNG).

## R2 — r2-drawing-hands.png

Prompt (verbatim):

> Antique book plate engraving, woodcut style, fine cross-hatched ink lines on aged cream paper, 19th-century scientific illustration, monochrome black ink, slight paper grain, serif caption space at bottom. Homage to Escher's Drawing Hands: two human hands emerging from flat sketched shirt cuffs, arranged in a circle, each hand holding a pen nib that is drawing the other hand's cuff, a paradoxical self-drawing loop, the hands fully shaded with fine engraved cross-hatching while the cuffs remain flat unfinished outline drawing on the paper.

4 variations ("Self-drawing hands I–IV"); picked III — the two hands cross in a
circular arrangement, each pen genuinely on the other's cuff. Native 4864x3328.

## R2b — r2b-drawing-hands-pen.png

Prompt (verbatim):

> Antique book plate engraving, woodcut style, fine cross-hatched ink lines on aged cream paper, 19th-century scientific illustration, monochrome black ink, slight paper grain, serif caption space at bottom. Same self-drawing hands composition: two engraved hands with sketched flat cuffs arranged in a circle, but now one hand holds its pen poised directly above a small empty rectangular box drawn in plain thin lines on the paper between the hands, the box completely blank inside, the other hand still drawing the first hand's cuff.

4 variations ("Hands and empty box I–IV"); picked I — pen poised over a blank
centered rectangle, ornamental corner flourishes. Native 5120x3072.

## R3 — r3-shepard-staircase.png

Prompt (verbatim):

> Antique book plate engraving, woodcut style, fine cross-hatched ink lines on aged cream paper, 19th-century scientific illustration, monochrome black ink, slight paper grain, serif caption space at bottom. Wide 16:9 landscape composition. A spiral staircase inside a round stone tower seen in cutaway section, where every stair tread is a piano key — alternating white and black piano keys as the steps — winding upward around the central column and impossibly reconnecting with its own lowest landing like a Penrose endless staircase, an optical paradox, dense engraved cross-hatching on the stone walls.

4 variations ("Piano-key Penrose tower I–IV"); picked III — cutaway tower,
explicit black/white piano-key treads in a doubled impossible spiral, blank
scroll banner at bottom (no legible caption text). Native 5376x3072.

## R4 — r4-hard-hat.png (different style, photographic)

Prompt (verbatim):

> Studio product photograph of a single yellow construction hard hat on a pure solid black background, slight three-quarter angle, one soft key light from the upper left, gentle specular highlight on the dome, deep shadow falloff, nothing else in frame, no surface or table visible, photorealistic, wide 16:9 landscape framing with the hat centered.

4 variations ("Yellow hard hat I–IV"); picked IV — purest black background, no
floor sheen, clean hat silhouette, slight three-quarter angle. Native 5376x3072.

## R5 — r5-sphex-wasp.png — NOT GENERATED (quota)

Prompt that was queued when the limit hit (verbatim, for reuse):

> Antique book plate engraving, woodcut style, fine cross-hatched ink lines on aged cream paper, 19th-century scientific illustration, monochrome black ink, slight paper grain, serif caption space at bottom. Wide 16:9 landscape composition. A digger wasp (sphex) in precise side profile walking on engraved ground, in the style of an entomological plate, with a clearly visible worn circular path looping around and returning to a small burrow entrance in the soil, the path drawn as a single closed circuit with fine hatched shading, dotted footprints along the loop.

## R6 — r6-arithmetic-page.png — NOT GENERATED (quota)

Planned prompt (verbatim, for reuse):

> Antique book plate engraving, woodcut style, fine cross-hatched ink lines on aged cream paper, 19th-century scientific illustration, monochrome black ink, slight paper grain, serif caption space at bottom. Wide 16:9 landscape composition. A page from an antique mathematics book densely set with neat rows of digits and arithmetic expressions in old letterpress type, numerals only with no real words, slight ink irregularity and uneven impression, generous margins around the dense block of figures.

## Quota note

After the R4 generation (5 prompts × 4 images = 20 images total), Reve showed:
"You've reached your daily usage limit. You can wait until tomorrow when your
usage will be reset, or you can upgrade now to keep on jamming." and "You've
reached your daily limit under the Free plan. Upgrade to Pro to unlock 100x
more usage, or come back in 1 hour." The chat composer was disabled. Evidence:
`assets/stills/quota-limit-screenshot.png`. R5 and R6 remain to be generated
after the reset, in the same project ("Antique Engraved Book Plate",
project id e4028583-2586-4ae7-96a3-45ce58db184e) with the prompts above.

## Rerun attempt 2026-06-10 ~03:14–03:44 CDT — still quota-blocked

Returned to the project ("Antique Engraved Book Plate", album
`474663a4-5212-4e23-876b-0e74464be44b` at
`https://app.reve.com/albums/474663a4-5212-4e23-876b-0e74464be44b`) to send R5
and R6. The composer was still disabled. Waited ~30 minutes total (one 5-minute
wait plus a 20-minute reload-and-check loop polling every 60 s); the textbox
"Message" and Send button stayed `[disabled]` the whole time. The banner text
(verbatim, unchanged across every reload):

> You've reached your daily usage limit. You can wait until tomorrow when your
> usage will be reset, or you can upgrade now to keep on jamming.

> You've reached your daily limit under the Free plan. Upgrade to Pro to unlock
> 100x more usage, or come back in 24 hours.

Note the retry window changed from "come back in 1 hour" (at the original
02:20 limit) to "come back in 24 hours" — the free-plan reset appears to be
daily, not hourly. No generation requests were spent (one attempted `gen.js`
send failed on the disabled textbox before submitting anything). Evidence:
`assets/stills/quota-limit-screenshot-2.png`. R5 and R6 remain ungenerated;
the verbatim prompts above are still the ones to send once the quota resets.

## Download mechanics (for reruns)

The web UI's images are served from
`/api/project/<projectId>/image/<imageId>/url/filename/<imageId>?fit=contain&width=5376&quality=100`
(returns WebP at native resolution; converted to PNG locally with sips).
Generation list (names + output image ids) comes from
`/api/project/<projectId>/node?props=type:generation&...&include=id,name,created_at,output`.
Helper scripts in `media/video/tools/`: `gen.js` (send prompt), `pollgen.js`
(wait for N generations), `fetchimg.js` (save image by id), `listimgs.js`.

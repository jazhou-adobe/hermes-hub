# Imagery

Hermes carries almost no pictures. Its imagery is the board itself: strips, holders, bays, callsign chips, lamps and the deck plan. This page covers what may be drawn, icons, Agent identity marks, attachments that contain images, placeholders and file formats.

## What the imagery is

- **The board is the image.** Strips in holders, a bay grid, rails, jack fields and deck zones are drawn with layout and tokens, not illustrations.
- **Flat, engineered, token-coloured.** Lines take `--hh-border`; paper takes `--hh-strip` or `--hh-surface-card`; status marks take the holder roles; Agent marks take `--hh-agent-1` … `--hh-agent-6`. Every theme and world then recolours the drawing.
- **Used future.** Wear, stencil marks and engraved labels may appear on page edges, the empty bay floor and world identity surfaces. They never sit behind text the Human reads.
- **Meaning never rests on colour.** Words, positions and shapes carry it.

## Never

- AI sparkle or robot imagery, brains, glowing orbs, chat bubbles with faces.
- Stock photos of people or of terminals.
- Real military insignia, real aircraft silhouettes, real agency logos.
- Gradients on text, glass, neon bloom, scanlines, film grain, CRT noise.
- Vendor logos for Agent clients. The callsign text names the client; logos are trademarks Hermes does not need.

## Icons

- One icon set, from the preview's icon module, drawn on a consistent stroke and sized by `--hh-icon-size`.
- Icons are decorative (`aria-hidden="true"`) and sit beside a word. An icon-only button has an `aria-label` and a tooltip repeating it.
- Status icons: check (answered), hourglass (pending), hatch or slash (expired/cancelled), plug (connection), key (shortcut hints), paperclip (attachment), diff (diff attachment), file, link.
- Unicode symbols and emoji never stand in for icons. Keyboard keys are `<kbd>` text, not key-cap drawings.

## Agent identity marks

- An Agent is identified by its **callsign chip**: a small mark in its `--hh-agent-*` colour beside the callsign text in `mono`, on the card surface with a `--hh-border` boundary. Colour is assigned by a stable hash of the session id.
- An Agent avatar (`.hh-avatar`, `--hh-avatar-size-sm|md`) shows the first letter of the client kind in mono on `--hh-secondary`. It always sits beside the callsign text and is decorative.
- No generated faces, mascots or client logos.

## Images inside attachments

Agents may attach screenshots or diagrams to a Question.

- Show the image at its intrinsic ratio inside the attachment card, contained, never cropped.
- Alt text comes from the Agent. When the Agent sends none, the card says "No description from the Agent" under the image, and the image is announced by its file name.
- Large images open in a dialog at full size; the dialog's title is the file name.
- Images never become the only carrier of a Question: the Question text must stand on its own.

## Placeholders

- **Loading an attachment:** hold the final shape with a `.hh-skeleton` block and the words "Loading attachment…". The pulse stops under reduced motion; the words stay.
- **Missing or expired attachment:** a dashed card with the file icon, "Attachment not available", the file name and why ("The Agent's session ended").
- **Too large to preview:** file name, size and "Open raw" link; never a broken-image icon.

## Formats and sizes

| Kind | Format | Notes |
|---|---|---|
| Board drawings, icons, world emblems | SVG on tokens | Recolours with theme and palette |
| Agent screenshots | PNG or WebP as sent | Shown as attachments, not resized on the Hub beyond display |
| World textures | SVG or small tiled PNG | Page edges and bay floor only; never behind text |

- Every image has width and height or sits in a sized frame, so the bay does not jump when attachments load.
- Below-the-fold attachments load lazily.

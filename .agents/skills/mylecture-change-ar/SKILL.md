---
name: mylecture-change-ar
description: use this skill to change only the aspect ratio of an existing video index.html
---

You will change the aspect ratio of a given video index.html file.

First read the HTML contract so that you comply with it in the processs: `.agents\mylecture-contracts\html-input-contract.md`



# Input: 
1. an `index.html` or `resolved.html` file. 
2. target aspect ratio



# Workflow
- DO NOT change the original narration, animation, visual etc.
- First,  update the aspect ratio of the `.html` file in it's `window.__VIDEO_METADATA__.aspectRatio field`
- Your task is to reposition all the existing elements to fit in the target aspect ratio.
- You will also tinker with the font sizes. Because in the new aspect ratio the real font size viewable will change, font size may get too small or too large. Fix the font size to look big enough to be viewable in the current aspect ratio.

For portrait video assume video will be watched on mobile device and adjust font sizes accordingly. Don't tinker with font weight though.

- After adjusting the font sizes adjust element sizes, padding and position so that there is no overlapping elements, no text overflow.

# Font size guide:
## For landscape aspect ratio  
title/headers: 72px
subtitle: 52px
main teaching text: 44px
labels / notes / table text: 30px

- For SVG text:
axis labels: 34px
small crowded labels: 30px
big emphasis word: 126px

## For portrait aspect ratio
title/headers: 60px 
subtitle: 40px 
main teaching text: 34px 
labels / notes / table text: 26px

- For SVG text: 
axis labels: 28px 
small crowded labels: 22px 
big emphasis word: 100px

Absolute minimum font size: 20px (no text or label may go below this value under any circumstance).

* Use these exact CSS font-size values. Do not use clamp(), vw, vh, rem, em, transform: scale(), zoom, or responsive font sizing for text unless explicitly requested.

* For SVG text, avoid scaling SVG containers in ways that change apparent text size. 


# Deliverables
Default deliverables folder: the folder where the `index.html` or `resolved.html` is already in.
1. Updated file named as `<old-file-name>-AR-<x>-<y>.html`, where x:y is  the new aspect ratio. Example: `index-AR-1-1.html`  
# background color

# Font
- family: Arial

# Font size
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
title/headers: 84px 
subtitle: 56px 
main teaching text: 48px 
labels / notes / table text: 36px

- For SVG text: 
axis labels: 39px 
small crowded labels: 30px 
big emphasis word: 140px

Absolute minimum font size: 28px (no text or label may go below this value under any circumstance).

* Use these exact CSS font-size values. Do not use clamp(), vw, vh, rem, em, transform: scale(), zoom, or responsive font sizing for text unless explicitly requested.

* For SVG text, avoid scaling SVG containers in ways that change apparent text size.

# Margin
## For portrait aspect ratio like 9:16, 3:4 etc.: 
* Top 10% and bottom 20% shouldn't have any content to keep in the social media safezone. Subtitle should be placed between 75%-80% region from the top.
* But you can make repeating background structure take out the whole screen. 

## For landscape aspect ratios:
- Keep 5% margin all around.

# Transition

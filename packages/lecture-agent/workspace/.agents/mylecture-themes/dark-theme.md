# background color
complete black.

# font
- family: Arial
- font-weight: 400; /* normal */
* NOTE: Don't use bold fonts.

# font size

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


## more
You can use other fonts if appropriate in certain case.



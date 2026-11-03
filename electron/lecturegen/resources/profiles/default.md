# Theme
# background color
Solid, dark charcoal matte (#121212). No background grid, solid background.

# font
- family: Lato
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Geist+Pixel&family=Lato:ital,wght@0,100;0,300;0,400;0,700;0,900;1,100;1,300;1,400;1,700;1,900&family=Open+Sans:ital,wght@0,300..800;1,300..800&family=Playfair+Display:ital,wght@0,400..900;1,400..900&family=Roboto+Flex:opsz,wght,XOPQ,XTRA,YOPQ,YTDE,YTFI,YTLC,YTUC@8..144,100..1000,96,468,79,-203,738,514,712&display=swap" rel="stylesheet">

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

## For portrait aspect ratio (i.e. 9:16, 3:4 etc.)
title/headers: 84px 
subtitle: 36px 
main teaching text: 48px 
labels / notes / table text: 36px

- For SVG text: 
axis labels: 39px 
small crowded labels: 30px 
big emphasis word: 140px

Absolute minimum font size: 28px (no text or label may go below this value under any circumstance).

* Use these exact CSS font-size values. Do not use clamp(), vw, vh, rem, em, transform: scale(), zoom, or responsive font sizing for text unless explicitly requested.

* For SVG text, avoid scaling SVG containers in ways that change apparent text size.

- Top 10% and bottom 20% should have no content, to be in fb/insta reels safezone. Make no visible border though. The background should span the full screen though.

- Keep 5% margin on left and right, but again no border


## more
You can use other fonts if appropriate in certain case.


# Teaching style
Teach step by step with examples. Start with a great hook. 
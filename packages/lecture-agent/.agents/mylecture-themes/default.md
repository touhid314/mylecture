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


## more
You can use other fonts if appropriate in certain case.

# padding
- Every element (text blocks, cards, tables, shapes, images, SVGs) must have clear breathing room from its container edges and from neighboring elements — nothing should touch or crowd another element's boundary.
- Minimum padding inside any card, box, or bordered container: 5% of that container's own width/height, or 24px, whichever is larger.
- Minimum gap between sibling elements (columns, rows, grid items, stacked blocks): 3% of the slide width/height, or 20px, whichever is larger.
- Text must never touch its container's edge or another element's edge. Leave at least one line-height of space between wrapped text and the nearest boundary.
- Tables: cells need internal padding of at least 12px top/bottom and 16px left/right so text doesn't touch cell borders.
- Icons/labels paired with text need at least 12px gap between the icon and the text baseline.
- Respect the existing safe-zone margins above (top 10%, bottom 20%, left/right 5%) as the outermost padding for the whole slide — no element's padding calculation should push content into those zones.
- When in doubt, add more padding rather than less; cramped or edge-touching elements are a defect.
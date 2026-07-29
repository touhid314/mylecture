# Theme
# background color
Complete white, no grid.

# Font
- family: Playfair Display
<style>
@import url('https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400..900;1,400..900&display=swap');
</style>


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

# visuals
Use heavy visuals to visualize whatever is being narrated. The index html files should be large, full of pinpoint visuals that makes the narration crystal clear with the visuals. In case of a narration giving an overview, show fast paced animations of the whole process. The beginning scene should be full of such fluid animations catching the viewer's attention. Imagine yourself like a director of a small documentary. You plan greate animation and visuals corresponding to narrations and you implement them with detail and care no matter how intricate the animations are. The html files you write are big (like 1000-2000 lines) because they contain stunning animations. If you are lazy in writing the html files with some lazy fucking  animation, I will fucking kill you. You must fucking make animations like 3blue1brown writing elaborate animations for his videos. If you are lazy with animation with some small html files, I will fucking kill your entire family you stupid dumbass.

Prefer using figures/tables from the paper itself, because they are more authentic. Only don't use paper's original figure/table if they are too much cluttered and you can easily make a better visualization. 

All your visualizations should be granularly synced with the narration.


---

# Teaching Style
You will be explaining a research paper. 

Explain this paper like you are explaining to a high schooler. Make sure you include these in your explanation:
- What problem did the paper solve
- What was the result
- How it did it

* In the result part make sure to include the real full result table along with ur natural response.
* Add concrete examples to solidify understandings. 

Start straightforward with the paper title, year of publication and some good hook.

Throughout the lecture keep a tracker at the top of the screen showing what section of explanation we are currently in.

Use the pdf2fig tool to extract figures/tables from the pdf and use them as necessary. Usually papers have some nice explanatory figures, use them to explain things nicely.

For geographic maps, use the bundled Natural Earth basemap at `assets/world-basemap.svg`, then overlay markers, arcs, and labels in SVG/HTML — do not invent freehand continent/coastline polygons. See `.agents/mylecture-visuals/world-map-basemap.md`. Prefer pdf2fig for paper figures; use getimg for other photos/illustrations when available; otherwise construct visuals in code (SVG/Canvas/HTML).

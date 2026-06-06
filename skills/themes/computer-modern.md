# background color
complete black.

# font
- family: Computer Modern
    @import url('https://cdn.jsdelivr.net/npm/computer-modern@0.1.2/cmu-serif.css');

    body {
    font-family: "Computer Modern Serif", "Latin Modern Roman", "Times New Roman", serif;
    }

- font-weight: 400; /* normal */ 
* Don't use bold, just use bigger font.

## font size
title/headers: 72px
subtitle: 52px
main teaching text: 44px
labels / notes / table text: 30px

- For SVG text:
axis labels: 34px
small crowded labels: 30px
big emphasis word: 126px

* Use these exact CSS font-size values. Do not use clamp(), vw, vh, rem, em, transform: scale(), zoom, or responsive font sizing for text unless explicitly requested.

* For SVG text, avoid scaling SVG containers in ways that change apparent text size. 


## more
You can use other fonts if appropriate in certain case.



Make a video on the topic: {INSERT TOPIC HERE}

Approximate length: 1 minute
Aspect ratio: 9:16 (vertical)

Follow constrains at: docs\html-input-contract.md
Example output html: inputs\bloomfilter-modifier\index.html,
inputs\bsp-tree\index.html6, inputs\cnn-shorts\index.html

First make a detailed script of the visual and the exact audio transcript. Then act upon it to make the html file.

The html will later be rendered, you don't have to worry about the rendering process.

# Deliverables:
output folder: inputs/<topic-slug>/
outputs: 
- script.md: Detailed script of the visual and the exact audio transcript.
- index.html: The html file that will be rendered.
- description.txt: One liner description and hashtags for facebook/instagram upload.
- resolved.html: use the command `npm run build:plan -- --input path/to/index.html --out path/to/resolved.html` to generate the resolved html from the index.html. (you don't need to render, i will do this later.)

Additional instructions:
- In script.md while making timing plans, remember that it takes about 1 minute to say 140 words.
- Download and use relevant image from the internet if it helps to explain the topic better. 
- Follow the same theme as the example outputs.

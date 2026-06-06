---
name: mylecture-avsl
description: use this skill to write script for video using the AVSL (Audio-visual scripting language) language.
---

# This skill enables an AI agent to write proper AVSL script.

- Make sure that the details of the visuals is captured in complete detail, including the content/data of the visual, color, position etc. 
    - Full data should be added in the script for things like table, matrix or anything that has data inside.

- The visuals you plan will be executed by an AI agent with HTML+CSS+JS+SVG and other web technology. So plan accordingly. 

- Make sure you choose the position thinking what else are in the screen right now and the text or content don't overlap. While making the index.html also your highest priority is no overlap. 

- The first screen should have interesting relevant animations, and should not be static. Begin with visually showing what we will learn in the video.

- Use colors for highlighting in all cases. Don't use arrows, the animator AI agent has trouble putting arrow in proper position.

- There should be granual synchronization between narration and visual.
Example: 
    So we add {visual: highight 7} 7, {visual: highlight 90} 90 and get the result {visual: add 97} 97.
Similarly for all cases, add granual synchronization between narration and visual.

    - You MUST have some visual change within every about 15 words. So that, viewer's attention is kept. 

- Add example based visual. 

Example:
    Let's say we have a database table {visual: add table id:users_table content:"Table: users. Columns: [id, name]. Rows: [1, 'Alice'], [2, 'Bob']" duration:persist} And we add a column to it 
    {visual: update table id:users_table content:"Table: users. Columns: [id, name, email]. Rows: [1, 'Alice', 'alice@example.com'], [2, 'Bob', 'bob@example.com']" description:"Append a new column labeled 'email' to the right of the 'name' column. Highlight the new column in green to emphasize the addition."}

Notice how we visualized the narration with an examplary table.

- It's better to teach from one diagra, rather than switching between many screens.

# workflow
You should work in multi-pass system.
- First: write a basic script first.
- Second: Edit your script to add detail of the visuals like proper position for no overlap, exact data, exact color, etc.
- Finally: Revise your script. Make sure:
    - The visuals have enough detailed description for content, theme, and position reconstruction.
    - The positions of the contents do not overlap with each other.
    - Plus any other thing you wanna check.
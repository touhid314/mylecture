# Audio-Visual-Scripting-Language (AVSL) 
A scripting language to plan narration and visual of a lecture video.

## Core Idea
The script is 'spoken narration' + 'embedded visual directives'. 
- Plain text = what is spoken. 
- {visual: ...} = what appears or changes on screen.

## Basic visual Format 
`{visual: ACTION TYPE id:NAME [fields]}`

1. Actions
- `add`: create and display an element
- `remove`: delete an element
- `update`: modify existing element
- `move`: change position
- `highlight`: emphasize element
- `dim`: de-emphasize element
- `clear`: remove all elements in a region

2. Types
- Example: title, text, equation, bullet-list, diagram, arrow, label, etc. It is not limited to these options only.

3. fields
Common fields can be: 
- `content`: text or equation (use LaTeX if needed) or content of diagram.
- `description`: natural language
- `duration`: how long it stays
    values: 
    - `persist`: stays until removed.
      - Every persistent element must have an id. Future actions, reference elements using this id. 
    - `temporary`: disappears after the current segment
    
    Use id to track and update elements
- `position`: Use position with visuals when they are added. Position should be descrptive; like: "under the y axis", "center of the screen" etc.  


- `style`: visual emphasis
- `target`: part of element to affect
- `animation`: how it appears/changes
- `group`: optional grouping


## Example
  {visual: add title id:main_title content:"Proving h = O(log n)" duration:persist} We want to prove the height is logarithmic. {visual: add text id:goal content:"Goal: h = O(log n)" duration:temporary style:bold} Let h be the height of the tree. {visual: add equation id:h_def content:"h = \\text{height of tree}" duration:persist} Since the tree is balanced, we can update the definition to logarithmic height. {visual: update equation id:h_def content:"h = \\log n"}

## Avoid
- Vague references like “that text” or “previous diagram”
- Combining multiple actions in one directive






The script uses the AVSL language. The following tells how this language works, so act accordingly:

Core Idea: The script is spoken narration + embedded visual directives. Plain text = what is spoken. {visual: ...} = what appears or changes on screen.

Basic Directive Format: {visual: ACTION TYPE id:NAME [fields]}
Actions:
add → create and display an element
remove → delete an element
update → modify existing element
move → change position
highlight → emphasize element
dim → de-emphasize element
clear → remove all elements in a region

Required Rule:
Every persistent element must have an id
Future actions reference elements using this id
Common Fields:
content: → text or equation (use LaTeX if needed)
description: → natural language (for diagrams)
duration: → how long it stays
style: → visual emphasis
target: → part of element to affect
animation: → how it appears/changes
group: → optional grouping

Duration:
persist → stays until removed
temporary → disappears after the current segment

Interpretation Rules:
Maintain a current screen state
Apply directives in order as narration progresses
Do not guess — only act on explicit directives
Use id to track and update elements
Guide to positioning:
Notice that, the “add” actions do not contain any directives about position of the content to be added. You have to decide where to add components very carefully. Make absolutely sure whenever you add/update a new content it does not overlap with another previous content. 
You have to add contents in a nice coherent way. For example:
{visual: add h=(a+b)^2}.....{visual: add h=a^2+2ab+b^2}. These two components should be added one below another maybe with a “=>” sign, so that, the user can follow the flow.
Visual should precede speech, but with exact timing. For example: “So we can say: x = 52” -  in the screen “x = 52” should not appear before saying “So we can …”, rather it should appear after saying “So we can say”, then the text “x =52” appears on screen and then “x = 52” is spoken out.

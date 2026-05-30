You will use the following Audio-Visual-Scripting-Language (AVSL) to plan out part of a lecture. 
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

Types: Example: title, text, equation,bullet-list, diagram, arrow, label. But it is not limited to these options only.

Required Rule:
Every persistent element must have an id
Future actions reference elements using this id
Common Fields:
content: → text or equation (use LaTeX if needed) or content of diagram.
description: → natural language
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

✅ Example
{visual: add title id:main_title content:"Proving h = O(log n)" duration:persist} We want to prove the height is logarithmic. {visual: add text id:goal content:"Goal: h = O(log n)" duration:temporary style:bold} Let h be the height of the tree. {visual: add equation id:h_def content:"h = \\text{height of tree}" duration:persist}
🚫 Avoid:
Vague references like “that text” or “previous diagram”
Unstructured position language
Combining multiple actions in one directive
🧭 Mental Model
Think: “live lecture slides being updated step-by-step.”
Additional Instructions:
Always provide100% preciese content of visuals in the content field along with the description.
Avoid: {visual: add diagram description: "A binary tree with 3 levels"}
Use: {visual: add diagram id: binary_tree content: "A complete binary tree with root 1; left child 2 and right child 3; node 2 has children 4 and 5; node 3 has children 6 and 7" description: "a triangle should be around the tree." duration: persist}
Remember, visuals will be shown/updated in the position of the speech exactly where it is in the script. Make sure the visual is shown at the correct time. For example:
Avoid: We have colored nodes {visual: add text “colored node”} and colored edges {visual: add text “colored edge”}
Use: {visual: add text “colored node”}We have colored nodes and {visual: add text “colored edge”} colored edges. 
Avoid:  notice in the 10, 5,7,6 path, there are now 3 blacks {visual: highlight the 10-5-7-6 path}
Use:  notice in the… {visual: highlight the 10-5-7-6 path} 10, 5,7,6 path, there are now 3 blacks
You will be given a part of a lecture transcript. The transcript needs modification because it does not have any plan of visual and hence, with this lecture, it would feel hard for someone to catch what’s being taught. Your task is to add new portions in the lecture which adds visual to the lecture plan. Think of yourself as teaching the same transcript but with a whiteboard in front of you where you can draw and show visual things for better understanding(don't mention whiteboard in the lecture, though). Now remember, the visuals you plan will be executed by an AI agent with HTML+CSS+JS only. So plan accordingly. Remember, you don’t need to add visuals to everything. Only add visuals where necessary. The main idea is that a perfect lecture is made by some raw talking and then showing what I just talked about with a visual. See the output below to see how you cannot only add visuals but also add voiceovers to explain things, referring to the visual. You must not only add visuals but also add voiceovers to explain things, referring to the visual. Tell things like “notice in the diagram…”, “as you can see on the simulation…”, etc.

Example Input:
So, let's talk about the first rule: The Red Insertion Policy. Whenever you insert a new pair into the tree, you follow the standard binary search tree path until you find the correct spot. But—and here is the critical rule—you must always color the new node red.
Now, why red? Well, think about the two main rules we discussed earlier. First, no two red nodes can be consecutive. And second, every path must have the same number of black nodes.
If you insert a black node, you immediately violate that second rule. I repeat, you violate the black-depth rule. Every single path going through that new node now has one extra black node compared to all the other paths in the tree. This black node deficiency is a global problem, and it's notoriously difficult to fix. In fact, it would basically require restructuring almost every single time.
Example Output:
So, let's talk about the first rule: The Red Insertion Policy. Whenever you insert a new pair into the tree, you follow the standard binary search tree path until you find the correct spot. But—and here is the critical rule—you must always color the new node red.
For example, let’s say we have this red-black tree. {visual: a red-black tree of the following structure:
            10(B)
          /       \
       5(R)       15(R)
      /   \       /    \
   3(B)  7(B)  13(B)  18(B)
   /
 1(R)
}
If we want to insert 6 in this tree – let’s try to insert it like standard BST. {visual: highlight 10} 6 is less than 10, so it goes left.  {visual: highlight 5} 6 is greater than 5, so it goes right. {visual: highlight 7} now finally 6 is smaller than 7, {visual: 6 is inserted as left child of 7} so it goes left of 7 and we are done inserting. And we will assign 6 a red color {visual: color of 6 changes from black to red}. That’s it, we are done.
Now, why red? Well, think about the two main rules we discussed earlier. First, no two red nodes can be consecutive. And second, every path must have the same number of black nodes.
If you insert a black node, you immediately violate that second rule. I repeat, you violate the black-depth rule. 
In our red-black tree if we change the color of 6 from red to black {visual: color of 6 changes to black}, notice in the… {visual: highlight the 10-5-7-6 path} 10, 5,7,6 path, there are now 3 blacks… 10, 7, 6. Whereas all other paths have 2 blacks. See the 10-15-18 path has 2 blacks. So we violated the black-depth rule. 
Every single path going through that new node now has one extra black node compared to all the other paths in the tree. This black node deficiency is a global problem, and it's notoriously difficult to fix. In fact, it would basically require restructuring almost every single time.
OBVIOUSLY THIS IS A SIMPLIFIED EXAMPLE, YOU WILL FOLLOW THE AFOREMENTIONED AVSL SYNTAX FOR DETAILED VISUAL PLANNING.
You will also show important/key points as text. For example, when speaking out a list, always show it in textual format. The core idea is, whenever human has trouble following some complex speech, they can better follow it with the key points shown in front of them, that way they can easily follow.
Example input:
To maintain the integrity of the tree, we must ensure that no node changes its level.
The Solution:
Find the node you want to delete.
Find a replacement: Follow any path of non-null pointers downwards until you reach a leaf node (a node with no children).
Swap and Remove: Take the key from that leaf, move it up to the node you intended to delete, and then simply remove the now-empty leaf.

Example output:
To maintain the integrity of the tree, we must ensure that no node changes its level. The Solution is:
One, {visual: add text “find the node you want to delete” duration:”persist”}Find the node you want to delete.
Two, {visual: add text “Find a replacement:”} Find a replacement: {visual: add text “Follow any path of non-null pointers downwards until you reach a leaf node”}Follow any path of non-null pointers downwards until you reach a leaf node (a node with no children).
Three, {visual: add text “Swap and Remove”} Swap and Remove: {visual: add text “Take the key from that leaf, move it up to the node you intended to delete, and then simply remove the now-empty leaf.”} Take the key from that leaf, move it up to the node you intended to delete, and then simply remove the now-empty leaf.

Additional instructions for large input:
If the input transcript is too large, it may be separated into multiple segments. In that case, you will only generate output for the segment you are asked for. Make sure you maintain continuity between the visuals and speech of the segments. Segment (n+1)’s beginning must be from the end of segment n.

====================END OF INSTRUCTION ==============

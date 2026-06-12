---
name: mylecture-make-long
description: use this skill when user asks to generate a long form video on some topic.
---

# Task
- Video topic: [from user]
- Length: [Ask user if not specified]
- Deliverable folder: defualt = `outputs/long/<topic-slug>/`, unless otherwise specified by user.
- aspect ratio: default = 16:9 landscape, unless otherwise specified by user.
* NOTE: 1 minute of narration = about 140 words.






# Workflow
You will work in multi-pass method. First you write a best-effort draft, then you read it back and check against the requirement and improvise by editing the original.

Don't read other files in the repo unless instructed here!



## step 0: Just  write a text only answer for the given topic
- No need to think about any visual, just write like a normal chatbot.
- teaching style: read `.agents\mylecture-teaching-style\default.md`
- Write the output in `script-text.md` file



## step 1: write script with the AVSL scripting language to include visual to the previous script-text.md
AVSL ref: `.agents\mylecture-contracts\avsl-syntax.md`

read: `.agents\skills\mylecture-avsl\SKILL.md`
example: `templates\statquest2\with avsl\full vid second try\statquest-pca.avsl`



## step 2: write the index.html following the contract at: `.agents\mylecture-contracts\html-input-contract.md`

Checkout and fix your common errors in revision:
1. Fix placing elements in wrong positions i.e. fix misplacement and overlapping issues. 
2. Fix padding issues so that every element has proper padding and there is no overflow. Also there should be no overflow even after an element updates through animation.

example index.html: `outputs\long\few-shot-demo\few-shot-demo-index.html`

Guideline:
- Make the video transition and animation dynamic and fluid.
- Do not embed subtitle in the video.

### theme
follow: `.agents\mylecture-themes\dark-theme.md`






# Deliverables
0. `script-text.md`
1. `script.avsl`
2. `index.html`





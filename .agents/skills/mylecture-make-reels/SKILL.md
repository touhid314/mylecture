---
name: mylecture-make-reels
description: use this skill to make short form reels on a topic provided by the user.
---

# Task
Make a video on the topic: [from the user]

- Length: 130-140 words of narration.
- Aspect ratio: 9:16 (vertical)

# Workflow
You will work in multi step method. First you write a best-effort draft, then you read it back and check against the requirement and improvise by editing the original.

Don't read other files in the repo unless instructed here!

## Script writing
- First make a script of the visual and the exact audio transcript. Then act upon it to make the html file. Make the visual plan very detailed, so that the visuals can be regenerated exactly by any agent.
- Script is the most important part of the whole thing. Make sure the content is coherent, interesting and properly teaches a thing. 
- Write and plan visuals that is realizable with simple 2D svg and animations. Avoid unnecessary complexity and camera movement plans.
- If needed, Refer to visuals while explaining things, like: "As you can see here {highlight something}...". You need not follow this exact saying, but you should try to refer to the visual in the audio, with proper sync, so that the thing is easily understandable. 
- Script should start with a strong hook with a catchy introductory hook sentence and with a great hook visual.
- Remember that it takes about 1 minute to narrate 140 words.
- Script should also include plan of what image to add if needed. You can later on download and use relevant image from the internet if it helps to explain the topic better.
- Revise the script and check whether the length criteria is met, visual plan is detailed enough, if not, improvise by editing the script.

- Write script in the following format:
```
# Scene 1: <scene title>
Audio: <audio transcript>
Visuals: <detailed visual plan>

# Scene 2: <scene title>
Audio: <audio transcript>
Visuals: <detailed visual plan>

...continue 

End
```

## Webpage writing
- Now you will write a webpage to realize the script. 
- Animation sizes should be big enough to be easily visible by the viewer in phone.
- Write a best effort initial index.html, revise it and check against the theme requirement, and evaluate the overall quality yourself. Edit the index.html and make it better.
- Your main problem is often times, you place elements in wrong positions. For example a slider should go over the middle of a block, it's going over the top of the block for misplacement. In your revision make sure you fix such misplacement issues.
- Keep engaging animation with movement to keep viewer attracted. Especially in the first scene use great engaging animations and try to download and use some relevant image if possible for greater hook.

### Theme:
- background: #1e1e1e 
- font-family: 'Roboto', sans-serif;
- Font size: Content 42px, Subtitle 48px
- Titles are blue (#61AFEF), bold, centered, and boxed with a blue border. 
- Don't put content in: top 15%, bottom 20%. Center 65% = safe for key content. Because it will be uploaded to fb/insta/yt reels/shorts.
- Example theme: outputs\short\bloomfilter-modifier\index.html
### Constraint
- You should write the webpage following the constraints at: `.agents\mylecture-contracts\html-input-contract.md`
- Don't put any start button or overlay.
### Subtitle
- Embed subtitle.
- Subtitle should be exactly same as the audio transcript (don't use emoji), no concise version of what is being spoken.
- Caption style: white, centered near the lower third, with a strong black text shadow for readability.
- Subtitle should not overlap with other elements.
- Subtitle should be around 7-8 words and not long so that it overlaps with visuals.

# Example output html: 
- `outputs\short\bloomfilter-modifier\index.html`
- `outputs\short\bsp-tree\index.html`
- `outputs\short\cnn-shorts\index.html`


# Deliverables:
output folder: `outputs/short/<topic-slug>/`

outputs: 
- script.md: Detailed script of the visual and the exact audio transcript.
- index.html: The html file that will be rendered.
- description.txt: One liner description and hashtags(no more than 5 hashtags) for facebook/instagram upload.
## What not to deliver  
- You don't have to resolve. If later asked to resolve, use the command `npm run build:plan -- --input path/to/index.html --out path/to/resolved.html` to generate the resolved html from the index.html. 
- You don't need to render the resolved html. If later asked to render, use command: `npm run render:video -- --html path/to/index.html --resolved-html path/to/resolved.html --out path/to/output.mp4`

# when you are done
open the viewer with the generated html file.
read: `.agents\skills\mylecture-render-pipeline\SKILL.md`

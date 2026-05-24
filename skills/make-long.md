# Task
Make a video on the topic: {dijkstra's algorithm}

- Length: {750-800} words of narration.
- Aspect ratio: 16:9 (landscape)

# Workflow
You will work in multi pass method. First you write a best-effort draft, then you read it back and check against the requirement and improvise by editing the original.

Don't read other files in the repo unless instructed here!

## Script writing
- Pass 1:
    - You only list all the scenes with a one liner description of what the scene is about.
    example: 
    ```
    # Scene 1: Introduction
    - Hook: "What is CDN?", Definition of CDN, Problem that CDN solves

    # Scene 2: How CDN works
    - Working principle of CDN, Architecture of CDN, Benefits of CDN
    ...
    ```
- Pass 2:
    - You write detailed audio and visual script of scene 1
    example:
    ```
    # Scene 1: Introduction
    audio: when we do this ....
    visual: ...

    audio: now let's look at this...
    visual: ...

    audio: ...
    Visual: ...

    ...

    # Scene 2: How CDN works
    - Working principle of CDN, Architecture of CDN, Benefits of CDN
    ...
    ```
- Pass 3:
    - write similarly detailed script for scene 2

and proceed accordinlgy until all scenes are completed.
- IMPORTANT: for a scene, try to plan like this: 1-2 sentence audio, associated visual, ...


- First make a script of the visual and the exact audio transcript. Then act upon it to make the html file. Make the visual plan very detailed, so that the visuals can be regenerated exactly by any agent.
- Script is the most important part of the whole thing. Make sure the content is coherent, interesting and properly teaches a thing. 
- Write and plan visuals that is realizable with simple 2D svg and animations. Avoid unnecessary complexity and camera movement plans.
- If needed, Refer to visuals while explaining things, like: "As you can see here {highlight something}...". You need not follow this exact saying, but you should try to refer to the visual in the audio, with proper sync, so that the thing is easily understandable. 
- Script should start with a strong hook with a catchy introductory hook sentence and with a great hook visual.
- Remember that it takes about 1 minute to narrate 140 words.
- Revise the script and check whether the length criteria is met, visual plan is detailed enough, if not, improvise by editing the script.

- Write script in the following format:
```
# Scene 1: <scene title>
audio: <audio transcript>
visual: <detailed visual plan>

audio: 
visual:
...
# Scene 2: <scene title>
Audio: <audio transcript>
Visuals: <detailed visual plan>
...

...continue 

End
```

## Webpage writing
- Now you will write a webpage to realize the script. 
    - Pass 1: 
        - You only write the basic structure following the constraints, setup the scenes, background, fonts, no animations. 
    - Pass 2: 
        - You start filling up the details of scene 1. Add animations, transitions, voiceover etc.
    - pass 3:
        - similarly for scene 2.
    similarly continue until all scenes are done for.


- Animation sizes should be big enough to be easily visible by the viewer in phone.
- Write a best effort initial index.html, revise it and check against the theme requirement, and evaluate the overall quality yourself. Edit the index.html and make it better.
- Your main problem is often times, you place elements in wrong positions. For example a slider should go over the middle of a block, it's going over the top of the block for misplacement. In your revision make sure you fix such misplacement issues.
- Keep engaging animation with movement to keep viewer attracted. Especially in the first scene use great engaging animations and try to download and use some relevant image if possible for greater hook.

### Theme:
- background: #1e1e1e 
- font-family: 'Roboto', sans-serif;
- Font size: Titles: 36 pt
  Body Text: 28 pt
  Minimum (Never go below): 18 pt
- Titles are blue (#61AFEF), bold, centered.

### Constraint
- You should write the webpage following the constraints at: docs\html-input-contract-v0_1.md
- Don't put any start button or overlay.
### Subtitle
- DON'T Embed subtitle.


# Deliverables:
output folder: inputs/<topic-slug>/
outputs: 
- script.md: Detailed script of the visual and the exact audio transcript.
- description.txt: One liner description for facebook/instagram upload.
- index.html: The html file that will be rendered.

## What not to deliver 
- You don't have to resolve. If later asked to resolve, use the command `npm run build:plan -- --input path/to/index.html --out path/to/resolved.html` to generate the resolved html from the index.html. 
- You don't need to render the resolved html. If later asked to render, use command: `npm run render:video -- --html path/to/index.html --resolved-html path/to/resolved.html --out path/to/output.mp4`

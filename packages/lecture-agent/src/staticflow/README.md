npm run static-flow -- --workspace "D:\mylecture\mylecture-ide\staticflow-gens" --length 1:00 --aspect-ratio 9:16 --no-getimg "make a video explaining The Brachistochrone Curve. This is for fb reels so keep 10% on the top and 20% on the bottom as no content safezone."


# 
The hypothesis is that, for the task in hand, a static workflow agent would be much better than the current flexible coding agent that we have in place. The reason is that the generation pipeline is almost completely static, and in many cases it's hard to tier the agent through a prompt. It's better handled by just a programmatic workflow. And also, such a static workflow would make the whole thing much more token-efficient and generation less costly. 


# plan

## steering external inputs
1. user-prompt
    - video request (includes attachment)
    - aspect ratio
    - generation length
2. theme
3. teaching-style

## tasks
1. script-writing (**ANSWERGEN LLM**, **SCRIPTWRITER LLM**)
2. animation (*ASSET-FETCHER*, **ANIMATOR LLM**)
3. editing (agent with read, write, edit, del, listdir, mkdir, getimg tool)

## workflow
1. script-writing  
`user-prompt (video request + generation length)` + `teaching-style` > **ANSWERGEN LLM** > `answer`


then, 


`user prompt(video request, )` + `answer` + `theme` + `teaching-style` >  **SCRIPTWRITER LLM** > `script`




2. animation  
`script` > *ASSET-FETCHER* > `asset files` + `asset description`
* NOTE: script should name out all the images, img will be downloaded in the script requested name
* asset description: is the path/name of the asset available, resolution or any other necessary info that the llm will need to know.


then, 


`user prompt(video request + aspect ratio + generation length)` + `script` + `theme` + `teaching-style` + `asset description` + `html-input-contract` + `previous-htmls`> **ANIMATOR LLM** > `index[].html`
* NOTE: animator's output html file shall be run by the validator hook to check whether it satisfies the contract, if doesn't satisfy, the animator should be in a loop, asked too edit the file in the edits tool format we have now, to edit the file to be contract compliant. in this case the animator llm is further provided the validator's output and a request of edit in the edits tool format.
* there will be mutiple html files as output. the system should auto parse the script and hand out to the animator llm a block containing 75 words of narration. we need a script-trimmer module to do this. 
* the animator will be shown all of it's previous generation, so that it's aware 
of the current generation so far and can generate in continuation. 

3. editing  
TODO

## Implementation

The static flow is implemented by:

- `answer_generator.ts` — runs the existing answer-generator prompt and writes `answer.md`.
- `script_writer.ts` — runs the existing script-writer prompt and writes `script.md`.
- `asset_fetcher.ts` — resolves the script's `getimg` requests into local image files and reports their paths and dimensions.
- `script_trimmer.ts` — intelligently partitions complete narration/visual beats into sequential blocks targeting 30–75 narration words.
- `animator.ts` — generates one HTML file per block, validates it, and requests edits-format repairs until it passes.
- `index.ts` — executes those stages in order and exposes the one-shot session used by the CLI.

Animation runs sequentially. Each animator call receives the current script block and retains the full generation/repair history for every earlier validated HTML file. Visual-description words do not count toward chunk size. The trimmer avoids chunks below 30 narration words when the whole script has at least 30 words; if beat boundaries make a 30–75 partition impossible, it prefers an oversized chunk rather than an undersized tail. `metadata.json` is written separately after all HTML files pass validation.

All animator generation and validator-repair calls share one retained LLM session. This preserves an identical growing request prefix across calls so provider prompt caching can apply. Previous HTML is not pasted into the newest prompt a second time because it is already present in retained history. The answer generator and script writer remain separate one-shot LLMs because they use different system prompts.

For a direct one-shot run from the repository root:

```powershell
npm run static-flow -- "Create a two-minute lecture about binary search"
```

Use `--workspace <directory>` to choose the parent workspace. Every CLI run creates a unique timestamp-and-ID generation folder inside it. That folder contains `answer.md`, `script.md`, `metadata.json`, all `index*.html` files, downloaded assets, and copied user attachments.

Pass `--no-getimg` to forbid image requests in the script and skip the asset-fetcher stage. In this mode, the script writer is instructed to use HTML/CSS/SVG/Canvas or user-supplied attachments instead.

The CLI is intentionally one-shot. Run the command again for another generation. IDE integration and editing/follow-up turns are not part of this implementation yet.




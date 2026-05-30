Make a game to teach a topic : {binary search tree insertion}

Don't read other files in the repo unless instructed here!


# Contract
Strictly follow this contract: `contract\html-input-contract.md`

game.html will only contain game segment, no other types of segment.





# Theme
- Font: Chakra Petch
- Retro-futuristic arcade vibe
Reference file: `outputs\long\how-dijkstras-algorithm-works\game.html`






# Must contain 
the following functions and buttons:
- rules
- hint
- pass
- restart

Should start with a mission briefing.





# Vibe
- Make the game like a guided experience like a guide saying things in a game. e.g. "Great job, now we gotta do ___, for that we need __, let's move on with ...", Something like this. 
- The game texts should not be very formal, rather casual and friendly and funny. 
- At the end, show the final score and based on the final score tell something to the player.





# SFX
- Add audio directly in `game.html` with relative paths from the game output folder to `assets\sfx\`.
- Background music: use `assets\sfx\game-bg-music.wav`. Play it once when the mission/game starts. Do not loop it.
- Button click SFX: use `assets\sfx\mouse_click.wav` for all button clicks, including rules, hint, pass, restart, submit, close, and play again buttons.
- Win/finish SFX: use `assets\sfx\game-win.wav` when the game is finished and the final score/result screen is shown.
- Error SFX: use `assets\sfx\error.mp3` for wrong answers and invalid submissions.
- Use small playback helpers so SFX can restart cleanly on repeated actions, e.g. reset `currentTime = 0` before `play()`.
- Catch and ignore browser autoplay promise errors with `.play().catch(() => {})`.
- Pause active audio inside `window.__STOP_GAME__` so sounds do not continue after the game segment is hidden.





# Scoring rule
- correct answer = +100
- wrong answer = -50
- hint = -10
- pass = -30





# deliverables
Put deliverables inside `outputs/long/game-<topic-slug>/` folder
1. game.html

# when you are done
open the viewer with the generated html file.
read: `skills\skill-resolve-render.md`
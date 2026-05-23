# resolve command:
`npm run build:plan -- --input path/to/index.html --out path/to/resolved.html`

# If asked for render:
## render command
`npm run render:video -- --html path/to/index.html --resolved-html path/to/resolved.html --out path/to/output.mp4`

default preferred output path is the folder of the input html

- Full render command with every available option:
`npm run render:video -- --html inputs/bloomfilter/index.html --out inputs/bloomfilter/output.mp4 --fps 30 --width 1080 --height 1920 --frames-dir .render/frames --frame-format jpeg --jpeg-quality 90 --workers 8 --video-codec auto --x264-preset veryfast --resolved-html inputs/bloomfilter/resolved.html --tts-provider kokoro --tts-voice am_puck --tts-speed 1.5 --force-audio --color-range tv`

- For changing voice/speed, the important part is:
`--tts-voice am_puck --tts-speed 1.2 --force-audio`

## preferred voice
`--tts-provider kokoro --tts-voice am_puck --tts-speed 1.3 --force-audio`
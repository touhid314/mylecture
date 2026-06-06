# opening the viewer:
`npm run view --open`

## open viewer with a file:
`npm run view -- --file path/to/file.html --open`


# resolve command:
`npm run build:plan -- --input path/to/index.html --out path/to/resolved.html`

# render command
`npm run render:video -- --html path/to/index.html --resolved-html path/to/resolved.html --out path/to/output.mp4`

default preferred output path is the folder of the input html

- Full render command with every available option:
`npm run render:video -- --html outputs/bloomfilter/index.html --out outputs/bloomfilter/output.mp4 --fps 60 --width 1080 --height 1920 --frames-dir .render/frames --frame-format jpeg --jpeg-quality 90 --workers 8 --video-codec auto --x264-preset veryfast --resolved-html outputs/bloomfilter/resolved.html --tts-provider kokoro --tts-voice af_heart --tts-speed 1 --force-audio --color-range tv`

- For changing voice/speed, the important part is:
`--tts-voice af_heart --tts-speed 1 --force-audio`

## preferred voice
`--tts-provider kokoro --tts-voice af_heart --tts-speed 1 --force-audio`

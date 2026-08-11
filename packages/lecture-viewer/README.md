# @mylecture/lecture-viewer

Reusable viewer runtime for contract-compliant lecture HTML.

This package is split into two concerns:

- `src/player/index.ts`: the reusable player core.
- `../../src/ui/viewer-html.ts`: the local IDE UI shell used by `src/ide-server.ts`.

The player core can be embedded by an IDE, website, or custom app. The local viewer UI is only one host around that core.

## HTML Contract

The loaded HTML must follow the repo contract in `docs/html-input-contract.md`.

At minimum, the document should expose:

```js
window.__VIDEO_METADATA__;
window.__VIDEO_PLAN__;
window.__RENDER_SECTION__;
```

Resolved HTML may also expose renderer-generated timeline globals such as `window.__RESOLVED_TIMELINE__`.

## Player Core

Use `createLecturePlayer()` when you want to build your own UI.

```js
import { createLecturePlayer } from '@mylecture/lecture-viewer/player';

const player = createLecturePlayer({
  iframe: document.querySelector('#preview'),
  subtitleElement: document.querySelector('#subtitles'),
  resolveSrc: src => src
});

await player.load('/lessons/example.html?export=1&viewer=1');

player.play();
player.pause();
player.seek(12.5);
player.seekBy(5);
player.setSpeed(1.25);
player.setSubtitlesEnabled(true);
player.setLiveTtsEnabled(false);
```

### Options

```js
createLecturePlayer({
  iframe,
  subtitleElement,
  resolveSrc,
  subtitlesEnabled,
  liveTtsEnabled,
  speed,
  onStatus
});
```

- `iframe`: required iframe element that will load the contract HTML.
- `subtitleElement`: optional element where viewer-owned subtitles are rendered.
- `resolveSrc`: optional function that maps `player.load(src)` to the actual iframe URL.
- `subtitlesEnabled`: optional boolean, defaults to `true`.
- `liveTtsEnabled`: optional boolean, defaults to `true`.
- `speed`: optional playback speed, defaults to `1`.
- `onStatus`: optional callback for host-visible status messages.

### Events

```js
player.on('ready', state => {});
player.on('statechange', state => {});
player.on('timeupdate', state => {});
player.on('ended', state => {});
player.on('status', message => {});
player.on('error', error => {});
```

Common state fields:

```js
{
  loaded,
  playing,
  duration,
  time,
  metadata,
  timeline,
  audioTimeline,
  subtitleTimeline,
  resolved,
  subtitlesEnabled,
  liveTtsEnabled,
  speed
}
```

## Local Server

The package does not require `src/ide-server.ts` or the repo-local UI in `src/ui/`.

That script is a repo-local development host. It provides browser access to local files and conveniences that are not part of the reusable player core:

- `/files/...` serves local HTML and assets.
- `/lecture-viewer/...` serves this package's browser modules.
- `/pick` opens the Windows file picker.
- `/viewer-state` and `/open-file` let CLI invocations update an existing viewer.

For a website, serve the player module and lecture HTML from your normal web server. For an IDE, let the extension/webview host provide the HTML URL and wire commands to the player API.

## Public Exports

```js
import { createLecturePlayer } from '@mylecture/lecture-viewer/player';
```

The package root also re-exports the player helpers.

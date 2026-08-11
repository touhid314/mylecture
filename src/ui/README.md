# IDE UI structure

`viewer-html.ts` normalizes server configuration and assembles the UI fragments.

## Markup

- `components/left-sidebar.ts` — folder browser and resolve/render/publish controls.
- `components/player-area.ts` — preview frame, playback controls, and scene timeline.
- `components/right-sidebar.ts` — lecture-agent chat and generation settings.
- `components/dialogs.ts` — narration, visual-edit, metadata, and publish dialogs.

## Browser controllers

- `controllers/player-controller.ts` — playback, loading, fullscreen, and preview state.
- `controllers/timeline-controller.ts` — scene timing, seeking, playhead, and preloading.
- `controllers/file-browser-controller.ts` — folder/file lists and scene tabs.
- `controllers/lecture-actions-controller.ts` — resolve, render, publish, and metadata actions.
- `controllers/agent-controller.ts` — agent chat, attachments, and generation settings.
- `controllers/player-editor-controller.ts` — narration and visual-edit workflows.
- `controllers/shell-controller.ts` — shared DOM handles and panel state.
- `controllers/ui-helpers.ts` — common formatting, status, and document-preview helpers.
- `controllers/event-bindings.ts` — DOM event registration.
- `controllers/bootstrap.ts` — initial page startup.

## Styling

Styles are grouped under `styles/` by the same visible areas: base shell, left sidebar,
player, dialogs, timeline, and agent sidebar.

All fragments are concatenated in their original order into one self-contained HTML
document. Browser-controller files are script fragments, so their declarations share
the same browser module scope after assembly.

# Releasing MyLecture

## The pipeline

`.github/workflows/release.yml` runs on every `v*` tag (and manually from the Actions tab):

| Job | Runner | Output |
| --- | --- | --- |
| Windows x64 | `windows-latest` | NSIS installer + portable `.exe` |
| macOS Apple silicon | `macos-latest` | `.dmg` + `.zip` (arm64) |
| macOS Intel | `macos-15-intel` | `.dmg` + `.zip` (x64) |

Each job runs the unit tests, packages the app, then **launches the packaged app** with
`--smoke-test` and `MYLECTURE_SMOKE_DEEP=1`. The app must boot into Create, synthesize a
sentence with Kokoro, run the bundled ffmpeg and validate a scene in the bundled browser.
A tag build ends with a **draft** GitHub Release; check it, then publish it.

The version comes from the tag (`v1.0.0` → `1.0.0`).

## In-app updates

Installed copies check `<server>/updates` (the server in `../mylecture-app-admin/server`,
backed by the `mylecture-releases` R2 bucket; address in `electron/server-config.json`) once when the app starts
(no polling while it runs). Nothing reaches users until you publish:

1. Bump `"version"` in `package.json` (users are only prompted for a **higher** version).
2. Build: `npm run dist:win` (and/or put the macOS `.dmg`/`.zip`/`latest-mac.yml` from the
   GitHub Actions artifacts into `dist/`).
3. Try the installer yourself.
4. `npm run release:publish` uploads that version's installers, then `latest.yml` /
   `latest-mac.yml` last. Credentials come from `../mylecture-website/.env` (`R2_*`).

What users see:

- **Windows (installer)**: the update downloads in the background; then a prompt
  "Update available" → **Update now** restarts into the new version. **Later** installs it
  when they close the app. If a video is generating/rendering, they are asked first.
- **Windows portable `.exe` and macOS**: the prompt's **Update now** downloads the new
  installer in the browser. (Unsigned macOS apps cannot replace themselves; once the Mac
  build is signed and notarized this can become automatic.)

To roll back, publish a new higher version; updates never downgrade.

## Signing (optional, add when ready)

Without certificates the pipeline still produces working builds:

- **Windows** — unsigned. SmartScreen shows "Windows protected your PC" → *More info* → *Run anyway*.
- **macOS** — ad-hoc signed, not notarized. First launch: right-click the app → *Open* → *Open*
  (or `xattr -dr com.apple.quarantine /Applications/MyLecture.app`).

To remove those warnings, add these repository secrets:

| Secret | What |
| --- | --- |
| `MAC_CERT_P12_BASE64`, `MAC_CERT_PASSWORD` | "Developer ID Application" certificate (.p12, base64) — needs the Apple Developer Program ($99/yr) |
| `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` | Notarization (with the certificate above) |
| `WIN_CERT_P12_BASE64`, `WIN_CERT_PASSWORD` | Windows code-signing certificate |

## Testing the macOS builds without a Mac

- **Every build is already tested on a real Mac.** The GitHub macOS runners launch the packaged
  app and exercise speech, ffmpeg and the scene checker. A green job means the app starts and
  works on that architecture.
- **Interactive testing (clicking around):** a VM on this Windows PC is not a real option —
  Apple's license only allows macOS VMs on Apple hardware, and unofficial "Hackintosh" VMs
  are unreliable for GPU/Electron apps. Practical options:
  - Rent a cloud Mac by the hour: **AWS EC2 Mac** (24-hour minimum), **Scaleway Apple silicon**
    (hourly), or **MacinCloud** (monthly). Connect over VNC/Remote Desktop and install the `.dmg`.
  - Remote into the Actions runner for a debugging session with an action such as
    `mxschmitt/action-tmate` (terminal only).
  - Borrow any Mac (an Apple-silicon Mac can also run the Intel build via Rosetta).
- **What can differ on a Mac**, worth checking by hand once: the agent CLIs must be found
  (the app reads the login shell's `PATH`, plus Homebrew and `~/.local/bin`), OmniVoice needs
  `python3`, and the Windows-only system voice is not available (Kokoro is the default).

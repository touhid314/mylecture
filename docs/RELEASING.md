# Releasing MyLecture (Windows)

Releases are Windows-only for now. Users download the installer from the website, which
links to `https://mylecture-server.touhid3-1416.workers.dev/download/windows`. That link always
points to the newest published installer, so the website never needs editing per release.
Installed copies check for updates once at startup and offer **Update now**.

## Release a new version

```powershell
cd D:\mylecture\mylecture-app
npm version patch --no-git-tag-version   # 1.0.0 -> 1.0.1 (or minor / major)
npm run release:build                    # tests, Windows build, launches the packaged app
```

`release:build` leaves `dist\MyLecture-<version>-win-x64.exe` (installer),
`dist\MyLecture-<version>-win-x64-portable.exe` and `dist\latest.yml`. Install it once and try it.
Then:

```powershell
npm run release:publish                  # uploads to R2; users are offered it from now on
git commit -am "Release <version>"
git tag v<version>
git push origin main v<version>
```

`release:publish` uploads the installers first and `latest.yml` last, so nobody is offered a
half-uploaded release. Credentials come from `../mylecture-website/.env` (`R2_*`); they never go
into the app. Users are only offered a **higher** version than they have; to roll back, publish
a new higher version.

Pushing the tag also runs `.github/workflows/release.yml`, which rebuilds on a clean Windows
machine, launches the packaged app, and publishes a GitHub Release with the installers.
A GitHub Release alone does not reach users: only `release:publish` updates installed copies
and the website download link.

## What users see

- **Installer build**: the update downloads in the background, then "Update available" →
  **Update now** restarts into the new version. **Later** installs it when they close the app.
  If a video is generating or rendering, they are asked first.
- **Portable `.exe`**: **Update now** downloads the new portable `.exe` in the browser.
- Windows SmartScreen warns about unsigned installers ("More info" → "Run anyway") until a
  code-signing certificate is added (below).

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

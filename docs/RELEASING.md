# Releasing MyLecture

Official releases target Windows 10/11, 64-bit. The release workflow builds and tests Windows x64 installers and portable executables.

The same workflow builds macOS for Apple silicon and Intel. Every platform installs Hermes from the packaged source in a fresh profile, automatically selects a model from a local test API, writes files in two separate projects, and checks that an outside-project write is refused. This uses the real Hermes runtime without a paid API key. macOS packages are ad-hoc signed unless release signing credentials are configured; the website's Mac installation command installs the matching build.

The Hermes check forces a private Python download even when the runner has Python installed. Cryptography must install from a wheel, so the runner's Rust compiler cannot hide a missing end-user dependency. Upstream cryptography 50.0.2 does not ship Intel Mac wheels; `hermes-intel-wheels.yml` builds that exact version with static OpenSSL, checks its native import, and uploads a wheel artifact. The verified wheel is hosted under `/updates/` on our release server. `scripts/hermes-wheels.json` records its URL, SHA-256 and size, and the bundler supplements Hermes's lock with it. When updating Hermes, rebuild and publish the wheel if its pinned cryptography version changes; do not downgrade the dependency to obtain an older wheel.

To run the app without packaging it, see [Getting started from source](GETTING_STARTED.md).

## Publish a GitHub release

Start from the repository root with the intended app changes committed:

```powershell
npm ci
npm test
npm version patch --no-git-tag-version
$releaseVersion = node -p "require('./package.json').version"

git add package.json package-lock.json
git commit -m "Release $releaseVersion"
git tag "v$releaseVersion"
git push origin main "v$releaseVersion"
```

In GitHub Actions, wait for **Release** to finish successfully. The workflow runs these jobs, in parallel where they don't depend on each other:

1. **Unit tests** on Windows, Apple silicon and Intel Macs (including real MP4 aspect-ratio checks), each in its own job alongside packaging.
2. **Windows x64**, **macOS Apple silicon**, **macOS Intel**: package the app, then start the packaged app and check speech synthesis, speech recognition, bundled ffmpeg and scene validation, and install and exercise the packaged Hermes source. The Windows installer and the Mac DMG/ZIP are built from the same packaged app these checks run.
3. **Windows x64 portable**: packages the portable app from the same commit in a separate job, because its single-file compression alone takes about three minutes.
4. **GitHub Release**: only after every test and build job passes, publishes the files to a GitHub Release.
5. **Update feed**: verifies the same files and publishes them to the in-app update feed (see below).

Electron and electron-builder's tools, the pinned Hermes source zip and the smoke test's checksummed speech models are cached between runs; nothing that is checked is skipped because of a cache.

Assets include `MyLecture-<version>-win-x64.exe`, the `-portable.exe`, the installer's `.blockmap`, and `latest.yml`. Try the installer and a representative video generation/render before announcing the release.

Running **Release > Run workflow** on `main` builds and checks downloadable artifacts without publishing a release.

## Website downloads

The homepage uses this permanent URL:

https://mylecture-server.touhid3-1416.workers.dev/download/windows

The Worker redirects to the Windows installer in the latest published GitHub release, with a 60-second lookup cache. GitHub serves the file and records its asset download count. No website edit or R2 upload is needed to update this link.

Download counts belong to individual assets. Save historical counts before deleting old releases.

## Publish the in-app update feed

Installed apps use a separate Cloudflare R2 update feed. The Release workflow's **Update feed** job publishes it automatically after the GitHub Release is created: it runs `scripts/publish-update.mjs` on the release files, which first verifies them (every file `latest.yml` lists must be present with its size and SHA-512, and the portable download must be there), then uploads the installers and `latest.yml` last.

The job needs three repository secrets (**Settings > Secrets and variables > Actions > New repository secret**), the same values as in the website's local `.env`:

- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`
- `R2_ENDPOINT` (the `https://<account-id>.r2.cloudflarestorage.com` endpoint)

With none of them set, the job ends with a notice and does nothing; with only some set, it fails. GitHub masks secret values in logs, and the publisher never prints them. The job installs dependencies without running install scripts, and only its credential check and publish steps receive the secrets.

### Publishing the feed by hand

Without the secrets, or to republish, download the same verified assets into `dist/<version>/` and publish them:

```powershell
$releaseVersion = node -p "require('./package.json').version"
gh release download "v$releaseVersion" --dir "dist/$releaseVersion" --clobber
npm run release:publish
```

The version in `package.json` must match the downloaded release. The publisher reads `dist/<version>/` (or `dist/` for a fresh local build, or the folder given with `--dir <folder>`). `node scripts/publish-update.mjs --check` runs only the verification. Keep each release's files in its own `dist/<version>/` folder.

Maintainers publishing by hand need `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, and `R2_ENDPOINT` in their environment or the sibling website's local `.env`. These are not required to run MyLecture and must never be committed or bundled.

Installed apps check at startup and offer only higher versions. Installer builds can download updates in the background; portable builds open the matching download in a browser.

## Local packaging

```powershell
npm run release:build
```

This runs tests, builds Windows packages, and performs the deep packaged-app checks. Keep only one build running per checkout because builds share `dist/`.

## Windows signing

Current installers are unsigned. A trusted signing service can verify the publisher, but signing alone does not guarantee immediate SmartScreen reputation. See [Microsoft's signing guidance](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation).

The workflow accepts `WIN_CERT_P12_BASE64` and `WIN_CERT_PASSWORD` as GitHub Actions secrets for compatible file-based certificates. Cloud or hardware-backed signing requires its provider's integration. Keep signing credentials in secrets, never in the repository.

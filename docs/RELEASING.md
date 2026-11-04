# Releasing MyLecture for Windows

Official releases target Windows 10/11, 64-bit. The release workflow builds and tests Windows x64 installers and portable executables.

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

In GitHub Actions, wait for **Release** to finish successfully. The workflow:

1. Installs dependencies and runs tests, including real MP4 aspect-ratio checks.
2. Builds the Windows installer and portable app.
3. Starts the packaged app and checks speech synthesis, bundled ffmpeg, and scene validation.
4. Publishes the files to a GitHub Release.

Assets include `MyLecture-<version>-win-x64.exe`, the `-portable.exe`, the installer's `.blockmap`, and `latest.yml`. Try the installer and a representative video generation/render before announcing the release.

Running **Release > Run workflow** on `main` builds and checks downloadable artifacts without publishing a release.

## Website downloads

The homepage uses this permanent URL:

https://mylecture-server.touhid3-1416.workers.dev/download/windows

The Worker redirects to the Windows installer in the latest published GitHub release, with a 60-second lookup cache. GitHub serves the file and records its asset download count. No website edit or R2 upload is needed to update this link.

Download counts belong to individual assets. Save historical counts before deleting old releases.

## Publish the in-app update feed

Installed apps use a separate Cloudflare R2 update feed. Publishing a GitHub Release alone does not update that feed.

After the GitHub workflow succeeds, download the same verified assets into `dist/` and publish them:

```powershell
$releaseVersion = node -p "require('./package.json').version"
gh release download "v$releaseVersion" --dir dist --clobber
npm run release:publish
```

The version in `package.json` must match the downloaded release. The publisher uploads binaries first and `latest.yml` last.

Maintainers need `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, and `R2_ENDPOINT` in their environment or the sibling website's local `.env`. These are not required to run MyLecture and must never be committed or bundled.

Installed apps check at startup and offer only higher versions. Installer builds can download updates in the background; portable builds open the matching download in a browser.

## Local packaging

```powershell
npm run release:build
```

This runs tests, builds Windows packages, and performs the deep packaged-app checks. Keep only one build running per checkout because builds share `dist/`.

## Windows signing

Current installers are unsigned. A trusted signing service can verify the publisher, but signing alone does not guarantee immediate SmartScreen reputation. See [Microsoft's signing guidance](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation).

The workflow accepts `WIN_CERT_P12_BASE64` and `WIN_CERT_PASSWORD` as GitHub Actions secrets for compatible file-based certificates. Cloud or hardware-backed signing requires its provider's integration. Keep signing credentials in secrets, never in the repository.

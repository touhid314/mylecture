# Social Upload Scripts

This folder contains scripts for uploading videos to the `MyLecture` Facebook Page using the Meta Graph API.

## Files

- `upload_video.py` uploads an MP4 to Facebook.
- `refresh_tokens.py` exchanges a fresh user token for longer-lived tokens and updates `.env`.
- `.env` stores Meta app, Page, and token values.

Do not commit or share `.env`.

## Environment

Required Facebook values:

```env
FB_GRAPH_VERSION=v25.0
FB_APP_ID=
FB_APP_SECRET=
FB_USER_ACCESS_TOKEN=
FB_PAGE_ID=
FB_PAGE_ACCESS_TOKEN=
```

Instagram placeholders are present for later work:

```env
IG_USER_ID=
IG_ACCESS_TOKEN=
IG_DEFAULT_CAPTION=
IG_SHARE_TO_FEED=true
```

## Refresh Tokens

If you have a fresh short-lived user token from Graph API Explorer, paste it into:

```env
FB_USER_ACCESS_TOKEN=
```

Then run:

```powershell
python social/refresh_tokens.py
```

This updates:

```env
FB_USER_ACCESS_TOKEN
FB_PAGE_ACCESS_TOKEN
```

Use these permissions when generating the user token:

```text
pages_show_list
pages_read_engagement
pages_manage_posts
```

## Upload A Reel

Reels are the default upload type.

```powershell
python social/upload_video.py "C:\path\to\video.mp4" --caption "Your caption here"
```

With a title:

```powershell
python social/upload_video.py "C:\path\to\video.mp4" --title "Video title" --caption "Your caption here"
```

Use a caption from a text file:

```powershell
$caption = Get-Content -Raw -Encoding UTF8 "inputs\git-github-gitlab\description.txt"
python social/upload_video.py "inputs\git-github-gitlab\output.mp4" --caption $caption
```

## Upload A Regular Page Video

Use `--type video` to use the regular Page video endpoint instead of the Reels endpoint.

```powershell
python social/upload_video.py "C:\path\to\video.mp4" --caption "Your caption here" --type video
```

## Schedule Uploads

Schedule a Reel:

```powershell
python social/upload_video.py "C:\path\to\video.mp4" --caption "Your caption here" --schedule "2026-05-24 09:00"
```

Schedule a regular Page video:

```powershell
python social/upload_video.py "C:\path\to\video.mp4" --caption "Your caption here" --type video --schedule "2026-05-24 09:00"
```

Schedule rules:

- Reels must be scheduled at least 10 minutes in the future and within 29 days.
- Regular Page videos must be scheduled at least 10 minutes in the future and within about 6 months.
- If no timezone is included, the script uses your computer's local timezone.

## Options

```text
video
  Required path to an MP4 file.

--caption
  Required Facebook caption/description.

--title
  Optional video title. Defaults to FB_DEFAULT_VIDEO_TITLE if present, otherwise the filename.

--type {reel,video}
  Optional upload type. Defaults to reel.

--schedule
  Optional publish time as Unix seconds or local/ISO datetime.
```

## Examples

Upload as a Reel:

```powershell
python social/upload_video.py "inputs\git-github-gitlab\output.mp4" --caption "Git, GitHub, and GitLab explained."
```

Upload as a regular Page video:

```powershell
python social/upload_video.py "inputs\git-github-gitlab\output.mp4" --caption "Git, GitHub, and GitLab explained." --type video
```

Schedule a Reel:

```powershell
python social/upload_video.py "inputs\git-github-gitlab\output.mp4" --caption "Git, GitHub, and GitLab explained." --schedule "2026-05-24 09:00"
```

## Token Expiration

The short-lived Graph API Explorer token lasts about an hour. After running `refresh_tokens.py`, the user token is usually valid for about 60 days. The Page token may last longer, but it can still be invalidated.

If uploads fail with an expired token error, first try:

```powershell
python social/refresh_tokens.py
```

If that fails because `FB_USER_ACCESS_TOKEN` is expired, generate a fresh user token, paste it into `.env`, and run `refresh_tokens.py` again.

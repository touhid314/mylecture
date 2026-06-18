import argparse
import mimetypes
import sys
from datetime import datetime, timedelta
from pathlib import Path

import requests


SCRIPT_DIR = Path(__file__).resolve().parent
ENV_PATH = SCRIPT_DIR / ".env"


def load_env(path: Path) -> dict[str, str]:
    values = {}
    if not path.exists():
        raise RuntimeError(f"Missing env file: {path}")

    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip().strip('"').strip("'")

    return values


def require_env(env: dict[str, str], key: str) -> str:
    value = env.get(key, "").strip()
    if not value:
        raise RuntimeError(f"Missing required value in src/social/.env: {key}")
    return value


def graph_error(response: requests.Response) -> str:
    try:
        payload = response.json()
    except ValueError:
        return response.text

    error = payload.get("error")
    if isinstance(error, dict):
        message = error.get("message", "Unknown Graph API error")
        code = error.get("code")
        error_type = error.get("type")
        return f"{message} (type={error_type}, code={code})"

    return str(payload)


def check_response(response: requests.Response) -> dict:
    if response.ok:
        return response.json()
    raise RuntimeError(graph_error(response))


def is_page_token_retryable(error: Exception) -> bool:
    message = str(error)
    return (
        "No permission to publish the video" in message
        or "Error validating access token" in message
        or "Session has expired" in message
    )


def start_upload_session(
    graph_version: str,
    app_id: str,
    user_access_token: str,
    video_path: Path,
) -> str:
    mime_type = mimetypes.guess_type(video_path.name)[0] or "video/mp4"
    if mime_type != "video/mp4":
        raise RuntimeError(f"Facebook video upload expects an MP4 file, got: {mime_type}")

    url = f"https://graph.facebook.com/{graph_version}/{app_id}/uploads"
    response = requests.post(
        url,
        params={
            "file_name": video_path.name,
            "file_length": video_path.stat().st_size,
            "file_type": mime_type,
            "access_token": user_access_token,
        },
        timeout=60,
    )
    payload = check_response(response)
    upload_id = payload.get("id")
    if not upload_id:
        raise RuntimeError(f"Upload session response did not include id: {payload}")
    return upload_id


def upload_file_bytes(
    graph_version: str,
    upload_id: str,
    user_access_token: str,
    video_path: Path,
) -> str:
    url = f"https://graph.facebook.com/{graph_version}/{upload_id}"
    with video_path.open("rb") as video_file:
        response = requests.post(
            url,
            headers={
                "Authorization": f"OAuth {user_access_token}",
                "file_offset": "0",
            },
            data=video_file,
            timeout=600,
        )

    payload = check_response(response)
    file_handle = payload.get("h")
    if not file_handle:
        raise RuntimeError(f"Upload response did not include file handle: {payload}")
    return file_handle


def start_reel_upload_session(
    graph_version: str,
    page_id: str,
    page_access_token: str,
) -> tuple[str, str]:
    url = f"https://graph.facebook.com/{graph_version}/{page_id}/video_reels"
    response = requests.post(
        url,
        data={
            "access_token": page_access_token,
            "upload_phase": "start",
        },
        timeout=60,
    )
    payload = check_response(response)
    video_id = payload.get("video_id")
    upload_url = payload.get("upload_url")
    if not video_id or not upload_url:
        raise RuntimeError(f"Reel upload session response was incomplete: {payload}")
    return video_id, upload_url


def upload_reel_file(
    page_access_token: str,
    upload_url: str,
    video_path: Path,
) -> None:
    with video_path.open("rb") as video_file:
        response = requests.post(
            upload_url,
            headers={
                "Authorization": f"OAuth {page_access_token}",
                "Content-Type": "application/octet-stream",
                "offset": "0",
                "file_size": str(video_path.stat().st_size),
            },
            data=video_file,
            timeout=900,
        )

    payload = check_response(response)
    if payload.get("success") is not True:
        raise RuntimeError(f"Reel file upload did not return success: {payload}")


def finish_reel_publish(
    graph_version: str,
    page_id: str,
    page_access_token: str,
    video_id: str,
    title: str,
    caption: str,
    scheduled_publish_time: int | None = None,
) -> str:
    url = f"https://graph.facebook.com/{graph_version}/{page_id}/video_reels"
    data = {
        "access_token": page_access_token,
        "video_id": video_id,
        "upload_phase": "finish",
        "video_state": "SCHEDULED" if scheduled_publish_time is not None else "PUBLISHED",
        "description": caption,
        "title": title,
    }
    if scheduled_publish_time is not None:
        data["scheduled_publish_time"] = str(scheduled_publish_time)

    response = requests.post(url, data=data, timeout=120)
    payload = check_response(response)
    if payload.get("success") is not True:
        raise RuntimeError(f"Reel publish did not return success: {payload}")
    return video_id


def publish_reel(
    graph_version: str,
    page_id: str,
    page_access_token: str,
    video_path: Path,
    title: str,
    caption: str,
    scheduled_publish_time: int | None = None,
) -> str:
    video_id, upload_url = start_reel_upload_session(
        graph_version,
        page_id,
        page_access_token,
    )
    upload_reel_file(page_access_token, upload_url, video_path)
    return finish_reel_publish(
        graph_version,
        page_id,
        page_access_token,
        video_id,
        title,
        caption,
        scheduled_publish_time,
    )


def get_page_access_token(
    graph_version: str,
    user_access_token: str,
    page_id: str,
) -> str:
    url = f"https://graph.facebook.com/{graph_version}/me/accounts"
    response = requests.get(
        url,
        params={
            "fields": "id,name,access_token,tasks",
            "access_token": user_access_token,
        },
        timeout=60,
    )
    payload = check_response(response)
    for page in payload.get("data", []):
        if str(page.get("id")) == str(page_id):
            token = page.get("access_token")
            tasks = page.get("tasks", [])
            if "CREATE_CONTENT" not in tasks:
                raise RuntimeError(
                    f"Found Page {page_id}, but token is missing CREATE_CONTENT task."
                )
            if not token:
                raise RuntimeError(f"Found Page {page_id}, but response did not include access_token.")
            return token

    page_names = ", ".join(
        f"{page.get('name')} ({page.get('id')})" for page in payload.get("data", [])
    )
    raise RuntimeError(f"Could not find FB_PAGE_ID in /me/accounts response. Pages returned: {page_names}")


def publish_video(
    graph_version: str,
    page_id: str,
    page_access_token: str,
    file_handle: str,
    title: str,
    caption: str,
    scheduled_publish_time: int | None = None,
) -> str:
    url = f"https://graph-video.facebook.com/{graph_version}/{page_id}/videos"
    data = {
        "access_token": page_access_token,
        "title": title,
        "description": caption,
        "fbuploader_video_file_chunk": file_handle,
    }
    if scheduled_publish_time is not None:
        data["published"] = "false"
        data["scheduled_publish_time"] = str(scheduled_publish_time)

    response = requests.post(
        url,
        data=data,
        timeout=120,
    )
    payload = check_response(response)
    video_id = payload.get("id")
    if not video_id:
        raise RuntimeError(f"Publish response did not include video id: {payload}")
    return video_id


def publish_video_source(
    graph_version: str,
    page_id: str,
    page_access_token: str,
    video_path: Path,
    title: str,
    caption: str,
    scheduled_publish_time: int | None = None,
) -> str:
    url = f"https://graph-video.facebook.com/{graph_version}/{page_id}/videos"
    data = {
        "access_token": page_access_token,
        "title": title,
        "description": caption,
    }
    if scheduled_publish_time is not None:
        data["published"] = "false"
        data["scheduled_publish_time"] = str(scheduled_publish_time)

    with video_path.open("rb") as video_file:
        response = requests.post(
            url,
            data=data,
            files={
                "source": (video_path.name, video_file, "video/mp4"),
            },
            timeout=900,
        )

    payload = check_response(response)
    video_id = payload.get("id")
    if not video_id:
        raise RuntimeError(f"Publish response did not include video id: {payload}")
    return video_id


def parse_schedule(value: str) -> int:
    if value.isdigit():
        scheduled_at = datetime.fromtimestamp(int(value)).astimezone()
    else:
        normalized = value.strip().replace("Z", "+00:00")
        try:
            scheduled_at = datetime.fromisoformat(normalized)
        except ValueError as exc:
            raise argparse.ArgumentTypeError(
                "Use Unix seconds or ISO/local format like '2026-05-23 15:30'."
            ) from exc

        if scheduled_at.tzinfo is None:
            local_timezone = datetime.now().astimezone().tzinfo
            scheduled_at = scheduled_at.replace(tzinfo=local_timezone)
        else:
            scheduled_at = scheduled_at.astimezone()

    now = datetime.now().astimezone()
    min_time = now + timedelta(minutes=10)
    max_time = now + timedelta(days=183)
    if scheduled_at < min_time:
        raise argparse.ArgumentTypeError("Scheduled time must be at least 10 minutes from now.")
    if scheduled_at > max_time:
        raise argparse.ArgumentTypeError("Scheduled time must be within about 6 months.")

    return int(scheduled_at.timestamp())


def validate_schedule_window(scheduled_timestamp: int | None, upload_type: str) -> None:
    if scheduled_timestamp is None:
        return

    scheduled_at = datetime.fromtimestamp(scheduled_timestamp).astimezone()
    now = datetime.now().astimezone()
    max_days = 29 if upload_type == "reel" else 183
    max_time = now + timedelta(days=max_days)
    if scheduled_at > max_time:
        raise RuntimeError(
            f"Scheduled {upload_type} uploads must be within {max_days} days."
        )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Upload an MP4 video to a Facebook Page.")
    parser.add_argument("video", help="Path to the MP4 video file.")
    parser.add_argument("--caption", required=True, help="Facebook post caption/description.")
    parser.add_argument("--title", help="Video title. Defaults to env value or filename stem.")
    parser.add_argument(
        "--type",
        choices=("reel", "video"),
        default="reel",
        help="Upload as a Facebook Reel by default. Use 'video' for the regular Page video endpoint.",
    )
    parser.add_argument(
        "--schedule",
        type=parse_schedule,
        help="Schedule publish time as Unix seconds or local/ISO datetime, e.g. '2026-05-23 15:30'.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    video_path = Path(args.video).expanduser().resolve()
    if not video_path.exists():
        raise RuntimeError(f"Video file does not exist: {video_path}")
    if not video_path.is_file():
        raise RuntimeError(f"Video path is not a file: {video_path}")

    env = load_env(ENV_PATH)
    graph_version = env.get("FB_GRAPH_VERSION", "v25.0").strip() or "v25.0"
    page_id = require_env(env, "FB_PAGE_ID")
    page_access_token = require_env(env, "FB_PAGE_ACCESS_TOKEN")

    title = args.title or env.get("FB_DEFAULT_VIDEO_TITLE") or video_path.stem
    caption = args.caption or env.get("FB_DEFAULT_VIDEO_DESCRIPTION") or ""
    validate_schedule_window(args.schedule, args.type)

    if args.schedule:
        print(f"Scheduling Facebook {args.type} for Unix time {args.schedule}...")
    else:
        print(f"Publishing Facebook {args.type}...")

    try:
        if args.type == "reel":
            video_id = publish_reel(
                graph_version,
                page_id,
                page_access_token,
                video_path,
                title,
                caption,
                args.schedule,
            )
        else:
            video_id = publish_video_source(
                graph_version,
                page_id,
                page_access_token,
                video_path,
                title,
                caption,
                args.schedule,
            )
    except RuntimeError as exc:
        if not is_page_token_retryable(exc):
            raise

        print("Stored Page token was rejected. Fetching a fresh Page token from the user token...")
        user_access_token = require_env(env, "FB_USER_ACCESS_TOKEN")
        fresh_page_access_token = get_page_access_token(
            graph_version,
            user_access_token,
            page_id,
        )
        if args.type == "reel":
            video_id = publish_reel(
                graph_version,
                page_id,
                fresh_page_access_token,
                video_path,
                title,
                caption,
                args.schedule,
            )
        else:
            video_id = publish_video_source(
                graph_version,
                page_id,
                fresh_page_access_token,
                video_path,
                title,
                caption,
                args.schedule,
            )

    if args.schedule:
        print(f"Scheduled successfully. Facebook {args.type} video id: {video_id}")
    else:
        print(f"Uploaded successfully. Facebook {args.type} video id: {video_id}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"Upload failed: {exc}", file=sys.stderr)
        raise SystemExit(1)

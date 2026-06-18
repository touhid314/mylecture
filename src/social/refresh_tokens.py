import sys
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


def exchange_for_long_lived_user_token(
    graph_version: str,
    app_id: str,
    app_secret: str,
    user_access_token: str,
) -> str:
    url = f"https://graph.facebook.com/{graph_version}/oauth/access_token"
    response = requests.get(
        url,
        params={
            "grant_type": "fb_exchange_token",
            "client_id": app_id,
            "client_secret": app_secret,
            "fb_exchange_token": user_access_token,
        },
        timeout=60,
    )
    payload = check_response(response)
    token = payload.get("access_token")
    if not token:
        raise RuntimeError(f"Long-lived token response did not include access_token: {payload}")
    return token


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
            print(f"Fetched Page token for {page.get('name')} ({page.get('id')}).")
            return token

    page_names = ", ".join(
        f"{page.get('name')} ({page.get('id')})" for page in payload.get("data", [])
    )
    raise RuntimeError(f"Could not find FB_PAGE_ID in /me/accounts response. Pages returned: {page_names}")


def update_env_values(path: Path, updates: dict[str, str]) -> None:
    lines = path.read_text(encoding="utf-8").splitlines()
    seen = set()
    next_lines = []

    for line in lines:
        if "=" not in line or line.lstrip().startswith("#"):
            next_lines.append(line)
            continue

        key = line.split("=", 1)[0].strip()
        if key in updates:
            next_lines.append(f"{key}={updates[key]}")
            seen.add(key)
        else:
            next_lines.append(line)

    for key, value in updates.items():
        if key not in seen:
            next_lines.append(f"{key}={value}")

    path.write_text("\n".join(next_lines) + "\n", encoding="utf-8")


def main() -> int:
    env = load_env(ENV_PATH)
    graph_version = env.get("FB_GRAPH_VERSION", "v25.0").strip() or "v25.0"
    app_id = require_env(env, "FB_APP_ID")
    app_secret = require_env(env, "FB_APP_SECRET")
    user_access_token = require_env(env, "FB_USER_ACCESS_TOKEN")
    page_id = require_env(env, "FB_PAGE_ID")

    print("Exchanging user token for a long-lived user token...")
    long_lived_user_token = exchange_for_long_lived_user_token(
        graph_version,
        app_id,
        app_secret,
        user_access_token,
    )

    print("Fetching Page access token from the long-lived user token...")
    page_access_token = get_page_access_token(
        graph_version,
        long_lived_user_token,
        page_id,
    )

    update_env_values(
        ENV_PATH,
        {
            "FB_USER_ACCESS_TOKEN": long_lived_user_token,
            "FB_PAGE_ACCESS_TOKEN": page_access_token,
        },
    )
    print("Updated FB_USER_ACCESS_TOKEN and FB_PAGE_ACCESS_TOKEN in src/social/.env.")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"Token refresh failed: {exc}", file=sys.stderr)
        raise SystemExit(1)

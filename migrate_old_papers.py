#!/usr/bin/env python3
"""
Migrate an existing Notion papers database into an arxiv2notion-style database.

Default source schema:
  Title      title
  Author     rich_text/text
  Year       rich_text/text
  Notes      rich_text/text
  My notes   url
  Field      select   # ignored

Target behavior:
  Title                 required
  Author -> Authors     rich_text, or legacy multi_select if the target uses it
  Year -> Published     date, if the target has Published
  Notes -> Notes        rich_text, if the target has Notes
  My notes -> Comments  url, only if the target still has Comments

Usage:
  cp migrate_old_papers.config.example.json migrate_old_papers.config.json
  # Paste notion_token and target_db into migrate_old_papers.config.json.
  python migrate_old_papers.py

Then set "dry_run": false, or run with --run.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from typing import Any, Dict, List, Optional, Tuple


NOTION_VERSION = "2022-06-28"
BASE_URL = "https://api.notion.com/v1"
DEFAULT_CONFIG_PATH = "migrate_old_papers.config.json"
DEFAULT_SOURCE_FIELDS = {
    "source_title": "Title",
    "source_authors": "Author",
    "source_year": "Year",
    "source_notes": "Notes",
    "source_my_notes": "My notes",
}


def load_config(path: str) -> Dict[str, Any]:
    if not path or not os.path.exists(path):
        return {}
    with open(path, "r", encoding="utf-8") as file:
        return json.load(file)


def config_value(
    args: argparse.Namespace,
    config: Dict[str, Any],
    name: str,
    default: Any = None,
) -> Any:
    value = getattr(args, name)
    if value is not None:
        return value
    if name in config:
        return config[name]
    return default


def normalize_id(value: str) -> str:
    """Accept a Notion URL or raw UUID-ish string; return a 32-char ID."""
    value = value.strip()
    matches = re.findall(r"[0-9a-fA-F]{32}", value.replace("-", ""))
    if not matches:
        raise ValueError(f"Cannot parse Notion ID from: {value}")
    return matches[0]


def request_headers(token: str) -> Dict[str, str]:
    return {
        "Authorization": f"Bearer {token}",
        "Notion-Version": NOTION_VERSION,
        "Content-Type": "application/json",
    }


def notion_request(
    method: str,
    path: str,
    token: str,
    payload: Optional[dict] = None,
    max_retries: int = 8,
) -> dict:
    url = f"{BASE_URL}{path}"
    body = json.dumps(payload).encode("utf-8") if payload is not None else None

    for attempt in range(max_retries):
        req = urllib.request.Request(
            url,
            data=body,
            method=method,
            headers=request_headers(token),
        )

        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            raw = exc.read().decode("utf-8")
            try:
                error_body: Any = json.loads(raw)
            except json.JSONDecodeError:
                error_body = raw

            if exc.code == 429:
                retry_after = int(exc.headers.get("Retry-After", "2"))
                time.sleep(retry_after + 0.25)
                continue

            if 500 <= exc.code < 600:
                time.sleep(min(2**attempt, 30))
                continue

            raise RuntimeError(
                f"Notion API error {exc.code} {method} {path}:\n{error_body}"
            ) from exc
        except urllib.error.URLError as exc:
            time.sleep(min(2**attempt, 30))
            if attempt == max_retries - 1:
                raise RuntimeError(f"Network error {method} {path}: {exc}") from exc

    raise RuntimeError(f"Notion API request failed after retries: {method} {path}")


def retrieve_database(token: str, database_id: str) -> dict:
    return notion_request("GET", f"/databases/{database_id}", token)


def database_has_property(database: dict, name: str) -> bool:
    return name in database.get("properties", {})


def database_property_type(database: dict, name: str) -> Optional[str]:
    prop = database.get("properties", {}).get(name)
    return prop.get("type") if prop else None


def query_all_database_rows(
    token: str,
    database_id: str,
    page_size: int = 100,
    sort_by: Optional[str] = None,
) -> List[dict]:
    rows: List[dict] = []
    cursor = None

    while True:
        payload: Dict[str, Any] = {"page_size": page_size}
        if sort_by:
            payload["sorts"] = [{"property": sort_by, "direction": "ascending"}]
        if cursor:
            payload["start_cursor"] = cursor

        data = notion_request("POST", f"/databases/{database_id}/query", token, payload)
        rows.extend(data.get("results", []))

        if not data.get("has_more"):
            break
        cursor = data.get("next_cursor")
        if not cursor:
            break

    return rows


def plain_text_from_rich_text(items: Optional[List[dict]]) -> str:
    if not items:
        return ""
    return "".join(item.get("plain_text", "") for item in items).strip()


def get_title(props: dict, name: str) -> str:
    prop = props.get(name)
    if not prop:
        return ""
    return plain_text_from_rich_text(prop.get("title", []))


def get_text(props: dict, name: str) -> str:
    prop = props.get(name)
    if not prop:
        return ""

    prop_type = prop.get("type")
    if prop_type == "rich_text":
        return plain_text_from_rich_text(prop.get("rich_text", []))
    if prop_type == "title":
        return plain_text_from_rich_text(prop.get("title", []))
    if prop_type == "select":
        selected = prop.get("select")
        return selected.get("name", "") if selected else ""
    if prop_type == "multi_select":
        return ", ".join(item.get("name", "") for item in prop.get("multi_select", []))
    if prop_type == "date":
        date_value = prop.get("date")
        return date_value.get("start", "") if date_value else ""
    if prop_type == "url":
        return prop.get("url") or ""
    if prop_type == "number":
        value = prop.get("number")
        return "" if value is None else str(value)

    return ""


def get_url(props: dict, name: str) -> Optional[str]:
    prop = props.get(name)
    if not prop:
        return None

    if prop.get("type") == "url":
        return prop.get("url") or None

    value = get_text(props, name)
    if value.startswith(("http://", "https://")):
        return value
    return None


def text_block(content: str) -> dict:
    return {
        "type": "text",
        "text": {"content": content[:2000]},
    }


def title_prop(text: str) -> dict:
    return {"title": [text_block(text)] if text else []}


def title_text_from_prop(prop: dict) -> str:
    title_items = prop.get("title", [])
    parts = []
    for item in title_items:
        if "plain_text" in item:
            parts.append(item.get("plain_text") or "")
        else:
            parts.append(item.get("text", {}).get("content", ""))
    return "".join(parts).strip()


def rich_text_prop(text: str) -> dict:
    return {"rich_text": [text_block(text)] if text else []}


def multi_select_prop(text: str) -> dict:
    names = [part.strip() for part in text.split(",") if part.strip()]
    return {"multi_select": [{"name": name} for name in names]}


def authors_prop(authors: str, target_authors_type: Optional[str]) -> dict:
    if target_authors_type == "rich_text":
        return rich_text_prop(authors)
    if target_authors_type == "multi_select":
        return multi_select_prop(authors)
    raise ValueError(
        "Target Authors property must be Text (rich_text). "
        "Legacy Multi-Select Authors is also supported."
    )


def url_prop(url: Optional[str]) -> dict:
    return {"url": url if url else None}


def date_from_year(year_text: str) -> Optional[dict]:
    if not year_text:
        return None

    year_text = year_text.strip()
    if re.fullmatch(r"\d{4}", year_text):
        return {"start": f"{year_text}-01-01"}
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", year_text):
        return {"start": year_text}

    match = re.search(r"(19|20)\d{2}", year_text)
    if match:
        return {"start": f"{match.group(0)}-01-01"}

    return None


def date_prop(year_text: str) -> Optional[dict]:
    date_value = date_from_year(year_text)
    return {"date": date_value} if date_value else None


def build_target_properties(src_page: dict, target_database: dict, args: argparse.Namespace) -> dict:
    source_props = src_page["properties"]

    title = get_title(source_props, args.source_title)
    authors = get_text(source_props, args.source_authors)
    year = get_text(source_props, args.source_year)
    notes = get_text(source_props, args.source_notes)
    my_notes = get_url(source_props, args.source_my_notes)

    if not title:
        raise ValueError(f"Source row has empty Title: {src_page.get('url')}")

    out: Dict[str, Any] = {"Title": title_prop(title)}

    if database_has_property(target_database, "Authors"):
        authors_type = database_property_type(target_database, "Authors")
        out["Authors"] = authors_prop(authors, authors_type)

    if database_has_property(target_database, "Published"):
        published = date_prop(year)
        if published:
            out["Published"] = published

    if database_has_property(target_database, "Notes"):
        out["Notes"] = rich_text_prop(notes)

    if database_has_property(target_database, "Comments"):
        out["Comments"] = url_prop(my_notes)

    return out


def query_existing_target_titles(token: str, target_db: str) -> set[str]:
    rows = query_all_database_rows(token, target_db)
    titles = set()
    for row in rows:
        title = get_title(row.get("properties", {}), "Title")
        if title:
            titles.add(title.strip())
    return titles


def create_page(token: str, target_db: str, properties: dict) -> dict:
    payload = {
        "parent": {"database_id": target_db},
        "properties": properties,
    }
    return notion_request("POST", "/pages", token, payload)


def migrate(
    token: str,
    source_db: str,
    target_db: str,
    dry_run: bool,
    skip_existing: bool,
    sleep_s: float,
    args: argparse.Namespace,
) -> None:
    print("Reading database schemas...")
    source_database = retrieve_database(token, source_db)
    target_database = retrieve_database(token, target_db)

    source_sort = (
        args.source_year
        if database_has_property(source_database, args.source_year)
        else None
    )

    print("Reading source database...")
    source_rows = query_all_database_rows(token, source_db, sort_by=source_sort)
    print(f"Source rows: {len(source_rows)}")

    existing_titles: set[str] = set()
    if skip_existing:
        print("Reading target database for duplicate detection...")
        existing_titles = query_existing_target_titles(token, target_db)
        print(f"Existing target titles: {len(existing_titles)}")

    created = 0
    skipped = 0
    failed: List[Tuple[str, str]] = []

    for index, row in enumerate(source_rows, start=1):
        try:
            props = build_target_properties(row, target_database, args)
            title = title_text_from_prop(props["Title"])

            if skip_existing and title in existing_titles:
                skipped += 1
                print(f"[{index}/{len(source_rows)}] SKIP existing: {title}")
                continue

            if dry_run:
                print(f"[{index}/{len(source_rows)}] DRY RUN: {title}")
                continue

            create_page(token, target_db, props)
            created += 1
            existing_titles.add(title)
            print(f"[{index}/{len(source_rows)}] CREATED: {title}")
            time.sleep(sleep_s)
        except Exception as exc:
            try:
                title = get_title(row.get("properties", {}), args.source_title)
            except Exception:
                title = row.get("id", "<unknown>")
            failed.append((title, str(exc)))
            print(
                f"[{index}/{len(source_rows)}] FAILED: {title}: {exc}",
                file=sys.stderr,
            )

    print("\nDone.")
    print(f"Created: {created}")
    print(f"Skipped: {skipped}")
    print(f"Failed:  {len(failed)}")

    if failed:
        print("\nFailed rows:")
        for title, error in failed:
            print(f"- {title}: {error}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--config",
        default=DEFAULT_CONFIG_PATH,
        help=f"JSON config path. Default: {DEFAULT_CONFIG_PATH}",
    )
    parser.add_argument("--source-db", help="Old database ID or URL")
    parser.add_argument("--target-db", help="arxiv2notion target database ID or URL")
    parser.add_argument("--token", help="Notion installation access token")
    dry_run_group = parser.add_mutually_exclusive_group()
    dry_run_group.add_argument("--dry-run", dest="dry_run", action="store_const", const=True)
    dry_run_group.add_argument("--run", dest="dry_run", action="store_const", const=False)
    parser.set_defaults(dry_run=None)
    parser.add_argument("--no-skip-existing", action="store_true")
    parser.add_argument("--source-title")
    parser.add_argument("--source-authors")
    parser.add_argument("--source-year")
    parser.add_argument("--source-notes")
    parser.add_argument("--source-my-notes")
    parser.add_argument(
        "--sleep",
        type=float,
        help="Seconds between create requests. Default stays under Notion's average rate limit.",
    )
    args = parser.parse_args()
    config = load_config(args.config)

    args.token = (
        config_value(args, config, "token")
        or config.get("notion_token")
        or os.environ.get("NOTION_TOKEN")
    )
    args.source_db = config_value(args, config, "source_db")
    args.target_db = config_value(args, config, "target_db")
    args.dry_run = config_value(args, config, "dry_run", False)
    args.sleep = config_value(args, config, "sleep", 0.38)
    for name, default in DEFAULT_SOURCE_FIELDS.items():
        setattr(args, name, config_value(args, config, name, default))

    if not args.token or args.token.startswith("PASTE_"):
        raise SystemExit("Missing token. Set NOTION_TOKEN or pass --token.")
    if not args.source_db:
        raise SystemExit("Missing source_db. Set it in config or pass --source-db.")
    if not args.target_db or args.target_db.startswith("PASTE_"):
        raise SystemExit("Missing target_db. Set it in config or pass --target-db.")

    migrate(
        token=args.token,
        source_db=normalize_id(args.source_db),
        target_db=normalize_id(args.target_db),
        dry_run=args.dry_run,
        skip_existing=not args.no_skip_existing,
        sleep_s=args.sleep,
        args=args,
    )


if __name__ == "__main__":
    main()

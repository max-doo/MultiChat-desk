#!/usr/bin/env python3
"""Append structured notes to SESSION_LOG.md with locking and archival."""

from __future__ import annotations

import argparse
import os
import re
import time
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path
from typing import Iterable


DATE_HEADING_RE = re.compile(r"^## (\d{4}-\d{2}-\d{2})\s*$", re.MULTILINE)
LESSON_RE = re.compile(r"^\s*-\s*lesson:\s*(.+?)\s*$", re.MULTILINE)
DEFAULT_WAIT_SECONDS = 10.0
DEFAULT_POLL_SECONDS = 0.2
RECENT_DAYS = 7


@dataclass
class AppendResult:
    log_path: Path
    archived_dates: list[str]
    lesson_candidates: list[str]


@contextmanager
def session_lock(memory_dir: Path, wait_seconds: float = DEFAULT_WAIT_SECONDS, poll_seconds: float = DEFAULT_POLL_SECONDS):
    memory_dir.mkdir(parents=True, exist_ok=True)
    lock_path = memory_dir / "SESSION_LOG.lock"
    deadline = time.monotonic() + wait_seconds
    handle = None

    while True:
        try:
            handle = os.open(str(lock_path), os.O_CREAT | os.O_EXCL | os.O_WRONLY)
            os.write(handle, f"pid={os.getpid()} time={datetime.now().isoformat()}\n".encode("utf-8"))
            break
        except FileExistsError:
            if time.monotonic() >= deadline:
                raise TimeoutError(
                    "SESSION_LOG.md is locked by another process. Please retry later."
                )
            time.sleep(poll_seconds)

    try:
        yield lock_path
    finally:
        if handle is not None:
            os.close(handle)
        try:
            lock_path.unlink()
        except FileNotFoundError:
            pass


def append_session_note(
    *,
    root: Path,
    now: datetime,
    done: str,
    context: str | None = None,
    decision: str | None = None,
    added: Iterable[str] = (),
    modified: Iterable[str] = (),
    removed: Iterable[str] = (),
    lesson: str | None = None,
    unresolved: str | None = None,
    agent: str = "agent",
) -> AppendResult:
    root = Path(root)
    memory_dir = root / ".memory"
    log_path = root / "SESSION_LOG.md"

    with session_lock(memory_dir):
        content = _read_or_default_log(log_path)
        _validate_parseable_existing_log(log_path, content)
        content, archived_dates, archived_lessons = _archive_old_blocks(
            content=content,
            memory_dir=memory_dir,
            now=now,
        )
        content = _append_entry(
            content=content,
            now=now,
            agent=agent,
            fields={
                "done": done,
                "context": context,
                "decision": decision,
                "added": list(added),
                "modified": list(modified),
                "removed": list(removed),
                "lesson": lesson,
                "unresolved": unresolved,
            },
        )
        log_path.write_text(content, encoding="utf-8", newline="\n")

    recent_lessons = _extract_lessons(content)
    lesson_candidates = []
    if len(recent_lessons) > 3:
        lesson_candidates.extend(recent_lessons)
    lesson_candidates.extend(archived_lessons)

    return AppendResult(
        log_path=log_path,
        archived_dates=archived_dates,
        lesson_candidates=_dedupe_preserving_order(lesson_candidates),
    )


def _read_or_default_log(log_path: Path) -> str:
    if log_path.exists():
        return log_path.read_text(encoding="utf-8")
    return "# Session Log\n\n"


def _validate_parseable_existing_log(log_path: Path, content: str) -> None:
    if not log_path.exists() or DATE_HEADING_RE.search(content):
        return

    non_heading_lines = [
        line.strip()
        for line in content.splitlines()
        if line.strip() and line.strip() != "# Session Log" and not line.strip().startswith("<!--") and not line.strip().endswith("-->")
    ]
    if non_heading_lines:
        raise ValueError(
            "Existing SESSION_LOG.md has no `## YYYY-MM-DD` date blocks. "
            "Please manually normalize it before using .memory/session_log.py."
        )


def _archive_old_blocks(*, content: str, memory_dir: Path, now: datetime) -> tuple[str, list[str], list[str]]:
    parts = _split_date_blocks(content)
    cutoff = now.date() - timedelta(days=RECENT_DAYS - 1)
    kept_blocks = []
    archived_dates = []
    archived_lessons = []

    for date_text, block in parts["blocks"]:
        date_value = datetime.strptime(date_text, "%Y-%m-%d").date()
        if date_value < cutoff:
            _append_archive_block(memory_dir, date_text, block)
            archived_dates.append(date_text)
            archived_lessons.extend(_extract_lessons(block))
        else:
            kept_blocks.append((date_text, block))

    rebuilt = parts["preamble"].rstrip() + "\n\n"
    for _, block in kept_blocks:
        rebuilt += block.strip() + "\n\n"
    return rebuilt, archived_dates, archived_lessons


def _split_date_blocks(content: str) -> dict[str, object]:
    matches = list(DATE_HEADING_RE.finditer(content))
    if not matches:
        return {"preamble": content.rstrip() + "\n", "blocks": []}

    preamble = content[: matches[0].start()]
    blocks = []
    for index, match in enumerate(matches):
        end = matches[index + 1].start() if index + 1 < len(matches) else len(content)
        blocks.append((match.group(1), content[match.start() : end]))
    return {"preamble": preamble, "blocks": blocks}


def _append_archive_block(memory_dir: Path, date_text: str, block: str) -> None:
    archive_dir = memory_dir / "sessions"
    archive_dir.mkdir(parents=True, exist_ok=True)
    archive_path = archive_dir / f"{date_text}.md"
    existing = archive_path.read_text(encoding="utf-8") if archive_path.exists() else ""
    separator = "\n\n" if existing.strip() else ""
    archive_path.write_text(
        existing.rstrip() + separator + block.strip() + "\n",
        encoding="utf-8",
        newline="\n",
    )


def _append_entry(*, content: str, now: datetime, agent: str, fields: dict[str, object]) -> str:
    date_heading = f"## {now:%Y-%m-%d}"

    entry_lines = [f"### {now:%H:%M} | {agent}", ""]
    for key in ("done", "context", "decision"):
        value = fields.get(key)
        if value:
            entry_lines.append(f"- {key}: {value}")

    for key in ("added", "modified", "removed"):
        values = [value for value in fields.get(key, []) if value]
        if values:
            entry_lines.append(f"- {key}:")
            entry_lines.extend(f"  - `{value}`" for value in values)

    for key in ("lesson", "unresolved"):
        value = fields.get(key)
        if value:
            entry_lines.append(f"- {key}: {value}")

    entry_str = "\n".join(entry_lines).rstrip() + "\n"

    # Search for the date heading in the existing content
    heading_pattern = rf"^{re.escape(date_heading)}\s*$"
    match = re.search(heading_pattern, content, re.MULTILINE)

    if match:
        # Date heading exists. Insert the new entry right after it.
        insert_pos = match.end()
        # Find where the next line starts
        post_match = content[insert_pos:]
        ws_match = re.match(r"^\s*", post_match)
        if ws_match:
            insert_pos += ws_match.end()
            
        return content[:match.end()].rstrip() + "\n\n" + entry_str + "\n" + content[insert_pos:].lstrip()
    else:
        # Date heading does not exist. We need to insert it at the very top of the date blocks.
        # Let's find the first date block (starts with "## ")
        first_heading_match = re.search(r"^## ", content, re.MULTILINE)
        if first_heading_match:
            insert_pos = first_heading_match.start()
            preamble = content[:insert_pos].rstrip()
            post_content = content[insert_pos:].lstrip()
            return preamble + f"\n\n{date_heading}\n\n" + entry_str + "\n" + post_content
        else:
            # No headings exist at all
            preamble = content.rstrip()
            return preamble + f"\n\n{date_heading}\n\n" + entry_str


def _extract_lessons(content: str) -> list[str]:
    return [match.group(1).strip() for match in LESSON_RE.finditer(content)]


def _dedupe_preserving_order(values: Iterable[str]) -> list[str]:
    seen = set()
    result = []
    for value in values:
        if value not in seen:
            result.append(value)
            seen.add(value)
    return result


def _csv_or_repeated(values: list[str] | None) -> list[str]:
    result = []
    for value in values or []:
        result.extend(part.strip() for part in value.split(",") if part.strip())
    return result


def get_default_agent() -> str:
    if os.environ.get("SESSION_LOG_AGENT"):
        return os.environ["SESSION_LOG_AGENT"]
    if os.environ.get("ANTIGRAVITY_AGENT") == "1":
        return "Antigravity"
    if os.environ.get("CURSOR_AGENT") == "1":
        return "cursor"
    if os.environ.get("CLAUDECODE") or os.environ.get("CLAUDE_CODE") or os.environ.get("CLAUDE"):
        return "claude-code"
    if os.environ.get("CODEX_SHELL") or os.environ.get("CODEX_THREAD_ID") or os.environ.get("CODEX_INTERNAL_ORIGINATOR_OVERRIDE"):
        return "Codex"
    return "agent"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Append a structured entry to SESSION_LOG.md."
    )
    parser.add_argument("--done", required=True, help="What was completed.")
    parser.add_argument("--context", help="Relevant context or constraints.")
    parser.add_argument("--decision", help="Decision or tradeoff made in this session.")
    parser.add_argument("--added", action="append", help="Added file path. May repeat or use comma-separated values.")
    parser.add_argument("--modified", action="append", help="Modified file path. May repeat or use comma-separated values.")
    parser.add_argument("--removed", action="append", help="Removed file path. May repeat or use comma-separated values.")
    parser.add_argument("--lesson", help="Reusable lesson or pitfall.")
    parser.add_argument("--unresolved", help="Unresolved follow-up item.")
    parser.add_argument("--agent", default=get_default_agent(), help="Agent label for the entry.")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        result = append_session_note(
            root=Path.cwd(),
            now=datetime.now(),
            done=args.done,
            context=args.context,
            decision=args.decision,
            added=_csv_or_repeated(args.added),
            modified=_csv_or_repeated(args.modified),
            removed=_csv_or_repeated(args.removed),
            lesson=args.lesson,
            unresolved=_csv_or_repeated([args.unresolved]) if args.unresolved else [],
            agent=args.agent,
        )
    except TimeoutError as exc:
        print(str(exc))
        return 2
    except ValueError as exc:
        print(str(exc))
        return 3

    print(f"Updated {result.log_path}")
    if result.archived_dates:
        print("Archived old session dates:")
        for date_text in result.archived_dates:
            print(f"- {date_text}")
    if result.lesson_candidates:
        print("Lesson candidates detected:")
        for item in result.lesson_candidates:
            print(f"- {item}")
        print("Consider promoting stable lessons to `.memory/KNOWLEDGE.md`.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

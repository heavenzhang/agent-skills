#!/usr/bin/env python3
"""Small, project-isolated shared context cache for dev-team workers.

The cache stores bounded, caller-provided summaries and file fingerprints.  It
never stores source file contents and never executes or interprets summaries.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import stat
import sys
import time
from typing import Iterable


MAX_SOURCE_BYTES = 5 * 1024 * 1024
MAX_SUMMARY_FILE_BYTES = 1024 * 1024
MAX_SUMMARY_CHARS = 6000
DEFAULT_READ_CHARS = 12000
MAX_READ_CHARS = 100000
DEFAULT_LIST_LIMIT = 20
MAX_LIST_LIMIT = 100
MAX_DEPENDENCIES = 64


class CacheError(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


class SafeParser(argparse.ArgumentParser):
    def error(self, message: str) -> None:
        raise CacheError("invalid_arguments", message)


def _positive_int(value: str) -> int:
    try:
        number = int(value)
    except ValueError as exc:
        raise argparse.ArgumentTypeError("must be an integer") from exc
    if number < 1:
        raise argparse.ArgumentTypeError("must be at least 1")
    return number


def _bounded_positive(maximum: int):
    def parse(value: str) -> int:
        number = _positive_int(value)
        if number > maximum:
            raise argparse.ArgumentTypeError(f"must be at most {maximum}")
        return number

    return parse


def _sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _validate_hash(value: str) -> str:
    candidate = value.lower()
    if len(candidate) != 64 or any(c not in "0123456789abcdef" for c in candidate):
        raise CacheError("invalid_hash", "sha256 must be 64 hexadecimal characters")
    return candidate


def _validate_short(value: str, label: str, maximum: int) -> str:
    if not value or len(value) > maximum or "\x00" in value:
        raise CacheError("invalid_value", f"{label} must contain 1 to {maximum} characters")
    return value


def _canonical_root(raw: str) -> Path:
    path = Path(raw)
    if not path.is_absolute():
        raise CacheError("invalid_root", "--root must be an absolute project directory")
    try:
        resolved = path.resolve(strict=True)
    except (OSError, RuntimeError) as exc:
        raise CacheError("invalid_root", "--root must resolve to an existing directory") from exc
    if not resolved.is_dir():
        raise CacheError("invalid_root", "--root must resolve to an existing directory")
    return resolved


def _blocked_source(parts: Iterable[str], name: str) -> bool:
    lowered_parts = [part.lower() for part in parts]
    lower_name = name.lower()
    if ".git" in lowered_parts:
        return True
    if lower_name == ".env" or (
        lower_name.startswith(".env.")
        and lower_name not in {".env.example", ".env.sample"}
    ):
        return True
    if lower_name in {
        "id_rsa",
        "id_dsa",
        "id_ecdsa",
        "id_ed25519",
        "identity",
        "private_key",
        "private-key",
    }:
        return True
    if lower_name.endswith((".pem", ".key", ".p12", ".pfx", ".jks", ".keystore")):
        return True
    return False


def _source_path(root: Path, raw: str, *, must_exist: bool) -> tuple[Path, str]:
    if not raw or "\x00" in raw or len(raw) > 4096:
        raise CacheError("invalid_source", "source path is invalid")
    supplied = Path(raw)
    lexical = supplied if supplied.is_absolute() else root / supplied
    if _blocked_source(lexical.parts, lexical.name):
        raise CacheError(
            "blocked_source",
            "source path is blocked by the credential-file policy; this is not a comprehensive secret scanner",
        )
    try:
        resolved = lexical.resolve(strict=must_exist)
        relative = resolved.relative_to(root).as_posix()
    except FileNotFoundError as exc:
        raise CacheError("source_missing", "source does not exist") from exc
    except (ValueError, RuntimeError) as exc:
        raise CacheError("source_outside_root", "source must remain under the canonical project root") from exc
    except OSError as exc:
        raise CacheError("source_unavailable", "source cannot be resolved safely") from exc
    if relative == "." or _blocked_source(Path(relative).parts, resolved.name):
        raise CacheError(
            "blocked_source",
            "source path is blocked by the credential-file policy; this is not a comprehensive secret scanner",
        )
    return resolved, relative


def _reject_existing_non_regular_source(path: Path) -> None:
    """Reject directories/devices/FIFOs while allowing a deleted get target."""
    try:
        info = path.stat()
    except FileNotFoundError:
        return
    except OSError as exc:
        raise CacheError("source_unavailable", "source cannot be inspected safely") from exc
    if not stat.S_ISREG(info.st_mode):
        raise CacheError("non_regular_file", "source must be a regular file")


def _read_regular_bytes(path: Path, maximum: int, *, missing_code: str) -> bytes:
    try:
        info = path.stat()
    except FileNotFoundError as exc:
        raise CacheError(missing_code, "file does not exist") from exc
    except OSError as exc:
        raise CacheError("file_unavailable", "file cannot be inspected safely") from exc
    if not stat.S_ISREG(info.st_mode):
        raise CacheError("non_regular_file", "file must be a regular file")
    if info.st_size > maximum:
        raise CacheError("file_too_large", f"file exceeds the {maximum}-byte safety limit")

    flags = os.O_RDONLY
    flags |= getattr(os, "O_NONBLOCK", 0)
    flags |= getattr(os, "O_NOFOLLOW", 0)
    try:
        fd = os.open(path, flags)
    except OSError as exc:
        raise CacheError("file_unavailable", "file cannot be opened safely") from exc
    chunks: list[bytes] = []
    total = 0
    try:
        opened_info = os.fstat(fd)
        if not stat.S_ISREG(opened_info.st_mode):
            raise CacheError("non_regular_file", "file must be a regular file")
        while True:
            chunk = os.read(fd, min(65536, maximum + 1 - total))
            if not chunk:
                break
            chunks.append(chunk)
            total += len(chunk)
            if total > maximum:
                raise CacheError("file_too_large", f"file exceeds the {maximum}-byte safety limit")
    finally:
        os.close(fd)
    return b"".join(chunks)


def _read_source(root: Path, raw: str) -> tuple[str, bytes]:
    path, relative = _source_path(root, raw, must_exist=True)
    data = _read_regular_bytes(path, MAX_SOURCE_BYTES, missing_code="source_missing")
    return relative, data


def _decode_utf8(data: bytes, *, label: str) -> str:
    try:
        text = data.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise CacheError("non_utf8", f"{label} must be UTF-8 text") from exc
    if "\x00" in text:
        raise CacheError("non_text", f"{label} must not contain NUL bytes")
    return text


def _default_cache_dir(root: Path) -> Path:
    digest = hashlib.sha256(os.fsencode(str(root))).hexdigest()
    return Path.home() / ".codex" / "cache" / "dev-team" / digest


def _cache_dir(root: Path, raw: str | None) -> Path:
    if raw is None:
        return _default_cache_dir(root)
    path = Path(raw)
    if not path.is_absolute():
        raise CacheError("invalid_cache_dir", "--cache-dir must be absolute")
    try:
        return path.resolve(strict=False)
    except (OSError, RuntimeError) as exc:
        raise CacheError("invalid_cache_dir", "cache directory cannot be resolved safely") from exc


def _connect(root: Path, cache_dir: Path) -> sqlite3.Connection:
    existed = cache_dir.exists()
    if existed and not cache_dir.is_dir():
        raise CacheError("invalid_cache_dir", "cache path must be a directory")
    previous_umask = os.umask(0o077)
    try:
        cache_dir.mkdir(mode=0o700, parents=True, exist_ok=True)
        db_path = cache_dir / "context-cache.sqlite3"
        db_existed = db_path.exists()
        connection = sqlite3.connect(db_path, timeout=5.0, isolation_level=None)
    except (OSError, sqlite3.Error) as exc:
        raise CacheError("cache_unavailable", "cache database cannot be opened") from exc
    finally:
        os.umask(previous_umask)
    try:
        if not db_existed:
            os.chmod(db_path, 0o600)
        connection.execute("PRAGMA busy_timeout = 5000")
        connection.execute("PRAGMA journal_mode = DELETE")
        connection.execute("PRAGMA synchronous = FULL")
        connection.execute(
            "CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL)"
        )
        connection.execute(
            """CREATE TABLE IF NOT EXISTS entries (
                   source TEXT NOT NULL,
                   topic TEXT NOT NULL,
                   revision INTEGER NOT NULL,
                   summary TEXT NOT NULL,
                   source_sha256 TEXT NOT NULL,
                   dependencies_json TEXT NOT NULL,
                   model TEXT NOT NULL,
                   created_at INTEGER NOT NULL,
                   PRIMARY KEY (source, topic)
               )"""
        )
        connection.execute(
            """CREATE TABLE IF NOT EXISTS metrics (
                   id INTEGER PRIMARY KEY CHECK (id = 1),
                   hit_count INTEGER NOT NULL,
                   miss_count INTEGER NOT NULL,
                   stale_count INTEGER NOT NULL,
                   read_count INTEGER NOT NULL,
                   emitted_source_chars INTEGER NOT NULL,
                   emitted_summary_chars INTEGER NOT NULL
               )"""
        )
        connection.execute(
            "INSERT OR IGNORE INTO metrics VALUES (1, 0, 0, 0, 0, 0, 0)"
        )
        connection.execute("BEGIN IMMEDIATE")
        row = connection.execute(
            "SELECT value FROM metadata WHERE key = 'canonical_root'"
        ).fetchone()
        root_text = str(root)
        if row is None:
            connection.execute(
                "INSERT INTO metadata(key, value) VALUES ('canonical_root', ?)", (root_text,)
            )
        elif row[0] != root_text:
            connection.execute("ROLLBACK")
            raise CacheError(
                "root_mismatch",
                "cache directory is already bound to a different canonical project root",
            )
        connection.execute("COMMIT")
        return connection
    except CacheError:
        connection.close()
        raise
    except (OSError, sqlite3.Error) as exc:
        try:
            connection.execute("ROLLBACK")
        except sqlite3.Error:
            pass
        connection.close()
        raise CacheError("cache_unavailable", "cache database initialization failed") from exc


def _metric(connection: sqlite3.Connection, field: str, amount: int = 1) -> None:
    allowed = {
        "hit_count",
        "miss_count",
        "stale_count",
        "read_count",
        "emitted_source_chars",
        "emitted_summary_chars",
    }
    if field not in allowed or amount < 0:
        raise CacheError("internal_error", "invalid metric update")
    try:
        connection.execute("BEGIN IMMEDIATE")
        connection.execute(f"UPDATE metrics SET {field} = {field} + ? WHERE id = 1", (amount,))
        connection.execute("COMMIT")
    except sqlite3.Error as exc:
        try:
            connection.execute("ROLLBACK")
        except sqlite3.Error:
            pass
        raise CacheError("cache_busy", "cache metric update failed") from exc


def _numbered_excerpt(text: str, start: int, end: int | None, maximum: int) -> dict:
    lines = text.splitlines()
    total_lines = len(lines)
    if total_lines == 0:
        return {
            "content": "",
            "range": {"start": None, "end": None, "requested_start": start, "requested_end": end, "total_lines": 0},
            "truncated": False,
        }
    requested_end = total_lines if end is None else end
    if start > total_lines:
        selected: list[tuple[int, str]] = []
    else:
        selected = list(enumerate(lines[start - 1 : min(requested_end, total_lines)], start=start))
    output = ""
    emitted_end: int | None = None
    char_truncated = False
    for number, line in selected:
        rendered = f"{number}: {line}"
        if output:
            rendered = "\n" + rendered
        remaining = maximum - len(output)
        if remaining <= 0:
            char_truncated = True
            break
        if len(rendered) > remaining:
            output += rendered[:remaining]
            emitted_end = number
            char_truncated = True
            break
        output += rendered
        emitted_end = number
    range_truncated = start > 1 or requested_end < total_lines or requested_end > total_lines
    not_all_selected = bool(selected) and emitted_end != selected[-1][0]
    return {
        "content": output,
        "range": {
            "start": start if selected else None,
            "end": emitted_end,
            "requested_start": start,
            "requested_end": end,
            "total_lines": total_lines,
        },
        "truncated": bool(range_truncated or char_truncated or not_all_selected),
    }


def command_read(connection: sqlite3.Connection, root: Path, args: argparse.Namespace) -> dict:
    relative, data = _read_source(root, args.source)
    text = _decode_utf8(data, label="source")
    if args.end is not None and args.end < args.start:
        raise CacheError("invalid_range", "--end must be greater than or equal to --start")
    excerpt = _numbered_excerpt(text, args.start, args.end, args.max_chars)
    emitted = len(excerpt["content"])
    try:
        connection.execute("BEGIN IMMEDIATE")
        connection.execute(
            """UPDATE metrics
               SET read_count = read_count + 1,
                   emitted_source_chars = emitted_source_chars + ?
               WHERE id = 1""",
            (emitted,),
        )
        connection.execute("COMMIT")
    except sqlite3.Error as exc:
        try:
            connection.execute("ROLLBACK")
        except sqlite3.Error:
            pass
        raise CacheError("cache_busy", "cache metric update failed") from exc
    return {
        "status": "ok",
        "source": relative,
        "sha256": _sha256(data),
        **excerpt,
        "emitted_chars": emitted,
    }


def _parse_dependencies(root: Path, values: list[str]) -> list[dict[str, str]]:
    if len(values) > MAX_DEPENDENCIES:
        raise CacheError("too_many_dependencies", f"at most {MAX_DEPENDENCIES} dependencies are allowed")
    dependencies: dict[str, str] = {}
    for value in values:
        if "=" not in value:
            raise CacheError("invalid_dependency", "dependency must use PATH=SHA256")
        raw_path, raw_hash = value.rsplit("=", 1)
        expected = _validate_hash(raw_hash)
        relative, data = _read_source(root, raw_path)
        actual = _sha256(data)
        if actual != expected:
            raise CacheError("stale_fingerprint", "a submitted dependency fingerprint is stale")
        if relative in dependencies and dependencies[relative] != expected:
            raise CacheError("invalid_dependency", "duplicate dependency has conflicting fingerprints")
        dependencies[relative] = expected
    return [{"source": source, "sha256": dependencies[source]} for source in sorted(dependencies)]


def _read_summary_file(raw: str) -> str:
    if not raw or "\x00" in raw:
        raise CacheError("invalid_summary_file", "summary file path is invalid")
    try:
        path = Path(raw).resolve(strict=True)
    except (OSError, RuntimeError) as exc:
        raise CacheError("summary_missing", "summary file does not exist or cannot be resolved") from exc
    data = _read_regular_bytes(path, MAX_SUMMARY_FILE_BYTES, missing_code="summary_missing")
    text = _decode_utf8(data, label="summary file")
    if len(text) > MAX_SUMMARY_CHARS:
        raise CacheError(
            "summary_too_large",
            f"summary exceeds the {MAX_SUMMARY_CHARS}-character limit; shorten it before publishing",
        )
    return text


def command_publish(connection: sqlite3.Connection, root: Path, args: argparse.Namespace) -> dict:
    topic = _validate_short(args.topic, "topic", 256)
    model = _validate_short(args.model, "model", 128)
    expected_source = _validate_hash(args.sha256)
    relative, data = _read_source(root, args.source)
    if _sha256(data) != expected_source:
        raise CacheError("stale_fingerprint", "submitted source fingerprint is stale")
    dependencies = _parse_dependencies(root, args.dependency)
    summary = _read_summary_file(args.summary_file)

    # Recheck all fingerprints inside the write transaction.  This narrows the
    # filesystem/SQLite race without claiming to lock project files.
    try:
        connection.execute("BEGIN IMMEDIATE")
        _, current_source = _read_source(root, relative)
        if _sha256(current_source) != expected_source:
            raise CacheError("stale_fingerprint", "submitted source fingerprint became stale")
        for dependency in dependencies:
            _, current = _read_source(root, dependency["source"])
            if _sha256(current) != dependency["sha256"]:
                raise CacheError("stale_fingerprint", "a submitted dependency fingerprint became stale")
        old = connection.execute(
            "SELECT revision FROM entries WHERE source = ? AND topic = ?", (relative, topic)
        ).fetchone()
        revision = 1 if old is None else old[0] + 1
        connection.execute(
            """INSERT INTO entries
               (source, topic, revision, summary, source_sha256, dependencies_json, model, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(source, topic) DO UPDATE SET
                 revision=excluded.revision,
                 summary=excluded.summary,
                 source_sha256=excluded.source_sha256,
                 dependencies_json=excluded.dependencies_json,
                 model=excluded.model,
                 created_at=excluded.created_at""",
            (
                relative,
                topic,
                revision,
                summary,
                expected_source,
                json.dumps(dependencies, separators=(",", ":"), ensure_ascii=False),
                model,
                int(time.time()),
            ),
        )
        connection.execute("COMMIT")
    except CacheError:
        try:
            connection.execute("ROLLBACK")
        except sqlite3.Error:
            pass
        raise
    except sqlite3.Error as exc:
        try:
            connection.execute("ROLLBACK")
        except sqlite3.Error:
            pass
        raise CacheError("cache_busy", "summary publication failed") from exc
    return {
        "status": "published",
        "source": relative,
        "topic": topic,
        "revision": revision,
        "summary_chars": len(summary),
        "dependency_count": len(dependencies),
        "model": model,
    }


def _entry(connection: sqlite3.Connection, source: str, topic: str):
    return connection.execute(
        """SELECT revision, summary, source_sha256, dependencies_json, model, created_at
           FROM entries WHERE source = ? AND topic = ?""",
        (source, topic),
    ).fetchone()


def _fingerprint_is_fresh(root: Path, source: str, expected: str) -> bool:
    try:
        _, data = _read_source(root, source)
    except CacheError:
        return False
    return _sha256(data) == expected


def command_get(connection: sqlite3.Connection, root: Path, args: argparse.Namespace) -> dict:
    topic = _validate_short(args.topic, "topic", 256)
    resolved, relative = _source_path(root, args.source, must_exist=False)
    _reject_existing_non_regular_source(resolved)
    row = _entry(connection, relative, topic)
    if row is None:
        _metric(connection, "miss_count")
        return {"status": "missing", "source": relative, "topic": topic}
    revision, summary, source_hash, dependencies_json, model, created_at = row
    try:
        dependencies = json.loads(dependencies_json)
        if not isinstance(dependencies, list):
            raise ValueError
    except (json.JSONDecodeError, ValueError, TypeError) as exc:
        raise CacheError("cache_corrupt", "cached provenance is invalid") from exc
    fresh = _fingerprint_is_fresh(root, relative, source_hash)
    if fresh:
        for dependency in dependencies:
            if (
                not isinstance(dependency, dict)
                or not isinstance(dependency.get("source"), str)
                or not isinstance(dependency.get("sha256"), str)
                or not _fingerprint_is_fresh(root, dependency["source"], dependency["sha256"])
            ):
                fresh = False
                break
    if not fresh:
        _metric(connection, "stale_count")
        return {
            "status": "stale",
            "source": relative,
            "topic": topic,
            "revision": revision,
            "reason": "fingerprint_mismatch_or_missing",
        }
    emitted_summary = summary[: args.max_chars]
    try:
        connection.execute("BEGIN IMMEDIATE")
        connection.execute(
            """UPDATE metrics
               SET hit_count = hit_count + 1,
                   emitted_summary_chars = emitted_summary_chars + ?
               WHERE id = 1""",
            (len(emitted_summary),),
        )
        connection.execute("COMMIT")
    except sqlite3.Error as exc:
        try:
            connection.execute("ROLLBACK")
        except sqlite3.Error:
            pass
        raise CacheError("cache_busy", "cache metric update failed") from exc
    return {
        "status": "fresh",
        "source": relative,
        "topic": topic,
        "revision": revision,
        "model": model,
        "created_at": created_at,
        "sha256": source_hash,
        "dependencies": dependencies,
        "summary": emitted_summary,
        "summary_chars": len(emitted_summary),
        "summary_truncated": len(summary) > len(emitted_summary),
    }


def command_list(connection: sqlite3.Connection, args: argparse.Namespace) -> dict:
    query = args.query or ""
    _validate_short(query, "query", 256) if query else None
    escaped_query = query.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    pattern = f"%{escaped_query}%"
    rows = connection.execute(
        """SELECT source, topic, revision, model, length(summary), created_at
           FROM entries
           WHERE source LIKE ? ESCAPE '\\' OR topic LIKE ? ESCAPE '\\'
           ORDER BY created_at DESC, source, topic
           LIMIT ?""",
        (pattern, pattern, args.limit),
    ).fetchall()
    return {
        "status": "ok",
        "query": query,
        "limit": args.limit,
        "entries": [
            {
                "source": row[0],
                "topic": row[1],
                "revision": row[2],
                "model": row[3],
                "summary_chars": row[4],
                "created_at": row[5],
            }
            for row in rows
        ],
    }


def command_stats(connection: sqlite3.Connection) -> dict:
    row = connection.execute(
        """SELECT hit_count, miss_count, stale_count, read_count,
                  emitted_source_chars, emitted_summary_chars
           FROM metrics WHERE id = 1"""
    ).fetchone()
    return {
        "status": "ok",
        "hit_count": row[0],
        "miss_count": row[1],
        "stale_count": row[2],
        "read_count": row[3],
        "emitted_source_chars": row[4],
        "emitted_summary_chars": row[5],
        "measurement_note": "Character emission counts are bounded activity proxies, not token or cost savings.",
    }


def build_parser() -> argparse.ArgumentParser:
    parser = SafeParser(
        description="Project-isolated SQLite cache for bounded, fingerprinted dev-team summaries."
    )
    parser.add_argument("--root", required=True, help="absolute canonical project root")
    parser.add_argument("--cache-dir", help="absolute cache directory (default: per-root user cache)")
    subparsers = parser.add_subparsers(dest="command", required=True)

    read = subparsers.add_parser("read", help="read a bounded numbered UTF-8 source excerpt and full-file hash")
    read.add_argument("--source", required=True, help="project-relative or absolute source path")
    read.add_argument("--start", type=_positive_int, default=1, help="first 1-based line (default: 1)")
    read.add_argument("--end", type=_positive_int, help="last 1-based line, inclusive")
    read.add_argument(
        "--max-chars",
        type=_bounded_positive(MAX_READ_CHARS),
        default=DEFAULT_READ_CHARS,
        help=f"maximum emitted excerpt characters (default: {DEFAULT_READ_CHARS}, max: {MAX_READ_CHARS})",
    )

    publish = subparsers.add_parser("publish", help="publish a bounded summary after current fingerprint validation")
    publish.add_argument("--source", required=True, help="project-relative or absolute primary source")
    publish.add_argument("--sha256", required=True, help="previously captured primary source SHA-256")
    publish.add_argument("--topic", required=True, help="summary topic key (max 256 characters)")
    publish.add_argument("--summary-file", required=True, help="UTF-8 file containing the derived summary")
    publish.add_argument("--model", required=True, help="model provenance label (max 128 characters)")
    publish.add_argument(
        "--dependency",
        action="append",
        default=[],
        metavar="PATH=SHA256",
        help=f"fingerprinted project dependency; repeat up to {MAX_DEPENDENCIES} times",
    )

    get = subparsers.add_parser("get", help="return a summary only when all current fingerprints match")
    get.add_argument("--source", required=True, help="project-relative or absolute primary source")
    get.add_argument("--topic", required=True, help="summary topic key")
    get.add_argument(
        "--max-chars",
        type=_bounded_positive(MAX_SUMMARY_CHARS),
        default=MAX_SUMMARY_CHARS,
        help=f"maximum emitted summary characters (default/max: {MAX_SUMMARY_CHARS})",
    )

    listing = subparsers.add_parser("list", help="list bounded index metadata only (never summary text)")
    listing.add_argument("--query", help="case-insensitive source/topic substring")
    listing.add_argument(
        "--limit",
        type=_bounded_positive(MAX_LIST_LIMIT),
        default=DEFAULT_LIST_LIMIT,
        help=f"maximum entries (default: {DEFAULT_LIST_LIMIT}, max: {MAX_LIST_LIMIT})",
    )

    subparsers.add_parser("stats", help="report counts and emitted-character proxies")
    return parser


def run(argv: list[str] | None = None) -> dict:
    parser = build_parser()
    args = parser.parse_args(argv)
    root = _canonical_root(args.root)
    cache_dir = _cache_dir(root, args.cache_dir)
    connection = _connect(root, cache_dir)
    try:
        if args.command == "read":
            return command_read(connection, root, args)
        if args.command == "publish":
            return command_publish(connection, root, args)
        if args.command == "get":
            return command_get(connection, root, args)
        if args.command == "list":
            return command_list(connection, args)
        if args.command == "stats":
            return command_stats(connection)
        raise CacheError("invalid_arguments", "unknown command")
    finally:
        connection.close()


def main(argv: list[str] | None = None) -> int:
    try:
        result = run(argv)
        print(json.dumps(result, ensure_ascii=False, separators=(",", ":")))
        return 0
    except CacheError as exc:
        print(
            json.dumps(
                {"status": "error", "error": {"code": exc.code, "message": exc.message}},
                ensure_ascii=False,
                separators=(",", ":"),
            ),
            file=sys.stderr,
        )
        return 2
    except (OSError, sqlite3.Error) as exc:
        # Deliberately omit exception details: they can include caller-provided
        # paths and SQLite contents.  CLI failures must not leak source data.
        print(
            json.dumps(
                {"status": "error", "error": {"code": "operation_failed", "message": "operation failed safely"}},
                separators=(",", ":"),
            ),
            file=sys.stderr,
        )
        return 2


if __name__ == "__main__":
    raise SystemExit(main())

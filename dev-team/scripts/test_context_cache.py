#!/usr/bin/env python3
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import unittest


SCRIPT = Path(__file__).with_name("context_cache.py")


class ContextCacheTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        base = Path(self.temp.name)
        self.root = base / "project"
        self.cache = base / "cache"
        self.root.mkdir()
        (self.root / "src").mkdir()
        self.source = self.root / "src" / "main.txt"
        self.source.write_text("alpha\nbeta\ngamma\n", encoding="utf-8")
        self.summary = base / "summary.txt"
        self.summary.write_text("a compact derived summary", encoding="utf-8")

    def tearDown(self) -> None:
        self.temp.cleanup()

    def cli(self, *args: str, root: Path | None = None, cache: Path | None = None, ok: bool = True):
        command = [
            sys.executable,
            str(SCRIPT),
            "--root",
            str(root or self.root),
            "--cache-dir",
            str(cache or self.cache),
            *args,
        ]
        result = subprocess.run(command, text=True, capture_output=True, timeout=15)
        if ok:
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertFalse(result.stderr)
            return json.loads(result.stdout)
        self.assertNotEqual(result.returncode, 0, result.stdout)
        self.assertNotIn("Traceback", result.stderr)
        return json.loads(result.stderr)

    def capture(self, path: str = "src/main.txt") -> dict:
        return self.cli("read", "--source", path)

    def publish(self, digest: str, *extra: str, source: str = "src/main.txt", topic: str = "overview") -> dict:
        return self.cli(
            "publish",
            "--source",
            source,
            "--sha256",
            digest,
            "--topic",
            topic,
            "--summary-file",
            str(self.summary),
            "--model",
            "test-model",
            *extra,
        )

    def test_read_hash_binding_and_numbered_range(self) -> None:
        result = self.cli(
            "read", "--source", "src/main.txt", "--start", "2", "--end", "3", "--max-chars", "100"
        )
        expected = hashlib.sha256(self.source.read_bytes()).hexdigest()
        self.assertEqual(result["sha256"], expected)
        self.assertEqual(result["source"], "src/main.txt")
        self.assertEqual(result["content"], "2: beta\n3: gamma")
        self.assertEqual(result["range"]["start"], 2)
        self.assertEqual(result["range"]["end"], 3)
        self.assertTrue(result["truncated"])

        db = sqlite3.connect(self.cache / "context-cache.sqlite3")
        try:
            columns = db.execute("SELECT source, topic, summary FROM entries").fetchall()
        finally:
            db.close()
        self.assertEqual(columns, [])

    def test_publish_get_and_metadata_only_list(self) -> None:
        digest = self.capture()["sha256"]
        published = self.publish(digest)
        self.assertEqual(published["status"], "published")
        got = self.cli("get", "--source", str(self.source), "--topic", "overview")
        self.assertEqual(got["status"], "fresh")
        self.assertEqual(got["summary"], "a compact derived summary")
        self.assertEqual(got["sha256"], digest)
        self.assertEqual(got["model"], "test-model")

        listing = self.cli("list", "--query", "main")
        self.assertEqual(len(listing["entries"]), 1)
        self.assertNotIn("summary", listing["entries"][0])
        self.assertEqual(listing["entries"][0]["summary_chars"], len("a compact derived summary"))

    def test_modified_and_deleted_primary_never_emit_stale_summary(self) -> None:
        digest = self.capture()["sha256"]
        self.publish(digest)
        self.source.write_text("changed\n", encoding="utf-8")
        stale = self.cli("get", "--source", "src/main.txt", "--topic", "overview")
        self.assertEqual(stale["status"], "stale")
        self.assertNotIn("summary", stale)

        self.source.unlink()
        stale_deleted = self.cli("get", "--source", "src/main.txt", "--topic", "overview")
        self.assertEqual(stale_deleted["status"], "stale")
        self.assertNotIn("summary", stale_deleted)

    def test_dependency_modification_and_deletion_are_stale(self) -> None:
        dependency = self.root / "src" / "dependency.txt"
        dependency.write_text("dep-v1\n", encoding="utf-8")
        source_hash = self.capture()["sha256"]
        dep_hash = self.cli("read", "--source", "src/dependency.txt")["sha256"]
        self.publish(source_hash, "--dependency", f"src/dependency.txt={dep_hash}")

        fresh = self.cli("get", "--source", "src/main.txt", "--topic", "overview")
        self.assertEqual(fresh["dependencies"], [{"source": "src/dependency.txt", "sha256": dep_hash}])
        dependency.write_text("dep-v2\n", encoding="utf-8")
        stale = self.cli("get", "--source", "src/main.txt", "--topic", "overview")
        self.assertEqual(stale["status"], "stale")
        self.assertNotIn("summary", stale)

        dependency.unlink()
        deleted = self.cli("get", "--source", "src/main.txt", "--topic", "overview")
        self.assertEqual(deleted["status"], "stale")
        self.assertNotIn("summary", deleted)

    def test_publish_rejects_old_primary_and_dependency_hashes(self) -> None:
        old_hash = self.capture()["sha256"]
        self.source.write_text("new contents\n", encoding="utf-8")
        error = self.cli(
            "publish", "--source", "src/main.txt", "--sha256", old_hash,
            "--topic", "overview", "--summary-file", str(self.summary), "--model", "test-model", ok=False
        )
        self.assertEqual(error["error"]["code"], "stale_fingerprint")

        dependency = self.root / "src" / "dependency.txt"
        dependency.write_text("old", encoding="utf-8")
        dep_hash = self.cli("read", "--source", "src/dependency.txt")["sha256"]
        dependency.write_text("new", encoding="utf-8")
        current_source = self.capture()["sha256"]
        error = self.cli(
            "publish", "--source", "src/main.txt", "--sha256", current_source,
            "--topic", "overview", "--summary-file", str(self.summary), "--model", "test-model",
            "--dependency", f"src/dependency.txt={dep_hash}", ok=False
        )
        self.assertEqual(error["error"]["code"], "stale_fingerprint")

    def test_explicit_cache_is_bound_to_canonical_root(self) -> None:
        self.capture()
        other = Path(self.temp.name) / "other-project"
        other.mkdir()
        (other / "file.txt").write_text("other", encoding="utf-8")
        error = self.cli("stats", root=other, cache=self.cache, ok=False)
        self.assertEqual(error["error"]["code"], "root_mismatch")

    def test_symlink_escape_credentials_and_nonregular_are_rejected(self) -> None:
        outside = Path(self.temp.name) / "outside.txt"
        outside.write_text("outside secret", encoding="utf-8")
        (self.root / "escape.txt").symlink_to(outside)
        error = self.cli("read", "--source", "escape.txt", ok=False)
        self.assertEqual(error["error"]["code"], "source_outside_root")
        self.assertNotIn("outside secret", json.dumps(error))

        (self.root / ".env").write_text("SECRET=value", encoding="utf-8")
        error = self.cli("read", "--source", ".env", ok=False)
        self.assertEqual(error["error"]["code"], "blocked_source")
        self.assertNotIn("SECRET", json.dumps(error))
        (self.root / ".env.example").write_text("NAME=placeholder", encoding="utf-8")
        self.assertEqual(self.cli("read", "--source", ".env.example")["status"], "ok")

        fifo = self.root / "pipe"
        os.mkfifo(fifo)
        error = self.cli("read", "--source", "pipe", ok=False)
        self.assertEqual(error["error"]["code"], "non_regular_file")
        error = self.cli("get", "--source", "src", "--topic", "anything", ok=False)
        self.assertEqual(error["error"]["code"], "non_regular_file")

    def test_output_caps_and_oversize_summary_binary_rejection(self) -> None:
        limited = self.cli("read", "--source", "src/main.txt", "--max-chars", "7")
        self.assertLessEqual(len(limited["content"]), 7)
        self.assertTrue(limited["truncated"])

        self.summary.write_text("s" * 7000, encoding="utf-8")
        digest = self.capture()["sha256"]
        error = self.cli(
            "publish", "--source", "src/main.txt", "--sha256", digest,
            "--topic", "overview", "--summary-file", str(self.summary), "--model", "test-model", ok=False
        )
        self.assertEqual(error["error"]["code"], "summary_too_large")
        self.summary.write_text("s" * 6000, encoding="utf-8")
        published = self.publish(digest)
        self.assertEqual(published["summary_chars"], 6000)
        got = self.cli("get", "--source", "src/main.txt", "--topic", "overview", "--max-chars", "11")
        self.assertEqual(len(got["summary"]), 11)
        self.assertTrue(got["summary_truncated"])

        binary = self.root / "src" / "binary.dat"
        binary.write_bytes(b"\xff\xfe")
        error = self.cli("read", "--source", "src/binary.dat", ok=False)
        self.assertEqual(error["error"]["code"], "non_utf8")
        nul = self.root / "src" / "nul.txt"
        nul.write_bytes(b"valid utf8\x00but not text")
        error = self.cli("read", "--source", "src/nul.txt", ok=False)
        self.assertEqual(error["error"]["code"], "non_text")
        large = self.root / "src" / "large.txt"
        large.write_bytes(b"x" * (5 * 1024 * 1024 + 1))
        error = self.cli("read", "--source", "src/large.txt", ok=False)
        self.assertEqual(error["error"]["code"], "file_too_large")

    def test_concurrent_publishers_preserve_index(self) -> None:
        sources = []
        for index in range(8):
            source = self.root / "src" / f"worker-{index}.txt"
            source.write_text(f"worker {index}\n", encoding="utf-8")
            digest = hashlib.sha256(source.read_bytes()).hexdigest()
            sources.append((source, digest))
        processes = []
        for index, (source, digest) in enumerate(sources):
            command = [
                sys.executable, str(SCRIPT), "--root", str(self.root), "--cache-dir", str(self.cache),
                "publish", "--source", str(source), "--sha256", digest,
                "--topic", f"topic-{index}", "--summary-file", str(self.summary), "--model", "parallel-test",
            ]
            processes.append(subprocess.Popen(command, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE))
        for process in processes:
            stdout, stderr = process.communicate(timeout=20)
            self.assertEqual(process.returncode, 0, stderr)
            self.assertEqual(json.loads(stdout)["status"], "published")
        listing = self.cli("list", "--limit", "100")
        self.assertEqual(len(listing["entries"]), 8)
        self.assertEqual({item["topic"] for item in listing["entries"]}, {f"topic-{i}" for i in range(8)})

    def test_stats_are_nonnegative_and_use_proxy_language(self) -> None:
        digest = self.capture()["sha256"]
        self.publish(digest)
        self.cli("get", "--source", "src/main.txt", "--topic", "overview")
        self.cli("get", "--source", "src/main.txt", "--topic", "missing")
        self.source.write_text("changed", encoding="utf-8")
        self.cli("get", "--source", "src/main.txt", "--topic", "overview")
        stats = self.cli("stats")
        fields = [
            "hit_count", "miss_count", "stale_count", "read_count",
            "emitted_source_chars", "emitted_summary_chars",
        ]
        self.assertTrue(all(isinstance(stats[field], int) and stats[field] >= 0 for field in fields))
        self.assertGreaterEqual(stats["hit_count"], 1)
        self.assertGreaterEqual(stats["miss_count"], 1)
        self.assertGreaterEqual(stats["stale_count"], 1)
        self.assertIn("not token or cost savings", stats["measurement_note"])


if __name__ == "__main__":
    unittest.main(verbosity=2)

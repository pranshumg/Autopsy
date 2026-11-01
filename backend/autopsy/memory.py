"""Shared agent memory (the blackboard).

Agents talk only through this interface:
    write_fact(key, value, author)      durable findings ("noise_floor", "effect:age", ...)
    read_facts(prefix="")               -> {key: value}
    post_message(msg)                   msg = {from, to, type, content, reason}
    read_messages(to=None, status=None) -> [msg, ...]
    resolve(msg_id)                     mark a message handled

Two backends: SQLite (default, zero setup) and Meko via its MCP endpoint.
Raw probe results never go here; they go in the probes table (autopsy/probes.py).
"""

from __future__ import annotations

import itertools
import json
import sqlite3
import threading
import time
from abc import ABC, abstractmethod
from typing import Any

import httpx

from autopsy import config

Message = dict[str, Any]


class Memory(ABC):
    @abstractmethod
    def write_fact(self, key: str, value: Any, author: str) -> None: ...

    @abstractmethod
    def read_facts(self, prefix: str = "") -> dict[str, Any]: ...

    @abstractmethod
    def post_message(self, msg: Message) -> Message: ...

    @abstractmethod
    def read_messages(self, to: str | None = None, status: str | None = None) -> list[Message]: ...

    @abstractmethod
    def resolve(self, msg_id: int) -> None: ...

    def read_fact(self, key: str, default: Any = None) -> Any:
        return self.read_facts(key).get(key, default)

    def next_open(self) -> Message | None:
        """Oldest open message (FIFO routing for the orchestrator)."""
        open_ = self.read_messages(status="open")
        return open_[0] if open_ else None


class SQLiteMemory(Memory):
    def __init__(self, run_id: str, path: str | None = None):
        self.run_id = run_id
        self.db = sqlite3.connect(path or str(config.DATA_DIR / "autopsy.db"), check_same_thread=False)
        self.lock = threading.Lock()
        with self.lock:
            self.db.executescript(
                """
                CREATE TABLE IF NOT EXISTS facts (run TEXT, key TEXT, value TEXT, author TEXT, t REAL, PRIMARY KEY (run, key));
                CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY AUTOINCREMENT, run TEXT, sender TEXT, recipient TEXT,
                    type TEXT, content TEXT, reason TEXT, status TEXT, t REAL);
                """
            )
            self.db.commit()

    def write_fact(self, key, value, author):
        with self.lock:
            self.db.execute("INSERT OR REPLACE INTO facts VALUES (?,?,?,?,?)", (self.run_id, key, json.dumps(value), author, time.time()))
            self.db.commit()

    def read_facts(self, prefix=""):
        with self.lock:
            rows = self.db.execute("SELECT key, value FROM facts WHERE run=? AND key LIKE ?", (self.run_id, prefix + "%")).fetchall()
        return {k: json.loads(v) for k, v in rows}

    def post_message(self, msg):
        with self.lock:
            cur = self.db.execute(
                "INSERT INTO messages (run, sender, recipient, type, content, reason, status, t) VALUES (?,?,?,?,?,?,?,?)",
                (self.run_id, msg["from"], msg["to"], msg["type"], json.dumps(msg.get("content", {})), msg.get("reason", ""), "open", time.time()),
            )
            self.db.commit()
            return {**msg, "id": cur.lastrowid, "status": "open"}

    def read_messages(self, to=None, status=None):
        q, args = "SELECT id, sender, recipient, type, content, reason, status, t FROM messages WHERE run=?", [self.run_id]
        if to:
            q, args = q + " AND recipient=?", args + [to]
        if status:
            q, args = q + " AND status=?", args + [status]
        with self.lock:
            rows = self.db.execute(q + " ORDER BY id", args).fetchall()
        return [
            {"id": i, "from": s, "to": r, "type": ty, "content": json.loads(c), "reason": re, "status": st, "t": t}
            for i, s, r, ty, c, re, st, t in rows
        ]

    def resolve(self, msg_id):
        with self.lock:
            self.db.execute("UPDATE messages SET status='done' WHERE id=?", (msg_id,))
            self.db.commit()


class MekoMemory(Memory):
    """Meko over its MCP endpoint (JSON-RPC `tools/call`).

    Facts and messages are stored as Meko memories tagged with the run id; a local
    mirror keeps routing fast and deterministic. If Meko is unreachable the run
    continues on the mirror and a warning is recorded.
    """

    def __init__(self, run_id: str):
        if not config.MEKO_URL:
            raise RuntimeError("AUTOPSY_MEMORY=meko needs AUTOPSY_MEKO_URL (the Meko MCP endpoint).")
        self.run_id = run_id
        self.mirror = SQLiteMemory(run_id, ":memory:")
        self.ids = itertools.count(1)
        self.errors = 0
        headers = {"content-type": "application/json", "accept": "application/json, text/event-stream"}
        if config.MEKO_TOKEN:
            headers["authorization"] = f"Bearer {config.MEKO_TOKEN}"
        self.http = httpx.Client(timeout=10, headers=headers)

    def _call(self, tool: str, arguments: dict) -> Any:
        body = {"jsonrpc": "2.0", "id": next(self.ids), "method": "tools/call", "params": {"name": tool, "arguments": arguments}}
        try:
            r = self.http.post(config.MEKO_URL, json=body)
            r.raise_for_status()
            text = r.text
            if text.startswith("event:") or "\ndata:" in text:  # streamable HTTP response
                text = next(line[5:] for line in text.splitlines() if line.startswith("data:"))
            return json.loads(text).get("result")
        except Exception:  # noqa: BLE001 - remote memory is best effort
            self.errors += 1
            return None

    def write_fact(self, key, value, author):
        self.mirror.write_fact(key, value, author)
        self._call("add_memory", {"content": json.dumps({"kind": "fact", "key": key, "value": value, "author": author}), "tags": ["autopsy", self.run_id, "fact"]})

    def read_facts(self, prefix=""):
        return self.mirror.read_facts(prefix)

    def post_message(self, msg):
        saved = self.mirror.post_message(msg)
        self._call("add_memory", {"content": json.dumps({"kind": "message", **saved}), "tags": ["autopsy", self.run_id, "message", f"to:{msg['to']}"]})
        return saved

    def read_messages(self, to=None, status=None):
        return self.mirror.read_messages(to, status)

    def resolve(self, msg_id):
        self.mirror.resolve(msg_id)


def make_memory(run_id: str) -> Memory:
    if config.MEMORY_BACKEND == "meko":
        return MekoMemory(run_id)
    return SQLiteMemory(run_id)

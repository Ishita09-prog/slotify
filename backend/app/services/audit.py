"""Append-only, hash-chained audit ledger (same scheme as the Command Centre's browser ledger).

hash_n = SHA-256(seq|at|actorId|role|action|entity|detail|source|hash_{n-1}). Any edit, deletion or
reordering breaks the chain from that entry on. Production: persist to an append-only table and anchor
the head hash to WORM object storage every few minutes.
"""
from __future__ import annotations

import hashlib
import threading
from datetime import datetime, timedelta, timezone

GENESIS = "0" * 64
IST = timezone(timedelta(hours=5, minutes=30))


def _canonical(e: dict) -> str:
    return "|".join(str(e[k]) for k in ("seq", "at", "actorId", "role", "action", "entity", "detail", "source", "prevHash"))


class Ledger:
    def __init__(self):
        self.entries: list[dict] = []
        self._lock = threading.Lock()

    def append(self, *, actor: str, actor_id: str, role: str, action: str, entity: str, detail: str, source: str) -> dict:
        with self._lock:
            prev = self.entries[-1]["hash"] if self.entries else GENESIS
            e = {
                "seq": len(self.entries) + 1,
                "at": datetime.now(IST).isoformat(timespec="milliseconds"),
                "actor": actor, "actorId": actor_id, "role": role, "action": action,
                "entity": entity, "detail": detail, "source": source, "prevHash": prev,
            }
            e["hash"] = hashlib.sha256(_canonical(e).encode()).hexdigest()
            self.entries.append(e)
            return e

    def verify(self) -> dict:
        prev = GENESIS
        for e in self.entries:
            if e["prevHash"] != prev or hashlib.sha256(_canonical(e).encode()).hexdigest() != e["hash"]:
                return {"ok": False, "brokenAt": e["seq"], "checked": e["seq"]}
            prev = e["hash"]
        return {"ok": True, "checked": len(self.entries), "head": prev}


ledger = Ledger()

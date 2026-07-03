"""长期记忆库：SQLite 存储 + 向量召回（相关性 × 重要性 × 时近性）。"""
import json
import os
import sqlite3
import time

import numpy as np

DATA_DIR = os.environ.get("DATA_DIR", os.path.join(os.path.dirname(__file__), "..", "..", "data"))
DB_PATH = os.path.join(DATA_DIR, "memories.db")

SCHEMA = """
CREATE TABLE IF NOT EXISTS memories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts INTEGER NOT NULL,            -- 记忆发生时间
    kind TEXT NOT NULL,             -- summary / fact / event / inside_joke ...
    text TEXT NOT NULL,
    importance REAL NOT NULL,       -- 0~1
    embedding BLOB NOT NULL,
    source TEXT NOT NULL DEFAULT 'chatlog'  -- chatlog / game
);
CREATE TABLE IF NOT EXISTS chat_turns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts INTEGER NOT NULL,
    player TEXT NOT NULL,
    role TEXT NOT NULL,             -- user / cat
    text TEXT NOT NULL,
    archived INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS player_state (
    player TEXT PRIMARY KEY,
    last_seen INTEGER NOT NULL
);
"""

DECAY_HALF_LIFE_DAYS = 90.0


def get_db():
    os.makedirs(DATA_DIR, exist_ok=True)
    db = sqlite3.connect(DB_PATH)
    db.executescript(SCHEMA)
    return db


def add_memory(db, ts, kind, text, importance, embedding, source="chatlog"):
    vec = np.asarray(embedding, dtype=np.float32)
    db.execute(
        "INSERT INTO memories (ts, kind, text, importance, embedding, source) VALUES (?,?,?,?,?,?)",
        (ts, kind, text, importance, vec.tobytes(), source),
    )


def recall(db, query_embedding, k=8, now=None):
    """按 相关性 × 重要性 × 时近性 打分取 top-k。"""
    now = now or time.time()
    rows = db.execute("SELECT id, ts, kind, text, importance, embedding FROM memories").fetchall()
    if not rows:
        return []
    q = np.asarray(query_embedding, dtype=np.float32)
    q = q / (np.linalg.norm(q) + 1e-8)
    scored = []
    for mid, ts, kind, text, imp, blob in rows:
        v = np.frombuffer(blob, dtype=np.float32)
        rel = float(np.dot(q, v / (np.linalg.norm(v) + 1e-8)))
        age_days = max(0.0, (now - ts) / 86400.0)
        recency = 0.5 ** (age_days / DECAY_HALF_LIFE_DAYS)
        score = rel * 0.6 + imp * 0.25 + recency * 0.15
        scored.append((score, mid, ts, kind, text))
    scored.sort(reverse=True)
    return [{"id": m, "ts": ts, "kind": k_, "text": t} for _, m, ts, k_, t in scored[:k]]


def random_memories(db, k=3, min_importance=0.5):
    rows = db.execute(
        "SELECT ts, kind, text FROM memories WHERE importance >= ? ORDER BY RANDOM() LIMIT ?",
        (min_importance, k),
    ).fetchall()
    return [{"ts": ts, "kind": kd, "text": t} for ts, kd, t in rows]


def log_turn(db, player, role, text):
    db.execute(
        "INSERT INTO chat_turns (ts, player, role, text) VALUES (?,?,?,?)",
        (int(time.time()), player, role, text),
    )
    db.commit()


def recent_turns(db, player, n=10):
    rows = db.execute(
        "SELECT role, text FROM chat_turns WHERE player=? ORDER BY id DESC LIMIT ?",
        (player, n),
    ).fetchall()
    return list(reversed(rows))


def unarchived_turns(db):
    return db.execute(
        "SELECT id, ts, player, role, text FROM chat_turns WHERE archived=0 ORDER BY id"
    ).fetchall()


def mark_archived(db, ids):
    db.executemany("UPDATE chat_turns SET archived=1 WHERE id=?", [(i,) for i in ids])
    db.commit()


def touch_player(db, player):
    now = int(time.time())
    row = db.execute("SELECT last_seen FROM player_state WHERE player=?", (player,)).fetchone()
    db.execute(
        "INSERT INTO player_state (player, last_seen) VALUES (?,?) "
        "ON CONFLICT(player) DO UPDATE SET last_seen=?",
        (player, now, now),
    )
    db.commit()
    return row[0] if row else None

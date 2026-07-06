"""长期记忆库：SQLite 存储 + 向量召回（相关性 × 重要性 × 时近性）。"""
import json
import os
import random
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
CREATE TABLE IF NOT EXISTS pet_state (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    hunger REAL NOT NULL,
    clean REAL NOT NULL,
    mood REAL NOT NULL,
    illness TEXT,
    yb INTEGER NOT NULL,
    last_bonus INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS inventory (
    item TEXT PRIMARY KEY,
    count INTEGER NOT NULL
);
"""

# ==== QQ宠物式养成机制（简化移植：饱腹/清洁/心情/健康 + 元宝 + 商店 + 背包 + 疾病）====

PET_DEFAULTS = {"hunger": 80.0, "clean": 80.0, "mood": 75.0, "yb": 300}
STARTER_ITEMS = {"小鱼干": 3, "香皂": 1}
HUNGER_DECAY_PER_HOUR = 4.0
CLEAN_DECAY_PER_HOUR = 3.0
MOOD_DECAY_PER_HOUR = 2.0
STAT_MAX = 100.0
HEALTH_NORMAL = 5
LOGIN_BONUS_YB = 20
LOGIN_BONUS_COOLDOWN = 20 * 3600

# 商店（参考 QQ宠物物品分类：食物/清洁/玩具/药品）
SHOP = {
    "小鱼干": {"kind": "food", "price": 10, "hunger": 15, "mood": 2, "desc": "喂一喂，垫垫肚子"},
    "猫罐头": {"kind": "food", "price": 30, "hunger": 40, "mood": 5, "desc": "香喷喷的大餐"},
    "大鱼大肉": {"kind": "food", "price": 60, "hunger": 80, "mood": 8, "desc": "吃到扶墙"},
    "香皂": {"kind": "clean", "price": 15, "clean": 30, "desc": "简单洗一洗"},
    "沐浴露": {"kind": "clean", "price": 40, "clean": 80, "desc": "洗得香喷喷"},
    "毛线球": {"kind": "toy", "price": 20, "mood": 25, "desc": "玩到飞起"},
    "板蓝根": {"kind": "medicine", "price": 25, "cure": "感冒", "desc": "治感冒"},
    "枇杷糖浆": {"kind": "medicine", "price": 25, "cure": "咳嗽", "desc": "治咳嗽"},
    "消食片": {"kind": "medicine", "price": 25, "cure": "肚子胀", "desc": "治肚子胀"},
}

ILLNESSES = ["感冒", "咳嗽", "肚子胀"]

CARE_EFFECTS = {
    "play": {"mood": 8.0},
    "pet": {"mood": 3.0},
}


def _clamp(v):
    return max(0.0, min(STAT_MAX, v))


def _pet_row(db, now):
    row = db.execute(
        "SELECT hunger, clean, mood, illness, yb, last_bonus, updated_at FROM pet_state WHERE id=1"
    ).fetchone()
    if row is None:
        d = PET_DEFAULTS
        db.execute(
            "INSERT INTO pet_state (id, hunger, clean, mood, illness, yb, last_bonus, updated_at) "
            "VALUES (1,?,?,?,NULL,?,0,?)",
            (d["hunger"], d["clean"], d["mood"], d["yb"], now),
        )
        db.executemany(
            "INSERT OR IGNORE INTO inventory (item, count) VALUES (?,?)", list(STARTER_ITEMS.items())
        )
        db.commit()
        return (d["hunger"], d["clean"], d["mood"], None, d["yb"], 0, now)
    return row


def get_inventory(db):
    return {item: count for item, count in db.execute("SELECT item, count FROM inventory WHERE count > 0")}


def _pet_dict(db, hunger, clean, mood, illness, yb):
    return {
        "hunger": round(hunger, 1),
        "clean": round(clean, 1),
        "mood": round(mood, 1),
        "health": HEALTH_NORMAL - 1 if illness else HEALTH_NORMAL,
        "illness": illness,
        "yb": yb,
        "inventory": get_inventory(db),
    }


def get_pet_state(db, now=None):
    """读取宠物状态：按离线时间衰减，饿到/脏到见底会随机生病（QQ宠物式）。"""
    now = int(now or time.time())
    hunger, clean, mood, illness, yb, last_bonus, updated_at = _pet_row(db, now)
    hours = max(0.0, (now - updated_at) / 3600.0)
    hunger = _clamp(hunger - hours * HUNGER_DECAY_PER_HOUR)
    clean = _clamp(clean - hours * CLEAN_DECAY_PER_HOUR)
    mood_decay = MOOD_DECAY_PER_HOUR * (2.0 if illness else 1.0)
    mood = _clamp(mood - hours * mood_decay)
    if illness is None and (hunger <= 0 or clean <= 0) and hours > 0:
        if random.random() < min(0.9, 0.15 * hours):
            illness = random.choice(ILLNESSES)
    db.execute(
        "UPDATE pet_state SET hunger=?, clean=?, mood=?, illness=?, updated_at=? WHERE id=1",
        (hunger, clean, mood, illness, now),
    )
    db.commit()
    return _pet_dict(db, hunger, clean, mood, illness, yb)


def grant_login_bonus(db):
    """每天上线送元宝（20 小时冷却）。返回本次发放数量。"""
    now = int(time.time())
    _, _, _, _, yb, last_bonus, _ = _pet_row(db, now)
    if now - last_bonus < LOGIN_BONUS_COOLDOWN:
        return 0
    db.execute("UPDATE pet_state SET yb=?, last_bonus=? WHERE id=1", (yb + LOGIN_BONUS_YB, now))
    db.commit()
    return LOGIN_BONUS_YB


def care_pet(db, action):
    """无消耗的照顾动作（play 逗猫 / pet 摸猫）。"""
    effects = CARE_EFFECTS.get(action)
    if effects is None:
        return None
    state = get_pet_state(db)
    mood = _clamp(state["mood"] + effects.get("mood", 0.0))
    db.execute("UPDATE pet_state SET mood=?, updated_at=? WHERE id=1", (mood, int(time.time())))
    db.commit()
    state["mood"] = round(mood, 1)
    return state


def buy_item(db, item):
    """商店购买。返回 (state, error)。"""
    spec = SHOP.get(item)
    if spec is None:
        return None, "商店里没有这个东西喵"
    state = get_pet_state(db)
    if state["yb"] < spec["price"]:
        return None, "元宝不够喵"
    db.execute("UPDATE pet_state SET yb=? WHERE id=1", (state["yb"] - spec["price"],))
    db.execute(
        "INSERT INTO inventory (item, count) VALUES (?,1) "
        "ON CONFLICT(item) DO UPDATE SET count=count+1",
        (item,),
    )
    db.commit()
    return get_pet_state(db), None


def use_item(db, item):
    """使用背包物品（吃/洗/玩/吃药）。返回 (state, error)。"""
    spec = SHOP.get(item)
    if spec is None:
        return None, "不认识这个东西喵"
    row = db.execute("SELECT count FROM inventory WHERE item=?", (item,)).fetchone()
    if not row or row[0] <= 0:
        return None, "背包里没有了，去商店买点吧"
    state = get_pet_state(db)
    if spec["kind"] == "medicine":
        if state["illness"] != spec["cure"]:
            return None, f"现在不需要吃{item}喵"
        db.execute("UPDATE pet_state SET illness=NULL WHERE id=1")
    else:
        hunger = _clamp(state["hunger"] + spec.get("hunger", 0))
        clean = _clamp(state["clean"] + spec.get("clean", 0))
        mood = _clamp(state["mood"] + spec.get("mood", 0))
        db.execute(
            "UPDATE pet_state SET hunger=?, clean=?, mood=?, updated_at=? WHERE id=1",
            (hunger, clean, mood, int(time.time())),
        )
    db.execute("UPDATE inventory SET count=count-1 WHERE item=?", (item,))
    db.commit()
    return get_pet_state(db), None

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

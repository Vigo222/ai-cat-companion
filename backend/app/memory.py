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
    growth REAL NOT NULL DEFAULT 0,
    illness TEXT,
    ill_since INTEGER NOT NULL DEFAULT 0,
    dead INTEGER NOT NULL DEFAULT 0,
    yb INTEGER NOT NULL,
    born INTEGER NOT NULL DEFAULT 0,
    last_bonus INTEGER NOT NULL DEFAULT 0,
    charm REAL NOT NULL DEFAULT 0,
    intel REAL NOT NULL DEFAULT 0,
    strong REAL NOT NULL DEFAULT 0,
    act_type TEXT,
    act_id TEXT,
    act_end INTEGER NOT NULL DEFAULT 0,
    study TEXT NOT NULL DEFAULT '{}',
    updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS inventory (
    item TEXT PRIMARY KEY,
    count INTEGER NOT NULL
);
"""

# ==== QQ宠物养成机制（数值/物品/疾病链均取自原版 v1.2.4 逆向数据）====

from .qqpet_activities import STUDY, WORK  # noqa: E402
from .qqpet_catalog import CATALOG  # noqa: E402

SHOP = {it["id"]: it for it in CATALOG}

PET_DEFAULTS = {"hunger": 2400.0, "clean": 2400.0, "mood": 75.0, "yb": 800}
STARTER_ITEMS = {"102010002": 3, "102020008": 1}  # 跳跳玉米鱼×3 + 妙味香皂×1（原版物品）
HUNGER_DECAY_PER_HOUR = 60.0
CLEAN_DECAY_PER_HOUR = 45.0
MOOD_DECAY_PER_HOUR = 2.0
MOOD_MAX = 100.0
HEALTH_NORMAL = 5
HUNGER_THRESHOLD = 720   # 原版：低于此值进入饥饿状态
CLEAN_THRESHOLD = 1080   # 原版：低于此值进入脏污状态
GROWTH_PER_HOUR = 100.0  # 成长速度（生病减半，死亡停止）
ILLNESS_WORSEN_HOURS = 24  # 生病拖着不治，每 24 小时恶化一级
LOGIN_BONUS_YB = 100
LOGIN_BONUS_COOLDOWN = 20 * 3600

# 原版疾病恶化链：疾病名 -> {health, cure(药品ID), next(恶化后的疾病)}
ILLNESS_CHAINS = {
    "感冒": {"health": 4, "cure": "10001", "next": "发烧"},
    "发烧": {"health": 3, "cure": "30004", "next": "重感冒"},
    "重感冒": {"health": 2, "cure": "20001", "next": "肺炎"},
    "肺炎": {"health": 1, "cure": "30001", "next": None},
    "咳嗽": {"health": 4, "cure": "10003", "next": "支气管炎"},
    "支气管炎": {"health": 3, "cure": "20003", "next": "哮喘"},
    "哮喘": {"health": 2, "cure": "30003", "next": "肺结核"},
    "肺结核": {"health": 1, "cure": "40003", "next": None},
    "肚子胀": {"health": 4, "cure": "10002", "next": "胃炎"},
    "胃炎": {"health": 3, "cure": "20002", "next": "胃溃疡"},
    "胃溃疡": {"health": 2, "cure": "30002", "next": "胃癌"},
    "胃癌": {"health": 1, "cure": "40002", "next": None},
}
ILLNESS_START = ["感冒", "咳嗽", "肚子胀"]
CURE_ALL_ID = "50001"   # 百草丹：包治百病
REVIVE_ID = "60001"     # 还魂丹：复活 + 治百病

# 等级经验值表（原版 400 级表前 100 级）
LEVEL_TABLE = [
    0, 100, 300, 600, 1100, 1800, 2800, 4200, 5900, 8000,
    10600, 13700, 17400, 21700, 26700, 32500, 39000, 46300, 54500, 63600,
    73700, 84800, 97000, 110400, 124900, 140600, 157600, 175900, 195600, 216700,
    239300, 263500, 289200, 316500, 345500, 376200, 408700, 443000, 479200, 517400,
    557500, 599600, 643800, 690100, 738600, 789300, 842300, 897700, 955400, 1015500,
    1078100, 1143200, 1210900, 1281200, 1354200, 1430000, 1508500, 1589800, 1674000, 1761100,
    1851200, 1944300, 2040500, 2139900, 2242400, 2348100, 2457100, 2569400, 2685100, 2804200,
    2926800, 3053000, 3182700, 3316000, 3453000, 3593700, 3738200, 3886500, 4038700, 4194900,
    4355000, 4519100, 4687300, 4859600, 5036100, 5216800, 5401800, 5591200, 5784900, 5983000,
    6185600, 6392700, 6604400, 6820700, 7041700, 7267500, 7498000, 7733300, 7973500, 8218600,
]

CARE_EFFECTS = {
    "play": {"mood": 8.0},
    "pet": {"mood": 3.0},
}


def get_level(growth):
    """原版：根据成长值计算等级与升级区间。"""
    for i in range(1, len(LEVEL_TABLE)):
        if growth < LEVEL_TABLE[i]:
            return i, LEVEL_TABLE[i - 1], LEVEL_TABLE[i]
    return len(LEVEL_TABLE), LEVEL_TABLE[-1], LEVEL_TABLE[-1]


def get_max_hunger_clean(level):
    """原版公式：3000 + 100 × min(等级, 30)。"""
    return 3000 + 100 * min(level, 30)


def _clamp(v, hi):
    return max(0.0, min(float(hi), v))


PET_COLS = (
    "hunger, clean, mood, growth, illness, ill_since, dead, yb, born, last_bonus, "
    "charm, intel, strong, act_type, act_id, act_end, study, updated_at"
)

# 学历阶段（原版 Goods.js getStudyLevel）：课时数 -> 阶段
SCHOOL_STAGES = [("xx", "小学", 9), ("zx", "中学", 20), ("dx", "大学", 40), ("yjs", "研究生", 10 ** 9)]
EDU_LABELS = {9: "小学", 20: "中学", 40: "大学"}
SUBJECT_NAMES = {s["subject"]: s["object"] for s in STUDY.values()}


def study_stage(hours):
    """根据某科目已学课时返回 (阶段key, 阶段名)。"""
    for key, name, up in SCHOOL_STAGES:
        if hours < up:
            return key, name
    return "yjs", "研究生"


def _pet_row(db, now):
    row = db.execute(f"SELECT {PET_COLS} FROM pet_state WHERE id=1").fetchone()
    if row is None:
        d = PET_DEFAULTS
        db.execute(
            "INSERT INTO pet_state (id, hunger, clean, mood, growth, illness, ill_since, dead, yb, born, last_bonus, updated_at) "
            "VALUES (1,?,?,?,0,NULL,0,0,?,?,0,?)",
            (d["hunger"], d["clean"], d["mood"], d["yb"], now, now),
        )
        db.executemany(
            "INSERT OR IGNORE INTO inventory (item, count) VALUES (?,?)", list(STARTER_ITEMS.items())
        )
        db.commit()
        return (d["hunger"], d["clean"], d["mood"], 0.0, None, 0, 0, d["yb"], now, 0, 0.0, 0.0, 0.0, None, None, 0, "{}", now)
    return row


def get_inventory(db):
    return {item: count for item, count in db.execute("SELECT item, count FROM inventory WHERE count > 0")}


def _activity_dict(act_type, act_id, act_end, now):
    if not act_type:
        return None
    spec = (WORK if act_type == "work" else STUDY).get(act_id)
    if spec is None:
        return None
    name = spec["name"] if act_type == "work" else spec["tolk_name"]
    total = (spec["use_time"] if act_type == "work" else spec["class_time"]) * 60
    return {"type": act_type, "id": act_id, "name": name, "end": act_end,
            "remain": max(0, act_end - now), "total": total}


def _pet_dict(db, hunger, clean, mood, growth, illness, dead, yb, born,
              charm, intel, strong, act_type, act_id, act_end, study, now):
    level, up_growth, next_growth = get_level(growth)
    max_hc = get_max_hunger_clean(level)
    if dead:
        health = 0
    elif illness:
        health = ILLNESS_CHAINS[illness]["health"]
    else:
        health = HEALTH_NORMAL
    return {
        "hunger": round(hunger, 1),
        "clean": round(clean, 1),
        "mood": round(mood, 1),
        "max_hunger": max_hc,
        "max_clean": max_hc,
        "max_mood": int(MOOD_MAX),
        "health": health,
        "max_health": HEALTH_NORMAL,
        "growth": round(growth, 1),
        "level": level,
        "up_growth": up_growth,
        "next_growth": next_growth,
        "growth_rate": int(GROWTH_PER_HOUR / (2 if illness else 1)) if not dead else 0,
        "age_hours": max(0, (now - born) // 3600),
        "illness": illness,
        "cure": ILLNESS_CHAINS[illness]["cure"] if illness else (REVIVE_ID if dead else None),
        "dead": bool(dead),
        "yb": yb,
        "charm": int(charm),
        "intel": int(intel),
        "strong": int(strong),
        "study": study,
        "activity": _activity_dict(act_type, act_id, act_end, now),
        "inventory": get_inventory(db),
    }


def get_pet_state(db, now=None):
    """读取宠物状态：离线衰减 + 成长积累 + 饿/脏诱发疾病 + 疾病恶化链 + 死亡（原版机制）。"""
    now = int(now or time.time())
    (hunger, clean, mood, growth, illness, ill_since, dead, yb, born, last_bonus,
     charm, intel, strong, act_type, act_id, act_end, study_json, updated_at) = _pet_row(db, now)
    study = json.loads(study_json or "{}")
    hours = max(0.0, (now - updated_at) / 3600.0)
    # 打工/学习到点结算（原版：消耗饱食/清洁，获得元宝/属性/课时）
    if act_type and not dead and now >= act_end:
        spec = (WORK if act_type == "work" else STUDY).get(act_id)
        if spec:
            hunger = max(0.0, hunger - spec["starve"])
            clean = max(0.0, clean - spec["clean"])
            charm += spec["charm"]
            intel += spec["intel"]
            strong += spec["strong"]
            if act_type == "work":
                yb += spec["yb"]
                db.execute("UPDATE pet_state SET yb=? WHERE id=1", (yb,))
            else:
                study[spec["subject"]] = study.get(spec["subject"], 0) + 1
        act_type, act_id, act_end = None, None, 0
        db.execute(
            "UPDATE pet_state SET charm=?, intel=?, strong=?, act_type=NULL, act_id=NULL, act_end=0, study=? WHERE id=1",
            (charm, intel, strong, json.dumps(study, ensure_ascii=False)),
        )
    if not dead:
        level, _, _ = get_level(growth)
        max_hc = get_max_hunger_clean(level)
        hunger = _clamp(hunger - hours * HUNGER_DECAY_PER_HOUR, max_hc)
        clean = _clamp(clean - hours * CLEAN_DECAY_PER_HOUR, max_hc)
        mood_decay = MOOD_DECAY_PER_HOUR * (2.0 if illness else 1.0)
        mood = _clamp(mood - hours * mood_decay, MOOD_MAX)
        growth += hours * GROWTH_PER_HOUR / (2 if illness else 1)
        if illness is None and (hunger < HUNGER_THRESHOLD or clean < CLEAN_THRESHOLD) and hours > 0:
            if random.random() < min(0.9, 0.15 * hours):
                illness = random.choice(ILLNESS_START)
                ill_since = now
        elif illness and now - ill_since > ILLNESS_WORSEN_HOURS * 3600:
            nxt = ILLNESS_CHAINS[illness]["next"]
            if nxt is None:
                dead, illness, ill_since = 1, None, 0
            else:
                illness, ill_since = nxt, now
    db.execute(
        "UPDATE pet_state SET hunger=?, clean=?, mood=?, growth=?, illness=?, ill_since=?, dead=?, updated_at=? WHERE id=1",
        (hunger, clean, mood, growth, illness, ill_since, dead, now),
    )
    db.commit()
    return _pet_dict(db, hunger, clean, mood, growth, illness, dead, yb, born,
                     charm, intel, strong, act_type, act_id, act_end, study, now)


def grant_login_bonus(db):
    """每天上线送元宝（20 小时冷却）。返回本次发放数量。"""
    now = int(time.time())
    row = _pet_row(db, now)
    yb, last_bonus = row[7], row[9]
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
    if state["dead"]:
        return state
    mood = _clamp(state["mood"] + effects.get("mood", 0.0), MOOD_MAX)
    db.execute("UPDATE pet_state SET mood=?, updated_at=? WHERE id=1", (mood, int(time.time())))
    db.commit()
    state["mood"] = round(mood, 1)
    return state


def _edu_unmet(study, education):
    """返回未达标的学历要求描述列表，如「小学语文毕业」。"""
    unmet = []
    for subject, hours_req in education.items():
        if study.get(subject, 0) < hours_req:
            unmet.append(f"{EDU_LABELS.get(hours_req, str(hours_req) + '课时')}{SUBJECT_NAMES.get(subject, subject)}毕业")
    return unmet


def start_work(db, job_id):
    """开始打工（原版：耗时 use_time 分钟，到点结算元宝/属性并扣饱食清洁）。返回 (state, error)。"""
    spec = WORK.get(job_id)
    if spec is None:
        return None, "没有这份工作喵"
    state = get_pet_state(db)
    if state["dead"]:
        return None, "宠物已经死亡，不能打工……"
    if state["activity"]:
        return None, f"正在{state['activity']['name']}中，忙不过来喵"
    if state["level"] < spec["need"]:
        return None, f"等级不够，{spec['name']}需要 {spec['need']} 级"
    unmet = _edu_unmet(state["study"], spec["education"])
    if unmet:
        return None, "学历不够，需要：" + "、".join(unmet)
    if state["hunger"] < spec["starve"]:
        return None, "太饿了，先吃点东西再去打工吧"
    if state["clean"] < spec["clean"]:
        return None, "太脏了，先洗个澡再去打工吧"
    now = int(time.time())
    db.execute(
        "UPDATE pet_state SET act_type='work', act_id=?, act_end=? WHERE id=1",
        (job_id, now + spec["use_time"] * 60),
    )
    db.commit()
    return get_pet_state(db), None


def start_study(db, subject):
    """开始上课（按科目当前学历阶段自动选课）。返回 (state, error)。"""
    state = get_pet_state(db)
    if state["dead"]:
        return None, "宠物已经死亡，不能上课……"
    if state["activity"]:
        return None, f"正在{state['activity']['name']}中，忙不过来喵"
    stage_key, _ = study_stage(state["study"].get(subject, 0))
    spec = STUDY.get(f"{stage_key}-{subject}")
    if spec is None:
        return None, "没有这门课程喵"
    if state["hunger"] < spec["starve"]:
        return None, "太饿了，先吃点东西再去上课吧"
    if state["clean"] < spec["clean"]:
        return None, "太脏了，先洗个澡再去上课吧"
    now = int(time.time())
    db.execute(
        "UPDATE pet_state SET act_type='study', act_id=?, act_end=? WHERE id=1",
        (spec["id"], now + spec["class_time"] * 60),
    )
    db.commit()
    return get_pet_state(db), None


def cancel_activity(db):
    """中途放弃打工/上课（无奖励无消耗）。"""
    db.execute("UPDATE pet_state SET act_type=NULL, act_id=NULL, act_end=0 WHERE id=1")
    db.commit()
    return get_pet_state(db)


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
    """使用背包物品（吃/洗/吃药/还魂）。返回 (state, error)。"""
    spec = SHOP.get(item)
    if spec is None:
        return None, "不认识这个东西喵"
    row = db.execute("SELECT count FROM inventory WHERE item=?", (item,)).fetchone()
    if not row or row[0] <= 0:
        return None, "背包里没有了，去商城买点吧"
    state = get_pet_state(db)
    now = int(time.time())
    if state["dead"]:
        if item != REVIVE_ID:
            return None, "宠物已经死亡，需要还魂丹才能复活……"
        max_hc = get_max_hunger_clean(state["level"])
        db.execute(
            "UPDATE pet_state SET dead=0, illness=NULL, ill_since=0, hunger=?, clean=?, mood=50, updated_at=? WHERE id=1",
            (_clamp(state["hunger"] + 500, max_hc), _clamp(state["clean"] + 500, max_hc), now),
        )
    elif spec["type"] == "medicine":
        if not state["illness"]:
            return None, "现在没有生病，不用吃药喵"
        if item not in (CURE_ALL_ID, REVIVE_ID) and item != ILLNESS_CHAINS[state["illness"]]["cure"]:
            return None, f"这药治不了{state['illness']}，要对症下药喵"
        db.execute("UPDATE pet_state SET illness=NULL, ill_since=0 WHERE id=1")
    else:
        max_hc = get_max_hunger_clean(state["level"])
        hunger = _clamp(state["hunger"] + spec["starve"], max_hc)
        clean = _clamp(state["clean"] + spec["clean"], max_hc)
        mood = _clamp(state["mood"] + 2, MOOD_MAX)
        db.execute(
            "UPDATE pet_state SET hunger=?, clean=?, mood=?, updated_at=? WHERE id=1",
            (hunger, clean, mood, now),
        )
    db.execute("UPDATE inventory SET count=count-1 WHERE item=?", (item,))
    db.commit()
    return get_pet_state(db), None

DECAY_HALF_LIFE_DAYS = 90.0


def get_db():
    os.makedirs(DATA_DIR, exist_ok=True)
    db = sqlite3.connect(DB_PATH)
    cols = {r[1] for r in db.execute("PRAGMA table_info(pet_state)")}
    if cols and "growth" not in cols:  # 旧版（0~100 刻度）存档：重置为原版刻度
        db.executescript("DROP TABLE pet_state; DROP TABLE IF EXISTS inventory;")
        cols = set()
    db.executescript(SCHEMA)
    if cols and "act_type" not in cols:  # 老存档：补打工/学习相关列
        db.executescript(
            "ALTER TABLE pet_state ADD COLUMN charm REAL NOT NULL DEFAULT 0;"
            "ALTER TABLE pet_state ADD COLUMN intel REAL NOT NULL DEFAULT 0;"
            "ALTER TABLE pet_state ADD COLUMN strong REAL NOT NULL DEFAULT 0;"
            "ALTER TABLE pet_state ADD COLUMN act_type TEXT;"
            "ALTER TABLE pet_state ADD COLUMN act_id TEXT;"
            "ALTER TABLE pet_state ADD COLUMN act_end INTEGER NOT NULL DEFAULT 0;"
            "ALTER TABLE pet_state ADD COLUMN study TEXT NOT NULL DEFAULT '{}';"
        )
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

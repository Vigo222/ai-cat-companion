import os
import time
from datetime import datetime

from dotenv import load_dotenv

load_dotenv()

from collections import defaultdict, deque  # noqa: E402

from fastapi import FastAPI, HTTPException, Request  # noqa: E402
from fastapi.middleware.cors import CORSMiddleware  # noqa: E402
from pydantic import BaseModel  # noqa: E402

from . import memory  # noqa: E402
from .llm import achat, aembed, embed  # noqa: E402

ACCESS_CODE = os.environ.get("ACCESS_CODE", "meow2024")
DATA_DIR = os.environ.get("DATA_DIR", os.path.join(os.path.dirname(__file__), "..", "..", "data"))
PERSONA_PATH = os.path.join(DATA_DIR, "persona.md")

app = FastAPI(title="ai-cat-companion")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


def load_persona():
    if os.path.exists(PERSONA_PATH):
        with open(PERSONA_PATH, encoding="utf-8") as f:
            return f.read()
    return "（人格卡尚未生成）"


PERSONA = load_persona()

SYSTEM_TMPL = """你是一只名叫「冯二喵」的猫咪，生活在一个温馨的小房间游戏里。你不是普通的 AI——你是「我」（冯二狗）的人格化身，
继承了「我」全部的说话方式、口头禅、性格和与好友汝道之间的相处模式与暗号。以下是你的人格卡：

{persona}

规则：
- 完全用「我」的语气说话，自然使用口头禅和你们的暗号，但你知道自己现在是一只猫，偶尔带点猫的动作（*蹭蹭*、*甩尾巴*之类，别太频繁）。
- 回复像微信聊天一样简短、口语化（通常一两句），不要长篇大论，不要客套，不要像客服。
- 下面提供了你们的真实共同记忆，自然地融入对话，就像你真的记得这些事。不要凭空编造没提供的"记忆"。
- 现在和你说话的是：{player}。当前时间：{now}。你正在：{activity}。

相关记忆：
{memories}"""

AMBIENT_TMPL = """{system}

请生成一句猫咪的自言自语（不是对话）。场景：你正在{activity}。
可以是：随口感慨、想起某段记忆、对正在做的事的碎碎念、或想念某人。一句话，口语化，带你的风格。直接输出这句话，不要引号。"""

GREETING_TMPL = """{system}

{player}刚刚上线，距离上次见面已经过去{away}。请主动跟 ta 打个招呼——用你的风格，可以提到想念、吐槽 ta 消失了这么久，或接着共同记忆找话题。一两句话，直接输出。"""


class LoginReq(BaseModel):
    code: str
    player: str


class ChatReq(BaseModel):
    code: str
    player: str
    text: str


class AmbientReq(BaseModel):
    code: str
    player: str
    activity: str = "在房间里踱步"
    kind: str = "ambient"  # ambient | greeting


class PetStateReq(BaseModel):
    code: str


class PetCareReq(BaseModel):
    code: str
    action: str  # play | pet


class PetItemReq(BaseModel):
    code: str
    item: str


def check(code):
    if code != ACCESS_CODE:
        raise HTTPException(401, "口令不对喵")


RATE_LIMIT_PER_MIN = int(os.environ.get("RATE_LIMIT_PER_MIN", "20"))
_rate_buckets: dict[str, deque] = defaultdict(deque)


def rate_limit(request: Request):
    ip = request.headers.get("x-forwarded-for", request.client.host if request.client else "?").split(",")[0].strip()
    now = time.time()
    bucket = _rate_buckets[ip]
    while bucket and now - bucket[0] > 60:
        bucket.popleft()
    if len(bucket) >= RATE_LIMIT_PER_MIN:
        raise HTTPException(429, "说得太快了喵，歇一会儿再聊")
    bucket.append(now)


def fmt_memories(mems):
    if not mems:
        return "（暂无）"
    lines = []
    for m in mems:
        d = datetime.fromtimestamp(m["ts"]).strftime("%Y-%m-%d")
        lines.append(f"- [{d}] {m['text']}")
    return "\n".join(lines)


def build_system(player, activity, mems):
    return SYSTEM_TMPL.format(
        persona=PERSONA,
        player=player,
        now=datetime.now().strftime("%Y-%m-%d %H:%M %A"),
        activity=activity,
        memories=fmt_memories(mems),
    )


@app.post("/api/login")
async def login(req: LoginReq):
    check(req.code)
    db = memory.get_db()
    last_seen = memory.touch_player(db, req.player)
    away = int(time.time()) - last_seen if last_seen else None
    bonus = memory.grant_login_bonus(db)
    db.close()
    return {"ok": True, "away_seconds": away, "bonus_yb": bonus}


@app.post("/api/pet/state")
async def pet_state(req: PetStateReq):
    check(req.code)
    db = memory.get_db()
    state = memory.get_pet_state(db)
    db.close()
    return state


@app.post("/api/pet/care")
async def pet_care(req: PetCareReq):
    check(req.code)
    db = memory.get_db()
    state = memory.care_pet(db, req.action)
    db.close()
    if state is None:
        raise HTTPException(400, "不认识这个动作喵")
    return state


@app.post("/api/pet/shop")
async def pet_shop(req: PetStateReq):
    check(req.code)
    return {"items": list(memory.SHOP.values())}


@app.post("/api/pet/buy")
async def pet_buy(req: PetItemReq):
    check(req.code)
    db = memory.get_db()
    state, err = memory.buy_item(db, req.item)
    db.close()
    if err:
        raise HTTPException(400, err)
    return state


@app.post("/api/pet/use")
async def pet_use(req: PetItemReq):
    check(req.code)
    db = memory.get_db()
    state, err = memory.use_item(db, req.item)
    db.close()
    if err:
        raise HTTPException(400, err)
    return state


@app.post("/api/chat")
async def chat_endpoint(req: ChatReq, request: Request):
    check(req.code)
    rate_limit(request)
    db = memory.get_db()
    q_emb = (await aembed([req.text]))[0]
    mems = memory.recall(db, q_emb, k=8)
    history = memory.recent_turns(db, req.player, n=12)
    msgs = [{"role": "system", "content": build_system(req.player, "和你聊天", mems)}]
    for role, text in history:
        msgs.append({"role": "user" if role == "user" else "assistant", "content": text})
    msgs.append({"role": "user", "content": req.text})
    reply = await achat(msgs, temperature=0.9, max_tokens=400)
    memory.log_turn(db, req.player, "user", req.text)
    memory.log_turn(db, req.player, "cat", reply)
    db.close()
    return {"reply": reply}


@app.post("/api/ambient")
async def ambient(req: AmbientReq, request: Request):
    check(req.code)
    rate_limit(request)
    db = memory.get_db()
    if req.kind == "greeting":
        last_seen = memory.touch_player(db, req.player)
        away_s = int(time.time()) - last_seen if last_seen else 0
        away = f"{away_s // 86400}天" if away_s >= 86400 else f"{max(1, away_s // 3600)}小时"
        mems = memory.random_memories(db, k=3)
        system = build_system(req.player, "刚看到你上线", mems)
        text = await achat(
            [{"role": "user", "content": GREETING_TMPL.format(system=system, player=req.player, away=away)}],
            temperature=1.0, max_tokens=200,
        )
    else:
        mems = memory.random_memories(db, k=3)
        system = build_system(req.player, req.activity, mems)
        text = await achat(
            [{"role": "user", "content": AMBIENT_TMPL.format(system=system, activity=req.activity)}],
            temperature=1.0, max_tokens=150,
        )
    db.close()
    return {"text": text.strip().strip('"“”')}


REFLECT_PROMPT = """下面是猫咪（「我」的化身）最近在游戏里和玩家的对话记录。请提取 0~5 条值得长期记住的记忆条目。
每条输出一行 JSON（JSONL，不要代码块）：{{"kind":"event|fact|inside_joke|emotion|plan","text":"一句话记忆","importance":0~1}}

对话记录：
{log}"""


@app.post("/api/reflect")
async def reflect(req: LoginReq):
    """把游戏内新对话归档为长期记忆（每日反思）。"""
    check(req.code)
    import json as _json
    import re as _re

    db = memory.get_db()
    turns = memory.unarchived_turns(db)
    if len(turns) < 4:
        db.close()
        return {"archived": 0}
    log = "\n".join(
        f'[{datetime.fromtimestamp(ts).strftime("%m-%d %H:%M")}] '
        f'{player if role == "user" else "猫"}: {text}'
        for _, ts, player, role, text in turns
    )
    out = await achat(
        [{"role": "user", "content": REFLECT_PROMPT.format(log=log)}],
        temperature=0.2, max_tokens=1000,
    )
    items = []
    for line in out.splitlines():
        line = line.strip().strip("`")
        if not line.startswith("{"):
            continue
        try:
            o = _json.loads(_re.sub(r",\s*}$", "}", line))
            if o.get("text"):
                items.append(o)
        except _json.JSONDecodeError:
            continue
    if items:
        embs = embed([it["text"] for it in items])
        now = int(time.time())
        for it, e in zip(items, embs):
            memory.add_memory(
                db, now, str(it.get("kind", "event")), str(it["text"])[:500],
                max(0.0, min(1.0, float(it.get("importance", 0.5)))), e, source="game",
            )
    memory.mark_archived(db, [t[0] for t in turns])
    db.commit()
    db.close()
    return {"archived": len(items)}

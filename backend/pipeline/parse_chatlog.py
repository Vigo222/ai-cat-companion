"""Parse a ChatLab JSONL export into conversation sessions.

Usage: python parse_chatlog.py <chatlog.jsonl> <out_sessions.json>
"""
import json
import sys
from datetime import datetime

SESSION_GAP_SECONDS = 30 * 60

SELF_WXID = "wxid_hy3acjzjxgr822"   # 猫的人格来源（"我"）
FRIEND_WXID = "wxid_k47bak8dbo6622"  # 汝道

NAMES = {SELF_WXID: "我", FRIEND_WXID: "汝道"}


def load_messages(path):
    msgs = []
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            o = json.loads(line)
            if o.get("_type") != "message":
                continue
            if o.get("type", 0) != 0:
                continue  # 只保留纯文本
            content = (o.get("content") or "").strip()
            if not content or len(content) > 2000:
                continue
            sender = o.get("sender")
            if sender not in NAMES:
                continue
            msgs.append({
                "ts": o["timestamp"],
                "sender": NAMES[sender],
                "text": content,
            })
    msgs.sort(key=lambda m: m["ts"])
    return msgs


def split_sessions(msgs):
    sessions = []
    cur = []
    for m in msgs:
        if cur and m["ts"] - cur[-1]["ts"] > SESSION_GAP_SECONDS:
            sessions.append(cur)
            cur = []
        cur.append(m)
    if cur:
        sessions.append(cur)
    return sessions


def main():
    src, dst = sys.argv[1], sys.argv[2]
    msgs = load_messages(src)
    sessions = split_sessions(msgs)
    out = []
    for s in sessions:
        start = datetime.fromtimestamp(s[0]["ts"])
        out.append({
            "start_ts": s[0]["ts"],
            "end_ts": s[-1]["ts"],
            "date": start.strftime("%Y-%m-%d %H:%M"),
            "lines": [f'{m["sender"]}: {m["text"]}' for m in s],
        })
    with open(dst, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False)
    total = sum(len(s["lines"]) for s in out)
    print(f"messages={total} sessions={len(out)}")


if __name__ == "__main__":
    main()

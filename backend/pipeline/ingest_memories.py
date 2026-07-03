"""把会话分块批量摘要/分类/打分，embedding 后写入长期记忆库。

Usage: python -m pipeline.ingest_memories <sessions.json> [--limit N] [--resume]
"""
import argparse
import asyncio
import json
import os
import re
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app import memory  # noqa: E402
from app.llm import achat, aembed  # noqa: E402

CONCURRENCY = 8
BATCH_SESSIONS = 4  # 每次 API 调用合并的 session 数

SUMMARIZE_PROMPT = """下面是「我」和好友「汝道」的 {n} 段微信聊天（真实记录，段与段之间用 ===== 分隔，每段开头是日期）。
请为每段提取 0~3 条值得长期记住的「记忆条目」。值得记住的：具体事件、约定、彼此的喜好/雷点、玩笑梗和暗号、重要情绪时刻、生活近况。
不值得记住的：无信息量的寒暄、单纯转发。

对每条记忆输出一行 JSON（JSONL 格式，不要代码块），字段：
- "seg": 段序号（从1开始）
- "kind": "event"|"fact"|"inside_joke"|"emotion"|"plan"
- "text": 一句话记忆（中文，第三人称写「我」和「汝道」，含关键细节）
- "importance": 0~1 的重要性分数

聊天记录：
{chunks}"""


def parse_jsonl(text):
    items = []
    for line in text.splitlines():
        line = line.strip().strip("`")
        if not line.startswith("{"):
            continue
        try:
            o = json.loads(re.sub(r",\s*}$", "}", line))
            if "text" in o and "seg" in o:
                items.append(o)
        except json.JSONDecodeError:
            continue
    return items


async def process_batch(sem, batch):
    async with sem:
        chunks = []
        for i, s in enumerate(batch):
            body = "\n".join(s["lines"][:150])
            chunks.append(f"[第{i + 1}段 {s['date']}]\n{body}")
        prompt = SUMMARIZE_PROMPT.format(n=len(batch), chunks="\n\n=====\n\n".join(chunks))
        try:
            out = await achat([{"role": "user", "content": prompt}], temperature=0.2, max_tokens=2500)
        except Exception as e:
            print(f"  batch failed: {e}")
            return []
        results = []
        for it in parse_jsonl(out):
            seg = it.get("seg")
            if not isinstance(seg, int) or not (1 <= seg <= len(batch)):
                continue
            results.append({
                "ts": batch[seg - 1]["start_ts"],
                "kind": str(it.get("kind", "fact")),
                "text": str(it["text"])[:500],
                "importance": max(0.0, min(1.0, float(it.get("importance", 0.5)))),
            })
        return results


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("sessions")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--start", type=int, default=0)
    args = ap.parse_args()

    with open(args.sessions, encoding="utf-8") as f:
        sessions = json.load(f)
    sessions = sessions[args.start:]
    if args.limit:
        sessions = sessions[: args.limit]

    batches = [sessions[i:i + BATCH_SESSIONS] for i in range(0, len(sessions), BATCH_SESSIONS)]
    print(f"sessions={len(sessions)} batches={len(batches)}")

    db = memory.get_db()
    sem = asyncio.Semaphore(CONCURRENCY)
    done = 0
    total_mem = 0
    for group_start in range(0, len(batches), 40):
        group = batches[group_start:group_start + 40]
        results = await asyncio.gather(*[process_batch(sem, b) for b in group])
        items = [it for r in results for it in r]
        if items:
            embs = await aembed([it["text"] for it in items])
            for it, e in zip(items, embs):
                memory.add_memory(db, it["ts"], it["kind"], it["text"], it["importance"], e)
            db.commit()
            total_mem += len(items)
        done += len(group)
        print(f"progress: {done}/{len(batches)} batches, {total_mem} memories")
    print(f"DONE: {total_mem} memories")


if __name__ == "__main__":
    asyncio.run(main())

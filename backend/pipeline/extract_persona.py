"""Extract a persona card for the cat from chat sessions.

采样「我」的发言 + 双人对话片段，分块喂给 heavy 模型提炼特征，最后合并成人格卡。

Usage: python -m pipeline.extract_persona <sessions.json> <out_persona.md>
"""
import json
import random
import sys

sys.path.insert(0, __import__("os").path.join(__import__("os").path.dirname(__file__), ".."))

from app.llm import CHAT_MODEL_HEAVY, chat  # noqa: E402

CHUNK_PROMPT = """你是一位语言风格分析专家。下面是「我」和好友「汝道」的微信聊天片段（真实记录）。
请仔细分析「我」的说话风格，输出要点列表（中文）：
1. 口头禅/高频用语（原文摘录，含语气词、标点习惯）
2. 对汝道的称呼、汝道对「我」的称呼
3. 两人之间的暗号、梗、独有表达（解释含义）
4. 性格特质（从说话方式推断，附例句）
5. 相处模式（谁主动、如何开玩笑、如何关心对方）
只写有明确证据的内容，引用原句作为证据。

聊天片段：
{chunk}"""

MERGE_PROMPT = """下面是对同一个人（「我」）多个聊天片段的风格分析结果。请合并去重，写成一张最终「人格卡」，
将用于驱动一只代表「我」的 AI 猫咪与好友「汝道」互动。要求：
- Markdown 格式，分节：口头禅与语言习惯 / 称呼与暗号 / 性格特质 / 与汝道的相处模式 / 说话风格示例（10 句原文摘录）
- 保留高频、可靠的特征，丢弃孤例
- 尽量具体、可直接执行（例如"句尾常用『捏』"而不是"语气可爱"）

分析结果：
{analyses}"""


def main():
    src, dst = sys.argv[1], sys.argv[2]
    with open(src, encoding="utf-8") as f:
        sessions = json.load(f)

    random.seed(42)
    # 优先选对话密集的 session
    rich = [s for s in sessions if len(s["lines"]) >= 20]
    picked = random.sample(rich, min(60, len(rich)))

    chunks = []
    buf, size = [], 0
    for s in picked:
        text = f'[{s["date"]}]\n' + "\n".join(s["lines"][:120])
        buf.append(text)
        size += len(text)
        if size > 12000:
            chunks.append("\n\n---\n\n".join(buf))
            buf, size = [], 0
    if buf:
        chunks.append("\n\n---\n\n".join(buf))

    analyses = []
    for i, c in enumerate(chunks):
        print(f"analyzing chunk {i + 1}/{len(chunks)}...")
        analyses.append(chat(
            [{"role": "user", "content": CHUNK_PROMPT.format(chunk=c)}],
            model=CHAT_MODEL_HEAVY, temperature=0.3, max_tokens=4000,
        ))

    print("merging...")
    persona = chat(
        [{"role": "user", "content": MERGE_PROMPT.format(analyses="\n\n=====\n\n".join(analyses))}],
        model=CHAT_MODEL_HEAVY, temperature=0.3, max_tokens=6000,
    )
    with open(dst, "w", encoding="utf-8") as f:
        f.write(persona)
    print(f"persona card written to {dst} ({len(persona)} chars)")


if __name__ == "__main__":
    main()

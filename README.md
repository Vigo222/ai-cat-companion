# 🐾 ai-cat-companion（小凡的房间）

一款专属两人的私密网页游戏：一只卡通小猫「小凡」生活在温馨小房间里，它是「凡」的人格化身——继承口头禅、性格、和汝道之间的相处模式与暗号。猫咪自主行动、主动说话；所有互动经全自动记忆管道沉淀为长期记忆（类 AI Town 的 记忆流 + 反思 + 动态召回）。

## 架构

```
frontend/   Phaser 3 + Vite (TS)   房间场景、猫状态机、气泡、聊天框
backend/
  app/      FastAPI                /api/login /api/chat /api/ambient /api/reflect
  pipeline/ 离线管道               聊天记录解析 → 人格卡提取 → 记忆摘要/打分/embedding 入库
data/       (gitignored)           chatlog.jsonl / sessions.json / persona.md / memories.db
```

记忆召回打分：`相关性 × 0.6 + 重要性 × 0.25 + 时近性 × 0.15`（时近性按 90 天半衰期指数衰减）。

## 快速开始

```bash
cp .env.example .env   # 填入 API key

# 后端
cd backend
pip install -r requirements.txt

# 离线管道（首次）
python pipeline/parse_chatlog.py ../data/chatlog.jsonl ../data/sessions.json
python -m pipeline.extract_persona ../data/sessions.json ../data/persona.md
python -m pipeline.ingest_memories ../data/sessions.json

# 启动
uvicorn app.main:app --port 8000

# 前端
cd ../frontend
npm install
npm run dev   # http://localhost:5173
```

进入游戏：输入口令（.env 的 ACCESS_CODE）→ 选择「我是谁」→ 点击猫咪可聊天。

## 记忆系统

1. **人格卡**：离线一次性从「凡」的 5 万+ 条真实发言提取（口头禅/称呼/暗号/相处模式），写入 system prompt。
2. **长期记忆库**：全部历史聊天按 30 分钟间隔切成会话，LLM 摘要/分类/重要性打分后 embedding 入 SQLite；游戏内新对话通过 `/api/reflect` 每日反思归档。
3. **动态召回**：每轮对话把玩家消息 embed 后按加权分取 top-8 记忆注入 prompt；自言自语随机抽取高重要性记忆。

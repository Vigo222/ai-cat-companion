"""数据库自动备份到 Vercel Blob：启动时恢复，之后定时增量备份。

Render 免费档容器休眠/重新部署都会清空文件系统，
通过 BLOB_RW_TOKEN（Vercel Blob 读写令牌）把 SQLite 备份到外部存储。
"""

import asyncio
import os
import sqlite3
import tempfile

import httpx

from . import memory

BLOB_API = "https://blob.vercel-storage.com"
TOKEN = os.environ.get("BLOB_RW_TOKEN", "")
BLOB_PATH = "backup/memories.db"
INTERVAL = int(os.environ.get("BACKUP_INTERVAL_SEC", "300"))
KEEP = 3

_last_mtime = 0.0


def _headers():
    return {"Authorization": f"Bearer {TOKEN}", "x-api-version": "7"}


async def restore_if_missing():
    if not TOKEN or os.path.exists(memory.DB_PATH):
        return
    try:
        async with httpx.AsyncClient(timeout=60) as c:
            r = await c.get(f"{BLOB_API}/?prefix=backup/", headers=_headers())
            blobs = [b for b in r.json().get("blobs", []) if b["pathname"] == BLOB_PATH]
            if not blobs:
                return
            latest = max(blobs, key=lambda b: b["uploadedAt"])
            data = (await c.get(latest["url"])).content
            os.makedirs(memory.DATA_DIR, exist_ok=True)
            with open(memory.DB_PATH, "wb") as f:
                f.write(data)
            print(f"[backup] 已从 Blob 恢复数据库（{len(data)} 字节，{latest['uploadedAt']}）")
    except Exception as e:  # noqa: BLE001 - 恢复失败不阻断启动
        print(f"[backup] 恢复失败：{e}")


def _snapshot() -> bytes:
    fd, tmp = tempfile.mkstemp(suffix=".db")
    os.close(fd)
    try:
        src = sqlite3.connect(memory.DB_PATH)
        dst = sqlite3.connect(tmp)
        src.backup(dst)
        dst.close()
        src.close()
        with open(tmp, "rb") as f:
            return f.read()
    finally:
        os.unlink(tmp)


async def backup_once():
    global _last_mtime
    if not TOKEN or not os.path.exists(memory.DB_PATH):
        return
    mtime = os.path.getmtime(memory.DB_PATH)
    if mtime == _last_mtime:
        return
    data = _snapshot()
    async with httpx.AsyncClient(timeout=60) as c:
        await c.put(f"{BLOB_API}/{BLOB_PATH}", headers=_headers(), content=data)
        _last_mtime = mtime
        r = await c.get(f"{BLOB_API}/?prefix=backup/", headers=_headers())
        blobs = sorted(
            (b for b in r.json().get("blobs", []) if b["pathname"] == BLOB_PATH),
            key=lambda b: b["uploadedAt"],
        )
        stale = [b["url"] for b in blobs[:-KEEP]]
        if stale:
            await c.post(f"{BLOB_API}/delete", headers=_headers(), json={"urls": stale})


async def loop():
    while True:
        try:
            await backup_once()
        except Exception as e:  # noqa: BLE001 - 备份失败下轮重试
            print(f"[backup] 备份失败：{e}")
        await asyncio.sleep(INTERVAL)

import os

from dotenv import load_dotenv
from openai import AsyncOpenAI, OpenAI

load_dotenv()

CHAT_MODEL = os.environ.get("CHAT_MODEL", "gpt-5.4-mini")
CHAT_MODEL_HEAVY = os.environ.get("CHAT_MODEL_HEAVY", "gpt-5.5")
EMB_MODEL = os.environ.get("EMB_MODEL", "text-embedding-3-small")

# 网关 WAF 会拦截 openai-python 默认 User-Agent，用通用 UA 绕过
UA_HEADERS = {"User-Agent": "curl/8.4.0"}

chat_client = OpenAI(
    api_key=os.environ["CHAT_API_KEY"],
    base_url=os.environ.get("CHAT_BASE_URL", "https://api.openai.com/v1"),
    default_headers=UA_HEADERS,
    max_retries=4,
)
achat_client = AsyncOpenAI(
    api_key=os.environ["CHAT_API_KEY"],
    base_url=os.environ.get("CHAT_BASE_URL", "https://api.openai.com/v1"),
    default_headers=UA_HEADERS,
    max_retries=4,
)
emb_client = OpenAI(
    api_key=os.environ["EMB_API_KEY"],
    base_url=os.environ.get("EMB_BASE_URL", "https://api.openai.com/v1"),
    default_headers=UA_HEADERS,
    max_retries=4,
)
aemb_client = AsyncOpenAI(
    api_key=os.environ["EMB_API_KEY"],
    base_url=os.environ.get("EMB_BASE_URL", "https://api.openai.com/v1"),
    default_headers=UA_HEADERS,
    max_retries=4,
)


def chat(messages, model=None, temperature=0.8, max_tokens=2000):
    r = chat_client.chat.completions.create(
        model=model or CHAT_MODEL,
        messages=messages,
        temperature=temperature,
        max_tokens=max_tokens,
    )
    return r.choices[0].message.content


async def achat(messages, model=None, temperature=0.8, max_tokens=2000):
    r = await achat_client.chat.completions.create(
        model=model or CHAT_MODEL,
        messages=messages,
        temperature=temperature,
        max_tokens=max_tokens,
    )
    return r.choices[0].message.content


def embed(texts):
    r = emb_client.embeddings.create(model=EMB_MODEL, input=texts)
    return [d.embedding for d in r.data]


async def aembed(texts):
    r = await aemb_client.embeddings.create(model=EMB_MODEL, input=texts)
    return [d.embedding for d in r.data]

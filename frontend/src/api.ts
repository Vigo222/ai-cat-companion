/// <reference types="vite/client" />

export interface Session {
  code: string;
  player: string;
}

export const session: Session = { code: "", player: "" };

const API_BASE: string = import.meta.env.VITE_API_BASE ?? "";

const RETRYABLE = new Set([404, 502, 503, 504]);

async function post<T>(path: string, body: object): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const r = await fetch(API_BASE + path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (r.ok) return r.json();
    if (attempt < 2 && RETRYABLE.has(r.status)) {
      await new Promise((res) => setTimeout(res, 800 * (attempt + 1)));
      continue;
    }
    throw new Error(`${path} -> ${r.status}`);
  }
}

export function login(code: string, player: string) {
  return post<{ ok: boolean; away_seconds: number | null }>("/api/login", { code, player });
}

export function chat(text: string) {
  return post<{ reply: string }>("/api/chat", { ...session, text });
}

export function ambient(activity: string, kind: "ambient" | "greeting" = "ambient") {
  return post<{ text: string }>("/api/ambient", { ...session, activity, kind });
}

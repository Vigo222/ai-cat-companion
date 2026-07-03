export interface Session {
  code: string;
  player: string;
}

export const session: Session = { code: "", player: "" };

const API_BASE: string = import.meta.env.VITE_API_BASE ?? "";

async function post<T>(path: string, body: object): Promise<T> {
  const r = await fetch(API_BASE + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`${path} -> ${r.status}`);
  return r.json();
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

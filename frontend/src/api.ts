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
    const detail = await r.json().then((d) => d?.detail).catch(() => null);
    throw new Error(detail || `${path} -> ${r.status}`);
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

export interface PetState {
  hunger: number;
  clean: number;
  mood: number;
  max_hunger: number;
  max_clean: number;
  max_mood: number;
  health: number;
  max_health: number;
  growth: number;
  level: number;
  up_growth: number;
  next_growth: number;
  growth_rate: number;
  age_hours: number;
  illness: string | null;
  cure: string | null;
  dead: boolean;
  yb: number;
  inventory: Record<string, number>;
}

export interface ShopItem {
  id: string;
  name: string;
  type: "food" | "commodity" | "medicine";
  price: number;
  starve: number;
  clean: number;
  desc: string;
  rectype: string;
}

export function petState() {
  return post<PetState>("/api/pet/state", { code: session.code });
}

export function petCare(action: "play" | "pet") {
  return post<PetState>("/api/pet/care", { code: session.code, action });
}

export function petShop() {
  return post<{ items: ShopItem[] }>("/api/pet/shop", { code: session.code });
}

export function petBuy(item: string) {
  return post<PetState>("/api/pet/buy", { code: session.code, item });
}

export function petUse(item: string) {
  return post<PetState>("/api/pet/use", { code: session.code, item });
}

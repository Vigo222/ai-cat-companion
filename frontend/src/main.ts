import { chat, login, session } from "./api";
import { createGame, RoomScene } from "./RoomScene";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

interface PetCareStats {
  hunger: number;
  mood: number;
  updatedAt: number;
}

const STAT_MAX = 100;
const PET_CARE_KEY = "ai-cat-companion:pet-care";

function clampStat(v: number) {
  return Math.max(0, Math.min(STAT_MAX, Math.round(v)));
}

function loadPetCareStats(): PetCareStats {
  const fallback: PetCareStats = { hunger: 80, mood: 75, updatedAt: Date.now() };
  try {
    const raw = localStorage.getItem(PET_CARE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<PetCareStats>;
    const elapsedMinutes = Math.max(0, Math.floor((Date.now() - Number(parsed.updatedAt ?? Date.now())) / 60000));
    return {
      hunger: clampStat(Number(parsed.hunger ?? fallback.hunger) - elapsedMinutes),
      mood: clampStat(Number(parsed.mood ?? fallback.mood) - Math.floor(elapsedMinutes / 2)),
      updatedAt: Date.now(),
    };
  } catch {
    return fallback;
  }
}

function savePetCareStats(stats: PetCareStats) {
  localStorage.setItem(PET_CARE_KEY, JSON.stringify({ ...stats, updatedAt: Date.now() }));
}

function renderPetCareStats(stats: PetCareStats) {
  const hunger = clampStat(stats.hunger);
  const mood = clampStat(stats.mood);
  $("hungerFill").style.width = `${hunger}%`;
  $("moodFill").style.width = `${mood}%`;
  $("hungerValue").textContent = String(hunger);
  $("moodValue").textContent = String(mood);
}

function updatePetCareStats(stats: PetCareStats, delta: Partial<Omit<PetCareStats, "updatedAt">>) {
  stats.hunger = clampStat(stats.hunger + (delta.hunger ?? 0));
  stats.mood = clampStat(stats.mood + (delta.mood ?? 0));
  stats.updatedAt = Date.now();
  savePetCareStats(stats);
  renderPetCareStats(stats);
}

let who = "";
document.querySelectorAll<HTMLButtonElement>(".who button").forEach((b) => {
  b.addEventListener("click", () => {
    document.querySelectorAll(".who button").forEach((x) => x.classList.remove("sel"));
    b.classList.add("sel");
    who = b.dataset.who!;
  });
});

$("enterBtn").addEventListener("click", async () => {
  const code = ($("codeInput") as HTMLInputElement).value.trim();
  const err = $("loginErr");
  if (!code || !who) {
    err.textContent = "请输入口令并选择你是谁";
    return;
  }
  try {
    await login(code, who);
  } catch {
    err.textContent = "口令不对喵";
    return;
  }
  session.code = code;
  session.player = who;
  $("login").style.display = "none";
  startGame();
});

function startGame() {
  const game = createGame($("game"));
  game.events.once("ready", () => {
    const scene = game.scene.getScene("room") as RoomScene;
    setupChat(scene);
  });
}

function setupChat(scene: RoomScene) {
  const input = $("chatInput") as HTMLInputElement;
  const sendBtn = $("sendBtn") as HTMLButtonElement;
  const feedBtn = $("feedBtn") as HTMLButtonElement;
  const floatMsg = $("floatMsg");
  const petCareStats = loadPetCareStats();

  $("chatBar").classList.add("show");
  $("actionBar").classList.add("show");
  renderPetCareStats(petCareStats);
  window.setInterval(() => updatePetCareStats(petCareStats, { hunger: -1, mood: -1 }), 60000);

  scene.onCatClick = () => {
    scene.showBubble("喵？");
    input.focus();
  };
  scene.onLureComplete = () => updatePetCareStats(petCareStats, { mood: 8 });
  scene.onFeedComplete = () => updatePetCareStats(petCareStats, { hunger: 24, mood: 5 });

  // 玩家的话从输入条上方飘起
  const flyUserMsg = (text: string) => {
    floatMsg.textContent = text;
    floatMsg.classList.remove("fly");
    void floatMsg.offsetWidth; // 重置动画
    floatMsg.classList.add("fly");
  };

  // 长回复按句子切成多段云朵气泡，逐段打字机展示
  const speakReply = (reply: string) => {
    const chunks: string[] = [];
    let cur = "";
    for (const part of reply.split(/(?<=[。！？!?～~\n])/)) {
      if (cur && cur.length + part.length > 54) {
        chunks.push(cur.trim());
        cur = part;
      } else {
        cur += part;
      }
    }
    if (cur.trim()) chunks.push(cur.trim());

    let delay = 0;
    chunks.forEach((c, idx) => {
      window.setTimeout(() => {
        const dur = scene.showBubble(c);
        if (idx === chunks.length - 1) {
          window.setTimeout(() => scene.setChatting(false), dur);
        }
      }, delay);
      delay += Math.min(14000, 3000 + c.length * 150) + 250;
    });
  };

  let sending = false;
  const send = async () => {
    const text = input.value.trim();
    if (!text || sending) return;
    sending = true;
    sendBtn.disabled = true;
    input.value = "";
    flyUserMsg(text);
    scene.setChatting(true);
    scene.showBubble("……", true);
    try {
      const r = await chat(text);
      speakReply(r.reply);
    } catch {
      const dur = scene.showBubble("（小凡走神了，再说一次喵）");
      window.setTimeout(() => scene.setChatting(false), dur);
    } finally {
      sending = false;
      sendBtn.disabled = false;
      input.focus();
    }
  };
  feedBtn.addEventListener("click", () => {
    if (petCareStats.hunger >= 98) {
      scene.showBubble("已经吃饱啦，先陪我玩一会儿吧～");
      return;
    }
    feedBtn.disabled = true;
    scene.feedTreat();
    window.setTimeout(() => {
      feedBtn.disabled = false;
    }, 3600);
  });
  sendBtn.addEventListener("click", send);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") send();
  });
}

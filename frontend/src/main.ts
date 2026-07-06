import { chat, login, petBuy, petCare, petShop, petState, petUse, session } from "./api";
import type { PetState, ShopItem } from "./api";
import { createGame, RoomScene } from "./RoomScene";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const KIND_ICON: Record<ShopItem["kind"], string> = {
  food: "🐟",
  clean: "🧼",
  toy: "🧶",
  medicine: "💊",
};

let pet: PetState | null = null;
let shopItems: ShopItem[] = [];
const itemKind = (name: string) => shopItems.find((s) => s.name === name)?.kind;

function renderPet(scene: RoomScene) {
  if (!pet) return;
  const set = (fill: string, val: string, v: number) => {
    $(fill).style.width = `${Math.round(v)}%`;
    $(val).textContent = String(Math.round(v));
  };
  set("hungerFill", "hungerValue", pet.hunger);
  set("cleanFill", "cleanValue", pet.clean);
  set("moodFill", "moodValue", pet.mood);
  $("ybValue").textContent = String(pet.yb);
  $("illnessTag").textContent = pet.illness ? `🤒 ${pet.illness}` : "";
  scene.mood = pet.mood;
  renderBag(scene);
}

function renderBag(scene: RoomScene) {
  const list = $("bagList");
  list.innerHTML = "";
  const entries = Object.entries(pet?.inventory ?? {});
  if (entries.length === 0) {
    list.innerHTML = `<div class="empty">背包空空的，去商店买点吧</div>`;
    return;
  }
  for (const [name, count] of entries) {
    const kind = itemKind(name);
    const row = document.createElement("div");
    row.className = "itemRow";
    row.innerHTML = `<div class="info">${KIND_ICON[kind ?? "food"]} ${name} × ${count}</div>`;
    const btn = document.createElement("button");
    btn.textContent = "使用";
    btn.addEventListener("click", () => useItem(scene, name));
    row.appendChild(btn);
    list.appendChild(row);
  }
}

function renderShop(scene: RoomScene) {
  const list = $("shopList");
  list.innerHTML = "";
  for (const item of shopItems) {
    const row = document.createElement("div");
    row.className = "itemRow";
    row.innerHTML = `<div class="info">${KIND_ICON[item.kind]} ${item.name} · 🪙${item.price}<small>${item.desc}</small></div>`;
    const btn = document.createElement("button");
    btn.textContent = "购买";
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      try {
        pet = await petBuy(item.name);
        renderPet(scene);
        scene.showBubble(`买到${item.name}啦～`);
      } catch (e) {
        scene.showBubble((e as Error).message);
      } finally {
        btn.disabled = false;
      }
    });
    row.appendChild(btn);
    list.appendChild(row);
  }
}

async function useItem(scene: RoomScene, name: string) {
  const kind = itemKind(name);
  if (kind === "food" && pet && pet.hunger >= 98) {
    scene.showBubble("已经吃饱啦，先陪我玩一会儿吧～");
    return;
  }
  try {
    pet = await petUse(name);
    renderPet(scene);
    if (kind === "food" || kind === undefined) scene.feedTreat(name);
    else scene.useItem(kind, name);
  } catch (e) {
    scene.showBubble((e as Error).message);
  }
}

async function refreshPet(scene: RoomScene) {
  try {
    pet = await petState();
    renderPet(scene);
  } catch {
    /* API 不可用时静默 */
  }
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
    setupPetCare(scene);
  });
}

function setupPetCare(scene: RoomScene) {
  $("actionBar").classList.add("show");
  void petShop().then((r) => {
    shopItems = r.items;
    renderShop(scene);
    void refreshPet(scene);
  });
  window.setInterval(() => void refreshPet(scene), 60000);

  const togglePanel = (id: string) => {
    for (const pid of ["bagPanel", "shopPanel"]) {
      $(pid).classList.toggle("show", pid === id && !$(pid).classList.contains("show"));
    }
  };
  $("bagBtn").addEventListener("click", () => togglePanel("bagPanel"));
  $("shopBtn").addEventListener("click", () => togglePanel("shopPanel"));
  document.querySelectorAll<HTMLElement>(".panel .close").forEach((x) => {
    x.addEventListener("click", () => $(x.dataset.close!).classList.remove("show"));
  });

  scene.onPetComplete = () => {
    void petCare("pet").then((s) => {
      pet = s;
      renderPet(scene);
    });
  };
  scene.onLureComplete = () => {
    void petCare("play").then((s) => {
      pet = s;
      renderPet(scene);
    });
  };
}

function setupChat(scene: RoomScene) {
  const input = $("chatInput") as HTMLInputElement;
  const sendBtn = $("sendBtn") as HTMLButtonElement;
  const floatMsg = $("floatMsg");

  $("chatBar").classList.add("show");

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
      const dur = scene.showBubble("（冯二喵走神了，再说一次喵）");
      window.setTimeout(() => scene.setChatting(false), dur);
    } finally {
      sending = false;
      sendBtn.disabled = false;
      input.focus();
    }
  };
  sendBtn.addEventListener("click", send);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") send();
  });
}

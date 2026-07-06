import { chat, login, petBuy, petCare, petShop, petState, petUse, session } from "./api";
import type { PetState, ShopItem } from "./api";
import { createGame, RoomScene, W, H } from "./RoomScene";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const ICON = (id: string) => `/qqpet/items/${id}.gif`;
const TAB_LABEL: Record<ShopItem["type"], string> = { food: "食品", commodity: "清洁", medicine: "药品" };
const TABS: ShopItem["type"][] = ["food", "commodity", "medicine"];

let pet: PetState | null = null;
let shopItems: ShopItem[] = [];
const byId = (id: string) => shopItems.find((s) => s.id === id);

// ===== 状态面板（仿原版 stateInfo 小窗：等级骨头 + 成长条 + 彩色进度条素材）=====

function barColor(ratio: number) {
  return ratio > 0.6 ? "shenglan" : ratio > 0.3 ? "huangse" : "hongse";
}

function qqBar(color: string, ratio: number, valueText: string) {
  const pct = Math.max(0, Math.min(100, ratio * 100));
  return `<div class="valueLine"><div class="background_line" style="width:${pct}%">
    <div class="b_left" style="background-image:url(/qqpet/state/${color}jindutiao00.png)"></div>
    <div class="b_center"><div class="b_c_back" style="background-image:url(/qqpet/state/${color}jindutiao01.png)"></div></div>
    <div class="b_right" style="background-image:url(/qqpet/state/${color}jindutiao02.png)"></div>
  </div><div class="v_l_value">${valueText}</div></div>`;
}

function levelBones(level: number) {
  // 原版：等级用骨头图标表示（dengji3=40级 dengji2=20级 dengji1=10级 dengji=5级）
  let t = Math.trunc(level / 5);
  const b3 = Math.trunc(t / 8); t -= b3 * 8;
  const b2 = Math.trunc(t / 4); t -= b2 * 4;
  const b1 = Math.trunc(t / 2); t -= b1 * 2;
  const b0 = t + 1;
  const imgs: string[] = [];
  for (let i = 0; i < b3; i++) imgs.push("dengji3");
  for (let i = 0; i < b2; i++) imgs.push("dengji2");
  for (let i = 0; i < b1; i++) imgs.push("dengji1");
  for (let i = 0; i < b0; i++) imgs.push("dengji");
  return imgs.map((n) => `<img src="/qqpet/state/${n}.png" alt="" />`).join("");
}

function renderStatePanel() {
  if (!pet) return;
  const growSpan = Math.max(1, pet.next_growth - pet.up_growth);
  const growRatio = (pet.growth - pet.up_growth) / growSpan;
  const rows = [
    { lbl: "饥饿：", v: pet.hunger, max: pet.max_hunger },
    { lbl: "清洁：", v: pet.clean, max: pet.max_clean },
    { lbl: "健康：", v: pet.health, max: pet.max_health },
    { lbl: "心情：", v: pet.mood, max: pet.max_mood },
  ];
  const stateText = pet.dead
    ? `<span class="spDead">死亡了~（需还魂丹复活）</span>`
    : pet.illness
      ? `<span class="spSick">生病了~（${pet.illness}）</span>`
      : `成长中~`;
  $("statePanel").innerHTML = `
    <div id="spBg">
      <div class="bgRow bh"><div class="l"></div><div class="c"></div><div class="r"></div></div>
      <div class="bgRow bm"><div class="l"></div><div class="c"></div><div class="r"></div></div>
      <div class="bgRow bf"><div class="l"></div><div class="c"></div><div class="r"></div></div>
    </div>
    <div id="spContent">
      <div class="head"><div class="petFile" title="宠物资料"></div><div id="spClose" title="关闭"></div></div>
      <div class="main">
        <div class="onceInfo"><div class="label">昵称：</div><div class="value">冯二喵</div></div>
        <div class="onceInfo"><div class="label">等级：</div><div class="value">${pet.level}</div>
          <div class="bones">${levelBones(pet.level)}</div></div>
        <div class="onceInfo"><div class="label">年龄：</div><div class="value">${pet.age_hours}小时</div></div>
      </div>
      <div class="onceInfo onceInfoLine"><div class="label">成长：</div>
        ${qqBar("luse", growRatio, `${Math.round(pet.growth - pet.up_growth)} / ${growSpan}`)}</div>
      ${rows.map((r) => `<div class="onceInfo onceInfoLine"><div class="label">${r.lbl}</div>
        ${qqBar(barColor(r.v / r.max), r.v / r.max, `${Math.round(r.v)} / ${r.max}`)}</div>`).join("")}
      <div class="onceInfo onceInfoLine"><div class="label">成长速度：</div><div class="value">${pet.growth_rate}/小时</div></div>
      <div class="onceInfo onceInfoLine"><div class="label">元宝：</div><div class="value">${pet.yb}</div></div>
      <div class="onceInfo onceInfoLine"><div class="label">状态：</div><div class="value">${stateText}</div></div>
      <div class="foot">
        <div class="sweetHeart" style="background-image:url(/qqpet/state/h_down.png)"></div>
      </div>
    </div>`;
  $("spClose").addEventListener("click", () => $("statePanel").classList.remove("show"));
}

// ===== 原版 control 工具栏菜单：顶级圆形图标 + 悬停展开二级子菜单 =====

interface MenuChild { key: string; name: string; icon: string; disabled?: boolean }
interface MenuGroup { name: string; icon: string; children: MenuChild[] }
const MENU: MenuGroup[] = [
  {
    name: "日常", icon: "richang", children: [
      { key: "feed", name: "食物", icon: "weishi" },
      { key: "clean", name: "清洁", icon: "qingjie" },
      { key: "cure", name: "吃药", icon: "zhibing" },
      { key: "play", name: "玩耍", icon: "wanshua" },
    ],
  },
  {
    name: "交互", icon: "chongwu", children: [
      { key: "work", name: "打工", icon: "dagong", disabled: true },
      { key: "study", name: "学习", icon: "xuexi", disabled: true },
      { key: "trip", name: "旅游", icon: "lvyou", disabled: true },
    ],
  },
  {
    name: "活动", icon: "gonggao", children: [
      { key: "shop", name: "商城", icon: "cf" },
      { key: "bag", name: "背包", icon: "guanli" },
      { key: "state", name: "状态", icon: "chongwu" },
    ],
  },
];

function setupPetMenu(scene: RoomScene) {
  const menu = $("petMenu");
  const closeMenu = () => menu.classList.remove("show");

  scene.onCatClick = (cx, cy) => {
    if (menu.classList.contains("show")) { closeMenu(); return; }
    const canvas = document.querySelector<HTMLCanvasElement>("#game canvas");
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const sx = rect.left + (cx / W) * rect.width;
    const sy = rect.top + (cy / H) * rect.height;
    menu.innerHTML = "";
    MENU.forEach((g) => {
      const head = document.createElement("div");
      head.className = "m_head";
      head.innerHTML = `
        <div class="m_h_name">${g.name}</div>
        <div class="m_h_i_back">
          <img class="m_h_i_bk_6" src="/qqpet/control/bk/6.svg" alt="" />
          <img class="m_h_img" src="/qqpet/control/${g.icon}.png" alt="" />
        </div>
        <div class="m_children">${g.children.map((c) => `
          <div class="m_c_once normal${c.disabled ? " disabledItem" : ""}" data-key="${c.key}">
            <div class="m_c_o_bk">
              <div class="m_c_o_b_point"></div>
              <div class="m_c_o_b_round"><img src="/qqpet/control/${c.icon}.png" alt="" /></div>
              <div class="m_c_o_b_piece">${c.name}</div>
            </div>
          </div>`).join("")}
        </div>`;
      head.querySelectorAll<HTMLElement>(".m_c_once").forEach((el) => {
        const key = el.dataset.key!;
        const child = g.children.find((c) => c.key === key)!;
        el.addEventListener("pointerdown", (e) => {
          e.stopPropagation();
          e.preventDefault();
          if (child.disabled) { scene.showBubble("这个功能还没开放喵～"); return; }
          closeMenu();
          doMenuAction(scene, key);
        });
      });
      menu.appendChild(head);
    });
    const menuW = MENU.length * 50 + (MENU.length - 1) * 20;
    menu.style.left = `${Math.max(10, Math.min(window.innerWidth - menuW - 10, sx - menuW / 2))}px`;
    menu.style.top = `${Math.max(30, sy - 90)}px`;
    menu.classList.add("show");
  };
  document.addEventListener("pointerdown", (e) => {
    if (menu.classList.contains("show") && !menu.contains(e.target as Node)) closeMenu();
  }, true);
}

function doMenuAction(scene: RoomScene, key: string) {
  if (pet?.dead && key !== "shop" && key !== "bag" && key !== "state") {
    scene.showBubble("……（冯二喵已经死了，快去商城买还魂丹！）");
    return;
  }
  switch (key) {
    case "feed": openBag(scene, "food"); break;
    case "clean": openBag(scene, "commodity"); break;
    case "cure": openBag(scene, "medicine"); break;
    case "play":
      scene.playWithCat();
      break;
    case "shop": openShop(scene); break;
    case "bag": openBag(scene, bagTab); break;
    case "state": $("statePanel").classList.toggle("show"); break;
  }
}

// ===== 原版商城窗口（BG.png + 分类 tab + Card_Items 商品卡）=====

let shopTab: ShopItem["type"] = "food";
let shopSel: ShopItem | null = null;

function effectText(it: ShopItem) {
  if (it.type === "food") return `饱食 +${it.starve}`;
  if (it.type === "commodity") return `清洁 +${it.clean}`;
  return it.desc || "药品";
}

function renderShop(scene: RoomScene) {
  const win = $("shopWin");
  const items = shopItems.filter((s) => s.type === shopTab);
  if (!shopSel || shopSel.type !== shopTab) shopSel = items[0] ?? null;
  const badge = (t: string) =>
    ["hot", "new", "recommand"].includes(t) ? `<img class="badge" src="/qqpet/store/${t}.gif" alt="" />` : "";
  win.innerHTML = `
    <img class="winClose" src="/qqpet/state/close_normal.png" alt="关闭"
      onmouseover="this.src='/qqpet/state/close_over.png'" onmouseout="this.src='/qqpet/state/close_normal.png'" />
    <div id="shopPreview">${shopSel ? `
      <img src="${ICON(shopSel.id)}" alt="" />
      <div class="nm">${shopSel.name}</div>
      <div class="ds">${shopSel.desc || effectText(shopSel)}</div>` : ""}
    </div>
    <div id="shopDetail">${shopSel ? `
      <div class="row">价格：<span class="price">${shopSel.price} 元宝</span></div>
      <div class="row">效果：${effectText(shopSel)}</div>
      <div class="row">已拥有：${pet?.inventory[shopSel.id] ?? 0} 个</div>
      <button id="shopBuyBtn">购 买</button>` : ""}
    </div>
    <div id="shopYb">${pet?.yb ?? 0}</div>
    <div id="shopTabs">${TABS.map((t) =>
      `<div class="shopTab${t === shopTab ? " sel" : ""}" data-tab="${t}">${TAB_LABEL[t]}</div>`).join("")}
    </div>
    <div id="shopGrid">${items.map((it) => `
      <div class="goodCard${shopSel?.id === it.id ? " sel" : ""}" data-id="${it.id}">
        <img class="gi" src="${ICON(it.id)}" alt="" />
        <div class="gn">${it.name}</div>
        <div class="gp">${it.price} 元宝</div>
        <button data-buy="${it.id}">购买</button>
        ${badge(it.rectype)}
      </div>`).join("")}
    </div>`;

  win.querySelector(".winClose")!.addEventListener("click", () => win.classList.remove("show"));
  win.querySelectorAll<HTMLElement>(".shopTab").forEach((el) =>
    el.addEventListener("click", () => { shopTab = el.dataset.tab as ShopItem["type"]; shopSel = null; renderShop(scene); }));
  win.querySelectorAll<HTMLElement>(".goodCard").forEach((el) =>
    el.addEventListener("click", () => { shopSel = byId(el.dataset.id!) ?? null; renderShop(scene); }));
  win.querySelectorAll<HTMLButtonElement>("[data-buy]").forEach((btn) =>
    btn.addEventListener("click", (e) => { e.stopPropagation(); void buy(scene, btn.dataset.buy!); }));
  $("shopBuyBtn")?.addEventListener("click", () => { if (shopSel) void buy(scene, shopSel.id); });
}

async function buy(scene: RoomScene, id: string) {
  try {
    pet = await petBuy(id);
    scene.showBubble(`买到${byId(id)?.name ?? "东西"}啦～`);
  } catch (e) {
    scene.showBubble((e as Error).message);
  }
  renderAll(scene);
}

function openShop(scene: RoomScene) {
  fitShopWin();
  renderShop(scene);
  $("shopWin").classList.add("show");
}

function fitShopWin() {
  const s = Math.min(1, (window.innerHeight - 40) / 600, (window.innerWidth - 40) / 800);
  $("shopWin").style.setProperty("--winScale", String(s));
}
window.addEventListener("resize", fitShopWin);

// ===== 格子背包（图标 + 数量角标 + 分类 tab）=====

let bagTab: ShopItem["type"] = "food";
let bagSel: string | null = null;

function renderBag(scene: RoomScene) {
  const win = $("bagWin");
  const entries = Object.entries(pet?.inventory ?? {})
    .map(([id, count]) => ({ it: byId(id), id, count }))
    .filter((e) => e.it && e.it.type === bagTab);
  if (!entries.some((e) => e.id === bagSel)) bagSel = entries[0]?.id ?? null;
  const sel = bagSel ? byId(bagSel) : null;
  win.innerHTML = `
    <div class="head"><span>🎒 背包</span><img id="bagClose" src="/qqpet/state/close_normal.png" alt="关闭"
      onmouseover="this.src='/qqpet/state/close_over.png'" onmouseout="this.src='/qqpet/state/close_normal.png'" /></div>
    <div id="bagTabs">${TABS.map((t) =>
      `<div class="bagTab${t === bagTab ? " sel" : ""}" data-tab="${t}">${TAB_LABEL[t]}</div>`).join("")}
    </div>
    <div id="bagGrid">${entries.length === 0
      ? `<div class="bagEmpty">这一格空空的，去商城买点吧～</div>`
      : entries.map((e) => `
        <div class="bagCell${e.id === bagSel ? " sel" : ""}" data-id="${e.id}" title="${e.it!.name}">
          <img src="${ICON(e.id)}" alt="${e.it!.name}" /><span class="ct">${e.count}</span>
        </div>`).join("")}
    </div>
    <div id="bagInfo">
      <div class="desc">${sel ? `<b>${sel.name}</b>　${sel.desc || effectText(sel)}` : ""}</div>
      <button id="bagUseBtn" ${sel ? "" : "disabled"}>使 用</button>
    </div>`;

  $("bagClose").addEventListener("click", () => win.classList.remove("show"));
  win.querySelectorAll<HTMLElement>(".bagTab").forEach((el) =>
    el.addEventListener("click", () => { bagTab = el.dataset.tab as ShopItem["type"]; bagSel = null; renderBag(scene); }));
  win.querySelectorAll<HTMLElement>(".bagCell").forEach((el) =>
    el.addEventListener("click", () => { bagSel = el.dataset.id!; renderBag(scene); }));
  $("bagUseBtn").addEventListener("click", () => { if (bagSel) void useItem(scene, bagSel); });
}

function openBag(scene: RoomScene, tab: ShopItem["type"]) {
  bagTab = tab;
  bagSel = null;
  renderBag(scene);
  $("bagWin").classList.add("show");
}

async function useItem(scene: RoomScene, id: string) {
  const it = byId(id);
  try {
    pet = await petUse(id);
    if (it?.type === "food") scene.feedTreat(it.name);
    else if (it) scene.useItem(it.type === "commodity" ? "commodity" : "medicine", it.name);
  } catch (e) {
    scene.showBubble((e as Error).message);
  }
  renderAll(scene);
}

// ===== 汇总渲染 / 轮询 =====

function renderAll(scene: RoomScene) {
  if (!pet) return;
  scene.mood = pet.mood;
  scene.setDead(pet.dead);
  renderStatePanel();
  if ($("shopWin").classList.contains("show")) renderShop(scene);
  if ($("bagWin").classList.contains("show")) renderBag(scene);
}

async function refreshPet(scene: RoomScene) {
  try {
    pet = await petState();
    renderAll(scene);
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
  void petShop().then((r) => {
    shopItems = r.items;
    void refreshPet(scene).then(() => $("statePanel").classList.add("show"));
  });
  window.setInterval(() => void refreshPet(scene), 60000);

  setupPetMenu(scene);
  scene.onLureComplete = () => {
    void petCare("play").then((s) => {
      pet = s;
      renderAll(scene);
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

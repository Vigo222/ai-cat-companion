import { chat, login, session } from "./api";
import { createGame, RoomScene } from "./RoomScene";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

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
  const panel = $("chatPanel");
  const log = $("chatLog");
  const input = $("chatInput") as HTMLInputElement;
  const fab = $("chatFab");

  fab.style.display = "block";

  const openChat = () => {
    panel.classList.add("open");
    fab.style.display = "none";
    scene.setChatting(true);
    input.focus();
  };
  const closeChat = () => {
    panel.classList.remove("open");
    fab.style.display = "block";
    scene.setChatting(false);
  };

  scene.onCatClick = openChat;
  fab.addEventListener("click", openChat);
  $("chatClose").addEventListener("click", closeChat);

  const addMsg = (cls: string, text: string) => {
    const d = document.createElement("div");
    d.className = `msg ${cls}`;
    d.textContent = text;
    log.appendChild(d);
    log.scrollTop = log.scrollHeight;
    return d;
  };

  const send = async () => {
    const text = input.value.trim();
    if (!text) return;
    input.value = "";
    addMsg("user", text);
    const typing = addMsg("cat typing", "小凡正在打字…");
    try {
      const r = await chat(text);
      typing.remove();
      addMsg("cat", r.reply);
      scene.showBubble(r.reply.length > 40 ? r.reply.slice(0, 40) + "…" : r.reply);
    } catch {
      typing.textContent = "（小凡走神了，再试一次）";
    }
  };
  $("sendBtn").addEventListener("click", send);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") send();
  });
}

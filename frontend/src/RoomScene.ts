import Phaser from "phaser";
import { ambient } from "./api";

const W = 960;
const H = 640;

interface Prop {
  name: string;
  x: number;
  y: number;
  activity: string;
  state: CatState;
}

type CatState = "idle" | "walk" | "sleep" | "play" | "sit" | "eat";

export class RoomScene extends Phaser.Scene {
  private cat!: Phaser.GameObjects.Container;
  private tail!: Phaser.GameObjects.Graphics;
  private eyes!: Phaser.GameObjects.Graphics;
  private zzz!: Phaser.GameObjects.Text;
  private bubble!: Phaser.GameObjects.Container;
  private bubbleText!: Phaser.GameObjects.Text;
  private state: CatState = "idle";
  private busyChatting = false;
  private hovered = false;
  private props: Prop[] = [];
  private stateTimer?: Phaser.Time.TimerEvent;
  private ambientTimer?: Phaser.Time.TimerEvent;
  private walkTween?: Phaser.Tweens.Tween;
  private greeted = false;
  onCatClick: (() => void) | null = null;

  constructor() {
    super("room");
  }

  create() {
    this.drawRoom();
    this.createCat();
    this.createBubble();

    this.cat.setInteractive(
      new Phaser.Geom.Rectangle(-60, -90, 120, 150),
      Phaser.Geom.Rectangle.Contains,
    );
    if (this.cat.input) this.cat.input.cursor = "pointer";
    // 悬停时停下脚步，方便点击；移开后继续自主行动
    this.cat.on("pointerover", () => this.setHovered(true));
    this.cat.on("pointerout", () => this.setHovered(false));
    this.cat.on("pointerdown", () => this.onCatClick?.());

    this.scheduleNextState(2000);
    this.ambientTimer = this.time.addEvent({
      delay: Phaser.Math.Between(25000, 45000),
      loop: true,
      callback: () => this.doAmbient(),
    });
    this.time.delayedCall(1500, () => this.doGreeting());
  }

  setChatting(v: boolean) {
    this.busyChatting = v;
    if (v) {
      this.stateTimer?.remove();
      this.walkTween?.stop();
      this.setState("idle");
    } else {
      this.scheduleNextState(4000);
    }
  }

  private setHovered(v: boolean) {
    if (this.hovered === v || this.busyChatting) return;
    this.hovered = v;
    if (v) {
      this.stateTimer?.remove();
      this.walkTween?.pause();
      if (this.state === "walk") this.setState("idle");
    } else {
      if (this.walkTween?.isPlaying() === false) this.walkTween.resume();
      this.scheduleNextState(Phaser.Math.Between(1500, 4000));
    }
  }

  showBubble(text: string, ms = 0) {
    const dur = ms || Math.min(12000, 2500 + text.length * 140);
    this.bubbleText.setText(text);
    const b = this.bubbleText.getBounds();
    const bg = this.bubble.getAt(0) as Phaser.GameObjects.Graphics;
    bg.clear();
    bg.fillStyle(0xfffaf3, 0.97);
    bg.lineStyle(2, 0xe8b89b, 1);
    const w = b.width + 24;
    const h = b.height + 18;
    bg.fillRoundedRect(-w / 2, -h, w, h, 12);
    bg.strokeRoundedRect(-w / 2, -h, w, h, 12);
    bg.fillTriangle(-6, -2, 6, -2, 0, 8);
    this.bubbleText.setPosition(0, -h / 2 - 9);
    this.bubble.setVisible(true);
    this.time.delayedCall(dur, () => this.bubble.setVisible(false));
  }

  private drawRoom() {
    const g = this.add.graphics();
    // 墙和地板
    g.fillStyle(0xf6e3cd).fillRect(0, 0, W, 260);
    g.fillStyle(0xe9c49a).fillRect(0, 260, W, H - 260);
    g.fillStyle(0xdeb488);
    for (let y = 300; y < H; y += 70) g.fillRect(0, y, W, 3);
    // 窗户
    g.fillStyle(0xbde3f5).fillRoundedRect(560, 40, 200, 150, 14);
    g.lineStyle(8, 0xffffff).strokeRoundedRect(560, 40, 200, 150, 14);
    g.lineStyle(4, 0xffffff).lineBetween(660, 44, 660, 186).lineBetween(564, 115, 756, 115);
    g.fillStyle(0xfff4b8).fillCircle(610, 80, 18); // 太阳
    // 挂画
    g.fillStyle(0xfff0dd).fillRoundedRect(150, 60, 110, 90, 8);
    g.lineStyle(5, 0xc79a6b).strokeRoundedRect(150, 60, 110, 90, 8);
    g.fillStyle(0xff9f7a).fillCircle(190, 100, 16);
    g.fillStyle(0x7ac9a2).fillTriangle(210, 130, 250, 130, 230, 95);
    // 地毯
    g.fillStyle(0xf7c8c8).fillEllipse(480, 460, 340, 150);
    g.fillStyle(0xfad9d9).fillEllipse(480, 460, 280, 110);
    // 猫窝
    g.fillStyle(0xc98d5f).fillEllipse(150, 520, 170, 80);
    g.fillStyle(0xf3e0c8).fillEllipse(150, 515, 130, 55);
    // 食盆
    g.fillStyle(0x8fb8de).fillEllipse(820, 540, 90, 36);
    g.fillStyle(0x6f98c0).fillEllipse(820, 532, 74, 26);
    g.fillStyle(0xb98456).fillEllipse(820, 530, 52, 16);
    // 毛线球
    g.fillStyle(0xf28bb4).fillCircle(700, 420, 26);
    g.lineStyle(2, 0xd96a96);
    g.strokeCircle(700, 420, 26).strokeEllipse(700, 420, 44, 22).strokeEllipse(700, 420, 22, 44);
    // 窗台垫子
    g.fillStyle(0xffd9a8).fillRoundedRect(560, 196, 200, 26, 8);

    this.props = [
      { name: "猫窝", x: 150, y: 495, activity: "窝在猫窝里睡觉", state: "sleep" },
      { name: "毛线球", x: 660, y: 430, activity: "玩毛线球", state: "play" },
      { name: "窗台", x: 660, y: 215, activity: "坐在窗台上看外面", state: "sit" },
      { name: "食盆", x: 770, y: 520, activity: "在食盆边吃小鱼干", state: "eat" },
      { name: "地毯", x: 480, y: 450, activity: "在地毯上打滚发呆", state: "idle" },
    ];
  }

  private createCat() {
    const c = this.add.container(430, 430);
    const body = this.add.graphics();
    // 尾巴
    this.tail = this.add.graphics();
    this.drawTail(0);
    c.add(this.tail);
    // 身体
    body.fillStyle(0xf7f0e6).fillEllipse(0, 10, 92, 70);
    // 头
    body.fillStyle(0xf7f0e6).fillCircle(0, -42, 40);
    // 耳朵
    body.fillStyle(0xf7f0e6).fillTriangle(-34, -60, -12, -76, -26, -84);
    body.fillTriangle(34, -60, 12, -76, 26, -84);
    body.fillStyle(0xf2a58c).fillTriangle(-28, -66, -16, -75, -24, -79);
    body.fillTriangle(28, -66, 16, -75, 24, -79);
    // 花纹
    body.fillStyle(0xe0b98a).fillEllipse(-18, -70, 22, 14);
    body.fillEllipse(24, 4, 30, 22);
    // 肚皮
    body.fillStyle(0xfffdf8).fillEllipse(0, 22, 52, 36);
    // 鼻子嘴
    body.fillStyle(0xf2a58c).fillTriangle(-4, -34, 4, -34, 0, -28);
    body.lineStyle(2, 0xb08d6a);
    body.lineBetween(0, -28, 0, -24);
    body.strokeCircle(-6, -20, 5.5);
    body.strokeCircle(6, -20, 5.5);
    // 胡须
    body.lineStyle(1.5, 0xc0a486);
    body.lineBetween(-16, -30, -38, -34).lineBetween(-16, -26, -38, -26);
    body.lineBetween(16, -30, 38, -34).lineBetween(16, -26, 38, -26);
    // 腮红
    body.fillStyle(0xf9c0b0, 0.7).fillEllipse(-24, -26, 14, 8).fillEllipse(24, -26, 14, 8);
    c.add(body);
    // 眼睛（独立，睡觉时变一条线）
    this.eyes = this.add.graphics();
    this.drawEyes(false);
    c.add(this.eyes);
    this.zzz = this.add.text(30, -95, "z Z z", { fontSize: "18px", color: "#8fa8c9" }).setVisible(false);
    c.add(this.zzz);
    c.setSize(110, 150);
    this.cat = c;

    this.tweens.add({
      targets: c,
      scaleY: { from: 1, to: 1.03 },
      y: "-=3",
      duration: 900,
      yoyo: true,
      repeat: -1,
      ease: "sine.inout",
    });
    this.time.addEvent({
      delay: 120,
      loop: true,
      callback: () => this.drawTail(this.time.now / 300),
    });
  }

  private drawTail(t: number) {
    if (!this.tail) return;
    this.tail.clear();
    this.tail.lineStyle(12, 0xe0b98a);
    const sway = Math.sin(t) * 14;
    this.tail.beginPath();
    this.tail.moveTo(40, 22);
    this.tail.lineTo(62, 6 + sway * 0.4);
    this.tail.lineTo(70, -16 + sway);
    this.tail.strokePath();
  }

  private drawEyes(closed: boolean) {
    this.eyes.clear();
    if (closed) {
      this.eyes.lineStyle(2.5, 0x5c4a3d);
      this.eyes.lineBetween(-19, -44, -7, -44);
      this.eyes.lineBetween(7, -44, 19, -44);
    } else {
      this.eyes.fillStyle(0x4a3b30).fillCircle(-13, -44, 5).fillCircle(13, -44, 5);
      this.eyes.fillStyle(0xffffff).fillCircle(-11, -46, 1.8).fillCircle(15, -46, 1.8);
    }
  }

  private createBubble() {
    const bg = this.add.graphics();
    this.bubbleText = this.add
      .text(0, 0, "", {
        fontSize: "15px",
        color: "#5c4a3d",
        wordWrap: { width: 240 },
        align: "left",
      })
      .setOrigin(0.5);
    this.bubble = this.add.container(0, 0, [bg, this.bubbleText]).setVisible(false).setDepth(5);
  }

  private scheduleNextState(delay: number) {
    this.stateTimer?.remove();
    this.stateTimer = this.time.delayedCall(delay, () => {
      if (this.busyChatting || this.hovered) return;
      const target = Phaser.Utils.Array.GetRandom(this.props);
      this.walkTo(target);
    });
  }

  private walkTo(prop: Prop) {
    this.setState("walk");
    const dist = Phaser.Math.Distance.Between(this.cat.x, this.cat.y, prop.x, prop.y);
    const flip = prop.x < this.cat.x ? -1 : 1;
    this.cat.scaleX = flip;
    this.walkTween = this.tweens.add({
      targets: this.cat,
      x: prop.x,
      y: prop.y,
      duration: Math.max(800, dist * 9),
      ease: "sine.inout",
      onComplete: () => {
        this.cat.scaleX = 1;
        this.setState(prop.state);
        this.currentActivity = prop.activity;
        this.scheduleNextState(Phaser.Math.Between(12000, 26000));
      },
    });
  }

  currentActivity = "在房间里踱步";

  private setState(s: CatState) {
    this.state = s;
    const asleep = s === "sleep";
    this.drawEyes(asleep);
    this.zzz.setVisible(asleep);
    if (s === "walk") this.currentActivity = "在房间里踱步";
  }

  private async doAmbient() {
    if (this.busyChatting || this.bubble.visible) return;
    try {
      const r = await ambient(this.currentActivity);
      if (!this.busyChatting) this.showBubbleOnCat(r.text);
    } catch {
      /* API 不可用时静默 */
    }
  }

  private async doGreeting() {
    if (this.greeted) return;
    this.greeted = true;
    try {
      const r = await ambient("刚看到你上线", "greeting");
      this.showBubbleOnCat(r.text);
    } catch {
      /* ignore */
    }
  }

  update() {
    if (this.bubble.visible) {
      this.bubble.setPosition(this.cat.x, this.cat.y - 95);
    }
  }

  private showBubbleOnCat(text: string) {
    this.bubble.setPosition(this.cat.x, this.cat.y - 95);
    this.showBubble(text);
  }
}

export function createGame(parent: HTMLElement): Phaser.Game {
  return new Phaser.Game({
    type: Phaser.AUTO,
    width: W,
    height: H,
    parent,
    backgroundColor: "#2b2530",
    scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
    scene: [RoomScene],
  });
}

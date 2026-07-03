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

const STATE_TEXTURE: Record<CatState, string> = {
  idle: "cat_sit",
  sit: "cat_sit",
  eat: "cat_sit",
  walk: "cat_walk",
  sleep: "cat_sleep",
  play: "cat_play",
};

const CAT_SCALE = 0.3;

export class RoomScene extends Phaser.Scene {
  private cat!: Phaser.GameObjects.Image;
  private shadow!: Phaser.GameObjects.Ellipse;
  private zzz!: Phaser.GameObjects.Text;
  private bubble!: Phaser.GameObjects.Container;
  private bubbleText!: Phaser.GameObjects.Text;
  private bubbleTimer?: Phaser.Time.TimerEvent;
  private typeTimer?: Phaser.Time.TimerEvent;
  private state: CatState = "sit";
  private busyChatting = false;
  private hovered = false;
  private props: Prop[] = [];
  private stateTimer?: Phaser.Time.TimerEvent;
  private ambientTimer?: Phaser.Time.TimerEvent;
  private walkTween?: Phaser.Tweens.Tween;
  private breathTween?: Phaser.Tweens.Tween;
  private greeted = false;
  onCatClick: (() => void) | null = null;

  constructor() {
    super("room");
  }

  preload() {
    this.load.image("room_bg", "assets/room_bg.png");
    this.load.image("cat_sit", "assets/cat_sit.png");
    this.load.image("cat_sit_blink", "assets/cat_sit_blink.png");
    this.load.image("cat_walk", "assets/cat_walk.png");
    this.load.image("cat_sleep", "assets/cat_sleep.png");
    this.load.image("cat_play", "assets/cat_play.png");
  }

  create() {
    this.add.image(W / 2, H / 2, "room_bg").setDisplaySize(W, H);
    this.createDust();
    this.createCat();
    this.createBubble();

    this.cat.setInteractive({ pixelPerfect: true, alphaTolerance: 40 });
    if (this.cat.input) this.cat.input.cursor = "pointer";
    // 悬停时停下脚步，方便点击；移开后继续自主行动
    this.cat.on("pointerover", () => this.setHovered(true));
    this.cat.on("pointerout", () => this.setHovered(false));
    this.cat.on("pointerdown", () => this.onCatClick?.());

    this.scheduleNextState(2500);
    this.ambientTimer = this.time.addEvent({
      delay: Phaser.Math.Between(15000, 28000),
      loop: true,
      callback: () => this.doAmbient(),
    });
    this.time.addEvent({
      delay: Phaser.Math.Between(2800, 4600),
      loop: true,
      callback: () => this.blink(),
    });
    this.time.delayedCall(1200, () => this.doGreeting());
  }

  setChatting(v: boolean) {
    this.busyChatting = v;
    if (v) {
      this.stateTimer?.remove();
      this.walkTween?.stop();
      this.setState("sit");
    } else {
      this.scheduleNextState(5000);
    }
  }

  private setHovered(v: boolean) {
    if (this.hovered === v || this.busyChatting) return;
    this.hovered = v;
    if (v) {
      this.stateTimer?.remove();
      this.walkTween?.pause();
      if (this.state === "walk") this.setState("sit");
    } else {
      if (this.walkTween?.isPlaying() === false) {
        this.setState("walk");
        this.walkTween.resume();
      }
      this.scheduleNextState(Phaser.Math.Between(1500, 4000));
    }
  }

  /** 云朵气泡 + 打字机效果；sticky 时不自动消失；返回预计展示时长 ms */
  showBubble(text: string, sticky = false): number {
    this.typeTimer?.remove();
    this.bubbleTimer?.remove();
    this.tweens.killTweensOf(this.bubble);
    const dur = Math.min(14000, 3000 + text.length * 150);
    let i = 0;
    this.bubble.setVisible(true).setAlpha(0);
    this.tweens.add({ targets: this.bubble, alpha: 1, duration: 200 });
    this.bubbleText.setText("");
    this.redrawCloud();
    this.typeTimer = this.time.addEvent({
      delay: 45,
      repeat: text.length - 1,
      callback: () => {
        i++;
        this.bubbleText.setText(text.slice(0, i));
        this.redrawCloud();
      },
    });
    if (sticky) return dur;
    this.bubbleTimer = this.time.delayedCall(dur, () => {
      this.tweens.add({
        targets: this.bubble,
        alpha: 0,
        duration: 300,
        onComplete: () => this.bubble.setVisible(false),
      });
    });
    return dur;
  }

  hideBubble() {
    this.typeTimer?.remove();
    this.bubbleTimer?.remove();
    this.bubble.setVisible(false);
  }

  private redrawCloud() {
    const b = this.bubbleText.getBounds();
    const w = Math.max(70, b.width + 40);
    const h = Math.max(46, b.height + 30);
    const g = this.bubble.getAt(0) as Phaser.GameObjects.Graphics;
    g.clear();
    g.fillStyle(0xfffdf7, 0.96);
    g.lineStyle(2.5, 0xd9bda0, 1);
    // 云朵：主体圆角矩形 + 上下边缘一圈鼓包
    const r = h / 2;
    g.fillRoundedRect(-w / 2, -h, w, h, r);
    g.strokeRoundedRect(-w / 2, -h, w, h, r);
    const bumps = Math.max(3, Math.floor(w / 34));
    for (let k = 0; k < bumps; k++) {
      const bx = -w / 2 + (w / (bumps - 1 || 1)) * k;
      g.fillCircle(bx, -h, 10 + (k % 2) * 4);
      g.fillCircle(bx, 0, 9 + ((k + 1) % 2) * 4);
    }
    g.lineStyle(0, 0, 0);
    // 尾巴小圆圈
    g.fillStyle(0xfffdf7, 0.95);
    g.fillCircle(-6, 14, 7);
    g.fillCircle(4, 26, 4.5);
    this.bubbleText.setPosition(0, -h / 2);
  }

  private createDust() {
    // 窗口光束里的飘尘
    const tex = this.make.graphics({ x: 0, y: 0 });
    tex.fillStyle(0xfff6d8, 1).fillCircle(4, 4, 4);
    tex.generateTexture("dust", 8, 8);
    tex.destroy();
    this.add.particles(0, 0, "dust", {
      x: { min: 480, max: 900 },
      y: { min: 60, max: 420 },
      lifespan: 6000,
      speedX: { min: -6, max: 6 },
      speedY: { min: 4, max: 14 },
      scale: { start: 0.5, end: 0.1 },
      alpha: { start: 0.55, end: 0 },
      quantity: 1,
      frequency: 450,
      blendMode: "ADD",
    });
  }

  private createCat() {
    this.shadow = this.add.ellipse(430, 470, 120, 26, 0x8a6a4c, 0.25);
    this.cat = this.add.image(430, 470, "cat_sit").setScale(CAT_SCALE).setOrigin(0.5, 0.88);
    this.zzz = this.add
      .text(0, 0, "z Z z", { fontSize: "20px", color: "#8fa8c9", fontStyle: "bold" })
      .setVisible(false)
      .setDepth(4);
    this.startBreathing();
  }

  private startBreathing() {
    this.breathTween?.stop();
    this.breathTween = this.tweens.add({
      targets: this.cat,
      scaleY: { from: CAT_SCALE, to: CAT_SCALE * 1.035 },
      duration: this.state === "sleep" ? 1600 : 950,
      yoyo: true,
      repeat: -1,
      ease: "sine.inout",
    });
  }

  private blink() {
    if (this.state !== "sit" && this.state !== "idle" && this.state !== "eat") return;
    this.cat.setTexture("cat_sit_blink");
    this.time.delayedCall(160, () => {
      if (this.state === "sit" || this.state === "idle" || this.state === "eat") {
        this.cat.setTexture("cat_sit");
      }
    });
  }

  private createBubble() {
    const g = this.add.graphics();
    this.bubbleText = this.add
      .text(0, 0, "", {
        fontSize: "15px",
        color: "#5c4a3d",
        wordWrap: { width: 250, useAdvancedWrap: true },
        align: "left",
        lineSpacing: 4,
      })
      .setOrigin(0.5);
    this.bubble = this.add.container(0, 0, [g, this.bubbleText]).setVisible(false).setDepth(5);
  }

  private roomProps(): Prop[] {
    if (this.props.length === 0) {
      this.props = [
        { name: "猫窝", x: 170, y: 505, activity: "窝在猫窝里睡觉", state: "sleep" },
        { name: "地毯", x: 540, y: 565, activity: "在地毯上打滚发呆", state: "idle" },
        { name: "毛线球", x: 300, y: 588, activity: "玩毛线球", state: "play" },
        { name: "食盆", x: 745, y: 588, activity: "在食盆边吃小鱼干", state: "eat" },
        { name: "书架旁", x: 395, y: 480, activity: "蹲在书架旁看书脊发呆", state: "sit" },
      ];
    }
    return this.props;
  }

  private scheduleNextState(delay: number) {
    this.stateTimer?.remove();
    this.stateTimer = this.time.delayedCall(delay, () => {
      if (this.busyChatting || this.hovered) return;
      const target = Phaser.Utils.Array.GetRandom(this.roomProps());
      this.walkTo(target);
    });
  }

  private walkTo(prop: Prop) {
    this.setState("walk");
    const dist = Phaser.Math.Distance.Between(this.cat.x, this.cat.y, prop.x, prop.y);
    this.cat.setFlipX(prop.x < this.cat.x); // walk 贴图朝右
    this.walkTween = this.tweens.add({
      targets: [this.cat, this.shadow],
      x: prop.x,
      y: prop.y,
      duration: Math.max(900, dist * 11),
      ease: "sine.inout",
      onComplete: () => {
        this.cat.setFlipX(false);
        this.setState(prop.state);
        this.currentActivity = prop.activity;
        this.scheduleNextState(Phaser.Math.Between(10000, 22000));
      },
    });
  }

  currentActivity = "在房间里踱步";

  private setState(s: CatState) {
    this.state = s;
    this.cat.setTexture(STATE_TEXTURE[s]);
    this.zzz.setVisible(s === "sleep");
    if (s === "walk") this.currentActivity = "在房间里踱步";
    this.startBreathing();
  }

  private async doAmbient() {
    if (this.busyChatting || this.bubble.visible) return;
    try {
      const r = await ambient(this.currentActivity);
      if (!this.busyChatting) this.showBubble(r.text);
    } catch {
      /* API 不可用时静默 */
    }
  }

  private async doGreeting() {
    if (this.greeted) return;
    this.greeted = true;
    try {
      const r = await ambient("刚看到你上线", "greeting");
      this.showBubble(r.text);
    } catch {
      /* ignore */
    }
  }

  update() {
    const t = this.time.now;
    // 走路轻微颠簸
    if (this.state === "walk") {
      this.cat.setAngle(Math.sin(t / 90) * 2.2);
    } else if (this.cat.angle !== 0) {
      this.cat.setAngle(0);
    }
    this.shadow.setPosition(this.cat.x, this.cat.y + 4);
    if (this.bubble.visible) {
      const headY = this.cat.y - this.cat.displayHeight * 0.95;
      this.bubble.setPosition(
        Phaser.Math.Clamp(this.cat.x, 150, W - 150),
        Math.max(110, headY - 18),
      );
    }
    if (this.zzz.visible) {
      this.zzz.setPosition(this.cat.x + 40, this.cat.y - this.cat.displayHeight * 0.8 + Math.sin(t / 500) * 5);
      this.zzz.setAlpha(0.6 + Math.sin(t / 400) * 0.4);
    }
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

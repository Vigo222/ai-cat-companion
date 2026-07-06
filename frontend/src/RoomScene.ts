import Phaser from "phaser";
import { ambient } from "./api";

export const W = 960;
export const H = 640;

interface Prop {
  name: string;
  x: number;
  y: number;
  activity: string;
  state: CatState;
}

type CatState = "idle" | "walk" | "sleep" | "play" | "sit" | "eat";

interface AnimSpec {
  frames: number;
  frameWidth: number;
  frameHeight: number;
  fps: number;
  scale: number;
}

const ANIMS: Record<string, AnimSpec> = {
  walk: { frames: 23, frameWidth: 421, frameHeight: 340, fps: 12, scale: 0.4791 },
  sleep: { frames: 11, frameWidth: 519, frameHeight: 340, fps: 3, scale: 0.3768 },
  sit: { frames: 22, frameWidth: 272, frameHeight: 340, fps: 6, scale: 0.6088 },
  groom: { frames: 21, frameWidth: 235, frameHeight: 340, fps: 12, scale: 0.5921 },
  play: { frames: 24, frameWidth: 304, frameHeight: 340, fps: 12, scale: 0.6344 },
};

const STATE_ANIM: Record<CatState, string> = {
  idle: "sit",
  sit: "sit",
  eat: "groom",
  walk: "walk",
  sleep: "sleep",
  play: "play",
};

export class RoomScene extends Phaser.Scene {
  private cat!: Phaser.GameObjects.Sprite;
  private shadow!: Phaser.GameObjects.Ellipse;
  private zzz!: Phaser.GameObjects.Text;
  private bubble!: Phaser.GameObjects.Container;
  private bubbleText!: Phaser.GameObjects.Text;
  private bubbleTimer?: Phaser.Time.TimerEvent;
  private typeTimer?: Phaser.Time.TimerEvent;
  private state: CatState = "sit";
  private busyChatting = false;
  private busyActivity = false;
  private hovered = false;
  private props: Prop[] = [];
  private stateTimer?: Phaser.Time.TimerEvent;
  private ambientTimer?: Phaser.Time.TimerEvent;
  private walkTween?: Phaser.Tweens.Tween;
  private lureToy?: Phaser.GameObjects.Container;
  private snack?: Phaser.GameObjects.Container;
  private greeted = false;
  private lastPetAt = 0;
  mood = 75;
  dead = false;
  onPetComplete: ((part: "head" | "body") => void) | null = null;
  onLureComplete: (() => void) | null = null;
  onFeedComplete: (() => void) | null = null;
  onCatClick: ((x: number, y: number) => void) | null = null;

  constructor() {
    super("room");
  }

  preload() {
    this.load.image("room_bg", "assets/room_bg.png");
    this.load.svg("bone_tip", "qqpet/tip/14.svg", { width: 458, height: 358 });
    for (const [name, a] of Object.entries(ANIMS)) {
      this.load.spritesheet(`cat_${name}`, `assets/cat_${name}_sheet.png`, {
        frameWidth: a.frameWidth,
        frameHeight: a.frameHeight,
      });
    }
  }

  create() {
    for (const [name, a] of Object.entries(ANIMS)) {
      this.anims.create({
        key: name,
        frames: this.anims.generateFrameNumbers(`cat_${name}`, { start: 0, end: a.frames - 1 }),
        frameRate: a.fps,
        repeat: -1,
      });
    }
    this.add.image(W / 2, H / 2, "room_bg").setDisplaySize(W, H);
    this.createDust();
    this.createCat();
    this.createBubble();

    this.cat.setInteractive({ pixelPerfect: true, alphaTolerance: 40 });
    if (this.cat.input) this.cat.input.cursor = "pointer";
    // 悬停时停下脚步，方便点击；移开后继续自主行动
    this.cat.on("pointerover", () => this.setHovered(true));
    this.cat.on("pointerout", () => this.setHovered(false));
    // 点猫：弹出 QQ宠物式环绕功能菜单
    this.cat.on("pointerdown", () => {
      this.onCatClick?.(this.cat.x, this.cat.y - this.cat.displayHeight * 0.5);
    });
    this.input.on("pointerdown", (pointer: Phaser.Input.Pointer, objects: Phaser.GameObjects.GameObject[]) => {
      if (objects.includes(this.cat)) return;
      this.lureTo(pointer.worldX, pointer.worldY);
    });

    this.scheduleNextState(2500);
    this.ambientTimer = this.time.addEvent({
      delay: Phaser.Math.Between(15000, 28000),
      loop: true,
      callback: () => this.doAmbient(),
    });
    this.time.delayedCall(1200, () => this.doGreeting());
  }

  setChatting(v: boolean) {
    this.busyChatting = v;
    if (v) {
      this.stateTimer?.remove();
      this.walkTween?.stop();
      this.lureToy?.destroy();
      this.lureToy = undefined;
      this.setState("sit");
    } else {
      this.scheduleNextState(5000);
    }
  }

  /** 打工/上课中：停止自主行动，坐下干活/听课 */
  setActivityMode(label: string | null) {
    if (this.busyActivity === !!label) {
      if (label) this.currentActivity = label;
      return;
    }
    this.busyActivity = !!label;
    if (label) {
      this.stateTimer?.remove();
      this.walkTween?.stop();
      this.setState("sit");
      this.currentActivity = label;
    } else {
      this.scheduleNextState(3000);
    }
  }

  /** 环绕菜单里的「玩耍」：逗猫反应 */
  playWithCat() {
    if (this.busyChatting || this.busyActivity || this.dead) return;
    if (this.time.now - this.lastPetAt < 1500) return;
    this.lastPetAt = this.time.now;
    this.stateTimer?.remove();
    this.walkTween?.stop();
    const lowMood = this.mood < 30;
    this.setState("play");
    this.currentActivity = "和你玩耍";
    this.showBubble(Phaser.Utils.Array.GetRandom(lowMood
      ? ["没心情玩……再陪陪我吧", "喵呜……轻点"]
      : ["喵嘿，好痒！", "再玩一会儿！", "翻个身给你摸"]));
    this.onLureComplete?.();
    this.scheduleNextState(Phaser.Math.Between(6000, 10000));
  }

  /** 死亡状态：灰化躺倒，停止自主行动；复活后恢复 */
  setDead(v: boolean) {
    if (this.dead === v) return;
    this.dead = v;
    this.stateTimer?.remove();
    this.walkTween?.stop();
    if (v) {
      this.setState("sleep");
      this.zzz.setVisible(false);
      this.cat.setTint(0x888888);
      this.currentActivity = "（死亡）";
      this.hideBubble();
    } else {
      this.cat.clearTint();
      this.setState("sit");
      this.showBubble("呼……我活过来了！");
      this.scheduleNextState(4000);
    }
  }

  lureTo(x: number, y: number) {
    if (this.busyChatting || this.busyActivity || this.dead) return;
    const tx = Phaser.Math.Clamp(x, 95, W - 95);
    const ty = Phaser.Math.Clamp(y, 430, H - 44);
    this.showLureToy(tx, ty);
    this.walkToPoint(tx, ty, () => {
      this.setState("play");
      this.currentActivity = "追着逗猫棒玩";
      this.showBubble("逮到你啦～");
      this.onLureComplete?.();
      this.fadeAndDestroy(this.lureToy, 2200);
      this.lureToy = undefined;
    });
  }

  feedTreat(item = "小鱼干") {
    if (this.busyChatting || this.busyActivity || this.dead) return;
    const dir = this.cat.x < W / 2 ? 1 : -1;
    const tx = Phaser.Math.Clamp(this.cat.x + dir * 115, 110, W - 110);
    const ty = Phaser.Math.Clamp(this.cat.y + 28, 455, H - 50);
    this.showSnack(tx, ty);
    this.walkToPoint(tx, ty, () => {
      this.setState("eat");
      this.currentActivity = `吃${item}`;
      this.showBubble(`啊呜，${item}好香！`);
      this.onFeedComplete?.();
      this.fadeAndDestroy(this.snack, 2600);
      this.snack = undefined;
    });
  }

  /** 使用非食物类物品的表现：洗澡/吃药 */
  useItem(kind: "commodity" | "medicine", item: string) {
    if (this.busyChatting) return;
    this.stateTimer?.remove();
    this.walkTween?.stop();
    if (kind === "commodity") {
      this.setState("eat");
      this.currentActivity = "洗澡澡";
      this.showBubble(`用${item}洗得香喷喷～`);
    } else {
      this.setState("sit");
      this.currentActivity = "乖乖吃药";
      this.showBubble(`吃了${item}，感觉好多了……`);
    }
    this.scheduleNextState(Phaser.Math.Between(8000, 14000));
  }

  private setHovered(v: boolean) {
    if (this.hovered === v || this.busyChatting || this.busyActivity || this.dead) return;
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
    // 原版骨头形提示框（tip/normal/14.svg）：文字居中显示在骨头中段
    const b = this.bubbleText.getBounds();
    const img = this.bubble.getAt(0) as Phaser.GameObjects.Image;
    const w = Math.max(170, b.width + 110);
    const h = Math.max(120, b.height + 96);
    img.setDisplaySize(w, h).setPosition(0, -h / 2);
    this.bubbleText.setPosition(0, -h / 2 - 4);
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
    this.cat = this.add.sprite(430, 470, "cat_sit").setOrigin(0.5, 0.97);
    this.applyAnim("sit");
    this.zzz = this.add
      .text(0, 0, "z Z z", { fontSize: "20px", color: "#8fa8c9", fontStyle: "bold" })
      .setVisible(false)
      .setDepth(4);
  }

  private applyAnim(name: string) {
    const flip = this.cat.flipX;
    this.cat.setScale(ANIMS[name].scale);
    this.cat.setFlipX(flip);
    this.cat.play(name, true);
  }

  private showLureToy(x: number, y: number) {
    this.lureToy?.destroy();
    const g = this.add.graphics();
    g.lineStyle(4, 0xb9895f, 0.95);
    g.lineBetween(-24, -46, -2, -10);
    g.lineStyle(2, 0xffd3de, 1);
    g.lineBetween(-2, -10, 8, -3);
    g.fillStyle(0xff7da8, 1);
    g.fillEllipse(13, 0, 22, 10);
    g.fillStyle(0xffd36b, 1);
    g.fillEllipse(4, 8, 18, 9);
    g.fillStyle(0x7ac9a2, 1);
    g.fillCircle(0, 0, 4);
    this.lureToy = this.add.container(x, y, [g]).setDepth(6);
    this.tweens.add({ targets: this.lureToy, angle: 10, y: y - 6, yoyo: true, repeat: -1, duration: 420, ease: "sine.inout" });
  }

  private showSnack(x: number, y: number) {
    this.snack?.destroy();
    const g = this.add.graphics();
    g.fillStyle(0xe59d45, 1);
    g.fillEllipse(0, 0, 30, 13);
    g.fillTriangle(-13, 0, -28, -9, -28, 9);
    g.fillStyle(0xffd98f, 1);
    g.fillCircle(7, -1, 3);
    g.fillStyle(0x5c4a3d, 1);
    g.fillCircle(10, -2, 1.5);
    this.snack = this.add.container(x, y - 8, [g]).setDepth(4);
    this.tweens.add({ targets: this.snack, y: y - 14, yoyo: true, repeat: -1, duration: 720, ease: "sine.inout" });
  }

  private fadeAndDestroy(item: Phaser.GameObjects.Container | undefined, delay: number) {
    if (!item) return;
    this.tweens.add({
      targets: item,
      alpha: 0,
      duration: 500,
      delay,
      onComplete: () => item.destroy(),
    });
  }

  private createBubble() {
    const g = this.add.image(0, 0, "bone_tip");
    this.bubbleText = this.add
      .text(0, 0, "", {
        fontSize: "14px",
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
      if (this.busyChatting || this.busyActivity || this.hovered || this.dead) return;
      // 心情低落时更想窝着/发呆
      const props = this.mood < 30
        ? this.roomProps().filter((p) => p.state === "sleep" || p.state === "idle" || p.state === "sit")
        : this.roomProps();
      const target = Phaser.Utils.Array.GetRandom(props);
      this.walkTo(target);
    });
  }

  private walkTo(prop: Prop) {
    this.walkToPoint(prop.x, prop.y, () => {
      this.setState(prop.state);
      this.currentActivity = prop.activity;
    });
  }

  private walkToPoint(x: number, y: number, onArrive: () => void) {
    this.stateTimer?.remove();
    this.walkTween?.stop();
    this.setState("walk");
    const dist = Phaser.Math.Distance.Between(this.cat.x, this.cat.y, x, y);
    this.cat.setFlipX(x < this.cat.x); // walk 贴图朝右
    this.walkTween = this.tweens.add({
      targets: [this.cat, this.shadow],
      x,
      y,
      duration: Math.max(900, dist * 11),
      ease: "sine.inout",
      onComplete: () => {
        this.cat.setFlipX(false);
        onArrive();
        this.scheduleNextState(Phaser.Math.Between(10000, 22000));
      },
    });
  }

  currentActivity = "在房间里踱步";

  private setState(s: CatState) {
    this.state = s;
    this.applyAnim(STATE_ANIM[s]);
    this.zzz.setVisible(s === "sleep");
    if (s === "walk") this.currentActivity = "在房间里踱步";
  }

  private async doAmbient() {
    if (this.busyChatting || this.bubble.visible || this.dead) return;
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

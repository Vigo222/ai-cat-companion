"""从 qqpet_automation（原版 QQ宠物客户端资源）提取商店物品数据与 UI 素材。

用法:
    python scripts/extract_qqpet_assets.py /path/to/qqpet_automation

生成:
    backend/app/qqpet_catalog.py           商店物品目录（可售 food/commodity/medicine）
    frontend/public/qqpet/items/{id}.gif   物品图标
    frontend/public/qqpet/state/           状态面板素材（进度条/等级骨头/关闭按钮）
    frontend/public/qqpet/store/           商城窗口素材
    frontend/public/qqpet/icons/           环绕菜单图标
"""
import json
import re
import shutil
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
PUB = REPO / "frontend" / "public" / "qqpet"

ITEM_RE = re.compile(
    r'_\d+:\{name:"([^"]*)",type:"([^"]*)",charm:([\d.e]+),intel:([\d.e]+),'
    r'strong:([\d.e]+),clean:([\d.e]+),starve:([\d.e]+),desc:"([^"]*)",'
    r'id:"(\d+)",price:(-?[\d.e]+),rectype:"([^"]*)"\}'
)

STATE_ASSETS = [
    "lusejindutiao00.png", "lusejindutiao01.png", "lusejindutiao02.png",
    "shenglanjindutiao00.png", "shenglanjindutiao01.png", "shenglanjindutiao02.png",
    "huangsejindutiao00.png", "huangsejindutiao01.png", "huangsejindutiao02.png",
    "hongsejindutiao00.png", "hongsejindutiao01.png", "hongsejindutiao02.png",
    "dengji.png", "dengji1.png", "dengji2.png", "dengji3.png",
    "close_normal.png", "close_click.png", "close_over.png",
    "ditu05.png",
]
STORE_ASSETS = [
    "Store_img/BG.png", "Store_img/Card_Items.png", "Store_img/Card_Items_Null.png",
    "Store_img/Items_Tag.png", "Store_img/Items_Tag_Selected.png",
    "Store_img/Items_SubTag_Selected.png",
    "Store_img/page_first.png", "Store_img/page_last.png",
    "Store_img/page_left.png", "Store_img/page_right.png",
    "Store_img/hot.gif", "Store_img/new.gif", "Store_img/recommand.gif",
]
CONTROL_ICONS = [
    "weishi.png", "qingjie.png", "wanshua.png", "zhibing.png",
    "dagong.png", "xuexi.png", "lvyou.png", "chongwu.png",
    "guanli.png", "richang.png", "renwu.png", "cf.png",
]


def main(src_dir: str) -> None:
    src = Path(src_dir) / "qq_pet_asar" / "src"
    shop_js = (src / "windows" / "util" / "pet" / "shop.js").read_text(encoding="utf-8")
    items = []
    for m in ITEM_RE.finditer(shop_js):
        name, typ, charm, intel, strong, clean, starve, desc, iid, price, rectype = m.groups()
        if float(price) <= 0 or typ not in ("food", "commodity", "medicine"):
            continue
        items.append({
            "id": iid, "name": name, "type": typ, "price": int(float(price)),
            "starve": int(float(starve)), "clean": int(float(clean)),
            "charm": int(float(charm)), "intel": int(float(intel)),
            "strong": int(float(strong)), "desc": desc, "rectype": rectype,
        })

    (PUB / "items").mkdir(parents=True, exist_ok=True)
    for it in items:
        gif = src / "assets" / "img_res" / it["type"] / f"{it['id']}.gif"
        shutil.copy(gif, PUB / "items" / f"{it['id']}.gif")

    for name, sub, base in [
        ("state", STATE_ASSETS, src / "assets" / "stateInfo"),
        ("store", STORE_ASSETS, src / "assets" / "shop" / "store"),
        ("icons", CONTROL_ICONS, src / "assets" / "control" / "icons"),
    ]:
        out = PUB / name
        out.mkdir(parents=True, exist_ok=True)
        for rel in sub:
            shutil.copy(base / rel, out / Path(rel).name)

    catalog = REPO / "backend" / "app" / "qqpet_catalog.py"
    body = json.dumps(items, ensure_ascii=False, indent=1)
    catalog.write_text(
        '"""原版 QQ宠物商店物品目录（由 scripts/extract_qqpet_assets.py 生成，勿手改）。"""\n'
        f"CATALOG = {body}\n",
        encoding="utf-8",
    )
    print(f"{len(items)} items -> {catalog}")


if __name__ == "__main__":
    main(sys.argv[1])

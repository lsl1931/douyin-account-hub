#!/usr/bin/env python
"""
生成应用图标。

设计意图（为什么是这几个形状）：
  - 圆角方形 + 红/粉渐变：Windows 应用图标的通用语言，同时在视觉上贴近抖音的品牌色。
  - 两张错开的白色卡片：语义是"多个账号/多个窗口"，这是本应用唯一要表达的事。
  - 前卡片里一个播放三角：点出"视频"，且把纯白块面破开，小尺寸下不至于糊成一坨。

刻意不画音符：那是抖音官方 logo 的母题，撞上去既像山寨也可能有商标问题。

形状全部是几何图形，不依赖任何字体 —— 换台机器、换个语言都不会变形。
只渲染一张高分辨率主图，各尺寸交给 Pillow 用 LANCZOS 缩放；形状做得足够粗，
16px 下仍然认得出。
"""
from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image, ImageDraw

# ---------------------------------------------------------------- 设计参数

SIZE = 1024
CORNER_RATIO = 0.2265  # Windows 11 图标圆角大致比例

GRADIENT_TOP_LEFT = (255, 92, 134)  # #FF5C86 浅粉红
GRADIENT_BOTTOM_RIGHT = (230, 20, 74)  # #E6144A 深玫红

CARD_RADIUS = 62
CARD_SIZE = 452
BACK_OFFSET = (56, -78)  # 后卡片相对前卡片的位移
BACK_ALPHA = 122  # 后卡片半透明度（0-255）
CARD_ALPHA = 255

PLAY_COLOR = (254, 44, 85)  # 抖音红，作为前卡片里的播放三角

ICO_SIZES = [16, 24, 32, 48, 64, 128, 256]


def linear_gradient(size: int, c1: tuple[int, int, int], c2: tuple[int, int, int]) -> Image.Image:
    """对角线线性渐变。"""
    img = Image.new("RGB", (size, size))
    px = img.load()
    assert px is not None
    denom = (size - 1) * 2
    for y in range(size):
        for x in range(size):
            t = (x + y) / denom
            px[x, y] = (
                round(c1[0] + (c2[0] - c1[0]) * t),
                round(c1[1] + (c2[1] - c1[1]) * t),
                round(c1[2] + (c2[2] - c1[2]) * t),
            )
    return img


def rounded_mask(size: int, radius: int) -> Image.Image:
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, size - 1, size - 1), radius=radius, fill=255)
    return mask


def build_master() -> Image.Image:
    radius = round(SIZE * CORNER_RATIO)

    base = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    gradient = linear_gradient(SIZE, GRADIENT_TOP_LEFT, GRADIENT_BOTTOM_RIGHT).convert("RGBA")
    base.paste(gradient, (0, 0), rounded_mask(SIZE, radius))

    # 纯几何布局：先算出整体外接框，再平移使其在画布上居中
    front_left = (SIZE - CARD_SIZE) // 2 - 28
    front_top = (SIZE - CARD_SIZE) // 2 + 46
    back_left = front_left + BACK_OFFSET[0]
    back_top = front_top + BACK_OFFSET[1]

    bbox_x0 = min(front_left, back_left)
    bbox_x1 = max(front_left + CARD_SIZE, back_left + CARD_SIZE)
    bbox_y0 = min(front_top, back_top)
    bbox_y1 = max(front_top + CARD_SIZE, back_top + CARD_SIZE)
    dx = round((SIZE - (bbox_x1 - bbox_x0)) / 2) - bbox_x0
    dy = round((SIZE - (bbox_y1 - bbox_y0)) / 2) - bbox_y0
    front_left += dx
    front_top += dy
    back_left += dx
    back_top += dy

    cards = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    draw = ImageDraw.Draw(cards)

    draw.rounded_rectangle(
        (back_left, back_top, back_left + CARD_SIZE, back_top + CARD_SIZE),
        radius=CARD_RADIUS,
        fill=(255, 255, 255, BACK_ALPHA),
    )
    draw.rounded_rectangle(
        (front_left, front_top, front_left + CARD_SIZE, front_top + CARD_SIZE),
        radius=CARD_RADIUS,
        fill=(255, 255, 255, CARD_ALPHA),
    )

    base.alpha_composite(cards)

    # 前卡片中央的播放三角（视觉重心略右偏，看起来才居中）
    cx = front_left + CARD_SIZE / 2 + 22
    cy = front_top + CARD_SIZE / 2
    half_h = CARD_SIZE * 0.255
    half_w = CARD_SIZE * 0.225

    triangle = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    ImageDraw.Draw(triangle).polygon(
        [
            (cx - half_w, cy - half_h),
            (cx - half_w, cy + half_h),
            (cx + half_w * 1.15, cy),
        ],
        fill=(*PLAY_COLOR, 255),
    )
    base.alpha_composite(triangle)

    return base


def main() -> int:
    out_dir = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("build")
    out_dir.mkdir(parents=True, exist_ok=True)

    master = build_master()

    png_path = out_dir / "icon.png"
    master.save(png_path, format="PNG")
    print(f"[icon] {png_path}  ({master.width}x{master.height})")

    icon_path = out_dir / "icon.ico"
    master.save(icon_path, format="ICO", sizes=[(s, s) for s in ICO_SIZES])
    print(f"[icon] {icon_path}  sizes={ICO_SIZES}")

    # 单独导出几个常用尺寸，方便预览和别处引用
    for s in (256, 512):
        p = out_dir / f"icon-{s}.png"
        master.resize((s, s), Image.Resampling.LANCZOS).save(p, format="PNG")
        print(f"[icon] {p}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())

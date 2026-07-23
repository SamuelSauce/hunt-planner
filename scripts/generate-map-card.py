#!/usr/bin/env python3
"""Generate a deterministic social/article card from Hunt Planner boundary data."""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path
from typing import Any, Iterable

from PIL import Image, ImageDraw, ImageFilter, ImageFont


ROOT = Path(__file__).resolve().parents[1]
WIDTH = 1200
HEIGHT = 675

STATE_FILES = {
    "utah": ("src/data/udwr-data.json",),
    "colorado": ("src/data/cpw-data.json",),
    "idaho": ("src/data/idfg-data.json",),
    "wyoming": ("src/data/wgfd-data.json",),
}

BOUNDARY_FILES = {
    "utah": ("public/data/boundaries/utah.json",),
    "colorado": ("public/data/boundaries/colorado.json",),
    "idaho": (
        "public/data/boundaries/idaho-controlled.json",
        "public/data/boundaries/idaho-general.json",
    ),
    "wyoming": (
        "public/data/boundaries/wyoming-bighorn-sheep.json",
        "public/data/boundaries/wyoming-deer.json",
        "public/data/boundaries/wyoming-elk.json",
        "public/data/boundaries/wyoming-moose.json",
        "public/data/boundaries/wyoming-mountain-goat.json",
        "public/data/boundaries/wyoming-pronghorn.json",
    ),
}

FONT_REGULAR = Path("/System/Library/Fonts/Supplemental/Arial.ttf")
FONT_BOLD = Path("/System/Library/Fonts/Supplemental/Arial Bold.ttf")
FONT_SERIF_BOLD = Path("/System/Library/Fonts/Supplemental/Georgia Bold.ttf")


def load_json(relative_path: str) -> Any:
    with (ROOT / relative_path).open(encoding="utf-8") as handle:
        return json.load(handle)


def find_hunt(state: str, hunt_number: str, hunt_name: str | None) -> dict[str, Any]:
    data = load_json(STATE_FILES[state][0])
    candidates = [
        hunt for hunt in data["hunts"]
        if str(hunt.get("huntNumber", "")).lower() == hunt_number.lower()
    ]
    if hunt_name:
        named = [
            hunt for hunt in candidates
            if str(hunt.get("huntName", "")).lower() == hunt_name.lower()
        ]
        if named:
            candidates = named
    if not candidates:
        raise SystemExit(f"No {state} hunt found for {hunt_number}")
    return next(
        (
            hunt for hunt in candidates
            if hunt.get("harvest") and (
                hunt.get("odds") or hunt.get("drawOut") or hunt.get("drawProfile")
            )
        ),
        candidates[0],
    )


def boundary_ids(state: str, hunt: dict[str, Any]) -> set[str]:
    ids = {str(value).lstrip("0") or "0" for value in hunt.get("mapUnitIds", [])}
    if ids:
        return ids
    if state == "colorado":
        name = str(hunt.get("huntName", ""))
        digits = "".join(character for character in name if character.isdigit())
        if digits:
            return {str(int(digits))}
    return set()


def find_boundary_features(
    state: str,
    hunt: dict[str, Any],
) -> tuple[list[dict[str, Any]], str]:
    ids = boundary_ids(state, hunt)
    matches: list[dict[str, Any]] = []
    source_label = ""
    for relative_path in BOUNDARY_FILES[state]:
        data = load_json(relative_path)
        for feature in data.get("features", []):
            hunt_numbers = {
                str(value).lower() for value in feature.get("huntNumbers", [])
            }
            feature_id = str(feature.get("id", ""))
            normalized_id = feature_id.lstrip("0") or "0"
            if (
                hunt["huntNumber"].lower() in hunt_numbers
                or normalized_id in ids
                or feature_id in ids
            ):
                matches.append(feature)
                source_label = data.get("label") or f"{state.title()} hunt boundary"
    if not matches:
        raise SystemExit(
            f"No boundary feature found for {state} hunt {hunt['huntNumber']}"
        )
    return matches, source_label


def polygon_rings(geometry: dict[str, Any]) -> Iterable[list[list[float]]]:
    if geometry.get("type") == "Polygon":
        yield from geometry.get("coordinates", [])
    elif geometry.get("type") == "MultiPolygon":
        for polygon in geometry.get("coordinates", []):
            yield from polygon


def all_points(features: list[dict[str, Any]]) -> list[tuple[float, float]]:
    points: list[tuple[float, float]] = []
    for feature in features:
        for ring in polygon_rings(feature["geometry"]):
            points.extend((float(lon), float(lat)) for lon, lat in ring)
    return points


def fitted_projector(
    features: list[dict[str, Any]],
    box: tuple[int, int, int, int],
):
    points = all_points(features)
    min_lon = min(point[0] for point in points)
    max_lon = max(point[0] for point in points)
    min_lat = min(point[1] for point in points)
    max_lat = max(point[1] for point in points)
    center_lat = (min_lat + max_lat) / 2
    lon_scale = max(math.cos(math.radians(center_lat)), 0.2)
    min_x = min_lon * lon_scale
    max_x = max_lon * lon_scale
    x0, y0, x1, y1 = box
    padding = 22
    available_width = x1 - x0 - padding * 2
    available_height = y1 - y0 - padding * 2
    scale = min(
        available_width / max(max_x - min_x, 0.001),
        available_height / max(max_lat - min_lat, 0.001),
    )
    content_width = (max_x - min_x) * scale
    content_height = (max_lat - min_lat) * scale
    offset_x = x0 + (x1 - x0 - content_width) / 2
    offset_y = y0 + (y1 - y0 - content_height) / 2

    def project(lon: float, lat: float) -> tuple[float, float]:
        x_value = (lon * lon_scale - min_x) * scale + offset_x
        y_value = (max_lat - lat) * scale + offset_y
        return x_value, y_value

    return project


def font(path: Path, size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    try:
        return ImageFont.truetype(str(path), size)
    except OSError:
        return ImageFont.load_default()


def wrap_text(
    draw: ImageDraw.ImageDraw,
    text: str,
    selected_font: ImageFont.ImageFont,
    max_width: int,
) -> list[str]:
    words = text.split()
    lines: list[str] = []
    current: list[str] = []
    for word in words:
        candidate = " ".join([*current, word])
        if draw.textbbox((0, 0), candidate, font=selected_font)[2] <= max_width:
            current.append(word)
        else:
            if current:
                lines.append(" ".join(current))
            current = [word]
    if current:
        lines.append(" ".join(current))
    return lines


def draw_gradient(image: Image.Image) -> None:
    pixels = image.load()
    for y in range(HEIGHT):
        for x in range(WIDTH):
            horizontal = x / WIDTH
            vertical = y / HEIGHT
            r = int(21 + 19 * horizontal + 8 * vertical)
            g = int(48 + 30 * horizontal + 16 * vertical)
            b = int(37 + 21 * horizontal + 12 * vertical)
            pixels[x, y] = (r, g, b, 255)


def draw_topographic_lines(draw: ImageDraw.ImageDraw) -> None:
    for index in range(18):
        points = []
        base_y = 20 + index * 40
        for x in range(0, WIDTH + 12, 12):
            wave = (
                math.sin(x / 82 + index * 0.71) * 16
                + math.sin(x / 31 + index * 1.19) * 5
            )
            points.append((x, base_y + wave))
        draw.line(points, fill=(130, 166, 138, 34), width=1)


def draw_boundary(
    base: Image.Image,
    features: list[dict[str, Any]],
    box: tuple[int, int, int, int],
) -> None:
    projector = fitted_projector(features, box)
    shadow = Image.new("RGBA", base.size, (0, 0, 0, 0))
    shadow_draw = ImageDraw.Draw(shadow)
    fill_layer = Image.new("RGBA", base.size, (0, 0, 0, 0))
    fill_draw = ImageDraw.Draw(fill_layer)
    for feature in features:
        for ring in polygon_rings(feature["geometry"]):
            projected = [projector(float(lon), float(lat)) for lon, lat in ring]
            if len(projected) < 3:
                continue
            shadow_draw.polygon(
                [(x + 10, y + 14) for x, y in projected],
                fill=(2, 16, 10, 135),
            )
            fill_draw.polygon(
                projected,
                fill=(214, 229, 204, 222),
                outline=(248, 250, 238, 255),
                width=4,
            )
    shadow = shadow.filter(ImageFilter.GaussianBlur(12))
    base.alpha_composite(shadow)
    base.alpha_composite(fill_layer)


def ratio_text(hunt: dict[str, Any]) -> str:
    totals = hunt.get("odds", {}).get("resident", {}).get("totals")
    if totals and totals.get("successRatio"):
        return str(totals["successRatio"])
    profile = hunt.get("drawProfile", {}).get("resident")
    if profile and isinstance(profile.get("odds"), (int, float)):
        return f"{profile['odds']:.1f}%"
    return "See profile"


def compact_number(value: Any) -> str:
    if not isinstance(value, (int, float)):
        return "—"
    return f"{int(value):,}"


def create_card(
    state: str,
    hunt: dict[str, Any],
    features: list[dict[str, Any]],
    source_label: str,
    output: Path,
) -> None:
    image = Image.new("RGBA", (WIDTH, HEIGHT), (23, 52, 39, 255))
    draw_gradient(image)
    draw = ImageDraw.Draw(image, "RGBA")
    draw_topographic_lines(draw)

    draw.rounded_rectangle(
        (36, 36, WIDTH - 36, HEIGHT - 36),
        radius=24,
        fill=(22, 55, 41, 255),
        outline=(139, 170, 145, 115),
        width=2,
    )
    draw.rounded_rectangle(
        (650, 74, 1136, 542),
        radius=22,
        fill=(10, 34, 24, 255),
        outline=(172, 200, 177, 90),
        width=2,
    )
    draw_boundary(image, features, (670, 92, 1118, 522))
    draw = ImageDraw.Draw(image, "RGBA")

    eyebrow_font = font(FONT_BOLD, 20)
    title_font = font(FONT_SERIF_BOLD, 56)
    body_font = font(FONT_REGULAR, 25)
    stat_label_font = font(FONT_BOLD, 15)
    stat_value_font = font(FONT_BOLD, 29)
    small_font = font(FONT_REGULAR, 16)

    state_label = state.upper()
    eyebrow = f"THE HUNT BRIEF  /  {state_label}  /  HUNT {hunt['huntNumber']}"
    draw.text((72, 82), eyebrow, font=eyebrow_font, fill=(220, 186, 119, 255))

    title = f"{hunt['huntName']}\n{hunt['species']}"
    y = 132
    for line in title.splitlines():
        for wrapped in wrap_text(draw, line, title_font, 520):
            draw.text((70, y), wrapped, font=title_font, fill=(250, 249, 240, 255))
            y += 64

    season = hunt.get("seasonDateText") or "See current agency materials"
    for line in wrap_text(draw, season, body_font, 500):
        draw.text((72, y + 14), line, font=body_font, fill=(192, 213, 197, 255))
        y += 32

    harvest = hunt.get("harvest") or {}
    quota = hunt.get("quota") or {}
    stats = [
        ("2026 PERMITS", compact_number(quota.get("total"))),
        (f"{harvest.get('year', 'LATEST')} SUCCESS", (
            f"{harvest['successRate']:.1f}%".replace(".0%", "%")
            if isinstance(harvest.get("successRate"), (int, float))
            else "—"
        )),
        ("RESIDENT DRAW", ratio_text(hunt)),
    ]
    stat_y = 490
    stat_width = 175
    for index, (label, value) in enumerate(stats):
        x = 72 + index * stat_width
        if index:
            draw.line((x - 20, stat_y, x - 20, stat_y + 72), fill=(168, 192, 172, 80), width=1)
        draw.text((x, stat_y), label, font=stat_label_font, fill=(159, 186, 166, 255))
        draw.text((x, stat_y + 27), value, font=stat_value_font, fill=(250, 249, 240, 255))

    feature_name = ", ".join(
        dict.fromkeys(str(feature.get("name", "")) for feature in features)
    )
    footer = f"Boundary: {feature_name or source_label}  •  Orientation only — verify with the wildlife agency"
    draw.text((72, 612), footer, font=small_font, fill=(155, 183, 163, 255))

    output.parent.mkdir(parents=True, exist_ok=True)
    image.convert("RGB").save(output, "PNG", optimize=True)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--state", choices=STATE_FILES, default="utah")
    parser.add_argument("--hunt-number", default="DB1001")
    parser.add_argument("--hunt-name")
    parser.add_argument(
        "--output",
        default="public/images/journal/db1001-paunsaugunt-archery-2026.png",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    hunt = find_hunt(args.state, args.hunt_number, args.hunt_name)
    features, source_label = find_boundary_features(args.state, hunt)
    output = Path(args.output)
    if not output.is_absolute():
        output = ROOT / output
    create_card(args.state, hunt, features, source_label, output)
    print(f"Created {output} ({WIDTH}x{HEIGHT}) from {len(features)} boundary feature(s).")


if __name__ == "__main__":
    main()

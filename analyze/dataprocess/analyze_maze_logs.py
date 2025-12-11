import os
import json
import argparse
import csv
from typing import List, Dict, Any

import matplotlib.pyplot as plt
import numpy as np


def parse_viewport_entries(json_path: str) -> List[Dict[str, Any]]:
    """
    解析单个 JSON 日志文件，返回一个列表，每一项对应 viewportDwellTime 中的一条记录。
    """
    with open(json_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    entries = data.get("viewportDwellTime", [])
    rows = []

    if not entries:
        return rows

    # 用第一个 timestamp 作为时间 0
    t0 = entries[0].get("timestamp", 0)

    for idx, e in enumerate(entries):
        ts = e.get("timestamp", 0)
        cam = e.get("cameraPos", {})
        angles = e.get("targetAngles", {})

        def to_float_safe(v):
            if v is None:
                return np.nan
            if isinstance(v, (int, float)):
                return float(v)
            # 字符串 "NaN" 之类
            try:
                if str(v).lower() == "nan":
                    return np.nan
                return float(v)
            except ValueError:
                return np.nan

        x = to_float_safe(cam.get("x"))
        y = to_float_safe(cam.get("y"))
        z = to_float_safe(cam.get("z"))

        start_angle = to_float_safe(angles.get("Start"))
        exit_angle = to_float_safe(angles.get("Exit"))

        rows.append(
            {
                "file": os.path.basename(json_path),
                "index": idx,
                "timestamp": ts,
                "time_sec": (ts - t0) / 1000.0,
                "x": x,
                "y": y,
                "z": z,
                "start_angle": start_angle,
                "exit_angle": exit_angle,
            }
        )

    return rows


def write_csv(all_rows: List[Dict[str, Any]], output_csv: str) -> None:
    """
    把所有日志的记录写入一个总 CSV.
    """
    if not all_rows:
        print("No data found, CSV will not be created.")
        return

    fieldnames = [
        "file",
        "index",
        "timestamp",
        "time_sec",
        "x",
        "y",
        "z",
        "start_angle",
        "exit_angle",
    ]
    with open(output_csv, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        for row in all_rows:
            writer.writerow(row)

    print(f"CSV written to: {output_csv}")


def plot_trajectory(rows: List[Dict[str, Any]], out_path: str) -> None:
    """
    根据记录绘制玩家轨迹图（x-z 平面），保存为 PNG.
    """
    if not rows:
        return

    xs = [r["x"] for r in rows]
    zs = [r["z"] for r in rows]

    plt.figure()
    plt.plot(xs, zs, marker="o", linestyle="-")
    # 标记起点和终点
    plt.scatter(xs[0], zs[0], s=50)
    plt.scatter(xs[-1], zs[-1], s=50)
    plt.text(xs[0], zs[0], "Start")
    plt.text(xs[-1], zs[-1], "End")
    plt.xlabel("X position")
    plt.ylabel("Z position")
    plt.title(f"Trajectory: {rows[0]['file']}")
    plt.gca().invert_yaxis()  # 如果你希望和地图视觉方向一致可以留着/删掉试试
    plt.tight_layout()
    plt.savefig(out_path)
    plt.close()
    print(f"Trajectory plot saved to: {out_path}")


def plot_angles(rows: List[Dict[str, Any]], out_path: str) -> None:
    """
    根据记录绘制视角角度变化图（Start / Exit 随时间），保存为 PNG.
    """
    if not rows:
        return

    t = [r["time_sec"] for r in rows]
    start_angles = [r["start_angle"] for r in rows]
    exit_angles = [r["exit_angle"] for r in rows]

    plt.figure()
    # 过滤掉全 NaN 的情况
    if not all(np.isnan(start_angles)):
        plt.plot(t, start_angles, label="Start angle")
    if not all(np.isnan(exit_angles)):
        plt.plot(t, exit_angles, label="Exit angle")

    plt.xlabel("Time (s)")
    plt.ylabel("Angle (deg)")
    plt.title(f"View angles over time: {rows[0]['file']}")
    plt.legend()
    plt.tight_layout()
    plt.savefig(out_path)
    plt.close()
    print(f"Angle plot saved to: {out_path}")


def process_file(json_path: str, plots_dir: str) -> List[Dict[str, Any]]:
    """
    处理单个 JSON：返回 CSV 行，同时生成两张图。
    """
    rows = parse_viewport_entries(json_path)
    if not rows:
        print(f"No viewportDwellTime data in {json_path}")
        return []

    base = os.path.splitext(os.path.basename(json_path))[0]
    traj_path = os.path.join(plots_dir, f"{base}_trajectory.png")
    angles_path = os.path.join(plots_dir, f"{base}_angles.png")

    os.makedirs(plots_dir, exist_ok=True)
    plot_trajectory(rows, traj_path)
    plot_angles(rows, angles_path)

    return rows


def main():
    parser = argparse.ArgumentParser(
        description="Analyze maze log JSON files: create CSV + trajectory and angle plots."
    )
    parser.add_argument(
        "input_path",
        help="JSON file or directory containing JSON log files",
    )
    parser.add_argument(
        "--output_csv",
        default="maze_logs_summary.csv",
        help="Output CSV file name (default: maze_logs_summary.csv)",
    )
    parser.add_argument(
        "--plots_dir",
        default="plots",
        help="Directory to save generated plots (default: plots)",
    )

    args = parser.parse_args()

    input_path = args.input_path
    all_rows: List[Dict[str, Any]] = []

    if os.path.isdir(input_path):
        # 目录：遍历所有 .json
        for name in os.listdir(input_path):
            if name.lower().endswith(".json"):
                json_path = os.path.join(input_path, name)
                print(f"Processing {json_path} ...")
                rows = process_file(json_path, args.plots_dir)
                all_rows.extend(rows)
    else:
        # 单个文件
        print(f"Processing {input_path} ...")
        rows = process_file(input_path, args.plots_dir)
        all_rows.extend(rows)

    # 写总 CSV
    write_csv(all_rows, args.output_csv)


if __name__ == "__main__":
    main()

import json
import os
import glob
import math
import pandas as pd

def parse_log(json_path):
    """Parse a single maze_user_data.json-style log file into a DataFrame."""
    with open(json_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    session = data.get("sessionInfo", {})
    map_info = data.get("mapInfo", {})
    viewport = data.get("viewportDwellTime", [])

    rows = []
    for entry in viewport:
        ts = entry.get("timestamp")
        cam = entry.get("cameraPos", {})
        ang = entry.get("targetAngles", {})
        rows.append({
            "timestamp": ts,
            "camera_x": float(cam.get("x", "nan")) if cam.get("x") is not None else float("nan"),
            "camera_y": float(cam.get("y", "nan")) if cam.get("y") is not None else float("nan"),
            "camera_z": float(cam.get("z", "nan")) if cam.get("z") is not None else float("nan"),
            "angle_start": float(ang.get("Start", "nan")) if ang.get("Start") not in (None, "NaN") else float("nan"),
            "angle_exit": float(ang.get("Exit", "nan")) if ang.get("Exit") not in (None, "NaN") else float("nan"),
            "session_startTime": session.get("startTime"),
            "session_endTime": session.get("endTime"),
            "map_width": map_info.get("width"),
            "map_height": map_info.get("height"),
        })
    return pd.DataFrame(rows), session, map_info

def compute_basic_metrics(df, session):
    """Compute simple metrics from one participant's DataFrame."""
    metrics = {}
    # Duration (ms) from sessionInfo if available
    if session.get("startTime") is not None and session.get("endTime") is not None:
        metrics["duration_ms"] = session["endTime"] - session["startTime"]
        metrics["duration_s"] = metrics["duration_ms"] / 1000.0
    else:
        metrics["duration_ms"] = None
        metrics["duration_s"] = None

    # Number of samples
    metrics["n_samples"] = len(df)

    # Path length in X-Z plane
    path_len = 0.0
    prev_x, prev_z = None, None
    for _, row in df.iterrows():
        x, z = row["camera_x"], row["camera_z"]
        if not (math.isnan(x) or math.isnan(z)):
            if prev_x is not None:
                path_len += math.dist((prev_x, prev_z), (x, z))
            prev_x, prev_z = x, z
    metrics["path_length"] = path_len

    # Average angular change (Exit - Start)
    if "angle_start" in df and "angle_exit" in df:
        d_angle = (df["angle_exit"] - df["angle_start"]).abs()
        metrics["mean_angle_change"] = float(d_angle.mean(skipna=True))
    else:
        metrics["mean_angle_change"] = None

    return metrics

def batch_analyze_logs(input_dir, output_csv="all_logs_summary.csv"):
    """Batch-parse all *.json logs in a directory and write a summary CSV.

    Parameters
    ----------
    input_dir : str
        Directory containing JSON log files.
    output_csv : str
        Path to the CSV file for the aggregated metrics.
    """
    json_files = glob.glob(os.path.join(input_dir, "*.json"))
    all_metrics = []
    for path in json_files:
        df, session, map_info = parse_log(path)
        metrics = compute_basic_metrics(df, session)
        metrics["file"] = os.path.basename(path)
        metrics["map_width"] = map_info.get("width")
        metrics["map_height"] = map_info.get("height")
        all_metrics.append(metrics)

        # Also optionally save per-file CSV beside the JSON
        base, _ = os.path.splitext(path)
        df.to_csv(base + "_viewport.csv", index=False)

    summary_df = pd.DataFrame(all_metrics)
    summary_df.to_csv(output_csv, index=False)
    print(f"Saved summary to {output_csv}")
    return summary_df

if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Batch analyze maze user logs.")
    parser.add_argument("input_dir", help="Directory containing JSON log files")
    parser.add_argument("--output_csv", default="all_logs_summary.csv",
                        help="Output CSV filename for aggregated metrics")
    args = parser.parse_args()

    batch_analyze_logs(args.input_dir, args.output_csv)

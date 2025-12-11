import json
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
import seaborn as sns

# Load the data
file_path = 'maze_user_data1210.json'
with open(file_path, 'r') as f:
    data = json.load(f)

# Extract eye tracking data
# Based on previous turns, it's likely under 'eyeTracking' key, but let's check keys to be sure or just try to access it.
if 'eyeTracking' in data:
    eye_data = data['eyeTracking']
else:
    # Fallback: maybe the snippet implied the whole file structure or a different key?
    # Let's inspect keys if 'eyeTracking' is missing.
    eye_data = []
    print(f"Keys found: {data.keys()}")

# Convert to DataFrame
df = pd.DataFrame(eye_data)

if not df.empty:
    # 1. Fixation Analysis (Basic Dispersion Algorithm)
    # Constants for fixation detection
    # Assuming screen resolution related coords.
    # Dispersion threshold (pixels)
    MAX_DISPERSION = 50
    # Minimum duration (ms) - approx 3-4 samples if 30ms gap
    MIN_DURATION = 100

    fixations = []

    # Simple ID-T implementation
    i = 0
    while i < len(df):
        j = i + 1
        while j < len(df):
            # Check duration
            duration = df.iloc[j]['timestamp'] - df.iloc[i]['timestamp']

            # Check dispersion
            window = df.iloc[i:j + 1]
            dispersion = (window['x'].max() - window['x'].min()) + (window['y'].max() - window['y'].min())

            if dispersion > MAX_DISPERSION:
                # Dispersion too high, stop extending window
                # If valid fixation found previously (duration > min), save it
                if (df.iloc[j - 1]['timestamp'] - df.iloc[i]['timestamp']) >= MIN_DURATION:
                    fixations.append({
                        'start_time': df.iloc[i]['timestamp'],
                        'end_time': df.iloc[j - 1]['timestamp'],
                        'duration': df.iloc[j - 1]['timestamp'] - df.iloc[i]['timestamp'],
                        'x': window.iloc[:-1]['x'].mean(),
                        'y': window.iloc[:-1]['y'].mean()
                    })
                    i = j
                else:
                    i += 1
                break
            else:
                j += 1
        else:
            # End of data
            if (df.iloc[-1]['timestamp'] - df.iloc[i]['timestamp']) >= MIN_DURATION:
                fixations.append({
                    'start_time': df.iloc[i]['timestamp'],
                    'end_time': df.iloc[-1]['timestamp'],
                    'duration': df.iloc[-1]['timestamp'] - df.iloc[i]['timestamp'],
                    'x': df.iloc[i:]['x'].mean(),
                    'y': df.iloc[i:]['y'].mean()
                })
            break

    fix_df = pd.DataFrame(fixations)


    # Define AOIs based on coordinates
    # Minimap: Top Left (approx x < 300, y < 200 based on previous analysis)
    # Export: Top Right (approx x > 1200, y < 100)
    # Center: Rest

    def classify_aoi(row):
        # Coordinates might be negative or large, adjust logic if needed based on data inspection
        x, y = row['x'], row['y']
        if x < 300 and y < 200:
            return "Minimap (Top-Left)"
        elif x > 1200 and y < 150:  # Assuming typical width, adjusting for export btn
            return "Export Button (Top-Right)"
        else:
            return "Main Viewport"


    if not fix_df.empty:
        fix_df['AOI'] = fix_df.apply(classify_aoi, axis=1)
        aoi_counts = fix_df['AOI'].value_counts()
        print("Fixation Counts per AOI:")
        print(aoi_counts)
    else:
        print("No fixations detected with current parameters.")

    # 2. Heatmap
    plt.figure(figsize=(10, 6))
    # Invert Y axis because screen coordinates usually have (0,0) at top-left
    plt.gca().invert_yaxis()
    sns.kdeplot(x=df['x'], y=df['y'], fill=True, cmap="Reds", thresh=0.05, alpha=0.7)
    plt.scatter(df['x'], df['y'], s=5, color='black', alpha=0.3)  # raw points
    plt.title("Gaze Heatmap")
    plt.xlabel("Screen X")
    plt.ylabel("Screen Y")
    plt.savefig("heatmap.png")

    # 3. Gaze Path (Scanpath)
    plt.figure(figsize=(10, 6))
    plt.gca().invert_yaxis()
    plt.plot(df['x'], df['y'], '-o', markersize=4, alpha=0.6, linewidth=1)

    # Annotate start and end
    plt.text(df.iloc[0]['x'], df.iloc[0]['y'], 'START', color='green', fontweight='bold')
    plt.text(df.iloc[-1]['x'], df.iloc[-1]['y'], 'END', color='red', fontweight='bold')

    # Draw AOI boxes for reference
    # Minimap
    plt.plot([0, 300, 300, 0, 0], [0, 0, 200, 200, 0], 'b--', label='Minimap Zone')
    # Export (assuming 1920 width for visualization, or max x)
    max_x = max(df['x'].max(), 1600)
    plt.plot([1200, max_x, max_x, 1200, 1200], [0, 0, 150, 150, 0], 'g--', label='Export Zone')

    plt.title("Gaze Scanpath")
    plt.legend()
    plt.savefig("scanpath.png")

    print(f"Total raw data points: {len(df)}")
    print(f"Total fixations detected: {len(fixations)}")
else:
    print("No eye tracking data found in file.")
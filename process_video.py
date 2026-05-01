#!/usr/bin/env python3
"""
Process the hand exercise reference video:
1. Split into selected exercise clips
2. Extract hand landmarks using MediaPipe Tasks API
3. Save landmark sequences as JSON
4. Extract representative keyframes
"""

import cv2
import json
import os
import subprocess
import numpy as np

# Exercise definitions with timestamps (seconds).
# Product scope: only exercise_1 and exercise_5 are active.
EXERCISES = [
    {"id": 1, "name": "Finger Opposition",  "start": 0,  "end": 16},
    {"id": 5, "name": "Strengthening",       "start": 85, "end": 123},
]

BASE_DIR      = os.path.dirname(os.path.abspath(__file__))
VIDEO_PATH    = os.path.join(BASE_DIR, "hand-exercise.mp4")
DATA_DIR      = os.path.join(BASE_DIR, "data")
CLIPS_DIR     = os.path.join(DATA_DIR, "clips")
LANDMARKS_DIR = os.path.join(DATA_DIR, "landmarks")
KEYFRAMES_DIR = os.path.join(DATA_DIR, "keyframes")
MODEL_PATH    = os.path.join(DATA_DIR, "hand_landmarker.task")
LANDMARK_SAMPLE_STRIDE = 6


def ensure_dirs():
    for d in [CLIPS_DIR, LANDMARKS_DIR, KEYFRAMES_DIR]:
        os.makedirs(d, exist_ok=True)


def split_video():
    """Split the main video into exercise clips using ffmpeg."""
    print("=" * 60)
    print("STEP 1: Splitting video into exercise clips")
    print("=" * 60)

    for ex in EXERCISES:
        out_path = os.path.join(CLIPS_DIR, f"exercise_{ex['id']}.mp4")
        if os.path.exists(out_path):
            print(f"  [SKIP] {ex['name']} already exists")
            continue

        duration = ex["end"] - ex["start"]
        cmd = [
            "ffmpeg", "-y",
            "-ss", str(ex["start"]),
            "-i", VIDEO_PATH,
            "-t", str(duration),
            "-c", "copy",
            "-movflags", "+faststart",
            out_path
        ]
        print(f"  Extracting: {ex['name']} ({ex['start']}s - {ex['end']}s)")
        subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True)
        print(f"  [OK] Saved → {out_path}")

    print()


def extract_landmarks():
    """Extract hand landmarks from each exercise clip using MediaPipe Tasks API."""
    print("=" * 60)
    print("STEP 2: Extracting hand landmarks with MediaPipe")
    print("=" * 60)

    import mediapipe as mp
    from mediapipe.tasks.python.vision import HandLandmarker, HandLandmarkerOptions, RunningMode
    from mediapipe.tasks.python import BaseOptions

    for ex in EXERCISES:
        clip_path = os.path.join(CLIPS_DIR, f"exercise_{ex['id']}.mp4")
        out_path = os.path.join(LANDMARKS_DIR, f"exercise_{ex['id']}.json")

        if os.path.exists(out_path):
            print(f"  [SKIP] {ex['name']} landmarks already exist")
            continue

        print(f"  Processing: {ex['name']}...")

        # Create HandLandmarker in VIDEO mode
        options = HandLandmarkerOptions(
            base_options=BaseOptions(model_asset_path=MODEL_PATH),
            running_mode=RunningMode.VIDEO,
            num_hands=2,
            min_hand_detection_confidence=0.3,
            min_hand_presence_confidence=0.3,
            min_tracking_confidence=0.3,
        )

        cap = cv2.VideoCapture(clip_path)
        fps = cap.get(cv2.CAP_PROP_FPS)
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))

        landmark_sequence = []
        frame_idx = 0

        with HandLandmarker.create_from_options(options) as landmarker:
            while cap.isOpened():
                ret, frame = cap.read()
                if not ret:
                    break

                # Process every nth frame to keep the guided sequence lightweight.
                if frame_idx % LANDMARK_SAMPLE_STRIDE == 0:
                    rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
                    mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
                    timestamp_ms = int(frame_idx * 1000 / fps)

                    result = landmarker.detect_for_video(mp_image, timestamp_ms)

                    frame_data = {
                        "frame": frame_idx,
                        "time": round(frame_idx / fps, 3),
                        "hands": []
                    }

                    if result.hand_landmarks:
                        for hand_idx, hand_lms in enumerate(result.hand_landmarks):
                            handedness_label = "Unknown"
                            if result.handedness and hand_idx < len(result.handedness):
                                handedness_label = result.handedness[hand_idx][0].category_name

                            hand_data = {
                                "handedness": handedness_label,
                                "landmarks": []
                            }
                            for lm in hand_lms:
                                hand_data["landmarks"].append({
                                    "x": round(lm.x, 6),
                                    "y": round(lm.y, 6),
                                    "z": round(lm.z, 6),
                                })
                            frame_data["hands"].append(hand_data)

                    landmark_sequence.append(frame_data)

                frame_idx += 1

        cap.release()

        # Save
        output = {
            "exercise_id": ex["id"],
            "exercise_name": ex["name"],
            "fps": fps,
            "sample_rate": LANDMARK_SAMPLE_STRIDE,
            "effective_fps": round(fps / LANDMARK_SAMPLE_STRIDE, 2),
            "total_frames": total_frames,
            "sampled_frames": len(landmark_sequence),
            "frames": landmark_sequence,
        }

        with open(out_path, "w") as f:
            json.dump(output, f, indent=2)

        detected = sum(1 for fr in landmark_sequence if fr["hands"])
        print(f"  [OK] {ex['name']}: {len(landmark_sequence)} frames sampled, "
              f"{detected} with hands detected ({100*detected/max(len(landmark_sequence),1):.0f}%)")

    print()


def extract_keyframes():
    """Extract representative keyframes (start, mid, end) from each exercise."""
    print("=" * 60)
    print("STEP 3: Extracting representative keyframes")
    print("=" * 60)

    import mediapipe as mp
    from mediapipe.tasks.python.vision import HandLandmarker, HandLandmarkerOptions, RunningMode
    from mediapipe.tasks.python import BaseOptions

    # Hand connection pairs for drawing
    HAND_CONNECTIONS = [
        (0,1),(1,2),(2,3),(3,4),
        (0,5),(5,6),(6,7),(7,8),
        (0,9),(9,10),(10,11),(11,12),
        (0,13),(13,14),(14,15),(15,16),
        (0,17),(17,18),(18,19),(19,20),
        (5,9),(9,13),(13,17),
    ]

    for ex in EXERCISES:
        clip_path = os.path.join(CLIPS_DIR, f"exercise_{ex['id']}.mp4")
        landmarks_path = os.path.join(LANDMARKS_DIR, f"exercise_{ex['id']}.json")

        with open(landmarks_path) as f:
            lm_data = json.load(f)

        # Find frames with best hand detection
        frames_with_hands = [fr for fr in lm_data["frames"] if fr["hands"]]
        if not frames_with_hands:
            print(f"  [WARN] No hands detected for {ex['name']}, using raw frames")
            keyframe_times = [0, (ex["end"] - ex["start"]) / 2, ex["end"] - ex["start"] - 0.5]
        else:
            n = len(frames_with_hands)
            keyframe_times = [
                frames_with_hands[0]["time"],
                frames_with_hands[n // 2]["time"],
                frames_with_hands[-1]["time"],
            ]

        cap = cv2.VideoCapture(clip_path)

        # Use IMAGE mode for single-image detection
        options = HandLandmarkerOptions(
            base_options=BaseOptions(model_asset_path=MODEL_PATH),
            running_mode=RunningMode.IMAGE,
            num_hands=2,
            min_hand_detection_confidence=0.2,
        )

        with HandLandmarker.create_from_options(options) as landmarker:
            for ki, t in enumerate(keyframe_times):
                label = ["start", "mid", "end"][ki]
                out_path = os.path.join(KEYFRAMES_DIR, f"exercise_{ex['id']}_{label}.jpg")

                cap.set(cv2.CAP_PROP_POS_MSEC, t * 1000)
                ret, frame = cap.read()
                if not ret:
                    continue

                # Detect and draw landmarks
                rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
                mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
                result = landmarker.detect(mp_image)

                if result.hand_landmarks:
                    h, w = frame.shape[:2]
                    for hand_lms in result.hand_landmarks:
                        pts = [(int(lm.x * w), int(lm.y * h)) for lm in hand_lms]
                        for s, e in HAND_CONNECTIONS:
                            cv2.line(frame, pts[s], pts[e], (0, 200, 255), 2)
                        for pt in pts:
                            cv2.circle(frame, pt, 4, (0, 255, 128), -1)

                cv2.imwrite(out_path, frame, [cv2.IMWRITE_JPEG_QUALITY, 90])

        cap.release()
        print(f"  [OK] {ex['name']}: 3 keyframes saved")

    print()


def generate_metadata():
    """Generate a summary metadata file for the web app."""
    print("=" * 60)
    print("STEP 4: Generating exercise metadata")
    print("=" * 60)

    metadata = []
    for ex in EXERCISES:
        lm_path = os.path.join(LANDMARKS_DIR, f"exercise_{ex['id']}.json")
        with open(lm_path) as f:
            lm_data = json.load(f)

        frames_with_hands = sum(1 for fr in lm_data["frames"] if fr["hands"])

        metadata.append({
            "id": ex["id"],
            "name": ex["name"],
            "duration": ex["end"] - ex["start"],
            "clip": f"exercise_{ex['id']}.mp4",
            "keyframes": {
                "start": f"exercise_{ex['id']}_start.jpg",
                "mid": f"exercise_{ex['id']}_mid.jpg",
                "end": f"exercise_{ex['id']}_end.jpg",
            },
            "landmarks_file": f"exercise_{ex['id']}.json",
            "total_landmark_frames": lm_data["sampled_frames"],
            "frames_with_hands": frames_with_hands,
            "detection_rate": round(100 * frames_with_hands / max(lm_data["sampled_frames"], 1), 1),
        })

    out_path = os.path.join(DATA_DIR, "exercises.json")
    with open(out_path, "w") as f:
        json.dump(metadata, f, indent=2)

    print(f"  [OK] Metadata saved → {out_path}")
    print()

    # Summary
    print("=" * 60)
    print("PROCESSING COMPLETE — Summary")
    print("=" * 60)
    for m in metadata:
        print(f"  {m['id']}. {m['name']:20s} | {m['duration']:3d}s | "
              f"{m['frames_with_hands']}/{m['total_landmark_frames']} frames detected "
              f"({m['detection_rate']}%)")
    print()


if __name__ == "__main__":
    ensure_dirs()
    split_video()
    extract_landmarks()
    extract_keyframes()
    generate_metadata()

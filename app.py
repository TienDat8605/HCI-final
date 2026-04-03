#!/usr/bin/env python3
"""
Flask server for the Hand Exercise Recovery Assistant.
Serves the web UI, reference exercise data, and video clips.
"""

import os
import json
from flask import Flask, jsonify, send_from_directory, send_file, request
from hand_compare import compare_hands, find_best_matching_frame, load_reference_landmarks

BASE_DIR      = os.path.dirname(os.path.abspath(__file__))
DATA_DIR      = os.path.join(BASE_DIR, "data")
STATIC_DIR    = os.path.join(BASE_DIR, "static")
CLIPS_DIR     = os.path.join(DATA_DIR, "clips")
LANDMARKS_DIR = os.path.join(DATA_DIR, "landmarks")
KEYFRAMES_DIR = os.path.join(DATA_DIR, "keyframes")

app = Flask(__name__, static_folder=STATIC_DIR)

# Pre-load reference landmarks
_ref_cache = {}


def get_ref_data(exercise_id):
    if exercise_id not in _ref_cache:
        path = os.path.join(LANDMARKS_DIR, f"exercise_{exercise_id}.json")
        _ref_cache[exercise_id] = load_reference_landmarks(path)
    return _ref_cache[exercise_id]


# ── Routes ────────────────────────────────────────────────

@app.route("/")
def index():
    return send_from_directory(STATIC_DIR, "index.html")


@app.route("/static/<path:filename>")
def static_files(filename):
    return send_from_directory(STATIC_DIR, filename)


@app.route("/api/exercises")
def get_exercises():
    """Return exercise metadata list."""
    with open(os.path.join(DATA_DIR, "exercises.json")) as f:
        exercises = json.load(f)
    return jsonify(exercises)


@app.route("/api/landmarks/<int:exercise_id>")
def get_landmarks(exercise_id):
    """Return reference landmark data for an exercise."""
    data = get_ref_data(exercise_id)
    return jsonify(data)


@app.route("/api/video/<int:exercise_id>")
def get_video(exercise_id):
    """Stream reference exercise video clip."""
    clip_path = os.path.join(CLIPS_DIR, f"exercise_{exercise_id}.mp4")
    if not os.path.exists(clip_path):
        return jsonify({"error": "not found"}), 404
    return send_file(clip_path, mimetype="video/mp4")


@app.route("/api/keyframe/<int:exercise_id>/<position>")
def get_keyframe(exercise_id, position):
    """Serve a keyframe image."""
    if position not in ("start", "mid", "end"):
        return jsonify({"error": "invalid position"}), 400
    img_path = os.path.join(KEYFRAMES_DIR, f"exercise_{exercise_id}_{position}.jpg")
    if not os.path.exists(img_path):
        return jsonify({"error": "not found"}), 404
    return send_file(img_path, mimetype="image/jpeg")


@app.route("/api/compare", methods=["POST"])
def compare():
    """
    Compare user landmarks with reference.
    Expects JSON: { exercise_id: int, landmarks: [{x,y,z}, ...] (21 points) }
    """
    data = request.json
    exercise_id = data.get("exercise_id")
    user_landmarks = data.get("landmarks")

    if not exercise_id or not user_landmarks or len(user_landmarks) != 21:
        return jsonify({"error": "invalid data"}), 400

    ref_data = get_ref_data(exercise_id)
    ref_frames = ref_data["frames"]

    best_idx, best_score, result = find_best_matching_frame(user_landmarks, ref_frames)

    if result is None:
        return jsonify({"error": "no reference data"}), 500

    result["matched_frame"] = best_idx
    result["matched_time"] = ref_frames[best_idx]["time"]

    return jsonify(result)


if __name__ == "__main__":
    print("=" * 60)
    print("  Hand Exercise Recovery Assistant")
    print("  Open http://localhost:5000 in your browser")
    print("=" * 60)
    app.run(host="0.0.0.0", port=5000, debug=True)

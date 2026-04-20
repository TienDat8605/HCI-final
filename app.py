#!/usr/bin/env python3
"""
Flask server for the Hand Exercise Recovery Assistant.
Serves the web UI, reference exercise data, and video clips.
"""

import json
import os

from flask import Flask, jsonify, request, send_file, send_from_directory

from hand_compare import find_best_matching_frame, load_reference_landmarks

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, "data")
STATIC_DIR = os.path.join(BASE_DIR, "static")
CLIPS_DIR = os.path.join(DATA_DIR, "clips")
LANDMARKS_DIR = os.path.join(DATA_DIR, "landmarks")
KEYFRAMES_DIR = os.path.join(DATA_DIR, "keyframes")
EXERCISES_PATH = os.path.join(DATA_DIR, "exercises.json")
KEYFRAME_POSITIONS = ("start", "mid", "end")
SUPPORTED_EXERCISE_IDS = (1, 5, 6)
EXERCISE_GAME_MODES = {
    1: "exercise_1_mode",
    5: "exercise_5_mode",
    6: "pinch_defense_mode",
}

app = Flask(__name__, static_folder=STATIC_DIR)

# Pre-load reference landmarks
_ref_cache = {}


def json_error(message, status_code):
    return jsonify({"error": message}), status_code


def read_json(path):
    with open(path, encoding="utf-8") as file:
        return json.load(file)


def exercise_file(directory, exercise_id, extension):
    return os.path.join(directory, f"exercise_{exercise_id}.{extension}")


def get_ref_data(exercise_id):
    path = exercise_file(LANDMARKS_DIR, exercise_id, "json")
    if not os.path.exists(path):
        return None
    if exercise_id not in _ref_cache:
        _ref_cache[exercise_id] = load_reference_landmarks(path)
    return _ref_cache[exercise_id]


def send_exercise_file(directory, exercise_id, extension, mimetype):
    path = exercise_file(directory, exercise_id, extension)
    if not os.path.exists(path):
        return json_error("not found", 404)
    return send_file(path, mimetype=mimetype)


def enrich_exercise(exercise):
    exercise_id = exercise.get("id")
    return {
        **exercise,
        "game_mode": EXERCISE_GAME_MODES.get(exercise_id, "unsupported"),
        "video_ready": os.path.exists(exercise_file(CLIPS_DIR, exercise_id, "mp4")),
        "landmarks_ready": os.path.exists(exercise_file(LANDMARKS_DIR, exercise_id, "json")),
        "keyframes_ready": all(
            os.path.exists(os.path.join(KEYFRAMES_DIR, f"exercise_{exercise_id}_{position}.jpg"))
            for position in KEYFRAME_POSITIONS
        ),
    }


def is_supported_exercise(exercise_id):
    return exercise_id in SUPPORTED_EXERCISE_IDS


# ── Routes ────────────────────────────────────────────────

@app.route("/")
def index():
    return send_from_directory(STATIC_DIR, "index.html")


@app.route("/static/<path:filename>")
def static_files(filename):
    return send_from_directory(STATIC_DIR, filename)


@app.route("/api/exercises")
def get_exercises():
    if not os.path.exists(EXERCISES_PATH):
        return json_error("exercise metadata not found", 404)

    exercises = read_json(EXERCISES_PATH)
    filtered = [exercise for exercise in exercises if exercise.get("id") in SUPPORTED_EXERCISE_IDS]
    filtered.sort(key=lambda exercise: exercise.get("id", 0))
    return jsonify([enrich_exercise(exercise) for exercise in filtered])


@app.route("/api/landmarks/<int:exercise_id>")
def get_landmarks(exercise_id):
    if not is_supported_exercise(exercise_id):
        return json_error("not found", 404)
    data = get_ref_data(exercise_id)
    if data is None:
        return json_error("not found", 404)
    return jsonify(data)


@app.route("/api/video/<int:exercise_id>")
def get_video(exercise_id):
    if not is_supported_exercise(exercise_id):
        return json_error("not found", 404)
    return send_exercise_file(CLIPS_DIR, exercise_id, "mp4", "video/mp4")


@app.route("/api/keyframe/<int:exercise_id>/<position>")
def get_keyframe(exercise_id, position):
    if not is_supported_exercise(exercise_id):
        return json_error("not found", 404)
    if position not in KEYFRAME_POSITIONS:
        return json_error("invalid position", 400)
    img_path = os.path.join(KEYFRAMES_DIR, f"exercise_{exercise_id}_{position}.jpg")
    if not os.path.exists(img_path):
        return json_error("not found", 404)
    return send_file(img_path, mimetype="image/jpeg")


@app.route("/api/compare", methods=["POST"])
def compare():
    data = request.get_json(silent=True) or {}
    exercise_id = data.get("exercise_id")
    user_landmarks = data.get("landmarks", [])

    try:
        exercise_id = int(exercise_id)
    except (TypeError, ValueError):
        return json_error("invalid data", 400)

    if not user_landmarks or len(user_landmarks) != 21:
        return json_error("invalid data", 400)
    if not is_supported_exercise(exercise_id):
        return json_error("not found", 404)

    ref_data = get_ref_data(exercise_id)
    if ref_data is None:
        return json_error("reference landmarks not found", 404)
    ref_frames = ref_data.get("frames", [])

    best_idx, best_score, result = find_best_matching_frame(user_landmarks, ref_frames)

    if result is None:
        return json_error("no reference data", 500)

    result["matched_frame"] = best_idx
    result["matched_time"] = ref_frames[best_idx]["time"]
    result["match_score"] = best_score

    return jsonify(result)


if __name__ == "__main__":
    print("=" * 60)
    print("  Hand Exercise Recovery Assistant")
    print("  Open http://localhost:5000 in your browser")
    print("=" * 60)
    app.run(host="0.0.0.0", port=5000, debug=True)

"""
Hand gesture comparison engine.
Compares user hand landmarks with reference exercise landmarks
using angle-based similarity and provides per-finger feedback.
"""

import math
import json
import numpy as np


# MediaPipe hand landmark indices
WRIST = 0
THUMB_CMC, THUMB_MCP, THUMB_IP, THUMB_TIP = 1, 2, 3, 4
INDEX_MCP, INDEX_PIP, INDEX_DIP, INDEX_TIP = 5, 6, 7, 8
MIDDLE_MCP, MIDDLE_PIP, MIDDLE_DIP, MIDDLE_TIP = 9, 10, 11, 12
RING_MCP, RING_PIP, RING_DIP, RING_TIP = 13, 14, 15, 16
PINKY_MCP, PINKY_PIP, PINKY_DIP, PINKY_TIP = 17, 18, 19, 20

FINGER_NAMES = ["Thumb", "Index", "Middle", "Ring", "Pinky"]

# Joint triplets for angle computation (parent, joint, child)
ANGLE_JOINTS = [
    # Thumb
    (WRIST, THUMB_CMC, THUMB_MCP),
    (THUMB_CMC, THUMB_MCP, THUMB_IP),
    (THUMB_MCP, THUMB_IP, THUMB_TIP),
    # Index
    (WRIST, INDEX_MCP, INDEX_PIP),
    (INDEX_MCP, INDEX_PIP, INDEX_DIP),
    (INDEX_PIP, INDEX_DIP, INDEX_TIP),
    # Middle
    (WRIST, MIDDLE_MCP, MIDDLE_PIP),
    (MIDDLE_MCP, MIDDLE_PIP, MIDDLE_DIP),
    (MIDDLE_PIP, MIDDLE_DIP, MIDDLE_TIP),
    # Ring
    (WRIST, RING_MCP, RING_PIP),
    (RING_MCP, RING_PIP, RING_DIP),
    (RING_PIP, RING_DIP, RING_TIP),
    # Pinky
    (WRIST, PINKY_MCP, PINKY_PIP),
    (PINKY_MCP, PINKY_PIP, PINKY_DIP),
    (PINKY_PIP, PINKY_DIP, PINKY_TIP),
]

# Finger-to-joint mapping (which joints belong to each finger)
FINGER_JOINT_INDICES = {
    "Thumb":  [0, 1, 2],
    "Index":  [3, 4, 5],
    "Middle": [6, 7, 8],
    "Ring":   [9, 10, 11],
    "Pinky":  [12, 13, 14],
}


def normalize_landmarks(landmarks):
    """
    Normalize landmarks: translate wrist to origin and scale by hand size.
    landmarks: list of 21 {x, y, z} dicts
    Returns: numpy array of shape (21, 3)
    """
    pts = np.array([[lm["x"], lm["y"], lm["z"]] for lm in landmarks])

    # Translate wrist to origin
    wrist = pts[WRIST].copy()
    pts -= wrist

    # Scale by distance from wrist to middle finger MCP
    scale = np.linalg.norm(pts[MIDDLE_MCP])
    if scale > 1e-6:
        pts /= scale

    return pts


def compute_angle(a, b, c):
    """Compute the angle at point b given three 3D points a, b, c (in radians)."""
    ba = a - b
    bc = c - b
    cos_angle = np.dot(ba, bc) / (np.linalg.norm(ba) * np.linalg.norm(bc) + 1e-8)
    cos_angle = np.clip(cos_angle, -1.0, 1.0)
    return math.acos(cos_angle)


def get_joint_angles(landmarks):
    """
    Compute all joint angles from normalized landmarks.
    Returns: numpy array of 15 angles (3 per finger × 5 fingers)
    """
    pts = normalize_landmarks(landmarks) if isinstance(landmarks[0], dict) else landmarks
    angles = []
    for a_idx, b_idx, c_idx in ANGLE_JOINTS:
        angle = compute_angle(pts[a_idx], pts[b_idx], pts[c_idx])
        angles.append(angle)
    return np.array(angles)


def compute_finger_distances(landmarks):
    """
    Compute fingertip-to-wrist distances (normalized).
    Useful for detecting open/closed hand, finger spread, etc.
    """
    pts = normalize_landmarks(landmarks) if isinstance(landmarks[0], dict) else landmarks
    tips = [THUMB_TIP, INDEX_TIP, MIDDLE_TIP, RING_TIP, PINKY_TIP]
    return np.array([np.linalg.norm(pts[t]) for t in tips])


def compare_hands(user_landmarks, ref_landmarks):
    """
    Compare user hand landmarks with reference landmarks.

    Returns dict with:
      - overall_score: 0-100
      - finger_scores: per-finger scores (0-100)
      - feedback: list of textual feedback strings
      - angle_diffs: raw angle differences
    """
    user_angles = get_joint_angles(user_landmarks)
    ref_angles = get_joint_angles(ref_landmarks)

    # Angle differences (in degrees)
    angle_diffs_deg = np.abs(user_angles - ref_angles) * (180.0 / math.pi)

    # Overall score: exponential decay based on mean angle error
    mean_error = np.mean(angle_diffs_deg)
    overall_score = max(0, 100 * math.exp(-mean_error / 30.0))

    # Per-finger scores
    finger_scores = {}
    feedback = []
    for fname, joint_idxs in FINGER_JOINT_INDICES.items():
        finger_errors = angle_diffs_deg[joint_idxs]
        finger_mean_error = np.mean(finger_errors)
        score = max(0, 100 * math.exp(-finger_mean_error / 25.0))
        finger_scores[fname] = round(score, 1)

        # Generate feedback
        if score < 50:
            # Check if finger is too bent or too extended
            user_finger_angles = user_angles[joint_idxs]
            ref_finger_angles = ref_angles[joint_idxs]
            if np.mean(user_finger_angles) < np.mean(ref_finger_angles):
                feedback.append(f"Extend your {fname} finger more")
            else:
                feedback.append(f"Bend your {fname} finger more")
        elif score < 75:
            feedback.append(f"Adjust your {fname} slightly")

    # Also compare finger distances for spread detection
    user_dists = compute_finger_distances(user_landmarks)
    ref_dists = compute_finger_distances(ref_landmarks)
    dist_diff = np.mean(np.abs(user_dists - ref_dists))

    if dist_diff > 0.5:
        if np.mean(user_dists) < np.mean(ref_dists):
            feedback.append("Spread your fingers wider")
        else:
            feedback.append("Bring your fingers closer together")

    return {
        "overall_score": round(overall_score, 1),
        "finger_scores": finger_scores,
        "feedback": feedback[:3],  # Limit to top 3 most important
        "mean_angle_error": round(mean_error, 1),
    }


def find_best_matching_frame(user_landmarks, ref_frames):
    """
    Find the reference frame that best matches the user's current hand pose.
    Uses DTW-like nearest-frame search.

    ref_frames: list of frame dicts from landmark JSON
    Returns: (best_frame_index, best_score, comparison_result)
    """
    best_idx = 0
    best_score = 0
    best_result = None

    user_angles = get_joint_angles(user_landmarks)

    for i, frame in enumerate(ref_frames):
        if not frame["hands"]:
            continue

        ref_lm = frame["hands"][0]["landmarks"]
        ref_angles = get_joint_angles(ref_lm)

        # Quick angle similarity
        angle_diff = np.mean(np.abs(user_angles - ref_angles) * (180.0 / math.pi))
        score = max(0, 100 * math.exp(-angle_diff / 30.0))

        if score > best_score:
            best_score = score
            best_idx = i
            best_result = compare_hands(user_landmarks, ref_lm)

    return best_idx, best_score, best_result


def load_reference_landmarks(json_path):
    """Load reference landmark data from JSON file."""
    with open(json_path) as f:
        data = json.load(f)
    return data

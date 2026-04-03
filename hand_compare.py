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

ANGLE_TOLERANCE_DEG = 13.0
OVERALL_SCORE_DECAY = 21.0
FINGER_SCORE_DECAY = 17.0
CONTACT_TOLERANCE = 0.09
CONTACT_SCORE_DECAY = 0.11
SPREAD_TOLERANCE = 0.08
SPREAD_SCORE_DECAY = 0.11


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


def compute_thumb_contact_profile(landmarks):
    """Distances from thumb tip to the other fingertip targets."""
    pts = normalize_landmarks(landmarks) if isinstance(landmarks[0], dict) else landmarks
    targets = [INDEX_TIP, MIDDLE_TIP, RING_TIP, PINKY_TIP]
    return np.array([np.linalg.norm(pts[THUMB_TIP] - pts[target]) for target in targets])


def compute_spread_profile(landmarks):
    """Simple lateral spread profile across the fingertips and palm."""
    pts = normalize_landmarks(landmarks) if isinstance(landmarks[0], dict) else landmarks
    spread_pairs = [
        (INDEX_TIP, MIDDLE_TIP),
        (MIDDLE_TIP, RING_TIP),
        (RING_TIP, PINKY_TIP),
        (INDEX_MCP, PINKY_MCP),
    ]
    return np.array([np.linalg.norm(pts[a] - pts[b]) for a, b in spread_pairs])


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
    penalized_diffs = np.maximum(0.0, angle_diffs_deg - ANGLE_TOLERANCE_DEG)

    # Angle score: allow small pose differences before penalizing accuracy.
    mean_error = np.mean(penalized_diffs)
    angle_score = max(0, 100 * math.exp(-mean_error / OVERALL_SCORE_DECAY))

    user_contacts = compute_thumb_contact_profile(user_landmarks)
    ref_contacts = compute_thumb_contact_profile(ref_landmarks)
    contact_diffs = np.maximum(0.0, np.abs(user_contacts - ref_contacts) - CONTACT_TOLERANCE)
    mean_contact_error = np.mean(contact_diffs)
    contact_score = max(0, 100 * math.exp(-mean_contact_error / CONTACT_SCORE_DECAY))

    user_spread = compute_spread_profile(user_landmarks)
    ref_spread = compute_spread_profile(ref_landmarks)
    spread_diffs = np.maximum(0.0, np.abs(user_spread - ref_spread) - SPREAD_TOLERANCE)
    mean_spread_error = np.mean(spread_diffs)
    spread_score = max(0, 100 * math.exp(-mean_spread_error / SPREAD_SCORE_DECAY))

    overall_score = max(0, min(100, angle_score * 0.5 + contact_score * 0.35 + spread_score * 0.15))

    # Per-finger scores
    finger_scores = {}
    feedback = []
    contact_index_map = {
        "Thumb": [0, 1, 2, 3],
        "Index": [0],
        "Middle": [1],
        "Ring": [2],
        "Pinky": [3],
    }
    for fname, joint_idxs in FINGER_JOINT_INDICES.items():
        finger_errors = penalized_diffs[joint_idxs]
        finger_mean_error = np.mean(finger_errors)
        finger_angle_score = max(0, 100 * math.exp(-finger_mean_error / FINGER_SCORE_DECAY))
        finger_contact_error = np.mean(contact_diffs[contact_index_map[fname]])
        finger_contact_score = max(0, 100 * math.exp(-finger_contact_error / CONTACT_SCORE_DECAY))
        score = max(0, min(100, finger_angle_score * 0.72 + finger_contact_score * 0.28))
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

    strongest_contact_idx = int(np.argmax(contact_diffs))
    if contact_diffs[strongest_contact_idx] > CONTACT_TOLERANCE * 1.6:
        finger_label = ["Index", "Middle", "Ring", "Pinky"][strongest_contact_idx]
        if user_contacts[strongest_contact_idx] > ref_contacts[strongest_contact_idx]:
            feedback.insert(0, f"Move your thumb closer to your {finger_label.lower()} finger")
        else:
            feedback.insert(0, f"Move your thumb slightly away from your {finger_label.lower()} finger")
    elif mean_spread_error > SPREAD_TOLERANCE * 0.8:
        if np.mean(user_spread) < np.mean(ref_spread):
            feedback.append("Spread your fingers wider")
        else:
            feedback.append("Bring your fingers closer together")

    return {
        "overall_score": round(overall_score, 1),
        "finger_scores": finger_scores,
        "feedback": feedback[:3],  # Limit to top 3 most important
        "mean_angle_error": round(mean_error, 1),
        "mean_contact_error": round(mean_contact_error, 3),
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

        # Quick similarity across angles and fingertip contact.
        angle_diff = np.abs(user_angles - ref_angles) * (180.0 / math.pi)
        penalized_diff = np.maximum(0.0, angle_diff - ANGLE_TOLERANCE_DEG)
        angle_score = max(0, 100 * math.exp(-np.mean(penalized_diff) / OVERALL_SCORE_DECAY))
        user_contacts = compute_thumb_contact_profile(user_landmarks)
        ref_contacts = compute_thumb_contact_profile(ref_lm)
        contact_diff = np.maximum(0.0, np.abs(user_contacts - ref_contacts) - CONTACT_TOLERANCE)
        contact_score = max(0, 100 * math.exp(-np.mean(contact_diff) / CONTACT_SCORE_DECAY))
        score = max(0, min(100, angle_score * 0.6 + contact_score * 0.4))

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

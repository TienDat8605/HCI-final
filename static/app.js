/**
 * Hand Exercise Recovery Assistant — Client-side JavaScript
 *
 * Uses MediaPipe Hands JS for real-time webcam hand tracking.
 * Compares landmarks against reference data fetched from the server.
 */

// ── State ──
let exercises = [];
let currentExercise = null;
let referenceLandmarks = null;
let cameraRunning = false;
let exerciseActive = false;
let hands = null;
let camera = null;
let latestLandmarks = null;
let compareInterval = null;

// ── DOM Elements ──
const exerciseList = document.getElementById('exerciseList');
const welcomeScreen = document.getElementById('welcomeScreen');
const exerciseView = document.getElementById('exerciseView');
const exerciseTitle = document.getElementById('exerciseTitle');
const refVideo = document.getElementById('refVideo');
const webcamVideo = document.getElementById('webcamVideo');
const webcamCanvas = document.getElementById('webcamCanvas');
const webcamPlaceholder = document.getElementById('webcam-placeholder');
const cameraStatus = document.getElementById('cameraStatus');
const cameraStatusText = document.getElementById('cameraStatusText');
const btnToggleCamera = document.getElementById('btnToggleCamera');
const btnStartExercise = document.getElementById('btnStartExercise');
const keyframesStrip = document.getElementById('keyframesStrip');
const scorePanel = document.getElementById('scoreContent');

// ── Hand Connections for Drawing ──
const HAND_CONNECTIONS = [
    [0, 1], [1, 2], [2, 3], [3, 4],
    [0, 5], [5, 6], [6, 7], [7, 8],
    [0, 9], [9, 10], [10, 11], [11, 12],
    [0, 13], [13, 14], [14, 15], [15, 16],
    [0, 17], [17, 18], [18, 19], [19, 20],
    [5, 9], [9, 13], [13, 17],
];

// ── Joint Angle Computation (mirrors Python hand_compare.py) ──
const ANGLE_JOINTS = [
    [0, 1, 2], [1, 2, 3], [2, 3, 4],
    [0, 5, 6], [5, 6, 7], [6, 7, 8],
    [0, 9, 10], [9, 10, 11], [10, 11, 12],
    [0, 13, 14], [13, 14, 15], [14, 15, 16],
    [0, 17, 18], [17, 18, 19], [18, 19, 20],
];

const FINGER_JOINT_INDICES = {
    "Thumb": [0, 1, 2],
    "Index": [3, 4, 5],
    "Middle": [6, 7, 8],
    "Ring": [9, 10, 11],
    "Pinky": [12, 13, 14],
};

const FINGER_ICONS = { Thumb: '👍', Index: '☝️', Middle: '🖕', Ring: '💍', Pinky: '🤙' };


// ── Init ──
async function init() {
    try {
        const resp = await fetch('/api/exercises');
        exercises = await resp.json();
        renderExerciseList();
    } catch (e) {
        console.error('Failed to load exercises:', e);
    }
}

function renderExerciseList() {
    exerciseList.innerHTML = exercises.map(ex => `
        <div class="exercise-card" data-id="${ex.id}" onclick="selectExercise(${ex.id})">
            <div class="ex-number">EXERCISE ${ex.id}</div>
            <div class="ex-name">${ex.name}</div>
            <div class="ex-duration">${ex.duration}s</div>
            <div class="ex-detection">
                <div class="ex-detection-bar" style="width:${ex.detection_rate}%"></div>
            </div>
        </div>
    `).join('');
}


// ── Exercise Selection ──
async function selectExercise(id) {
    currentExercise = exercises.find(e => e.id === id);
    if (!currentExercise) return;

    // Update UI
    document.querySelectorAll('.exercise-card').forEach(c => c.classList.remove('active'));
    document.querySelector(`.exercise-card[data-id="${id}"]`).classList.add('active');

    welcomeScreen.style.display = 'none';
    exerciseView.classList.add('active');
    exerciseTitle.textContent = currentExercise.name;

    // Load reference video
    refVideo.src = `/api/video/${id}`;
    refVideo.load();

    // Load keyframes
    keyframesStrip.innerHTML = ['start', 'mid', 'end'].map(pos => `
        <div class="keyframe-thumb">
            <img src="/api/keyframe/${id}/${pos}" alt="${pos}">
            <div class="label">${pos.toUpperCase()}</div>
        </div>
    `).join('');

    // Load reference landmarks
    try {
        const resp = await fetch(`/api/landmarks/${id}`);
        referenceLandmarks = await resp.json();
        btnStartExercise.disabled = !cameraRunning;
    } catch (e) {
        console.error('Failed to load landmarks:', e);
    }

    // Reset score panel
    resetScorePanel();
}

function resetScorePanel() {
    scorePanel.innerHTML = `
        <div class="no-data">
            <div class="icon">📏</div>
            <p>Start the exercise and show your hand to see real-time scoring</p>
        </div>
    `;
}


// ── Camera ──
async function toggleCamera() {
    if (cameraRunning) {
        stopCamera();
    } else {
        await startCamera();
    }
}

async function startCamera() {
    try {
        // Initialize MediaPipe Hands
        hands = new Hands({
            locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4.1675469240/${file}`
        });

        hands.setOptions({
            maxNumHands: 2,
            modelComplexity: 1,
            minDetectionConfidence: 0.5,
            minTrackingConfidence: 0.5,
        });

        hands.onResults(onHandResults);

        // Get webcam stream
        const stream = await navigator.mediaDevices.getUserMedia({
            video: { width: 640, height: 480, facingMode: 'user' }
        });

        webcamVideo.srcObject = stream;
        webcamVideo.style.display = 'block';
        webcamPlaceholder.style.display = 'none';

        // Setup canvas
        const container = document.getElementById('webcamContainer');
        webcamCanvas.width = 640;
        webcamCanvas.height = 480;

        // Start camera loop
        camera = new Camera(webcamVideo, {
            onFrame: async () => {
                await hands.send({ image: webcamVideo });
            },
            width: 640,
            height: 480,
        });

        await camera.start();

        cameraRunning = true;
        cameraStatus.classList.add('active');
        cameraStatusText.textContent = 'Camera active';
        btnToggleCamera.innerHTML = '⏹ Stop Camera';
        if (currentExercise && referenceLandmarks) {
            btnStartExercise.disabled = false;
        }

    } catch (e) {
        console.error('Camera error:', e);
        alert('Failed to access camera. Please allow camera permissions.');
    }
}

function stopCamera() {
    if (camera) {
        camera.stop();
        camera = null;
    }

    const stream = webcamVideo.srcObject;
    if (stream) {
        stream.getTracks().forEach(t => t.stop());
        webcamVideo.srcObject = null;
    }

    webcamVideo.style.display = 'none';
    webcamPlaceholder.style.display = 'block';

    const ctx = webcamCanvas.getContext('2d');
    ctx.clearRect(0, 0, webcamCanvas.width, webcamCanvas.height);

    cameraRunning = false;
    cameraStatus.classList.remove('active');
    cameraStatusText.textContent = 'Camera off';
    btnToggleCamera.innerHTML = '📷 Start Camera';
    btnStartExercise.disabled = true;

    if (exerciseActive) stopExercise();
}


// ── Hand Results ──
function onHandResults(results) {
    const ctx = webcamCanvas.getContext('2d');
    ctx.clearRect(0, 0, webcamCanvas.width, webcamCanvas.height);

    // Draw image
    ctx.drawImage(results.image, 0, 0, webcamCanvas.width, webcamCanvas.height);

    if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
        for (const landmarks of results.multiHandLandmarks) {
            drawHandSkeleton(ctx, landmarks);
            // Store latest landmarks for comparison
            latestLandmarks = landmarks.map(lm => ({ x: lm.x, y: lm.y, z: lm.z }));
        }
    } else {
        latestLandmarks = null;
    }
}

function drawHandSkeleton(ctx, landmarks) {
    const w = webcamCanvas.width;
    const h = webcamCanvas.height;

    // Draw connections
    ctx.strokeStyle = 'rgba(0, 200, 255, 0.8)';
    ctx.lineWidth = 3;

    for (const [s, e] of HAND_CONNECTIONS) {
        const start = landmarks[s];
        const end = landmarks[e];
        ctx.beginPath();
        ctx.moveTo(start.x * w, start.y * h);
        ctx.lineTo(end.x * w, end.y * h);
        ctx.stroke();
    }

    // Draw landmarks
    for (let i = 0; i < landmarks.length; i++) {
        const lm = landmarks[i];
        const x = lm.x * w;
        const y = lm.y * h;

        // Outer glow
        ctx.beginPath();
        ctx.arc(x, y, 6, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(99, 102, 241, 0.4)';
        ctx.fill();

        // Inner dot
        ctx.beginPath();
        ctx.arc(x, y, 3, 0, Math.PI * 2);
        ctx.fillStyle = '#00ff88';
        ctx.fill();
    }
}


// ── Exercise Control ──
function startExercise() {
    if (!cameraRunning || !referenceLandmarks) return;

    exerciseActive = true;
    refVideo.currentTime = 0;
    refVideo.play();

    btnStartExercise.innerHTML = '⏹ Stop';
    btnStartExercise.onclick = stopExercise;

    // Start comparison loop (every 200ms)
    compareInterval = setInterval(doComparison, 200);
}

function stopExercise() {
    exerciseActive = false;
    refVideo.pause();

    btnStartExercise.innerHTML = '▶ Start Exercise';
    btnStartExercise.onclick = startExercise;
    btnStartExercise.disabled = !cameraRunning;

    if (compareInterval) {
        clearInterval(compareInterval);
        compareInterval = null;
    }
}


// ── Comparison Logic (Client-side) ──
function doComparison() {
    if (!latestLandmarks || !referenceLandmarks) return;

    const refFrames = referenceLandmarks.frames;
    if (!refFrames || refFrames.length === 0) return;

    // Compute user angles
    const userAngles = computeJointAngles(latestLandmarks);

    // Find best matching reference frame
    let bestScore = 0;
    let bestRefLandmarks = null;

    for (const frame of refFrames) {
        if (!frame.hands || frame.hands.length === 0) continue;
        const refLm = frame.hands[0].landmarks;
        const refAngles = computeJointAngles(refLm);

        const angleDiffs = userAngles.map((a, i) => Math.abs(a - refAngles[i]) * (180 / Math.PI));
        const meanError = angleDiffs.reduce((s, v) => s + v, 0) / angleDiffs.length;
        const score = Math.max(0, 100 * Math.exp(-meanError / 30));

        if (score > bestScore) {
            bestScore = score;
            bestRefLandmarks = refLm;
        }
    }

    if (!bestRefLandmarks) {
        renderScore(null);
        return;
    }

    // Compute detailed comparison
    const result = compareHands(latestLandmarks, bestRefLandmarks);
    renderScore(result);
}

function normalizePoints(landmarks) {
    const pts = landmarks.map(lm => [lm.x, lm.y, lm.z]);
    const wrist = [...pts[0]];
    for (let i = 0; i < pts.length; i++) {
        pts[i] = [pts[i][0] - wrist[0], pts[i][1] - wrist[1], pts[i][2] - wrist[2]];
    }
    // Scale by wrist-to-middle-MCP distance
    const midMcp = pts[9];
    const scale = Math.sqrt(midMcp[0] ** 2 + midMcp[1] ** 2 + midMcp[2] ** 2) || 1;
    for (let i = 0; i < pts.length; i++) {
        pts[i] = [pts[i][0] / scale, pts[i][1] / scale, pts[i][2] / scale];
    }
    return pts;
}

function computeAngle(a, b, c) {
    const ba = [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
    const bc = [c[0] - b[0], c[1] - b[1], c[2] - b[2]];
    const dot = ba[0] * bc[0] + ba[1] * bc[1] + ba[2] * bc[2];
    const magBA = Math.sqrt(ba[0] ** 2 + ba[1] ** 2 + ba[2] ** 2) || 1e-8;
    const magBC = Math.sqrt(bc[0] ** 2 + bc[1] ** 2 + bc[2] ** 2) || 1e-8;
    let cosA = dot / (magBA * magBC);
    cosA = Math.max(-1, Math.min(1, cosA));
    return Math.acos(cosA);
}

function computeJointAngles(landmarks) {
    const pts = normalizePoints(landmarks);
    return ANGLE_JOINTS.map(([a, b, c]) => computeAngle(pts[a], pts[b], pts[c]));
}

function compareHands(userLm, refLm) {
    const userAngles = computeJointAngles(userLm);
    const refAngles = computeJointAngles(refLm);

    const angleDiffsDeg = userAngles.map((a, i) => Math.abs(a - refAngles[i]) * (180 / Math.PI));
    const meanError = angleDiffsDeg.reduce((s, v) => s + v, 0) / angleDiffsDeg.length;
    const overallScore = Math.max(0, 100 * Math.exp(-meanError / 30));

    const fingerScores = {};
    const feedback = [];

    for (const [fname, jointIdxs] of Object.entries(FINGER_JOINT_INDICES)) {
        const errors = jointIdxs.map(i => angleDiffsDeg[i]);
        const fMean = errors.reduce((s, v) => s + v, 0) / errors.length;
        const score = Math.max(0, 100 * Math.exp(-fMean / 25));
        fingerScores[fname] = Math.round(score * 10) / 10;

        if (score < 50) {
            const userMean = jointIdxs.map(i => userAngles[i]).reduce((s, v) => s + v, 0) / jointIdxs.length;
            const refMean = jointIdxs.map(i => refAngles[i]).reduce((s, v) => s + v, 0) / jointIdxs.length;
            feedback.push(userMean < refMean ? `Extend your ${fname} more` : `Bend your ${fname} more`);
        } else if (score < 75) {
            feedback.push(`Adjust your ${fname} slightly`);
        }
    }

    return {
        overall_score: Math.round(overallScore * 10) / 10,
        finger_scores: fingerScores,
        feedback: feedback.slice(0, 3),
        mean_angle_error: Math.round(meanError * 10) / 10,
    };
}


// ── Render Score ──
function renderScore(result) {
    if (!result) {
        scorePanel.innerHTML = `
            <div class="no-data">
                <div class="icon">👋</div>
                <p>Show your hand to the camera</p>
            </div>
        `;
        return;
    }

    const score = result.overall_score;
    const circumference = 251.2;
    const offset = circumference * (1 - score / 100);

    let statusText, statusClass;
    if (score >= 85) { statusText = 'Excellent!'; statusClass = 'score-excellent'; }
    else if (score >= 70) { statusText = 'Good'; statusClass = 'score-good'; }
    else if (score >= 50) { statusText = 'Fair'; statusClass = 'score-fair'; }
    else { statusText = 'Keep trying'; statusClass = 'score-poor'; }

    const fingerHTML = Object.entries(result.finger_scores).map(([name, val]) => {
        let cls = 'score-excellent';
        if (val < 50) cls = 'score-poor';
        else if (val < 70) cls = 'score-fair';
        else if (val < 85) cls = 'score-good';

        return `
            <div class="finger-score">
                <div class="finger-icon">${FINGER_ICONS[name] || '👆'}</div>
                <div class="finger-name">${name}</div>
                <div class="finger-value ${cls}">${Math.round(val)}%</div>
            </div>
        `;
    }).join('');

    const feedbackHTML = result.feedback.length > 0
        ? result.feedback.map(f => {
            const cls = f.includes('slightly') ? 'adjust' : 'bad';
            const icon = cls === 'adjust' ? '⚠️' : '❌';
            return `<div class="feedback-item ${cls}">${icon} ${f}</div>`;
        }).join('')
        : `<div class="feedback-item good">✅ Great form! Keep it up!</div>`;

    scorePanel.innerHTML = `
        <div class="overall-score-container">
            <div class="score-circle">
                <svg viewBox="0 0 100 100">
                    <circle cx="50" cy="50" r="40" class="track"/>
                    <circle cx="50" cy="50" r="40" class="progress"
                            style="stroke-dashoffset:${offset}"/>
                </svg>
                <div class="score-value ${statusClass}">
                    ${Math.round(score)}<span>%</span>
                </div>
            </div>
            <div class="score-label">
                <div class="status-text ${statusClass}">${statusText}</div>
                <div>Match your hand position with the reference video</div>
            </div>
        </div>

        <div class="finger-scores">${fingerHTML}</div>

        <div class="feedback-list">${feedbackHTML}</div>
    `;
}


// ── Init on Load ──
init();

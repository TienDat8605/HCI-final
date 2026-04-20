const HAND_CONNECTIONS = [
    [0, 1], [1, 2], [2, 3], [3, 4],
    [0, 5], [5, 6], [6, 7], [7, 8],
    [0, 9], [9, 10], [10, 11], [11, 12],
    [0, 13], [13, 14], [14, 15], [15, 16],
    [0, 17], [17, 18], [18, 19], [19, 20],
    [5, 9], [9, 13], [13, 17],
];

const ANGLE_JOINTS = [
    [0, 1, 2], [1, 2, 3], [2, 3, 4],
    [0, 5, 6], [5, 6, 7], [6, 7, 8],
    [0, 9, 10], [9, 10, 11], [10, 11, 12],
    [0, 13, 14], [13, 14, 15], [14, 15, 16],
    [0, 17, 18], [17, 18, 19], [18, 19, 20],
];

const FINGER_JOINT_INDICES = {
    Thumb: [0, 1, 2],
    Index: [3, 4, 5],
    Middle: [6, 7, 8],
    Ring: [9, 10, 11],
    Pinky: [12, 13, 14],
};

const FINGER_POINTS = {
    Thumb: [1, 2, 3, 4],
    Index: [5, 6, 7, 8],
    Middle: [9, 10, 11, 12],
    Ring: [13, 14, 15, 16],
    Pinky: [17, 18, 19, 20],
};

const EXERCISE_COPY = {
    1: {
        label: 'Game Mode A',
        overview: 'Touch the thumb to each fingertip, then reopen into a relaxed spread before the next contact.',
        guidance: 'Move thumb-to-finger slowly. Watch the reference clip first, then hold each clean contact briefly so the system can confirm it.',
        tips: [
            'Start with a relaxed open hand before each contact.',
            'Only move the finger that needs to meet the thumb.',
            'Keep the wrist quiet while the fingertips change shape.',
        ],
    },
    5: {
        label: 'Game Mode B',
        overview: 'Move through controlled closing and opening patterns while maintaining clear hand visibility for tracking.',
        guidance: 'Use the reference clip for pacing, then refine the weakest finger shown in the live cue until the hold meter fills.',
        tips: [
            'Squeeze gradually and avoid jerky jumps between poses.',
            'Hold each matched checkpoint for a short beat.',
            'Pause any time by withdrawing the hand from the camera view.',
        ],
    },
};

const ZONE_HOLD_MS = 2500;
const MATCH_HOLD_MS = 450;
const PAUSE_HAND_LOSS_MS = 900;
const PINCH_DEFENSE_PAUSE_MS = 800;
const SCORE_SAMPLE_MS = 180;
const PROGRESS_MATCH_THRESHOLD = 40;
const PROGRESS_SOFT_THRESHOLD = 20;
const SOFT_MATCH_HOLD_MS = 900;
const FORCED_PROGRESS_THRESHOLD = 8;
const GUIDE_MIN_TIME_GAP = 0.12;
const GUIDE_MIN_ANGLE_DELTA = 3.2;
const MAX_GUIDE_FRAMES = 8;
const GUIDE_TARGET_SECONDS = 4;
const ANGLE_TOLERANCE_DEG = 13;
const OVERALL_SCORE_DECAY = 21;
const FINGER_SCORE_DECAY = 17;
const CONTACT_TOLERANCE = 0.09;
const CONTACT_SCORE_DECAY = 0.11;
const SPREAD_TOLERANCE = 0.08;
const SPREAD_SCORE_DECAY = 0.11;
const POSE_SHAPE_DECAY = 0.34;
const PROCESSING_FRAME_MS = 48;
const MATCH_SEARCH_AHEAD = 8;
const FALLBACK_GAME_HUD = {
    primaryLabel: 'Mode Score',
    primaryValue: '0',
    secondaryLabel: 'Objective',
    secondaryValue: 'Follow guide checkpoints',
    statusText: 'Gamification scaffold active',
};

const appState = {
    exercises: [],
    exerciseIndex: 0,
    referenceData: null,
    guideFrames: [],
    screen: 'boot',
    cameraRunning: false,
    hands: null,
    camera: null,
    handSendInFlight: false,
    lastHandsSentAt: 0,
    latestLandmarks: null,
    latestBounds: null,
    latestHandedness: 'Right',
    mountedGameRuntime: null,
    zone: {
        current: null,
        enteredAt: 0,
        progress: 0,
        cooldownUntil: 0,
        triggered: null,
        triggeredAt: 0,
    },
    training: null,
    currentSummary: null,
    lastSessionSummary: null,
    toastTimeout: null,
};

const dom = {
    screenRoot: document.getElementById('screenRoot'),
    cameraStage: document.getElementById('cameraStage'),
    cameraVideo: document.getElementById('cameraVideo'),
    overlayCanvas: document.getElementById('overlayCanvas'),
    referencePanel: document.getElementById('referencePanel'),
    referenceVideo: document.getElementById('referenceVideo'),
    toast: document.getElementById('toast'),
    cameraStatusDot: document.getElementById('cameraStatusDot'),
    cameraStatusText: document.getElementById('cameraStatusText'),
    exerciseMetaTag: document.getElementById('exerciseMetaTag'),
    navItems: Array.from(document.querySelectorAll('[data-nav]')),
};

function createFallbackGameRuntime(exercise) {
    const modeTitle = exercise && exercise.id === 6
        ? 'Pinch Defense (Fallback)'
        : (exercise && exercise.id === 5 ? 'Game Mode B (Fallback)' : 'Game Mode A (Fallback)');
    return {
        modeId: 'fallback_mode',
        modeTitle,
        notifySessionStart() {},
        notifyFrame() {},
        notifyCheckpoint() {},
        notifyPause() {},
        notifyResume() {},
        notifySessionEnd() {},
        mount() {},
        unmount() {},
        snapshot() {
            return {
                modeId: 'fallback_mode',
                modeTitle,
                hud: { ...FALLBACK_GAME_HUD },
                summary: null,
                viewState: null,
            };
        },
    };
}

function getExerciseInteractionMode(exercise) {
    return exercise && exercise.interaction_mode === 'pinch_defense' ? 'pinch_defense' : 'guided';
}

function isPinchDefenseExercise(exercise = getCurrentExercise()) {
    return getExerciseInteractionMode(exercise) === 'pinch_defense';
}

function createGameRuntime(exercise) {
    if (!exercise) {
        return createFallbackGameRuntime(null);
    }

    if (window.BlueprintGamification && typeof window.BlueprintGamification.createRuntime === 'function') {
        return window.BlueprintGamification.createRuntime(exercise.id, {
            exerciseId: exercise.id,
            exerciseName: exercise.name,
        });
    }

    return createFallbackGameRuntime(exercise);
}

function syncTrainingGameSnapshot(training) {
    if (!training || !training.gameRuntime || typeof training.gameRuntime.snapshot !== 'function') {
        return;
    }

    const snapshot = training.gameRuntime.snapshot() || {};
    training.gameModeId = snapshot.modeId || training.gameModeId || 'unknown_mode';
    training.gameModeTitle = snapshot.modeTitle || training.gameModeTitle || 'Unknown Mode';
    training.gameHud = { ...FALLBACK_GAME_HUD, ...(snapshot.hud || {}) };
    training.gameSummary = snapshot.summary || null;
    training.gameViewState = snapshot.viewState || null;
}

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function average(values) {
    if (!values.length) return 0;
    return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function formatDuration(ms) {
    const totalSeconds = Math.max(0, Math.round(ms / 1000));
    const minutes = Math.floor(totalSeconds / 60).toString().padStart(2, '0');
    const seconds = (totalSeconds % 60).toString().padStart(2, '0');
    return `${minutes}:${seconds}`;
}

function showToast(message) {
    clearTimeout(appState.toastTimeout);
    dom.toast.textContent = message;
    dom.toast.classList.add('is-visible');
    appState.toastTimeout = setTimeout(() => {
        dom.toast.classList.remove('is-visible');
    }, 2600);
}

function getCurrentExercise() {
    return appState.exercises[appState.exerciseIndex] || null;
}

function getGuideCount() {
    return Math.max(1, appState.guideFrames.length);
}

function getCompletionPercent(guideIndex) {
    return Math.round((guideIndex / getGuideCount()) * 100);
}

function advanceTrainingGuide(training, score, nextGuideIndex, now, context = {}) {
    const previousGuideIndex = training.guideIndex;
    training.checkpointScores.push(score);
    training.guideIndex = Math.min(nextGuideIndex, appState.guideFrames.length);
    training.matchStartedAt = 0;
    training.matchGuideIndex = null;
    training.softMatchStartedAt = 0;
    training.softMatchGuideIndex = null;
    training.holdProgress = 0;
    training.lastAdvanceAt = now;

    if (training.gameRuntime && typeof training.gameRuntime.notifyCheckpoint === 'function') {
        training.gameRuntime.notifyCheckpoint({
            ...context,
            previousGuideIndex,
            nextGuideIndex: training.guideIndex,
            score,
            completionPercent: getCompletionPercent(training.guideIndex),
        });
        syncTrainingGameSnapshot(training);
    }

    return training.guideIndex >= appState.guideFrames.length;
}

function getTrainingElapsedAt(now) {
    if (!appState.training) return 0;
    return appState.training.activeElapsedMs + (now - appState.training.activeStartedAt);
}

function getExerciseCopy(exercise) {
    if (!exercise) {
        return {
            label: 'No Exercise Selected',
            overview: 'Load exercise metadata to begin.',
            guidance: 'Enable the camera, then choose an exercise checkpoint to start training.',
            tips: [],
        };
    }

    const fallback = getExerciseInteractionMode(exercise) === 'pinch_defense'
        ? window.PinchDefenseHost.getExerciseCopyFallback(exercise)
        : {
            label: `Guided Session - Exercise ${exercise.id}`,
            overview: `${exercise.name} uses reference landmarks and instruction-video checkpoints instead of strict frame matching.`,
            guidance: 'Follow the reference clip, hold briefly when the pose matches, and let the system advance at your pace.',
            tips: [
                'Keep the hand centered and fully visible.',
                'Match the overall hand shape before refining finger detail.',
                'Withdraw the hand if you need to pause.',
            ],
        };

    return { ...fallback, ...(EXERCISE_COPY[exercise.id] || {}) };
}

function updateShell() {
    dom.cameraStatusDot.classList.toggle('is-live', appState.cameraRunning);
    dom.cameraStatusText.textContent = appState.cameraRunning ? 'Camera live' : 'Camera offline';

    const exercise = getCurrentExercise();
    dom.exerciseMetaTag.textContent = exercise
        ? `${exercise.name} - ${(exercise.session_duration_seconds || exercise.duration)}s`
        : 'Waiting for exercise data';

    const navMap = {
        boot: null,
        zones: 'zones',
        instructions: 'instructions',
        training: 'training',
        paused: 'pause',
        summary: 'summary',
    };
    const activeNav = navMap[appState.screen];

    dom.navItems.forEach((item) => {
        item.classList.toggle('is-active', item.dataset.nav === activeNav);
    });
}

function getScreenZoneConfig() {
    const hasAnySummary = Boolean(appState.training || appState.currentSummary || appState.lastSessionSummary);
    const currentExercise = getCurrentExercise();
    const canStartInstructions = currentExercise
        ? (isPinchDefenseExercise(currentExercise) || Boolean(appState.referenceData && appState.guideFrames.length))
        : false;

    switch (appState.screen) {
        case 'zones':
            return {
                top: { enabled: Boolean(appState.lastSessionSummary), label: 'View Summary', description: 'Open the most recent completed session summary.' },
                left: { enabled: true, label: 'Back', description: 'Use your left side to go backward in the flow.' },
                center: { enabled: true, label: 'Continue', description: 'Hold center for 2.5 seconds to open the instruction view.' },
                right: { enabled: true, label: 'Forward', description: 'Use your right side to move forward in the flow.' },
            };
        case 'instructions':
            return {
                top: { enabled: Boolean(appState.lastSessionSummary), label: 'Summary', description: 'Open the latest completed summary.' },
                left: { enabled: appState.exercises.length > 1, label: 'Previous', description: 'Hold on your left side to switch to the previous exercise.' },
                center: { enabled: canStartInstructions, label: 'Start', description: 'Begin the live training view.' },
                right: { enabled: appState.exercises.length > 1, label: 'Next', description: 'Hold on your right side to switch to the next exercise.' },
            };
        case 'paused':
            return {
                top: { enabled: hasAnySummary, label: 'Summary', description: 'Review the current session summary.' },
                left: { enabled: appState.exercises.length > 1, label: 'Previous', description: 'Leave pause and open the previous exercise instructions.' },
                center: { enabled: Boolean(appState.training), label: 'Resume', description: 'Return to live training from the pause state.' },
                right: { enabled: appState.exercises.length > 1, label: 'Next', description: 'Leave pause and open the next exercise instructions.' },
            };
        case 'summary':
            return {
                center: { enabled: true, label: 'Return', description: 'Hold center to go back to the instruction screen.' },
            };
        default:
            return {};
    }
}

function zoneMarkup(config, centerClass = 'zone-card zone-card-center') {
    const topDisabled = config.top && !config.top.enabled ? ' is-disabled' : '';
    const leftDisabled = config.left && !config.left.enabled ? ' is-disabled' : '';
    const centerDisabled = config.center && !config.center.enabled ? ' is-disabled' : '';
    const rightDisabled = config.right && !config.right.enabled ? ' is-disabled' : '';

    return `
        ${config.top ? `
            <div class="zone-card zone-card-top${topDisabled}" data-zone-card="top">
                <strong>${config.top.label}</strong>
                <span>Up Zone</span>
                <small>${config.top.description}</small>
            </div>
        ` : ''}
        ${config.left ? `
            <div class="zone-card zone-card-left${leftDisabled}" data-zone-card="left">
                <strong>${config.left.label}</strong>
                <span>Left Zone</span>
                <small>${config.left.description}</small>
            </div>
        ` : ''}
        ${config.center ? `
            <div class="${centerClass}${centerDisabled}" data-zone-card="center">
                <strong>${config.center.label}</strong>
                <span>Center Hold</span>
                <small>${config.center.description}</small>
            </div>
        ` : ''}
        ${config.right ? `
            <div class="zone-card zone-card-right${rightDisabled}" data-zone-card="right">
                <strong>${config.right.label}</strong>
                <span>Right Zone</span>
                <small>${config.right.description}</small>
            </div>
        ` : ''}
    `;
}

function renderReferencePanel(hasVideo, emptyMessage = 'Reference clip unavailable for this exercise.') {
    if (hasVideo) {
        return '<div id="referenceMount" class="reference-mount"></div>';
    }

    return `
        <div class="reference-mount">
            <div class="reference-frame">
                <div class="empty-reference">${emptyMessage}</div>
            </div>
        </div>
    `;
}

function setReferenceVideoSource(exercise) {
    if (exercise && exercise.video_ready) {
        dom.referenceVideo.src = `/api/video/${exercise.id}`;
        dom.referenceVideo.load();
        return true;
    }

    dom.referenceVideo.removeAttribute('src');
    dom.referenceVideo.load();
    return false;
}

function refreshCameraStage() {
    requestAnimationFrame(() => {
        syncOverlayCanvasSize();
        drawOverlay();

        if (appState.cameraRunning) {
            dom.cameraVideo.play().catch(() => {});
        }
    });
}

function renderBootScreen() {
    return `
        <section class="screen boot-screen">
            <div class="boot-card">
                <div class="screen-kicker">Blueprint Recovery Flow</div>
                <h2>Camera-Led Hand Training</h2>
                <p>
                    This version replaces the old split-screen workflow with a staged experience:
                    hand-position zones, a reference instruction view, full-screen live coaching with landmark guidance,
                    automatic pause when the hand leaves the frame, and a session summary at the end.
                </p>
                <div class="boot-grid">
                    <div class="boot-stat">
                        <strong>Navigation</strong>
                        <span>Hold in zone for 2.5s</span>
                    </div>
                    <div class="boot-stat">
                        <strong>Training</strong>
                        <span>Single live camera view</span>
                    </div>
                    <div class="boot-stat">
                        <strong>Guidance</strong>
                        <span>Reference clip + live landmarks</span>
                    </div>
                </div>
                <div class="button-row">
                    <button class="button button-primary" type="button" data-action="enable-camera">Enable Camera</button>
                    <button class="button button-secondary" type="button" data-action="skip-boot">Open Interface</button>
                </div>
                <div class="sr-message">
                    Camera access is required for zone navigation, live overlays, and automatic pause detection.
                </div>
            </div>
        </section>
    `;
}

function renderZonesScreen() {
    const zoneConfig = getScreenZoneConfig();

    return `
        <section class="screen">
            <div class="screen-title-row">
                <div>
                    <div class="screen-kicker">Tutorial Stage 01</div>
                    <h2 class="hero-title">Interface Navigation</h2>
                    <p class="body-copy">Move your hand into a zone and hold long enough for the progress line to fill. The same logic is used on the instruction and pause screens.</p>
                </div>
                <div class="screen-meta">Optical sensors active</div>
            </div>

            <div class="zones-layout">
                <section class="zones-info">
                    <div class="zones-list">
                        <div class="card">
                            <strong>Center hold</strong>
                            <span>Start or continue the current flow.</span>
                        </div>
                        <div class="card">
                            <strong>Left and right</strong>
                            <span>Change exercise when you are browsing instructions or paused.</span>
                        </div>
                        <div class="card">
                            <strong>Top zone</strong>
                            <span>Open a summary when one is available.</span>
                        </div>
                    </div>

                    <div class="button-row">
                        <button class="button button-secondary" type="button" data-action="skip-tutorial">Skip Tutorial</button>
                        <button class="button button-primary" type="button" data-action="goto-instructions">Open Instructions</button>
                    </div>
                </section>

                <section class="zones-stage-shell">
                    <div id="cameraMount" class="stage-mount"></div>
                    <div class="zone-overlay">
                        ${zoneMarkup(zoneConfig)}
                    </div>
                </section>
            </div>

            <div class="zone-footer">
                <div class="zone-footnote">
                    <span>Latency target: live</span>
                    <span>Zone dwell: 2.5 seconds</span>
                    <span>Hand tracking: single-hand active</span>
                </div>
                <div class="button-row">
                    <button class="button button-secondary" type="button" data-action="goto-instructions">Continue</button>
                </div>
            </div>
        </section>
    `;
}

function renderInstructionScreen() {
    const exercise = getCurrentExercise();
    const copy = getExerciseCopy(exercise);
    const isPinchDefense = isPinchDefenseExercise(exercise);
    const hasGuidance = Boolean(appState.referenceData && appState.guideFrames.length);
    const hasVideo = Boolean(exercise && exercise.video_ready);
    const showWarning = exercise && (!exercise.landmarks_ready || !exercise.video_ready);
    const zoneConfig = getScreenZoneConfig();

    if (isPinchDefense) {
        return window.PinchDefenseHost.renderInstructionScreen({
            exercise,
            copy,
            zoneConfig,
            handedness: appState.latestHandedness,
            zoneMarkup,
        });
    }

    return `
        <section class="screen instructions-screen">
            <div class="screen-title-row">
                <div>
                    <div class="screen-kicker">Preparation Stage 02</div>
                    <h2 class="hero-title">${exercise ? exercise.name : 'Loading Exercise'}</h2>
                    <p class="body-copy">Watch the reference clip first, then use your live camera on the right to start, switch exercise, or open the summary.</p>
                </div>
                <div class="screen-meta">Zone holds follow your own left and right</div>
            </div>

            <div class="instruction-layout">
                <section class="instruction-media-column">
                    <section class="hero-panel instruction-meta-panel">
                        <div class="hero-chip">${copy.label}</div>
                        <p class="hero-copy">${copy.overview}</p>

                        <div class="hero-metrics">
                            <div class="hero-metric">
                                <strong>Difficulty</strong>
                                <span>${copy.label.split(' - ')[0]}</span>
                            </div>
                            <div class="hero-metric">
                                <strong>Estimated Time</strong>
                                <span>${exercise ? `${Math.max(1, Math.round(exercise.duration / 12))} Minutes` : '--'}</span>
                            </div>
                            <div class="hero-metric">
                                <strong>Guide Checkpoints</strong>
                                <span>${appState.guideFrames.length || '--'}</span>
                            </div>
                        </div>

                        ${showWarning ? `
                            <div class="asset-warning">
                                ${!exercise.video_ready ? 'Reference video is missing. ' : ''}
                                ${!exercise.landmarks_ready ? 'Landmark checkpoints are missing. Generate data/landmarks to enable guided training.' : ''}
                            </div>
                        ` : ''}

                        <div class="button-row">
                            <button class="button button-secondary" type="button" data-action="prev-exercise">Previous</button>
                            <button class="button button-secondary" type="button" data-action="next-exercise">Next</button>
                            <button class="button button-primary" type="button" data-action="start-training" data-zone-card="center" ${hasGuidance ? '' : 'disabled'}>
                                Hold Center To Start
                            </button>
                        </div>
                    </section>

                    <div class="instruction-video-shell">
                        ${renderReferencePanel(hasVideo)}
                    </div>

                    <section class="hero-guidance instruction-guidance">
                        <strong>Preparation and Form</strong>
                        <p>${copy.guidance}</p>
                        <ul>
                            ${copy.tips.map((tip) => `<li>${tip}</li>`).join('')}
                        </ul>
                    </section>
                </section>

                <section class="instruction-side-column">
                    <section class="instruction-stage-shell">
                        <div id="cameraMount" class="stage-mount"></div>
                        <div class="zone-overlay">
                            ${zoneMarkup(zoneConfig)}
                        </div>
                    </section>
                </section>
            </div>
        </section>
    `;
}

function getTrainingProgressPercent(training) {
    if (!training) return 0;
    if (training.interactionMode === 'pinch_defense') {
        return window.PinchDefenseHost.getTrainingProgressPercent(training);
    }
    return getCompletionPercent(training.guideIndex);
}

function getTrainingAccuracy(training) {
    if (!training) return 0;
    if (training.interactionMode === 'pinch_defense') {
        return window.PinchDefenseHost.getTrainingAccuracy(training);
    }
    return training.scoreHistory.length
        ? Math.round(training.scoreHistory[training.scoreHistory.length - 1].score)
        : 0;
}

function renderTrainingScreen() {
    const exercise = getCurrentExercise();
    const training = appState.training;
    const progressPercent = training ? getTrainingProgressPercent(training) : 0;
    const currentCue = training ? training.cueText : 'Match the next pose.';
    const gameModeTitle = training ? training.gameModeTitle : 'Mode';
    const gameHud = training ? training.gameHud : FALLBACK_GAME_HUD;
    const isPinchDefense = training && training.interactionMode === 'pinch_defense';

    if (isPinchDefense) {
        return window.PinchDefenseHost.renderTrainingScreen({
            exercise,
            training,
            progressPercent,
            currentCue,
            gameModeTitle,
            gameHud,
        });
    }

    return `
        <section class="screen training-screen">
            <div class="training-layout">
                <aside class="progress-rail">
                    <div class="progress-bar-shell">
                        <div id="trainingProgressFill" class="progress-bar-fill" style="height:${progressPercent}%;">
                            <div id="trainingProgressPop" class="progress-pop">${progressPercent}%</div>
                        </div>
                    </div>
                    <div class="progress-label">
                        <strong>Progress</strong>
                        <span id="trainingProgressMeta">${progressPercent}% complete</span>
                    </div>
                </aside>

                <section>
                    <div class="training-stage-shell">
                        <div id="cameraMount" class="stage-mount"></div>
                        <div class="training-overlay">
                            <div class="training-head">
                                <div>
                                    <div class="training-subtitle">Target pose</div>
                                    <h2 class="training-title">${exercise ? exercise.name : 'Training'}</h2>
                                </div>
                                <div class="status-box">
                                    <strong>Calibration Status</strong>
                                    <span id="trainingCalibrationText">Scanning live hand</span>
                                    <div class="status-caption">Tolerance window +/-${ANGLE_TOLERANCE_DEG}deg</div>
                                </div>
                            </div>

                            <div class="training-cue">
                                <strong id="trainingCueHeading">Live guidance</strong>
                                <p id="trainingCueTitle">${currentCue}</p>
                                <span id="trainingCueText">Watch the instruction clip first, then use the live cue to refine the weakest finger or wrist position.</span>
                            </div>

                            <div class="training-game-hud">
                                <strong id="trainingGameModeTitle">${gameModeTitle}</strong>
                                <div class="training-game-grid">
                                    <div>
                                        <span id="trainingGamePrimaryLabel">${gameHud.primaryLabel}</span>
                                        <b id="trainingGamePrimaryValue">${gameHud.primaryValue}</b>
                                    </div>
                                    <div>
                                        <span id="trainingGameSecondaryLabel">${gameHud.secondaryLabel}</span>
                                        <b id="trainingGameSecondaryValue">${gameHud.secondaryValue}</b>
                                    </div>
                                </div>
                                <small id="trainingGameStatusText">${gameHud.statusText}</small>
                            </div>

                            <div class="training-edge-note">Withdraw hand to pause session</div>
                        </div>
                    </div>
                </section>
            </div>
        </section>
    `;
}

function renderPausedScreen() {
    const training = appState.training;
    const progressPercent = training ? getTrainingProgressPercent(training) : 0;
    const latestScore = getTrainingAccuracy(training);
    const exercise = getCurrentExercise();
    const hasVideo = Boolean(exercise && exercise.video_ready);
    const isPinchDefense = training && training.interactionMode === 'pinch_defense';

    if (isPinchDefense) {
        return window.PinchDefenseHost.renderPausedScreen({
            training,
            progressPercent,
            latestScore,
            elapsedLabel: training ? formatDuration(getTrainingElapsedMs()) : '00:00',
        });
    }

    return `
        <section class="screen paused-shell">
            <div class="paused-header">
                <div>
                    <div class="screen-kicker" style="color: var(--danger);">Hand withdrawn</div>
                    <h2 class="paused-title">Session Paused</h2>
                </div>
                <div class="screen-meta">Elapsed time ${training ? formatDuration(getTrainingElapsedMs()) : '00:00'}</div>
            </div>

            <div class="paused-content">
                <div class="paused-stage-shell">
                    <div id="cameraMount" class="stage-mount"></div>
                    <div class="paused-overlay">
                        ${zoneMarkup(getScreenZoneConfig(), 'paused-center-card')}
                    </div>

                    <div class="paused-float-card">
                        <strong>Current Progress</strong>
                        <div class="paused-metric">
                            <span>Progress</span>
                            <b>${progressPercent}%</b>
                        </div>
                        <div class="paused-metric">
                            <span>Live Accuracy</span>
                            <b>${latestScore}%</b>
                        </div>
                        <div class="paused-metric">
                            <span>Pauses</span>
                            <b>${training ? training.pauseCount : 0}</b>
                        </div>
                        <div class="button-row" style="margin-top: 18px;">
                            <button class="button button-primary" type="button" data-action="resume-training">Resume</button>
                            <button class="button button-secondary" type="button" data-action="open-summary">Summary</button>
                        </div>
                    </div>
                </div>

                <div class="paused-reference-shell">
                    ${renderReferencePanel(hasVideo)}
                </div>
            </div>
        </section>
    `;
}

function buildTrendPath(values, width, height, inset = 18) {
    if (!values.length) return '';

    const minValue = Math.min(...values);
    const maxValue = Math.max(...values);
    const span = Math.max(1, maxValue - minValue);

    return values.map((value, index) => {
        const x = inset + ((width - inset * 2) * index) / Math.max(values.length - 1, 1);
        const y = height - inset - ((value - minValue) / span) * (height - inset * 2);
        return `${index === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`;
    }).join(' ');
}

function renderSummaryScreen() {
    const summary = appState.currentSummary || appState.lastSessionSummary;

    if (!summary) {
        return `
            <section class="screen summary-shell">
                <div class="boot-card">
                    <div class="screen-kicker">No Summary Available</div>
                    <h2>Finish A Session First</h2>
                    <p>No completed or paused training summary is available yet. Start from the instruction screen and finish a guided exercise to generate one.</p>
                    <div class="button-row">
                        <button class="button button-primary" type="button" data-action="return-menu">Back To Instructions</button>
                    </div>
                </div>
            </section>
        `;
    }

    const accuracyPath = buildTrendPath(summary.accuracyTrend, 760, 320);
    const stabilityPath = buildTrendPath(summary.stabilityTrend, 760, 320);
    const completionLabel = summary.completed
        ? 'Completed the full exercise.'
        : `Session ended at ${summary.completionPercent}% completion.`;
    const gameModeNote = summary.gameModeSummary && summary.gameModeSummary.notes
        ? summary.gameModeSummary.notes
        : 'Mode-specific scoring logic can be implemented in static/gamification/index.js.';
    const gameBadge = summary.gameModeSummary && summary.gameModeSummary.badge
        ? summary.gameModeSummary.badge
        : 'Scaffold';
    const gameModeScore = summary.gameModeSummary && Number.isFinite(summary.gameModeSummary.modeScore)
        ? summary.gameModeSummary.modeScore
        : 0;

    return `
        <section class="screen summary-shell">
            <div class="summary-head">
                <div>
                    <div class="screen-kicker">Performance Protocol</div>
                    <h2 class="summary-title">Session Summary</h2>
                </div>
                <div class="screen-meta">${summary.dateLabel} - ${summary.exerciseName}</div>
            </div>

            <div class="summary-grid">
                <div class="metrics-stack">
                    <div class="metric-card">
                        <strong>Exercise Completion</strong>
                        <div class="metric-value">${summary.completionPercent}<small>%</small></div>
                        <div class="metric-footer">${completionLabel}</div>
                    </div>
                    <div class="metric-card">
                        <strong>Average Accuracy</strong>
                        <div class="metric-value">${summary.averageAccuracy}<small>%</small></div>
                        <div class="metric-footer">Best accuracy ${summary.bestAccuracy}% - weakest finger ${summary.weakestFinger}</div>
                    </div>
                    <div class="metric-card">
                        <strong>Total Time</strong>
                        <div class="metric-value">${summary.durationLabel}<small>mm:ss</small></div>
                        <div class="metric-footer">${summary.pauseLabel}</div>
                    </div>
                    <div class="metric-card">
                        <strong>${summary.gameModeTitle || 'Game Mode'}</strong>
                        <div class="metric-value">${gameModeScore}<small>pts</small></div>
                        <div class="metric-footer">${gameBadge} - ${gameModeNote}</div>
                    </div>
                </div>

                <section class="summary-chart-card">
                    <div class="summary-chart-header">
                        <div>
                            <h3>Stability And Accuracy Tracking</h3>
                            <div class="screen-meta">Post-session movement analysis</div>
                        </div>
                        <div class="legend">
                            <div class="legend-item">
                                <span class="legend-swatch" style="background: var(--primary);"></span>
                                <span>Accuracy</span>
                            </div>
                            <div class="legend-item">
                                <span class="legend-swatch" style="background: var(--secondary);"></span>
                                <span>Stability</span>
                            </div>
                        </div>
                    </div>

                    <div class="summary-chart">
                        <svg viewBox="0 0 760 320" preserveAspectRatio="none">
                            <path d="${accuracyPath}" fill="none" stroke="var(--primary)" stroke-width="5"></path>
                            <path d="${stabilityPath}" fill="none" stroke="var(--secondary)" stroke-width="4" stroke-dasharray="10 6"></path>
                        </svg>
                        <div class="summary-axis">
                            <span>Start</span>
                            <span>Movement Midpoint</span>
                            <span>Finish</span>
                        </div>
                    </div>

                    <div class="assessment-card">
                        <strong>Architectural Assessment</strong>
                        <div>${summary.assessment}</div>
                    </div>
                </section>
            </div>

            <div class="summary-action" data-zone-card="center">
                <div class="summary-action-icon">[]</div>
                <div class="summary-action-copy">
                    <strong>Hold Hand In Center To Return To Menu</strong>
                    <span>Mouse and keyboard fallback: use the button below.</span>
                </div>
                <button class="button button-secondary" type="button" data-action="return-menu">Back To Instructions</button>
            </div>
        </section>
    `;
}

function render() {
    updateShell();

    let html = '';
    switch (appState.screen) {
        case 'zones':
            html = renderZonesScreen();
            break;
        case 'instructions':
            html = renderInstructionScreen();
            break;
        case 'training':
            html = renderTrainingScreen();
            break;
        case 'paused':
            html = renderPausedScreen();
            break;
        case 'summary':
            html = renderSummaryScreen();
            break;
        case 'boot':
        default:
            html = renderBootScreen();
            break;
    }

    dom.screenRoot.innerHTML = html;
    mountPersistentMedia();
    bindActions();
    updateZoneUI();
    updateTrainingUI();
    refreshCameraStage();
}

function bindActions() {
    dom.screenRoot.querySelectorAll('[data-action]').forEach((element) => {
        element.addEventListener('click', () => {
            handleAction(element.dataset.action);
        });
    });
}

async function handleAction(action) {
    switch (action) {
        case 'enable-camera':
            await startCamera();
            if (appState.cameraRunning) {
                setScreen('zones');
            }
            break;
        case 'skip-boot':
            setScreen(appState.cameraRunning ? 'zones' : 'instructions');
            break;
        case 'skip-tutorial':
        case 'goto-instructions':
            setScreen('instructions');
            break;
        case 'start-training':
            startTrainingSession();
            break;
        case 'prev-exercise':
            await shiftExercise(-1, true);
            break;
        case 'next-exercise':
            await shiftExercise(1, true);
            break;
        case 'resume-training':
            resumeTraining();
            break;
        case 'open-summary':
            openSummary(true);
            break;
        case 'return-menu':
            appState.currentSummary = null;
            setScreen('instructions');
            break;
        default:
            break;
    }
}

function setScreen(screen) {
    appState.screen = screen;
    render();
}

async function fetchExercises() {
    try {
        const response = await fetch('/api/exercises');
        if (!response.ok) {
            throw new Error('Failed to fetch exercises');
        }

        appState.exercises = await response.json();
        if (appState.exercises.length) {
            await loadCurrentExerciseAssets();
        }
    } catch (error) {
        console.error(error);
        showToast('Could not load exercise metadata.');
    }
}

async function loadCurrentExerciseAssets() {
    const exercise = getCurrentExercise();
    appState.referenceData = null;
    appState.guideFrames = [];
    appState.currentSummary = null;

    if (!exercise) {
        render();
        return;
    }

    setReferenceVideoSource(exercise);

    if (getExerciseInteractionMode(exercise) === 'guided' && exercise.landmarks_ready) {
        try {
            const response = await fetch(`/api/landmarks/${exercise.id}`);
            if (!response.ok) {
                throw new Error('Reference landmarks unavailable');
            }
            appState.referenceData = await response.json();
            appState.guideFrames = buildGuideFrames(appState.referenceData);
        } catch (error) {
            console.error(error);
            appState.referenceData = null;
            appState.guideFrames = [];
        }
    }

    render();
    playReferenceVideo();
}

function playReferenceVideo() {
    if (dom.referenceVideo.src) {
        dom.referenceVideo.play().catch(() => {});
    }
}

async function shiftExercise(direction, goToInstructions = false) {
    if (!appState.exercises.length) return;

    if (appState.training) {
        appState.training = null;
    }

    const count = appState.exercises.length;
    appState.exerciseIndex = (appState.exerciseIndex + direction + count) % count;
    await loadCurrentExerciseAssets();

    if (goToInstructions) {
        setScreen('instructions');
    }
}

function buildGuideFrames(referenceData) {
    const frames = (referenceData.frames || []).filter((frame) => frame.hands && frame.hands.length);
    if (!frames.length) return [];

    const selected = [frames[0]];
    let lastTime = frames[0].time || 0;
    let lastAngles = computeJointAngles(frames[0].hands[0].landmarks);
    let lastContacts = computeThumbContactProfile(frames[0].hands[0].landmarks);

    for (let index = 1; index < frames.length - 1; index += 1) {
        const frame = frames[index];
        const timeGap = (frame.time || 0) - lastTime;
        if (timeGap < GUIDE_MIN_TIME_GAP) continue;

        const nextAngles = computeJointAngles(frame.hands[0].landmarks);
        const nextContacts = computeThumbContactProfile(frame.hands[0].landmarks);
        const angleDiff = average(nextAngles.map((angle, angleIndex) => {
            return Math.abs(angle - lastAngles[angleIndex]) * (180 / Math.PI);
        }));
        const contactDiff = average(nextContacts.map((distance, contactIndex) => {
            return Math.abs(distance - lastContacts[contactIndex]);
        }));

        if (angleDiff >= GUIDE_MIN_ANGLE_DELTA || contactDiff >= CONTACT_TOLERANCE) {
            selected.push(frame);
            lastAngles = nextAngles;
            lastContacts = nextContacts;
            lastTime = frame.time || lastTime;
        }
    }

    if (frames.length > 1) {
        selected.push(frames[frames.length - 1]);
    }

    const duration = Math.max(1, (frames[frames.length - 1].time || 0) - (frames[0].time || 0));
    const targetGuideCount = clamp(Math.round(duration / GUIDE_TARGET_SECONDS), 3, MAX_GUIDE_FRAMES);

    let guides = selected;
    if (guides.length > targetGuideCount) {
        guides = Array.from({ length: targetGuideCount }, (_, position) => {
            const ratio = position / Math.max(targetGuideCount - 1, 1);
            const frameIndex = Math.round(ratio * (selected.length - 1));
            return selected[frameIndex];
        });
    }

    return guides.map((frame, index) => ({
        index,
        time: frame.time || 0,
        handedness: frame.hands[0].handedness || 'Unknown',
        landmarks: frame.hands[0].landmarks,
    }));
}

function startTrainingSession() {
    const exercise = getCurrentExercise();
    const interactionMode = getExerciseInteractionMode(exercise);

    if (interactionMode === 'guided' && (!appState.referenceData || !appState.guideFrames.length)) {
        showToast('Training needs reference landmarks. Generate data/landmarks first.');
        return;
    }

    const gameRuntime = createGameRuntime(exercise);
    const sessionStartedAt = performance.now();
    appState.training = {
        interactionMode,
        exerciseId: exercise.id,
        activeStartedAt: sessionStartedAt,
        activeElapsedMs: 0,
        pauseCount: 0,
        guideIndex: 0,
        guideWindowMs: Math.max(1200, Math.round((exercise.duration * 1000) / getGuideCount())),
        lastAdvanceAt: sessionStartedAt,
        matchStartedAt: 0,
        matchGuideIndex: null,
        softMatchStartedAt: 0,
        softMatchGuideIndex: null,
        holdProgress: 0,
        lastScoreSampleAt: 0,
        bestAccuracy: 0,
        scoreHistory: [],
        stabilityHistory: [],
        checkpointScores: [],
        previousMeanError: null,
        cueText: 'Match the first pose from the instruction video.',
        cueDetail: 'Once the live score is high enough, hold briefly to confirm the checkpoint.',
        calibrationText: 'Scanning live hand',
        handLossStartedAt: 0,
        fingerTotals: { Thumb: 0, Index: 0, Middle: 0, Ring: 0, Pinky: 0 },
        fingerSamples: 0,
        gameRuntime,
        gameModeId: gameRuntime.modeId,
        gameModeTitle: gameRuntime.modeTitle,
        gameHud: { ...FALLBACK_GAME_HUD },
        gameSummary: null,
        gameViewState: null,
        lastFrameAt: sessionStartedAt,
    };
    appState.training.gameRuntime.notifySessionStart({
        exerciseId: exercise.id,
        exerciseName: exercise.name,
        guideCount: getGuideCount(),
        sessionDurationMs: (exercise.session_duration_seconds || exercise.duration) * 1000,
        interactionMode,
        handedness: appState.latestHandedness,
    });
    syncTrainingGameSnapshot(appState.training);

    if (interactionMode === 'pinch_defense') {
        appState.training.cueText = 'Defend the lane with clean pinches.';
        appState.training.cueDetail = 'Match the front enemy symbol, then release before the next step.';
        appState.training.calibrationText = 'Hand tracking stable';
    }

    setScreen('training');
}

function resumeTraining() {
    if (!appState.training) {
        setScreen('instructions');
        return;
    }

    appState.training.activeStartedAt = performance.now();
    appState.training.handLossStartedAt = 0;
    appState.training.lastFrameAt = performance.now();
    if (appState.training.gameRuntime && typeof appState.training.gameRuntime.notifyResume === 'function') {
        appState.training.gameRuntime.notifyResume({
            guideIndex: appState.training.guideIndex,
            completionPercent: getTrainingProgressPercent(appState.training),
        });
        syncTrainingGameSnapshot(appState.training);
    }
    setScreen('training');
}

function getTrainingElapsedMs() {
    if (!appState.training) return 0;
    if (appState.screen !== 'training') return appState.training.activeElapsedMs;
    return getTrainingElapsedAt(performance.now());
}

function stopTrainingTimer() {
    if (!appState.training || appState.screen !== 'training') return;
    appState.training.activeElapsedMs += performance.now() - appState.training.activeStartedAt;
}

function pauseTraining() {
    if (!appState.training || appState.screen !== 'training') return;
    stopTrainingTimer();
    appState.training.pauseCount += 1;
    appState.training.matchStartedAt = 0;
    appState.training.matchGuideIndex = null;
    appState.training.softMatchStartedAt = 0;
    appState.training.softMatchGuideIndex = null;
    appState.training.holdProgress = 0;
    if (appState.training.gameRuntime && typeof appState.training.gameRuntime.notifyPause === 'function') {
        appState.training.gameRuntime.notifyPause({
            guideIndex: appState.training.guideIndex,
            completionPercent: getTrainingProgressPercent(appState.training),
        });
        syncTrainingGameSnapshot(appState.training);
    }
    setScreen('paused');
}

function finishTraining(completed) {
    if (!appState.training) return;
    stopTrainingTimer();

    if (appState.training.gameRuntime && typeof appState.training.gameRuntime.notifySessionEnd === 'function') {
        appState.training.gameRuntime.notifySessionEnd({
            completed,
            durationMs: appState.training.activeElapsedMs,
            completionPercent: getTrainingProgressPercent(appState.training),
            averageAccuracy: average(appState.training.checkpointScores.length
                ? appState.training.checkpointScores
                : appState.training.scoreHistory.map((entry) => entry.score)),
        });
        syncTrainingGameSnapshot(appState.training);
    }

    const summary = buildSessionSummary(appState.training, completed);
    appState.currentSummary = summary;
    appState.lastSessionSummary = summary;
    appState.training = null;
    setScreen('summary');
}

function openSummary(preferCurrentSession) {
    if (preferCurrentSession && appState.training) {
        finishTraining(false);
        return;
    }

    if (appState.lastSessionSummary) {
        appState.currentSummary = appState.lastSessionSummary;
        setScreen('summary');
        return;
    }

    showToast('No summary is available yet.');
}

function buildSessionSummary(training, completed) {
    const exercise = getCurrentExercise();
    const isPinchDefense = training.interactionMode === 'pinch_defense';
    const pinchSummary = isPinchDefense ? (training.gameSummary || {}) : null;
    const completionPercent = isPinchDefense
        ? Math.round(pinchSummary.completionPercent || 0)
        : getCompletionPercent(training.guideIndex);
    const accuracyTrend = isPinchDefense
        ? compressHistory(pinchSummary.accuracyTrend || [], 12)
        : compressHistory(training.scoreHistory.map((entry) => entry.score), 12);
    const stabilityTrend = isPinchDefense
        ? compressHistory(pinchSummary.stabilityTrend || [], 12)
        : compressHistory(training.stabilityHistory, 12);
    const averageAccuracy = isPinchDefense
        ? Math.round(pinchSummary.averageAccuracy || 0)
        : Math.round(average(training.checkpointScores.length ? training.checkpointScores : training.scoreHistory.map((entry) => entry.score)));
    const weakestFinger = isPinchDefense
        ? (pinchSummary.weakestFinger || 'Index')
        : findWeakestFinger(training);
    const dateLabel = new Date().toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
    });

    const durationLabel = formatDuration(training.activeElapsedMs);
    const pauseLabel = training.pauseCount
        ? `${training.pauseCount} pause${training.pauseCount === 1 ? '' : 's'} during session`
        : 'No pauses during session';

    return {
        exerciseName: exercise ? exercise.name : 'Unknown Exercise',
        completed,
        completionPercent,
        averageAccuracy: Number.isFinite(averageAccuracy) ? averageAccuracy : 0,
        bestAccuracy: isPinchDefense ? Math.round(pinchSummary.bestAccuracy || 0) : Math.round(training.bestAccuracy),
        weakestFinger,
        durationLabel,
        pauseLabel,
        dateLabel,
        accuracyTrend,
        stabilityTrend,
        gameModeTitle: training.gameModeTitle || 'Unknown Mode',
        gameModeSummary: training.gameSummary || null,
        assessment: isPinchDefense
            ? window.PinchDefenseHost.buildAssessment({
                averageAccuracy,
                weakestFinger,
                completed,
                completionPercent,
                pauseCount: training.pauseCount,
                gameSummary: training.gameSummary || {},
            })
            : buildAssessment({
                averageAccuracy,
                weakestFinger,
                completed,
                completionPercent,
                pauseCount: training.pauseCount,
            }),
    };
}

function buildAssessment(summary) {
    const completionNote = summary.completed
        ? 'You completed the full guided exercise.'
        : `The session ended at ${summary.completionPercent} percent of the guided exercise.`;

    const pauseNote = summary.pauseCount
        ? `Pause count ${summary.pauseCount} suggests the session may need a lighter pace or wider camera framing.`
        : 'The continuous run stayed stable without extra pauses.';

    return `
        Average session accuracy settled near ${Math.round(summary.averageAccuracy)} percent.
        ${completionNote}
        The most inconsistent finger was the ${summary.weakestFinger.toLowerCase()} finger, so the next session should start by matching that segment before refining the rest of the hand.
        ${pauseNote}
    `.trim();
}

function findWeakestFinger(training) {
    if (!training.fingerSamples) return 'Thumb';

    let weakest = 'Thumb';
    let weakestScore = Number.POSITIVE_INFINITY;
    Object.entries(training.fingerTotals).forEach(([finger, total]) => {
        const score = total / training.fingerSamples;
        if (score < weakestScore) {
            weakest = finger;
            weakestScore = score;
        }
    });
    return weakest;
}

function compressHistory(values, count) {
    if (!values.length) {
        return Array.from({ length: count }, () => 0);
    }

    if (values.length <= count) {
        const padded = values.slice();
        while (padded.length < count) padded.push(values[values.length - 1]);
        return padded.map((value) => Math.round(value));
    }

    const segment = values.length / count;
    return Array.from({ length: count }, (_, index) => {
        const start = Math.floor(index * segment);
        const end = Math.max(start + 1, Math.floor((index + 1) * segment));
        return Math.round(average(values.slice(start, end)));
    });
}

function mountPersistentMedia() {
    dom.cameraStage.classList.add('is-hidden');
    dom.referencePanel.classList.add('is-hidden');

    const cameraMount = dom.screenRoot.querySelector('#cameraMount');
    const shouldMountCamera = cameraMount && appState.cameraRunning && !(appState.training && appState.training.interactionMode === 'pinch_defense' && appState.screen === 'training');
    if (shouldMountCamera) {
        cameraMount.appendChild(dom.cameraStage);
        dom.cameraStage.classList.remove('is-hidden');
        dom.cameraStage.dataset.mode = appState.screen === 'paused' ? 'paused' : appState.screen;
        refreshCameraStage();
    }

    const referenceMount = dom.screenRoot.querySelector('#referenceMount');
    if (referenceMount && dom.referenceVideo.src && ['instructions', 'paused'].includes(appState.screen)) {
        referenceMount.appendChild(dom.referencePanel);
        dom.referencePanel.classList.remove('is-hidden');
        playReferenceVideo();
    } else {
        dom.referenceVideo.pause();
    }

    const gameMount = dom.screenRoot.querySelector('#gameMount');
    const nextRuntime = appState.training && appState.training.gameRuntime && typeof appState.training.gameRuntime.mount === 'function'
        ? appState.training.gameRuntime
        : null;

    if (gameMount && nextRuntime) {
        if (appState.mountedGameRuntime && appState.mountedGameRuntime !== nextRuntime && typeof appState.mountedGameRuntime.unmount === 'function') {
            appState.mountedGameRuntime.unmount();
        }
        nextRuntime.mount(gameMount);
        appState.mountedGameRuntime = nextRuntime;
    } else if (appState.mountedGameRuntime && typeof appState.mountedGameRuntime.unmount === 'function') {
        appState.mountedGameRuntime.unmount();
        appState.mountedGameRuntime = null;
    }
}

async function startCamera() {
    if (appState.cameraRunning) return true;

    if (!window.Hands || !window.Camera) {
        showToast('MediaPipe camera helpers did not load.');
        return false;
    }

    try {
        if (!appState.hands) {
            appState.hands = new Hands({
                locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4.1675469240/${file}`,
            });

            appState.hands.setOptions({
                maxNumHands: 1,
                modelComplexity: 1,
                minDetectionConfidence: 0.55,
                minTrackingConfidence: 0.5,
            });

            appState.hands.onResults(onHandResults);
        }

        appState.camera = new Camera(dom.cameraVideo, {
            onFrame: async () => {
                const now = performance.now();
                if (appState.handSendInFlight || now - appState.lastHandsSentAt < PROCESSING_FRAME_MS) {
                    return;
                }

                appState.handSendInFlight = true;
                appState.lastHandsSentAt = now;
                try {
                    await appState.hands.send({ image: dom.cameraVideo });
                } finally {
                    appState.handSendInFlight = false;
                }
            },
            width: 960,
            height: 540,
        });

        await Promise.resolve(appState.camera.start());
        appState.cameraRunning = true;
        updateShell();
        return true;
    } catch (error) {
        console.error(error);
        showToast('Could not start the camera. Allow camera access and try again.');
        return false;
    }
}

function getBounds(landmarks) {
    const xs = landmarks.map((point) => point.x);
    const ys = landmarks.map((point) => point.y);
    return {
        minX: Math.min(...xs),
        maxX: Math.max(...xs),
        minY: Math.min(...ys),
        maxY: Math.max(...ys),
    };
}

function getHandArea(landmarks) {
    const bounds = getBounds(landmarks);
    return Math.max(0.0001, (bounds.maxX - bounds.minX) * (bounds.maxY - bounds.minY));
}

function getHandednessLabel(entry) {
    if (!entry) return 'Right';
    if (Array.isArray(entry) && entry.length) {
        return getHandednessLabel(entry[0]);
    }
    const label = entry.label || entry.categoryName || entry.displayName || entry.classification?.[0]?.label;
    return label === 'Left' ? 'Left' : 'Right';
}

function selectActiveHand(results) {
    const hands = results.multiHandLandmarks || [];
    if (!hands.length) return { landmarks: null, bounds: null, handedness: null };

    let bestIndex = 0;
    let bestArea = -1;
    hands.forEach((candidate, index) => {
        const area = getHandArea(candidate);
        if (area > bestArea) {
            bestArea = area;
            bestIndex = index;
        }
    });

    return {
        landmarks: hands[bestIndex].map((point) => ({ x: point.x, y: point.y, z: point.z || 0 })),
        bounds: getBounds(hands[bestIndex]),
        handedness: getHandednessLabel((results.multiHandedness || [])[bestIndex]),
    };
}

function onHandResults(results) {
    syncOverlayCanvasSize();

    const now = performance.now();
    const active = selectActiveHand(results);

    if (active.landmarks) {
        appState.latestLandmarks = active.landmarks;
        appState.latestBounds = active.bounds;
        appState.latestHandedness = active.handedness || appState.latestHandedness;
    } else {
        appState.latestLandmarks = null;
        appState.latestBounds = null;
    }

    if (['zones', 'instructions', 'paused', 'summary'].includes(appState.screen)) {
        updateZoneDetection(now);
    } else {
        resetZoneState();
    }

    if (appState.screen === 'training') {
        updateTraining(now);
    }

    if (appState.screen === 'instructions' && isPinchDefenseExercise()) {
        updatePinchDefenseInstructionUI();
    }

    drawOverlay();
}

function updatePinchDefenseInstructionUI() {
    window.PinchDefenseHost.updateInstructionUI(dom.screenRoot, appState.latestHandedness);
}

function resetZoneState() {
    appState.zone.current = null;
    appState.zone.enteredAt = 0;
    appState.zone.progress = 0;
    updateZoneUI();
}

function getPalmCenter(landmarks) {
    if (!landmarks || landmarks.length < 18) return null;
    const anchors = [0, 5, 9, 13, 17].map((index) => landmarks[index]);
    return {
        x: average(anchors.map((point) => point.x)),
        y: average(anchors.map((point) => point.y)),
    };
}

function toUserFacingX(x) {
    return 1 - x;
}

function getActiveZone() {
    const config = getScreenZoneConfig();
    const center = getPalmCenter(appState.latestLandmarks);
    if (!center) return null;

    const y = center.y;
    const x = toUserFacingX(center.x);

    if (appState.screen === 'summary') {
        return x > 0.28 && x < 0.72 && y > 0.36 && y < 0.84 && config.center && config.center.enabled ? 'center' : null;
    }

    if (config.top && config.top.enabled && y < 0.22 && x > 0.34 && x < 0.66) return 'top';
    if (config.left && config.left.enabled && x < 0.27 && y > 0.28 && y < 0.82) return 'left';
    if (config.right && config.right.enabled && x > 0.73 && y > 0.28 && y < 0.82) return 'right';
    if (config.center && config.center.enabled && x > 0.34 && x < 0.66 && y > 0.3 && y < 0.82) return 'center';

    return null;
}

function updateZoneDetection(now) {
    const zoneName = getActiveZone();
    const inCooldown = now < appState.zone.cooldownUntil;

    if (!zoneName || inCooldown) {
        appState.zone.current = zoneName;
        appState.zone.progress = 0;
        appState.zone.enteredAt = zoneName ? now : 0;
        updateZoneUI();
        return;
    }

    if (appState.zone.current !== zoneName) {
        appState.zone.current = zoneName;
        appState.zone.enteredAt = now;
    }

    appState.zone.progress = clamp((now - appState.zone.enteredAt) / ZONE_HOLD_MS, 0, 1);
    updateZoneUI();

    if (appState.zone.progress >= 1) {
        appState.zone.triggered = zoneName;
        appState.zone.triggeredAt = now;
        appState.zone.cooldownUntil = now + 1000;
        appState.zone.current = null;
        appState.zone.enteredAt = 0;
        appState.zone.progress = 0;
        updateZoneUI();
        handleZoneAction(zoneName);
    }
}

function handleZoneAction(zoneName) {
    switch (appState.screen) {
        case 'zones':
            if (zoneName === 'center') {
                setScreen('instructions');
            } else if (zoneName === 'top' && appState.lastSessionSummary) {
                appState.currentSummary = appState.lastSessionSummary;
                setScreen('summary');
            } else {
                showToast(`Tutorial zone detected: ${zoneName}.`);
            }
            break;
        case 'instructions':
            if (zoneName === 'left') {
                shiftExercise(-1, true);
            } else if (zoneName === 'right') {
                shiftExercise(1, true);
            } else if (zoneName === 'center') {
                startTrainingSession();
            } else if (zoneName === 'top' && appState.lastSessionSummary) {
                appState.currentSummary = appState.lastSessionSummary;
                setScreen('summary');
            }
            break;
        case 'paused':
            if (zoneName === 'left') {
                shiftExercise(-1, true);
            } else if (zoneName === 'right') {
                shiftExercise(1, true);
            } else if (zoneName === 'center') {
                resumeTraining();
            } else if (zoneName === 'top') {
                openSummary(true);
            }
            break;
        case 'summary':
            if (zoneName === 'center') {
                appState.currentSummary = null;
                setScreen('instructions');
            }
            break;
        default:
            break;
    }
}

function updateZoneUI() {
    const config = getScreenZoneConfig();
    const now = performance.now();

    dom.screenRoot.querySelectorAll('[data-zone-card]').forEach((element) => {
        const name = element.dataset.zoneCard;
        const enabled = !config[name] || config[name].enabled !== false;
        const isActive = appState.zone.current === name && appState.zone.progress > 0;
        const isTriggered = appState.zone.triggered === name && now - appState.zone.triggeredAt < 700;
        const progress = isActive ? `${Math.round(appState.zone.progress * 100)}%` : '0%';

        element.classList.toggle('is-active', isActive);
        element.classList.toggle('is-disabled', !enabled);
        element.classList.toggle('is-triggered', isTriggered);
        element.style.setProperty('--zone-progress', progress);
    });
}

function normalizePoints(landmarks) {
    const points = landmarks.map((landmark) => [landmark.x, landmark.y, landmark.z]);
    const wrist = [...points[0]];

    for (let index = 0; index < points.length; index += 1) {
        points[index] = [
            points[index][0] - wrist[0],
            points[index][1] - wrist[1],
            points[index][2] - wrist[2],
        ];
    }

    const mid = points[9];
    const scale = Math.sqrt(mid[0] ** 2 + mid[1] ** 2 + mid[2] ** 2) || 1;

    return points.map((point) => [point[0] / scale, point[1] / scale, point[2] / scale]);
}

function normalizeVector(vector) {
    const length = Math.sqrt(vector[0] ** 2 + vector[1] ** 2 + vector[2] ** 2) || 1;
    return [vector[0] / length, vector[1] / length, vector[2] / length];
}

function crossVector(a, b) {
    return [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ];
}

function dotVector(a, b) {
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function getCanonicalPoints(landmarks) {
    const points = normalizePoints(landmarks);
    const wrist = points[0];
    const rawX = [
        points[5][0] - points[17][0],
        points[5][1] - points[17][1],
        points[5][2] - points[17][2],
    ];
    const rawY = [
        points[9][0] - wrist[0],
        points[9][1] - wrist[1],
        points[9][2] - wrist[2],
    ];

    const xAxis = normalizeVector(rawX);
    const zAxis = normalizeVector(crossVector(xAxis, rawY));
    const yAxis = normalizeVector(crossVector(zAxis, xAxis));

    return points.map((point) => {
        const relative = [
            point[0] - wrist[0],
            point[1] - wrist[1],
            point[2] - wrist[2],
        ];
        return [
            dotVector(relative, xAxis),
            dotVector(relative, yAxis),
            dotVector(relative, zAxis),
        ];
    });
}

function computeAngle(a, b, c) {
    const ba = [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
    const bc = [c[0] - b[0], c[1] - b[1], c[2] - b[2]];
    const dot = ba[0] * bc[0] + ba[1] * bc[1] + ba[2] * bc[2];
    const magA = Math.sqrt(ba[0] ** 2 + ba[1] ** 2 + ba[2] ** 2) || 1e-8;
    const magB = Math.sqrt(bc[0] ** 2 + bc[1] ** 2 + bc[2] ** 2) || 1e-8;
    const cosine = clamp(dot / (magA * magB), -1, 1);
    return Math.acos(cosine);
}

function computeJointAngles(landmarks) {
    const points = normalizePoints(landmarks);
    return ANGLE_JOINTS.map(([a, b, c]) => computeAngle(points[a], points[b], points[c]));
}

function computeThumbContactProfile(landmarks) {
    const points = normalizePoints(landmarks);
    const thumbTip = points[4];
    const contactTargets = [8, 12, 16, 20];

    return contactTargets.map((targetIndex) => {
        const target = points[targetIndex];
        return Math.sqrt(
            (thumbTip[0] - target[0]) ** 2 +
            (thumbTip[1] - target[1]) ** 2 +
            (thumbTip[2] - target[2]) ** 2
        );
    });
}

function computeSpreadProfile(landmarks) {
    const points = normalizePoints(landmarks);
    const spreadPairs = [[8, 12], [12, 16], [16, 20], [5, 17]];

    return spreadPairs.map(([startIndex, endIndex]) => {
        const start = points[startIndex];
        const end = points[endIndex];
        return Math.sqrt(
            (start[0] - end[0]) ** 2 +
            (start[1] - end[1]) ** 2 +
            (start[2] - end[2]) ** 2
        );
    });
}

function computePoseDeltaFromLandmarks(landmarksA, landmarksB) {
    const pointsA = getCanonicalPoints(landmarksA);
    const pointsB = getCanonicalPoints(landmarksB);

    return average(pointsA.map((point, index) => {
        const other = pointsB[index];
        return Math.sqrt(
            (point[0] - other[0]) ** 2 +
            (point[1] - other[1]) ** 2 +
            (point[2] - other[2]) ** 2
        );
    }));
}

function compareHands(userLandmarks, referenceLandmarks) {
    const userAngles = computeJointAngles(userLandmarks);
    const referenceAngles = computeJointAngles(referenceLandmarks);

    const rawDiffs = userAngles.map((angle, index) => {
        return Math.abs(angle - referenceAngles[index]) * (180 / Math.PI);
    });
    const angleDiffs = rawDiffs.map((diff) => Math.max(0, diff - ANGLE_TOLERANCE_DEG));
    const meanError = average(angleDiffs);
    const angleScore = Math.max(0, 100 * Math.exp(-meanError / OVERALL_SCORE_DECAY));

    const userContacts = computeThumbContactProfile(userLandmarks);
    const referenceContacts = computeThumbContactProfile(referenceLandmarks);
    const contactDiffs = userContacts.map((distance, index) => {
        return Math.max(0, Math.abs(distance - referenceContacts[index]) - CONTACT_TOLERANCE);
    });
    const meanContactError = average(contactDiffs);
    const contactScore = Math.max(0, 100 * Math.exp(-meanContactError / CONTACT_SCORE_DECAY));

    const userSpread = computeSpreadProfile(userLandmarks);
    const referenceSpread = computeSpreadProfile(referenceLandmarks);
    const spreadDiffs = userSpread.map((distance, index) => {
        return Math.max(0, Math.abs(distance - referenceSpread[index]) - SPREAD_TOLERANCE);
    });
    const meanSpreadError = average(spreadDiffs);
    const spreadScore = Math.max(0, 100 * Math.exp(-meanSpreadError / SPREAD_SCORE_DECAY));
    const poseDelta = computePoseDeltaFromLandmarks(userLandmarks, referenceLandmarks);
    const shapeScore = Math.max(0, 100 * Math.exp(-poseDelta / POSE_SHAPE_DECAY));

    const accuracyScore = clamp(
        angleScore * 0.5 + contactScore * 0.28 + spreadScore * 0.12 + shapeScore * 0.1,
        0,
        100
    );
    const progressScore = clamp(
        angleScore * 0.18 + contactScore * 0.08 + spreadScore * 0.04 + shapeScore * 0.7,
        0,
        100
    );

    const fingerScores = {};
    const feedback = [];
    const contactIndexMap = {
        Thumb: [0, 1, 2, 3],
        Index: [0],
        Middle: [1],
        Ring: [2],
        Pinky: [3],
    };

    Object.entries(FINGER_JOINT_INDICES).forEach(([finger, indices]) => {
        const fingerMeanError = average(indices.map((index) => angleDiffs[index]));
        const fingerAngleScore = Math.max(0, 100 * Math.exp(-fingerMeanError / FINGER_SCORE_DECAY));
        const relevantContactDiffs = contactIndexMap[finger].map((contactIndex) => contactDiffs[contactIndex]);
        const fingerContactScore = Math.max(0, 100 * Math.exp(-average(relevantContactDiffs) / CONTACT_SCORE_DECAY));
        const score = clamp(fingerAngleScore * 0.72 + fingerContactScore * 0.28, 0, 100);
        fingerScores[finger] = Math.round(score * 10) / 10;

        const userMean = average(indices.map((index) => userAngles[index]));
        const referenceMean = average(indices.map((index) => referenceAngles[index]));

        if (score < 50) {
            feedback.push(userMean < referenceMean ? `Extend your ${finger.toLowerCase()} finger more.` : `Bend your ${finger.toLowerCase()} finger more.`);
        } else if (score < 75) {
            feedback.push(`Refine the ${finger.toLowerCase()} finger angle slightly.`);
        }
    });

    const maxContactDiff = Math.max(...contactDiffs);
    if (maxContactDiff > CONTACT_TOLERANCE * 1.6) {
        const strongestMissIndex = contactDiffs.indexOf(maxContactDiff);
        const fingerLabel = ['index', 'middle', 'ring', 'pinky'][strongestMissIndex];
        feedback.unshift(userContacts[strongestMissIndex] > referenceContacts[strongestMissIndex]
            ? `Move your thumb closer to your ${fingerLabel} finger.`
            : `Move your thumb slightly away from your ${fingerLabel} finger.`);
    } else if (meanSpreadError > SPREAD_TOLERANCE * 0.8) {
        feedback.push(average(userSpread) < average(referenceSpread)
            ? 'Open the hand a bit wider.'
            : 'Bring the fingertips a little closer together.');
    }

    return {
        overall_score: Math.round(accuracyScore * 10) / 10,
        progress_score: Math.round(progressScore * 10) / 10,
        finger_scores: fingerScores,
        feedback: feedback.slice(0, 3),
        mean_angle_error: Math.round(meanError * 10) / 10,
        mean_contact_error: Math.round(meanContactError * 1000) / 1000,
        angle_score: Math.round(angleScore * 10) / 10,
        contact_score: Math.round(contactScore * 10) / 10,
        spread_score: Math.round(spreadScore * 10) / 10,
        shape_score: Math.round(shapeScore * 10) / 10,
    };
}

function scoreGuideAtIndex(userLandmarks, guideIndex, currentGuideIndex) {
    const guide = appState.guideFrames[guideIndex];
    if (!guide) return null;

    const result = compareHands(userLandmarks, guide.landmarks);
    const sequenceBias = guideIndex === currentGuideIndex
        ? 5
        : Math.max(0, 4 - (guideIndex - currentGuideIndex) * 0.7);
    const score = clamp(result.progress_score + sequenceBias, 0, 100);

    return {
        guideIndex,
        score,
        result,
    };
}

function findBestGuideMatch(userLandmarks, currentGuideIndex, lockedGuideIndex = null) {
    const maxGuideIndex = appState.guideFrames.length - 1;
    let best = null;

    for (let index = currentGuideIndex; index <= Math.min(maxGuideIndex, currentGuideIndex + MATCH_SEARCH_AHEAD); index += 1) {
        const candidate = scoreGuideAtIndex(userLandmarks, index, currentGuideIndex);
        if (candidate && (!best || candidate.score > best.score)) {
            best = candidate;
        }
    }

    if (lockedGuideIndex !== null) {
        const locked = scoreGuideAtIndex(userLandmarks, lockedGuideIndex, currentGuideIndex);
        if (locked && best && locked.score >= best.score - 3) {
            return locked;
        }
    }

    return best;
}

function isHandWithdrawn(bounds) {
    if (!bounds) return true;
    return bounds.minX < 0.02 || bounds.maxX > 0.98 || bounds.minY < 0.02 || bounds.maxY > 0.98;
}

function updatePinchDefenseTraining(now) {
    const training = appState.training;
    if (!training) return;

    const deltaSeconds = Math.max(0, (now - (training.lastFrameAt || now)) / 1000);
    training.lastFrameAt = now;

    const handPresent = Boolean(appState.latestLandmarks);
    const trackingOk = handPresent && !isHandWithdrawn(appState.latestBounds);

    if (!trackingOk) {
        if (!training.handLossStartedAt) {
            training.handLossStartedAt = now;
        }
    } else {
        training.handLossStartedAt = 0;
    }

    if (training.gameRuntime && typeof training.gameRuntime.notifyFrame === 'function') {
        training.gameRuntime.notifyFrame({
            now,
            deltaSeconds,
            landmarks: appState.latestLandmarks,
            bounds: appState.latestBounds,
            handedness: appState.latestHandedness,
            handPresent,
            trackingOk,
        });
        syncTrainingGameSnapshot(training);
    }

    const viewState = training.gameViewState || {};
    training.cueText = viewState.cueTitle || 'Defend the lane with clean pinches.';
    training.cueDetail = viewState.cueText || 'Match the enemy symbol, then release before the next pinch.';
    training.calibrationText = viewState.trackingText || (trackingOk ? 'Hand tracking stable' : 'Tracking lost');

    if (!trackingOk && training.handLossStartedAt && now - training.handLossStartedAt >= PINCH_DEFENSE_PAUSE_MS) {
        pauseTraining();
        return;
    }

    if (viewState.finishRequested) {
        finishTraining(Boolean(viewState.completed));
        return;
    }

    updateTrainingUI();
}

function updateTraining(now) {
    const training = appState.training;
    if (!training) return;
    if (training.interactionMode === 'pinch_defense') {
        updatePinchDefenseTraining(now);
        return;
    }
    const deltaSeconds = Math.max(0, (now - (training.lastFrameAt || now)) / 1000);
    training.lastFrameAt = now;

    if (!appState.latestLandmarks || isHandWithdrawn(appState.latestBounds)) {
        if (!training.handLossStartedAt) {
            training.handLossStartedAt = now;
        }

        if (now - training.handLossStartedAt >= PAUSE_HAND_LOSS_MS) {
            pauseTraining();
        }

        updateTrainingUI();
        return;
    }

    training.handLossStartedAt = 0;

    const guide = appState.guideFrames[Math.min(training.guideIndex, appState.guideFrames.length - 1)];
    if (!guide) {
        finishTraining(true);
        return;
    }

    const match = findBestGuideMatch(appState.latestLandmarks, training.guideIndex, training.matchGuideIndex);
    if (!match) {
        updateTrainingUI();
        return;
    }

    const { result } = match;
    training.lastResult = { ...result, match_score: Math.round(match.score * 10) / 10 };
    training.bestAccuracy = Math.max(training.bestAccuracy, result.overall_score);

    const stability = training.previousMeanError === null
        ? Math.max(0, 100 - result.mean_angle_error * 1.8)
        : Math.max(0, 100 - Math.abs(result.mean_angle_error - training.previousMeanError) * 5.5);
    training.previousMeanError = result.mean_angle_error;

    if (now - training.lastScoreSampleAt >= SCORE_SAMPLE_MS) {
        training.scoreHistory.push({ t: now, score: result.overall_score });
        training.stabilityHistory.push(stability);
        training.lastScoreSampleAt = now;
        training.fingerSamples += 1;
        Object.entries(result.finger_scores).forEach(([finger, score]) => {
            training.fingerTotals[finger] += score;
        });
    }

    const weakestEntry = Object.entries(result.finger_scores).sort((a, b) => a[1] - b[1])[0];
    const weakestFinger = weakestEntry ? weakestEntry[0] : 'Thumb';
    training.cueText = result.feedback[0] || (
        match.guideIndex > training.guideIndex
            ? 'Good, you are already close to the next pose in the sequence.'
            : `Refine the ${weakestFinger.toLowerCase()} finger and hold once the score rises.`
    );
    const laterPose = match.guideIndex > training.guideIndex;
    const strongMatch = match.score >= PROGRESS_MATCH_THRESHOLD;
    const softMatch = match.score >= PROGRESS_SOFT_THRESHOLD;
    const canAdvanceByTime = getTrainingElapsedAt(now) >= (training.guideIndex + 1) * training.guideWindowMs;

    training.cueDetail = laterPose
        ? `Later pose detected. Accuracy ${Math.round(result.overall_score)} percent, progress lock ${Math.round(match.score)} percent. Hold to advance.`
        : `Accuracy ${Math.round(result.overall_score)} percent. Progress lock ${Math.round(match.score)} percent.`;
    training.calibrationText = strongMatch
        ? (canAdvanceByTime ? 'Checkpoint aligned' : 'Pose aligned - keep pace')
        : (softMatch ? 'Checkpoint settling' : 'Refining live pose');

    if (strongMatch) {
        if (!training.matchStartedAt || training.matchGuideIndex !== match.guideIndex) {
            training.matchStartedAt = now;
            training.matchGuideIndex = match.guideIndex;
        }
        training.softMatchStartedAt = 0;
        training.softMatchGuideIndex = null;
        training.holdProgress = clamp((now - training.matchStartedAt) / MATCH_HOLD_MS, 0, 1);

        if (training.holdProgress >= 1 && canAdvanceByTime) {
            if (advanceTrainingGuide(training, result.overall_score, training.guideIndex + 1, now, {
                matchScore: match.score,
                result,
            })) {
                finishTraining(true);
                return;
            }
        }
    } else if (softMatch) {
        if (!training.softMatchStartedAt || training.softMatchGuideIndex !== match.guideIndex) {
            training.softMatchStartedAt = now;
            training.softMatchGuideIndex = match.guideIndex;
        }
        training.matchStartedAt = 0;
        training.matchGuideIndex = null;
        const softHoldMs = laterPose ? Math.max(450, SOFT_MATCH_HOLD_MS * 0.7) : SOFT_MATCH_HOLD_MS;
        training.holdProgress = clamp((now - training.softMatchStartedAt) / softHoldMs, 0, 1);

        if (training.holdProgress >= 1 && canAdvanceByTime) {
            if (advanceTrainingGuide(training, result.overall_score, training.guideIndex + 1, now, {
                matchScore: match.score,
                result,
            })) {
                finishTraining(true);
                return;
            }
        }
    } else {
        training.matchStartedAt = 0;
        training.matchGuideIndex = null;
        training.softMatchStartedAt = 0;
        training.softMatchGuideIndex = null;
        training.holdProgress = Math.max(0, training.holdProgress - 0.08);

        if (match.score >= FORCED_PROGRESS_THRESHOLD && canAdvanceByTime) {
            if (advanceTrainingGuide(training, result.overall_score, training.guideIndex + 1, now, {
                matchScore: match.score,
                result,
            })) {
                finishTraining(true);
                return;
            }
        }
    }

    if (training.gameRuntime && typeof training.gameRuntime.notifyFrame === 'function') {
        training.gameRuntime.notifyFrame({
            now,
            deltaSeconds,
            guideIndex: training.guideIndex,
            completionPercent: getCompletionPercent(training.guideIndex),
            holdProgress: training.holdProgress,
            matchScore: match.score,
            result,
        });
        syncTrainingGameSnapshot(training);
    }

    updateTrainingUI();
}

function updateTrainingUI() {
    if (appState.screen !== 'training' && appState.screen !== 'paused') {
        return;
    }

    const training = appState.training;
    if (!training) return;

    const progressPercent = getTrainingProgressPercent(training);

    const progressFill = dom.screenRoot.querySelector('#trainingProgressFill');
    const progressPop = dom.screenRoot.querySelector('#trainingProgressPop');
    const progressMeta = dom.screenRoot.querySelector('#trainingProgressMeta');
    const calibration = dom.screenRoot.querySelector('#trainingCalibrationText');
    const cueTitle = dom.screenRoot.querySelector('#trainingCueTitle');
    const cueText = dom.screenRoot.querySelector('#trainingCueText');
    const gameModeTitle = dom.screenRoot.querySelector('#trainingGameModeTitle');
    const gamePrimaryLabel = dom.screenRoot.querySelector('#trainingGamePrimaryLabel');
    const gamePrimaryValue = dom.screenRoot.querySelector('#trainingGamePrimaryValue');
    const gameSecondaryLabel = dom.screenRoot.querySelector('#trainingGameSecondaryLabel');
    const gameSecondaryValue = dom.screenRoot.querySelector('#trainingGameSecondaryValue');
    const gameStatusText = dom.screenRoot.querySelector('#trainingGameStatusText');
    const gameHud = training.gameHud || FALLBACK_GAME_HUD;

    if (progressFill) progressFill.style.height = `${progressPercent}%`;
    if (progressPop) progressPop.textContent = `${progressPercent}%`;
    if (progressMeta) progressMeta.textContent = `${progressPercent}% complete`;
    if (calibration) calibration.textContent = training.calibrationText || 'Scanning live hand';
    if (cueTitle) cueTitle.textContent = training.cueText;
    if (cueText) cueText.textContent = training.cueDetail;
    if (gameModeTitle) gameModeTitle.textContent = training.gameModeTitle || 'Game Mode';
    if (gamePrimaryLabel) gamePrimaryLabel.textContent = gameHud.primaryLabel;
    if (gamePrimaryValue) gamePrimaryValue.textContent = gameHud.primaryValue;
    if (gameSecondaryLabel) gameSecondaryLabel.textContent = gameHud.secondaryLabel;
    if (gameSecondaryValue) gameSecondaryValue.textContent = gameHud.secondaryValue;
    if (gameStatusText) gameStatusText.textContent = gameHud.statusText;
}

function drawOverlay() {
    const cameraMountVisible = !dom.cameraStage.classList.contains('is-hidden');
    const canvas = dom.overlayCanvas;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (!cameraMountVisible) return;

    if (appState.screen === 'training' && appState.training && appState.latestLandmarks) {
        const weakestEntry = appState.training.lastResult
            ? Object.entries(appState.training.lastResult.finger_scores).sort((a, b) => a[1] - b[1])[0]
            : null;
        drawLiveHand(
            ctx,
            appState.latestLandmarks,
            '#dffcff',
            '#89d2dc',
            weakestEntry ? weakestEntry[0] : null
        );
        drawPalmCursor(ctx, '#89d2dc');
        return;
    }

    if (appState.latestLandmarks) {
        const stroke = appState.screen === 'paused' ? 'rgba(255,255,255,0.72)' : '#89d2dc';
        const fill = appState.screen === 'paused' ? 'rgba(255,255,255,0.18)' : 'rgba(137,210,220,0.24)';
        drawLiveHand(ctx, appState.latestLandmarks, stroke, fill);
        drawPalmCursor(ctx, '#dffcff');
    }
}

function syncOverlayCanvasSize() {
    const parent = dom.overlayCanvas.parentElement;
    if (!parent) return;
    const rect = parent.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));

    if (dom.overlayCanvas.width !== width || dom.overlayCanvas.height !== height) {
        dom.overlayCanvas.width = width;
        dom.overlayCanvas.height = height;
    }
}

function toScreenPoint(point) {
    return {
        x: point.x * dom.overlayCanvas.width,
        y: point.y * dom.overlayCanvas.height,
    };
}

function drawLiveHand(ctx, landmarks, strokeColor, fillColor, highlightFinger = null) {
    const highlightPoints = highlightFinger ? new Set([0, ...FINGER_POINTS[highlightFinger]]) : null;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    HAND_CONNECTIONS.forEach(([startIndex, endIndex]) => {
        const start = toScreenPoint(landmarks[startIndex]);
        const end = toScreenPoint(landmarks[endIndex]);
        const isHighlighted = Boolean(highlightPoints && highlightPoints.has(startIndex) && highlightPoints.has(endIndex));
        ctx.strokeStyle = isHighlighted ? '#ffd666' : strokeColor;
        ctx.lineWidth = isHighlighted ? 6 : 4;
        ctx.globalAlpha = 0.95;
        ctx.beginPath();
        ctx.moveTo(start.x, start.y);
        ctx.lineTo(end.x, end.y);
        ctx.stroke();
    });

    landmarks.forEach((landmark, index) => {
        const point = toScreenPoint(landmark);
        const isHighlighted = Boolean(highlightPoints && highlightPoints.has(index) && index !== 0);
        ctx.globalAlpha = 0.9;
        ctx.fillStyle = isHighlighted ? 'rgba(255,214,102,0.9)' : fillColor;
        ctx.beginPath();
        ctx.arc(point.x, point.y, isHighlighted ? 8 : 7, 0, Math.PI * 2);
        ctx.fill();

        ctx.globalAlpha = 0.98;
        ctx.fillStyle = isHighlighted ? '#6b4f00' : strokeColor;
        ctx.beginPath();
        ctx.arc(point.x, point.y, isHighlighted ? 3.5 : 3, 0, Math.PI * 2);
        ctx.fill();
    });

    ctx.restore();
}

function drawPalmCursor(ctx, color) {
    const center = getPalmCenter(appState.latestLandmarks);
    if (!center) return;

    const point = toScreenPoint(center);
    ctx.save();
    ctx.strokeStyle = color;
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(point.x, point.y, 16, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    if (appState.zone.current && appState.zone.progress > 0) {
        ctx.strokeStyle = '#dffcff';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(point.x, point.y, 24, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * appState.zone.progress);
        ctx.stroke();
    }
    ctx.restore();
}

window.addEventListener('resize', () => {
    syncOverlayCanvasSize();
    drawOverlay();
});

async function init() {
    render();
    await fetchExercises();
    render();
}

init();

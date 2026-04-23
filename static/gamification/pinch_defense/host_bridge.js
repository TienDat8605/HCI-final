(function initPinchDefenseHost(globalObject) {
    'use strict';

    const PINCH_DEFENSE_MAP = [
        { id: 'index', label: 'Index', color: '#3b82f6', shape: 'Circle' },
        { id: 'middle', label: 'Middle', color: '#22c55e', shape: 'Triangle' },
        { id: 'ring', label: 'Ring', color: '#facc15', shape: 'Square' },
        { id: 'pinky', label: 'Pinky', color: '#ef4444', shape: 'Diamond' },
    ];

    function isPinchDefenseExercise(exercise) {
        return Boolean(exercise && exercise.interaction_mode === 'pinch_defense');
    }

    function getDurationSeconds(exercise) {
        return exercise ? (exercise.session_duration_seconds || exercise.duration || 0) : 0;
    }

    function getExerciseCopyFallback(exercise) {
        if (!isPinchDefenseExercise(exercise)) {
            return null;
        }

        return {
            label: 'Pinch Defense',
            overview: `${exercise.name} turns finger opposition into a forgiving lane-defense session.`,
            guidance: 'Watch the target symbol, pinch the matching finger, and release before the next step.',
            tips: [
                'Keep the thumb visible at all times.',
                'Use slow, clean pinches rather than fast repeated taps.',
                'If tracking drifts, relax and return your hand to center.',
            ],
        };
    }

    function getDetectedHandLabel(handedness) {
        return handedness === 'Left' ? 'Left Hand' : 'Right Hand';
    }

    function getHandGuideMarkup(handedness) {
        const isLeft = handedness === 'Left';
        const guideItems = PINCH_DEFENSE_MAP.map((finger) => {
            return `
                <div class="pinch-hand-guide-finger" style="--finger-color:${finger.color};">
                    <span>${finger.label}</span>
                    <b>${finger.shape}</b>
                </div>
            `;
        }).join('');

        return `
            <div id="pinchDefenseHandGuide" class="pinch-hand-guide ${isLeft ? 'is-left' : 'is-right'}">
                ${guideItems}
            </div>
        `;
    }

    function renderInstructionScreen({ exercise, copy, zoneConfig, handedness, zoneMarkup }) {
        const durationMinutes = exercise ? Math.max(1, Math.round(getDurationSeconds(exercise) / 60)) : '--';
        const guideAssetPath = '/static/gamification/pinch_defense/assets/hand_full_guide.jpg';

        return `
            <section class="screen instructions-screen pinch-instructions-screen">
                <div class="screen-title-row">
                    <div>
                        <div class="screen-kicker">Preparation Stage 02</div>
                        <h2 class="hero-title">${exercise ? exercise.name : 'Loading Exercise'}</h2>
                        <p class="body-copy">Learn the fixed finger mapping, keep the tracked hand visible, and use center hold to start the defense session.</p>
                    </div>
                    <div class="screen-meta">Adaptive pinch support enabled</div>
                </div>

                <div class="instruction-layout pinch-instruction-layout">
                    <section class="instruction-media-column">
                        <section class="hero-panel instruction-meta-panel">
                            <div class="hero-chip">${copy.label}</div>
                            <p class="hero-copy">${copy.overview}</p>

                            <div class="hero-metrics">
                                <div class="hero-metric">
                                    <strong>Estimated Time</strong>
                                    <span>${durationMinutes} Minutes</span>
                                </div>
                                <div class="hero-metric">
                                    <strong>Enemy Steps</strong>
                                    <span>1-step and 2-step waves</span>
                                </div>
                                <div class="hero-metric">
                                    <strong>Tracking</strong>
                                    <span>${getDetectedHandLabel(handedness)}</span>
                                </div>
                            </div>

                            <div class="pinch-legend-grid">
                                ${PINCH_DEFENSE_MAP.map((finger) => `
                                    <div class="pinch-legend-card" style="--legend-color:${finger.color};">
                                        <span>${finger.shape}</span>
                                        <strong>${finger.label}</strong>
                                    </div>
                                `).join('')}
                            </div>

                            <div class="button-row">
                                <button class="button button-secondary" type="button" data-action="prev-exercise">Previous</button>
                                <button class="button button-secondary" type="button" data-action="next-exercise">Next</button>
                                <button class="button button-primary" type="button" data-action="start-training" data-zone-card="center">
                                    Hold Center To Start
                                </button>
                            </div>
                        </section>

                        <section class="hero-guidance instruction-guidance pinch-guidance">
                            <strong>Pinch Defense Rules</strong>
                            <p>${copy.guidance}</p>
                            <ul>
                                ${copy.tips.map((tip) => `<li>${tip}</li>`).join('')}
                            </ul>
                            <div class="pinch-enemy-rules">
                                <div><strong>Ghost</strong><span>Single symbol, slow approach.</span></div>
                                <div><strong>Slime</strong><span>Two symbols in order, release between steps.</span></div>
                                <div><strong>Skull</strong><span>Elite 2-step target with higher score.</span></div>
                            </div>
                        </section>
                    </section>

                    <section class="instruction-side-column">
                        <section class="instruction-stage-shell pinch-instruction-stage">
                            <div id="cameraMount" class="stage-mount"></div>
                            <div class="zone-overlay">
                                ${zoneMarkup(zoneConfig)}
                            </div>
                            <div class="pinch-hand-guide-shell">
                                <div class="pinch-hand-meta">
                                    <span>Detected Hand</span>
                                    <strong id="pinchDetectedHand">${getDetectedHandLabel(handedness)}</strong>
                                </div>
                                <img class="pinch-full-guide-art" src="${guideAssetPath}" alt="Open hand guide for camera placement">
                                <p class="pinch-full-guide-copy">Place the whole hand in front of the camera and keep it a little away from the lens so every fingertip stays visible.</p>
                                ${getHandGuideMarkup(handedness)}
                            </div>
                        </section>
                    </section>
                </div>
            </section>
        `;
    }

    function getTrainingProgressPercent(training) {
        return Math.round(training && training.gameViewState && Number.isFinite(training.gameViewState.progressPercent)
            ? training.gameViewState.progressPercent
            : 0);
    }

    function getTrainingAccuracy(training) {
        return Math.round(training && training.gameViewState && Number.isFinite(training.gameViewState.accuracyPercent)
            ? training.gameViewState.accuracyPercent
            : 0);
    }

    function getShapeEntity(shape) {
        if (shape === 'Triangle') return '&#9650;';
        if (shape === 'Square') return '&#9632;';
        if (shape === 'Diamond') return '&#9670;';
        return '&#9679;';
    }

    function getFingerMeta(fingerId) {
        return PINCH_DEFENSE_MAP.find((finger) => finger.id === fingerId) || null;
    }

    function renderSequence(sequence) {
        if (!sequence || !sequence.length) {
            return '<div class="pinch-sequence-empty">No target on screen</div>';
        }

        return `
            <div class="pinch-sequence-row">
                ${sequence.map((fingerId) => {
                    const finger = getFingerMeta(fingerId);
                    if (!finger) return '';
                    return `
                        <div class="pinch-sequence-badge" style="--sequence-color:${finger.color};">
                            <span>${getShapeEntity(finger.shape)}</span>
                            <b>${finger.label}</b>
                        </div>
                    `;
                }).join('')}
            </div>
        `;
    }

    function renderTrainingScreen({ exercise, training, progressPercent, currentCue, gameModeTitle, gameHud }) {
        const viewState = training && training.gameViewState ? training.gameViewState : {};
        const trackingLost = Boolean(viewState.trackingWarning);
        const trackingStatusText = viewState.trackingText || 'Scanning live hand';

        return `
            <section class="screen training-screen pinch-training-screen">
                <div class="training-layout pinch-training-layout">
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

                    <section class="pinch-training-main">
                        <div class="training-stage-shell pinch-training-stage-shell">
                            <div id="gameMount" class="pinch-defense-stage-mount"></div>
                        </div>
                    </section>

                    <aside class="pinch-side-panel">
                        <div class="pinch-side-card">
                            <strong id="trainingGameModeTitle">${gameModeTitle}</strong>
                            <div class="pinch-side-metric">
                                <span id="trainingGamePrimaryLabel">${gameHud.primaryLabel}</span>
                                <b id="trainingGamePrimaryValue">${gameHud.primaryValue}</b>
                            </div>
                            <div class="pinch-side-metric">
                                <span id="trainingGameSecondaryLabel">${gameHud.secondaryLabel}</span>
                                <b id="trainingGameSecondaryValue">${gameHud.secondaryValue}</b>
                            </div>
                            <div class="pinch-side-metric">
                                <span>Accuracy</span>
                                <b>${viewState.accuracyPercent || 0}%</b>
                            </div>
                            <small id="trainingGameStatusText">${gameHud.statusText}</small>
                        </div>

                        <div class="pinch-side-card pinch-tracking-card ${trackingLost ? 'is-warning' : 'is-stable'}">
                            <span class="pinch-side-label">Tracking</span>
                            <strong id="trainingCalibrationText" class="pinch-tracking-state">${trackingStatusText}</strong>
                            <div class="pinch-tracking-instruction">
                                Put your hand in front of the camera and keep it a bit far from the lens, not too close.
                            </div>
                            <small>${currentCue}</small>
                        </div>
                    </aside>
                </div>
            </section>
        `;
    }

    function renderPausedScreen({ training, progressPercent, latestScore, elapsedLabel }) {
        const guideAssetPath = '/static/gamification/pinch_defense/assets/hand_full_guide.jpg';
        return `
            <section class="screen paused-shell">
                <div class="paused-header">
                    <div>
                        <div class="screen-kicker" style="color: var(--danger);">Hand withdrawn</div>
                        <h2 class="paused-title">Session Paused</h2>
                    </div>
                    <div class="screen-meta">Elapsed time ${elapsedLabel}</div>
                </div>

                <div class="paused-content">
                    <div class="paused-stage-shell">
                        <div id="cameraMount" class="stage-mount"></div>
                        <div class="paused-overlay"></div>

                        <div class="paused-float-card">
                            <strong>Current Progress</strong>
                            <div class="paused-metric">
                                <span>Progress</span>
                                <b>${progressPercent}%</b>
                            </div>
                            <div class="paused-metric">
                                <span>Pinch Accuracy</span>
                                <b>${latestScore}%</b>
                            </div>
                            <div class="paused-metric">
                                <span>Wave</span>
                                <b>${training && training.gameViewState ? training.gameViewState.currentWave : 1}/${training && training.gameViewState ? training.gameViewState.totalWaves : 3}</b>
                            </div>
                            <div class="button-row" style="margin-top: 18px;">
                                <button class="button button-primary" type="button" data-action="resume-training">Resume</button>
                                <button class="button button-secondary" type="button" data-action="open-summary">Summary</button>
                            </div>
                        </div>
                    </div>

                    <div class="paused-reference-shell pinch-paused-note">
                        <div class="boot-card">
                            <div class="screen-kicker">Tracking Pause</div>
                            <h2>Return Hand To Resume</h2>
                            <p>Your score, combo, and lane state are frozen. Recenter your hand, then resume when ready.</p>
                            <img class="pinch-full-guide-art is-pause" src="${guideAssetPath}" alt="Open hand guide for camera placement during pause">
                            <p class="pinch-full-guide-copy">Show the full hand to the camera and keep it slightly farther back instead of too close to the lens.</p>
                        </div>
                    </div>
                </div>
            </section>
        `;
    }

    function buildAssessment(summary) {
        const gameSummary = summary.gameSummary || {};
        const completionNote = summary.completed
            ? `You cleared all ${gameSummary.completedWaves || 3} waves and finished the session.`
            : `The run ended at ${summary.completionPercent} percent completion.`;
        const trackingNote = gameSummary.trackingInterruptions
            ? `Tracking confidence was reduced by ${gameSummary.trackingInterruptions} pause(s), so the quality metrics should be read with some caution.`
            : 'Tracking confidence stayed strong through the active run.';
        const repeatabilityNote = gameSummary.repeatabilityScore === null || gameSummary.repeatabilityScore === undefined
            ? 'Repeatability is still building because there were not enough clean repeated trials on the same finger.'
            : `Repeatability settled near ${gameSummary.repeatabilityScore} percent. High completion with lower repeatability suggests good range but inconsistent control.`;
        const reactionNote = gameSummary.averageReactionTimeMs
            ? `Average reaction time between targets was about ${gameSummary.averageReactionTimeMs} ms. Slower reactions with good completion usually point more to switching or planning than to closure itself.`
            : 'Reaction time could not be established from enough valid pinch switches.';

        return `
            Average pinch completion settled near ${Math.round(gameSummary.averageCompletion || 0)} percent, with the best closure reaching ${Math.round(gameSummary.bestCompletion || 0)} percent.
            ${completionNote}
            The strongest completion came from the ${String(gameSummary.strongestCompletionFinger || summary.strongestFinger).toLowerCase()} finger, while the weakest completion came from the ${String(gameSummary.weakestCompletionFinger || summary.weakestFinger).toLowerCase()} finger.
            ${reactionNote}
            ${repeatabilityNote}
            ${trackingNote}
        `.trim();
    }

    function updateInstructionUI(root, handedness) {
        const handLabel = root.querySelector('#pinchDetectedHand');
        const handGuide = root.querySelector('#pinchDefenseHandGuide');
        if (handLabel) {
            handLabel.textContent = getDetectedHandLabel(handedness);
        }
        if (handGuide) {
            handGuide.classList.toggle('is-left', handedness === 'Left');
            handGuide.classList.toggle('is-right', handedness !== 'Left');
        }
    }

    globalObject.PinchDefenseHost = {
        isPinchDefenseExercise,
        getDurationSeconds,
        getExerciseCopyFallback,
        renderInstructionScreen,
        renderTrainingScreen,
        renderPausedScreen,
        getTrainingProgressPercent,
        getTrainingAccuracy,
        buildAssessment,
        updateInstructionUI,
    };
}(window));

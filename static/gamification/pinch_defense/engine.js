(function initPinchDefenseEngine(globalObject) {
    'use strict';

    function clamp(value, min, max) {
        return Math.max(min, Math.min(max, value));
    }

    function average(values) {
        if (!values.length) {
            return 0;
        }
        return values.reduce((sum, value) => sum + value, 0) / values.length;
    }

    function createEmptyFingerStats(config) {
        return config.fingerOrder.reduce((stats, fingerId) => {
            stats[fingerId] = { targets: 0, hits: 0, misses: 0 };
            return stats;
        }, {});
    }

    function computeFingerScore(entry) {
        if (!entry || !entry.targets) {
            return 0;
        }
        return Math.round((entry.hits / entry.targets) * 100);
    }

    function pickFingerByMetric(stats, metric, fallbackFinger) {
        return Object.entries(stats)
            .sort((left, right) => right[1][metric] - left[1][metric])[0]?.[0] || fallbackFinger;
    }

    function pickWeakestFinger(stats, fallbackFinger) {
        const scored = Object.entries(stats)
            .filter(([, entry]) => entry.targets > 0)
            .map(([fingerId, entry]) => ({ fingerId, score: computeFingerScore(entry) }));
        if (!scored.length) {
            return fallbackFinger;
        }
        scored.sort((left, right) => left.score - right.score);
        return scored[0].fingerId;
    }

    function buildEnemyConfig(config, waveIndex, enemyIndex, definition) {
        const enemyType = config.enemyTypes[definition.type];
        return {
            id: `wave${waveIndex + 1}-enemy${enemyIndex + 1}`,
            type: definition.type,
            label: enemyType.label,
            assetId: enemyType.assetId,
            baseScore: enemyType.baseScore,
            hp: enemyType.hp,
            sequence: definition.sequence.slice(),
            currentStep: 0,
            x: config.enemyStartX,
            hitFlashMs: 0,
            knockbackMs: 0,
            travelTimeMs: config.waves[waveIndex].travelTimeMs,
        };
    }

    function createInitialState(config) {
        return {
            started: false,
            finished: false,
            completed: false,
            paused: false,
            finishRequested: false,
            finishReason: '',
            exerciseName: 'Pinch Defense',
            sessionDurationMs: config.sessionDurationMs,
            elapsedMs: 0,
            hp: config.playerMaxHp,
            score: 0,
            combo: 0,
            highestCombo: 0,
            enemiesDefeated: 0,
            activeEnemies: [],
            currentWaveIndex: 0,
            completedWaves: 0,
            waveActive: false,
            waveSpawnCursor: 0,
            nextSpawnAtMs: 0,
            waveTransitionUntilMs: 0,
            totalEnemies: config.waves.reduce((sum, wave) => sum + wave.enemies.length, 0),
            fingerStats: createEmptyFingerStats(config),
            confirmedAttempts: 0,
            correctAttempts: 0,
            attemptLog: [],
            accuracyTrend: [],
            stabilityTrend: [],
            sampleAtMs: config.sampleIntervalMs,
            bestRollingAccuracy: 0,
            currentAccuracyPercent: 0,
            trackingInterruptions: 0,
            currentFocusFinger: config.fingerOrder[0],
            activeFinger: null,
            confirmedFinger: null,
            currentWaveLabel: 'Wave 1',
            praiseText: 'Ready',
            statusText: 'Prepare your thumb and fingertips.',
            cueTitle: 'Defend the lane with clean pinches.',
            cueText: 'Match the front enemy symbol with the correct finger pinch.',
            transientText: '',
            transientUntilMs: 0,
            pendingRelease: false,
            detectorStates: {},
            handedness: 'Right',
            lastDefeatAt: 0,
            lastTrackingOk: true,
            lastFrameAt: 0,
        };
    }

    function createSession(config, detector) {
        const state = createInitialState(config);

        function resetForStart(payload) {
            const nextState = createInitialState(config);
            Object.assign(state, nextState, {
                started: true,
                exerciseName: payload.exerciseName || 'Pinch Defense',
                sessionDurationMs: payload.sessionDurationMs || config.sessionDurationMs,
                handedness: payload.handedness || 'Right',
                currentWaveLabel: config.waves[0].label,
                nextSpawnAtMs: config.waveStartLeadMs,
            });
            detector.reset();
        }

        function setTransient(text, now, durationMs) {
            state.transientText = text;
            state.transientUntilMs = now + durationMs;
        }

        function getActiveWave() {
            return config.waves[state.currentWaveIndex] || null;
        }

        function ensureWaveStarted(nowMs) {
            if (state.waveActive || state.currentWaveIndex >= config.waves.length || nowMs < state.waveTransitionUntilMs) {
                return;
            }
            const wave = getActiveWave();
            state.waveActive = true;
            state.waveSpawnCursor = 0;
            state.nextSpawnAtMs = nowMs + config.waveStartLeadMs;
            state.currentWaveLabel = wave.label;
            setTransient(wave.label, nowMs, 1500);
        }

        function queueEnemyTargetStats(definition) {
            definition.sequence.forEach((fingerId) => {
                if (state.fingerStats[fingerId]) {
                    state.fingerStats[fingerId].targets += 1;
                }
            });
        }

        function spawnEnemies(nowMs) {
            const wave = getActiveWave();
            if (!wave || !state.waveActive) {
                return;
            }

            while (
                state.waveSpawnCursor < wave.enemies.length &&
                state.activeEnemies.length < config.maxActiveEnemies &&
                nowMs >= state.nextSpawnAtMs
            ) {
                const definition = wave.enemies[state.waveSpawnCursor];
                const enemy = buildEnemyConfig(config, state.currentWaveIndex, state.waveSpawnCursor, definition);
                state.activeEnemies.push(enemy);
                queueEnemyTargetStats(definition);
                state.waveSpawnCursor += 1;
                state.nextSpawnAtMs += wave.spawnIntervalMs;
            }

            if (state.waveSpawnCursor >= wave.enemies.length && !state.activeEnemies.length) {
                state.waveActive = false;
                state.completedWaves = state.currentWaveIndex + 1;
                state.currentWaveIndex += 1;
                state.waveTransitionUntilMs = nowMs + config.waveTransitionMs;
                if (state.currentWaveIndex < config.waves.length) {
                    state.currentWaveLabel = config.waves[state.currentWaveIndex].label;
                }
            }
        }

        function breakCombo() {
            state.combo = 0;
        }

        function awardCombo(nowMs) {
            if (state.lastDefeatAt && nowMs - state.lastDefeatAt <= config.comboWindowMs) {
                state.combo += 1;
            } else {
                state.combo = 1;
            }
            state.highestCombo = Math.max(state.highestCombo, state.combo);
            state.lastDefeatAt = nowMs;
        }

        function getPraiseForCombo(combo) {
            if (combo >= 5) {
                return 'EXCELLENT';
            }
            if (combo >= 3) {
                return 'GREAT';
            }
            return 'GOOD';
        }

        function defeatEnemy(enemy, nowMs) {
            state.enemiesDefeated += 1;
            state.score += enemy.baseScore;
            awardCombo(nowMs);
            state.praiseText = getPraiseForCombo(state.combo);
            state.statusText = `${state.praiseText} - ${enemy.label} defeated.`;
            setTransient(`+${enemy.baseScore}`, nowMs, 700);
        }

        function applyPinch(fingerId, nowMs) {
            state.confirmedAttempts += 1;
            state.activeFinger = fingerId;
            state.confirmedFinger = fingerId;
            state.pendingRelease = true;
            const matchingEnemies = state.activeEnemies.filter((enemy) => enemy.sequence[enemy.currentStep] === fingerId);
            const wasCorrect = matchingEnemies.length > 0;

            state.attemptLog.push({ at: nowMs, success: wasCorrect, finger: fingerId });
            state.currentAccuracyPercent = state.confirmedAttempts
                ? Math.round((state.correctAttempts / state.confirmedAttempts) * 100)
                : 0;

            if (!wasCorrect) {
                breakCombo();
                if (state.fingerStats[fingerId]) {
                    state.fingerStats[fingerId].misses += 1;
                }
                state.praiseText = 'TRY AGAIN';
                state.statusText = 'Wrong target. Follow the front enemy symbol.';
                setTransient('Wrong pinch', nowMs, 850);
                return;
            }

            state.correctAttempts += 1;
            state.currentAccuracyPercent = Math.round((state.correctAttempts / state.confirmedAttempts) * 100);

            matchingEnemies.forEach((enemy) => {
                enemy.currentStep += 1;
                enemy.hitFlashMs = 220;
                enemy.knockbackMs = 180;
                if (state.fingerStats[fingerId]) {
                    state.fingerStats[fingerId].hits += 1;
                }
            });

            const defeatedIds = new Set();
            matchingEnemies.forEach((enemy) => {
                if (enemy.currentStep >= enemy.sequence.length) {
                    defeatedIds.add(enemy.id);
                    defeatEnemy(enemy, nowMs);
                }
            });

            if (defeatedIds.size) {
                state.activeEnemies = state.activeEnemies.filter((enemy) => !defeatedIds.has(enemy.id));
            } else {
                state.praiseText = 'GOOD';
                state.statusText = 'Sequence advanced. Release, then prepare the next pinch.';
                setTransient('Hit', nowMs, 650);
            }
        }

        function updateEnemyPositions(deltaSeconds) {
            const remainingEnemies = [];
            state.activeEnemies.forEach((enemy) => {
                const travelRange = config.enemyStartX - config.playerX;
                const speed = travelRange / (enemy.travelTimeMs / 1000);
                enemy.x -= speed * deltaSeconds;
                enemy.hitFlashMs = Math.max(0, enemy.hitFlashMs - deltaSeconds * 1000);
                enemy.knockbackMs = Math.max(0, enemy.knockbackMs - deltaSeconds * 1000);

                if (enemy.x <= config.playerX) {
                    state.hp = Math.max(0, state.hp - 1);
                    state.statusText = `${enemy.label} reached the wizard. Recenter and continue.`;
                    state.praiseText = 'BLOCKED';
                    breakCombo();
                } else {
                    remainingEnemies.push(enemy);
                }
            });
            state.activeEnemies = remainingEnemies;
        }

        function updateSampling(nowMs, trackingOk) {
            if (nowMs < state.sampleAtMs) {
                return;
            }
            const sampleBucket = state.attemptLog.filter((entry) => nowMs - entry.at <= config.rollingAccuracyWindowMs);
            const rollingAccuracy = sampleBucket.length
                ? Math.round((sampleBucket.filter((entry) => entry.success).length / sampleBucket.length) * 100)
                : state.currentAccuracyPercent;

            state.bestRollingAccuracy = Math.max(state.bestRollingAccuracy, rollingAccuracy);
            state.accuracyTrend.push(state.currentAccuracyPercent);
            state.stabilityTrend.push(trackingOk && !state.paused ? 100 : 25);
            state.sampleAtMs += config.sampleIntervalMs;
        }

        function updateFocus() {
            if (!state.activeEnemies.length) {
                state.currentFocusFinger = config.fingerOrder[(state.completedWaves + state.currentWaveIndex) % config.fingerOrder.length];
                return;
            }

            const nextTarget = state.activeEnemies
                .slice()
                .sort((left, right) => left.x - right.x)[0];
            state.currentFocusFinger = nextTarget.sequence[nextTarget.currentStep];
        }

        function updateStatus(nowMs, detectorOutput) {
            if (state.transientUntilMs && nowMs > state.transientUntilMs) {
                state.transientText = '';
                state.transientUntilMs = 0;
            }

            if (!detectorOutput.trackingOk) {
                state.statusText = 'Hand not detected. Return to resume.';
            } else if (state.activeEnemies.length) {
                const focusLabel = config.fingers[state.currentFocusFinger].label;
                state.cueTitle = `Target ${focusLabel.toLowerCase()} pinch first.`;
                state.cueText = `Enemies on screen react together when their next symbol matches your pinch.`;
            } else if (state.waveActive) {
                state.cueTitle = 'Prepare for the next enemy.';
                state.cueText = 'Stay relaxed and keep the fingertips visible.';
            } else if (state.currentWaveIndex >= config.waves.length) {
                state.cueTitle = 'Final checks complete.';
                state.cueText = 'Hold steady while the summary prepares.';
            } else {
                state.cueTitle = `Incoming ${state.currentWaveLabel}.`;
                state.cueText = 'Watch the lane and match the symbol color and shape.';
            }
        }

        function markFinished(completed, reason) {
            state.finished = true;
            state.completed = completed;
            state.finishRequested = true;
            state.finishReason = reason;
            state.waveActive = false;
            state.activeEnemies = [];
        }

        function update(frame) {
            if (!state.started || state.finished) {
                return getSnapshot();
            }
            if (state.paused) {
                return getSnapshot();
            }

            const nowMs = Math.max(0, state.elapsedMs + ((frame.deltaSeconds || 0) * 1000));
            state.elapsedMs = nowMs;
            state.handedness = frame.handedness || state.handedness;

            const detectorOutput = detector.update(frame);
            state.detectorStates = detectorOutput.states;
            state.lastTrackingOk = detectorOutput.trackingOk;
            state.activeFinger = detectorOutput.activeFinger;

            detectorOutput.events.forEach((event) => {
                if (event.type === 'pinch_confirmed') {
                    applyPinch(event.finger, nowMs);
                } else if (event.type === 'release_confirmed') {
                    state.pendingRelease = false;
                    state.confirmedFinger = null;
                    state.activeFinger = null;
                } else if (event.type === 'tracking_lost') {
                    state.statusText = 'Tracking drifting. Hold position or pause will trigger.';
                } else if (event.type === 'tracking_restored') {
                    state.statusText = 'Tracking restored.';
                }
            });

            ensureWaveStarted(nowMs);
            spawnEnemies(nowMs);
            updateEnemyPositions(frame.deltaSeconds || 0);
            updateFocus();
            updateSampling(nowMs, detectorOutput.trackingOk);
            updateStatus(nowMs, detectorOutput);

            if (state.hp <= 0) {
                markFinished(false, 'hp');
            } else if (state.currentWaveIndex >= config.waves.length && !state.waveActive && !state.activeEnemies.length) {
                markFinished(true, 'waves');
            } else if (state.elapsedMs >= state.sessionDurationMs) {
                markFinished(false, 'time');
            }

            return getSnapshot();
        }

        function pause() {
            if (state.finished) {
                return getSnapshot();
            }
            state.paused = true;
            state.trackingInterruptions += 1;
            state.statusText = 'Tracking paused. Return your hand and resume.';
            return getSnapshot();
        }

        function resume() {
            state.paused = false;
            state.statusText = 'Tracking restored. Continue the defense.';
            return getSnapshot();
        }

        function finalizeSummary(forceCompleted) {
            const strongestFingerId = pickFingerByMetric(state.fingerStats, 'hits', state.currentFocusFinger);
            const weakestFingerId = pickWeakestFinger(state.fingerStats, state.currentFocusFinger);
            const frequentMissedInputId = pickFingerByMetric(state.fingerStats, 'misses', weakestFingerId);
            const badge = forceCompleted
                ? 'Arcane Shield'
                : (state.hp > 0 ? 'Steady Recovery' : 'Needs Support');
            const notes = forceCompleted
                ? 'Session cleared with fatigue-friendly pinch assist enabled.'
                : 'Pinch assistance stayed active. Keep the camera framing wide and focus on the next required finger.';

            return {
                modeScore: state.score,
                badge,
                notes,
                enemiesDefeated: state.enemiesDefeated,
                highestCombo: state.highestCombo,
                strongestFinger: config.fingers[strongestFingerId].label,
                weakestFinger: config.fingers[weakestFingerId].label,
                frequentMissedInput: config.fingers[frequentMissedInputId].label,
                trackingInterruptions: state.trackingInterruptions,
                completedWaves: state.completedWaves,
                completionPercent: Math.round((state.enemiesDefeated / Math.max(1, state.totalEnemies)) * 100),
                averageAccuracy: state.confirmedAttempts
                    ? Math.round((state.correctAttempts / state.confirmedAttempts) * 100)
                    : 0,
                bestAccuracy: state.bestRollingAccuracy,
                accuracyTrend: state.accuracyTrend.slice(),
                stabilityTrend: state.stabilityTrend.slice(),
            };
        }

        function finish(payload) {
            if (!state.started) {
                return getSnapshot();
            }
            state.finished = true;
            state.completed = Boolean(payload && payload.completed) || state.completed;
            state.finishRequested = false;
            state.summary = finalizeSummary(state.completed);
            return getSnapshot();
        }

        function getViewState() {
            const hearts = Array.from({ length: config.playerMaxHp }, (_, index) => index < state.hp);
            const frontEnemy = state.activeEnemies.length
                ? state.activeEnemies.slice().sort((left, right) => left.x - right.x)[0]
                : null;
            return {
                progressPercent: Math.round((state.enemiesDefeated / Math.max(1, state.totalEnemies)) * 100),
                score: state.score,
                combo: state.combo,
                highestCombo: state.highestCombo,
                hp: state.hp,
                hearts,
                waveLabel: state.currentWaveLabel,
                currentWave: Math.min(state.currentWaveIndex + 1, config.waves.length),
                totalWaves: config.waves.length,
                remainingMs: Math.max(0, state.sessionDurationMs - state.elapsedMs),
                praiseText: state.praiseText,
                cueTitle: state.cueTitle,
                cueText: state.cueText,
                trackingText: state.lastTrackingOk ? 'Hand tracking stable' : 'Tracking lost',
                activeTargetFinger: state.currentFocusFinger,
                activeFinger: state.activeFinger,
                confirmedFinger: state.confirmedFinger,
                handedness: state.handedness,
                enemies: state.activeEnemies.map((enemy) => ({
                    id: enemy.id,
                    type: enemy.type,
                    assetId: enemy.assetId,
                    label: enemy.label,
                    x: enemy.x,
                    currentStep: enemy.currentStep,
                    sequence: enemy.sequence.slice(),
                    hitFlashMs: enemy.hitFlashMs,
                    knockbackMs: enemy.knockbackMs,
                })),
                detectorStates: state.detectorStates,
                trackingWarning: !state.lastTrackingOk,
                pendingRelease: state.pendingRelease,
                frontEnemyLabel: frontEnemy ? frontEnemy.label : '',
                frontEnemySequence: frontEnemy ? frontEnemy.sequence.slice(frontEnemy.currentStep) : [],
                finishRequested: state.finishRequested,
                completed: state.completed,
                accuracyPercent: state.confirmedAttempts
                    ? Math.round((state.correctAttempts / state.confirmedAttempts) * 100)
                    : 0,
                transientText: state.transientText,
            };
        }

        function getSnapshot() {
            const summary = state.summary || finalizeSummary(state.completed);
            return {
                hud: {
                    primaryLabel: 'Score',
                    primaryValue: String(state.score),
                    secondaryLabel: 'Combo',
                    secondaryValue: state.combo > 1 ? `x${state.combo}` : 'Ready',
                    statusText: `${state.currentWaveLabel} · ${state.praiseText}`,
                },
                summary,
                viewState: getViewState(),
            };
        }

        function start(payload) {
            resetForStart(payload);
            return getSnapshot();
        }

        return {
            start,
            update,
            pause,
            resume,
            finish,
            getSnapshot,
        };
    }

    globalObject.PinchDefenseEngine = {
        createSession,
    };
}(window));

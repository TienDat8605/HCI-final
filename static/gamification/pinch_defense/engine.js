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

    function standardDeviation(values) {
        if (!values.length) {
            return 0;
        }
        const mean = average(values);
        const variance = average(values.map((value) => (value - mean) ** 2));
        return Math.sqrt(variance);
    }

    function createEmptyFingerStats(config) {
        return config.fingerOrder.reduce((stats, fingerId) => {
            stats[fingerId] = { targets: 0, hits: 0, misses: 0 };
            return stats;
        }, {});
    }

    function createEmptyPerFingerQualityStats(config) {
        return config.fingerOrder.reduce((stats, fingerId) => {
            stats[fingerId] = {
                completionValues: [],
                reactionTimes: [],
                confirmDurations: [],
                holdStabilityValues: [],
                validAttemptCount: 0,
                assistedCount: 0,
                invalidAttemptCount: 0,
            };
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
            perFingerQualityStats: createEmptyPerFingerQualityStats(config),
            qualityAttempts: [],
            pendingAttempt: null,
            lastTargetChangeAt: 0,
            lastTrackedTargetFinger: null,
            lastTrackedTargetToken: null,
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
            playerHitFlashMs: 0,
            pendingRelease: false,
            detectorStates: {},
            handLandmarks: null,
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

        function startPendingAttempt(fingerId, nowMs) {
            if (!fingerId) {
                state.pendingAttempt = null;
                return;
            }
            state.pendingAttempt = {
                fingerId,
                attemptStartedAt: nowMs,
                movementOnsetAt: 0,
                confirmedAt: 0,
                bestCompletionRatio: 0,
                bestNormalizedGap: Number.POSITIVE_INFINITY,
                holdStability: 0,
                wasCorrect: false,
                wasAssisted: false,
                invalidatedByTracking: false,
            };
            state.lastTargetChangeAt = nowMs;
        }

        function syncPendingAttemptFromDetector(nowMs) {
            if (!state.pendingAttempt) {
                return;
            }
            const fingerState = state.detectorStates[state.pendingAttempt.fingerId];
            if (!fingerState) {
                return;
            }
            state.pendingAttempt.bestCompletionRatio = Math.max(
                state.pendingAttempt.bestCompletionRatio,
                Number.isFinite(fingerState.completionRatio) ? fingerState.completionRatio : 0
            );
            if (Number.isFinite(fingerState.normalizedGap)) {
                state.pendingAttempt.bestNormalizedGap = Math.min(
                    state.pendingAttempt.bestNormalizedGap,
                    fingerState.normalizedGap
                );
            }
        }

        function recordAttemptQuality(attempt) {
            if (!attempt) {
                return;
            }
            const reactionTimeMs = attempt.movementOnsetAt && attempt.attemptStartedAt
                ? Math.max(0, attempt.movementOnsetAt - attempt.attemptStartedAt)
                : 0;
            const confirmDurationMs = attempt.confirmedAt && attempt.movementOnsetAt
                ? Math.max(0, attempt.confirmedAt - attempt.movementOnsetAt)
                : 0;

            const normalizedAttempt = {
                ...attempt,
                bestCompletionRatio: Number.isFinite(attempt.bestCompletionRatio) ? attempt.bestCompletionRatio : 0,
                bestNormalizedGap: Number.isFinite(attempt.bestNormalizedGap) ? attempt.bestNormalizedGap : null,
                reactionTimeMs,
                confirmDurationMs,
                isValidQualityAttempt: Boolean(
                    attempt.wasCorrect &&
                    !attempt.invalidatedByTracking &&
                    attempt.movementOnsetAt &&
                    attempt.confirmedAt
                ),
            };

            state.qualityAttempts.push(normalizedAttempt);
            const fingerStats = state.perFingerQualityStats[attempt.fingerId];
            if (!fingerStats) {
                return;
            }

            if (attempt.invalidatedByTracking) {
                fingerStats.invalidAttemptCount += 1;
            }
            if (normalizedAttempt.wasAssisted) {
                fingerStats.assistedCount += 1;
            }
            if (!normalizedAttempt.isValidQualityAttempt) {
                return;
            }

            fingerStats.validAttemptCount += 1;
            fingerStats.completionValues.push(normalizedAttempt.bestCompletionRatio);
            fingerStats.reactionTimes.push(normalizedAttempt.reactionTimeMs);
            fingerStats.confirmDurations.push(normalizedAttempt.confirmDurationMs);
            fingerStats.holdStabilityValues.push(normalizedAttempt.holdStability);
        }

        function finalizePendingAttempt(overrides) {
            if (!state.pendingAttempt) {
                return;
            }
            const attempt = {
                ...state.pendingAttempt,
                ...overrides,
            };
            recordAttemptQuality(attempt);
            state.pendingAttempt = null;
        }

        function updateTargetAttemptWindow(nowMs) {
            const frontEnemy = (!state.pendingRelease && state.activeEnemies.length)
                ? state.activeEnemies.slice().sort((left, right) => left.x - right.x)[0]
                : null;
            const nextFinger = frontEnemy ? frontEnemy.sequence[frontEnemy.currentStep] : null;
            const nextToken = frontEnemy ? `${frontEnemy.id}:${frontEnemy.currentStep}` : null;
            if (state.lastTrackedTargetToken !== nextToken) {
                state.lastTrackedTargetToken = nextToken;
                state.lastTrackedTargetFinger = nextFinger;
                if (nextFinger && nextToken) {
                    startPendingAttempt(nextFinger, nowMs);
                } else if (state.pendingAttempt) {
                    finalizePendingAttempt({
                        confirmedAt: state.pendingAttempt.confirmedAt || nowMs,
                    });
                }
            }
        }

        function defeatEnemy(enemy, nowMs) {
            state.enemiesDefeated += 1;
            state.score += enemy.baseScore;
            awardCombo(nowMs);
            state.praiseText = getPraiseForCombo(state.combo);
            state.statusText = `${state.praiseText} - ${enemy.label} defeated.`;
            setTransient(`+${enemy.baseScore}`, nowMs, 700);
        }

        function applyPinch(event, nowMs) {
            const fingerId = event.finger;
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
                finalizePendingAttempt({
                    fingerId,
                    movementOnsetAt: event.movementOnsetAt || nowMs,
                    confirmedAt: nowMs,
                    bestCompletionRatio: event.bestCompletionRatio || event.completionRatio || 0,
                    bestNormalizedGap: Number.isFinite(event.bestNormalizedGap) ? event.bestNormalizedGap : event.normalizedGap,
                    holdStability: Number.isFinite(event.holdStability) ? event.holdStability : 0,
                    wasCorrect: false,
                    wasAssisted: Boolean(event.assisted),
                });
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

            finalizePendingAttempt({
                fingerId,
                movementOnsetAt: event.movementOnsetAt || nowMs,
                confirmedAt: nowMs,
                bestCompletionRatio: event.bestCompletionRatio || event.completionRatio || 0,
                bestNormalizedGap: Number.isFinite(event.bestNormalizedGap) ? event.bestNormalizedGap : event.normalizedGap,
                holdStability: Number.isFinite(event.holdStability) ? event.holdStability : 0,
                wasCorrect: true,
                wasAssisted: Boolean(event.assisted),
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
            state.playerHitFlashMs = Math.max(0, state.playerHitFlashMs - deltaSeconds * 1000);
            state.activeEnemies.forEach((enemy) => {
                const travelRange = config.enemyStartX - config.playerX;
                const speed = travelRange / (enemy.travelTimeMs / 1000);
                enemy.x -= speed * deltaSeconds;
                enemy.hitFlashMs = Math.max(0, enemy.hitFlashMs - deltaSeconds * 1000);
                enemy.knockbackMs = Math.max(0, enemy.knockbackMs - deltaSeconds * 1000);

                if (enemy.x <= config.playerX) {
                    state.hp = Math.max(0, state.hp - 1);
                    state.playerHitFlashMs = 320;
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
                state.cueText = 'Enemies on screen react together when their next symbol matches your pinch.';
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
            if (state.pendingAttempt) {
                finalizePendingAttempt({
                    confirmedAt: state.pendingAttempt.confirmedAt || state.elapsedMs,
                });
            }
        }

        function buildPerFingerQualitySummary() {
            const summary = {};
            config.fingerOrder.forEach((fingerId) => {
                const stats = state.perFingerQualityStats[fingerId];
                const enoughTrials = stats.validAttemptCount >= 3;
                const completionMean = average(stats.completionValues);
                const confirmDurationMean = average(stats.confirmDurations);
                const completionCV = completionMean > 0 ? (standardDeviation(stats.completionValues) / completionMean) : 0;
                const timingCV = confirmDurationMean > 0 ? (standardDeviation(stats.confirmDurations) / confirmDurationMean) : 0;
                summary[fingerId] = {
                    averageCompletion: Math.round(clamp(completionMean, 0, 1) * 100),
                    bestCompletion: Math.round(clamp(Math.max(0, ...stats.completionValues, 0), 0, 1.15) * 100),
                    averageReactionTimeMs: Math.round(average(stats.reactionTimes)),
                    repeatabilityScore: enoughTrials
                        ? Math.round(clamp(100 - (((completionCV * 55) + (timingCV * 45)) * 100), 0, 100))
                        : null,
                    validAttemptCount: stats.validAttemptCount,
                    holdStability: Math.round(average(stats.holdStabilityValues)),
                    assistedCount: stats.assistedCount,
                    insufficientTrials: !enoughTrials,
                };
            });
            return summary;
        }

        function getQualityExtremes(perFingerQuality) {
            const ranked = Object.entries(perFingerQuality)
                .filter(([, entry]) => entry.validAttemptCount > 0)
                .sort((left, right) => right[1].averageCompletion - left[1].averageCompletion);
            return {
                strongestCompletionFingerId: ranked[0]?.[0] || state.currentFocusFinger,
                weakestCompletionFingerId: ranked[ranked.length - 1]?.[0] || state.currentFocusFinger,
            };
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
            const validQualityAttempts = state.qualityAttempts.filter((attempt) => attempt.isValidQualityAttempt);
            const perFingerQuality = buildPerFingerQualitySummary();
            const repeatabilityCandidates = Object.values(perFingerQuality).filter((entry) => entry.repeatabilityScore !== null);
            const overallRepeatability = repeatabilityCandidates.length
                ? Math.round(
                    repeatabilityCandidates.reduce((sum, entry) => sum + (entry.repeatabilityScore * entry.validAttemptCount), 0) /
                    repeatabilityCandidates.reduce((sum, entry) => sum + entry.validAttemptCount, 0)
                )
                : null;
            const qualityExtremes = getQualityExtremes(perFingerQuality);

            return {
                modeScore: state.score,
                badge,
                notes,
                enemiesDefeated: state.enemiesDefeated,
                highestCombo: state.highestCombo,
                strongestFinger: config.fingers[strongestFingerId].label,
                weakestFinger: config.fingers[weakestFingerId].label,
                strongestCompletionFinger: config.fingers[qualityExtremes.strongestCompletionFingerId].label,
                weakestCompletionFinger: config.fingers[qualityExtremes.weakestCompletionFingerId].label,
                frequentMissedInput: config.fingers[frequentMissedInputId].label,
                trackingInterruptions: state.trackingInterruptions,
                completedWaves: state.completedWaves,
                completionPercent: Math.round((state.enemiesDefeated / Math.max(1, state.totalEnemies)) * 100),
                averageAccuracy: state.confirmedAttempts
                    ? Math.round((state.correctAttempts / state.confirmedAttempts) * 100)
                    : 0,
                bestAccuracy: state.bestRollingAccuracy,
                averageCompletion: validQualityAttempts.length
                    ? Math.round(average(validQualityAttempts.map((attempt) => clamp(attempt.bestCompletionRatio, 0, 1) * 100)))
                    : 0,
                bestCompletion: validQualityAttempts.length
                    ? Math.round(Math.max(...validQualityAttempts.map((attempt) => clamp(attempt.bestCompletionRatio, 0, 1.15) * 100)))
                    : 0,
                averageReactionTimeMs: validQualityAttempts.length
                    ? Math.round(average(validQualityAttempts.map((attempt) => attempt.reactionTimeMs)))
                    : 0,
                averageHoldStability: validQualityAttempts.length
                    ? Math.round(average(validQualityAttempts.map((attempt) => attempt.holdStability)))
                    : 0,
                repeatabilityScore: overallRepeatability,
                repeatabilityLabel: overallRepeatability === null ? 'Insufficient repeated trials' : `${overallRepeatability}%`,
                perFingerQuality,
                qualityAttempts: state.qualityAttempts.slice(),
                qualityAttemptCount: validQualityAttempts.length,
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
            if (state.pendingAttempt) {
                finalizePendingAttempt({
                    confirmedAt: state.pendingAttempt.confirmedAt || state.elapsedMs,
                });
            }
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
                playerHitFlashMs: state.playerHitFlashMs,
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
                handLandmarks: state.handLandmarks,
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
            state.handLandmarks = detectorOutput.landmarks || null;
            syncPendingAttemptFromDetector(nowMs);

            detectorOutput.events.forEach((event) => {
                if (event.type === 'pinch_confirmed') {
                    applyPinch(event, nowMs);
                } else if (event.type === 'release_confirmed') {
                    state.pendingRelease = false;
                    state.confirmedFinger = null;
                    state.activeFinger = null;
                } else if (event.type === 'tracking_lost') {
                    state.statusText = 'Tracking drifting. Hold position or pause will trigger.';
                    if (state.pendingAttempt) {
                        state.pendingAttempt.invalidatedByTracking = true;
                    }
                } else if (event.type === 'tracking_restored') {
                    state.statusText = 'Tracking restored.';
                }
            });

            ensureWaveStarted(nowMs);
            spawnEnemies(nowMs);
            updateEnemyPositions(frame.deltaSeconds || 0);
            updateFocus();
            updateTargetAttemptWindow(nowMs);
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
            if (state.pendingAttempt) {
                state.pendingAttempt.invalidatedByTracking = true;
            }
            state.statusText = 'Tracking paused. Return your hand and resume.';
            return getSnapshot();
        }

        function resume() {
            state.paused = false;
            state.statusText = 'Tracking restored. Continue the defense.';
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

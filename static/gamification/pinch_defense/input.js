(function initPinchDefenseInput(globalObject) {
    'use strict';

    const THUMB_MCP_INDEX = 2;
    const THUMB_IP_INDEX = 3;
    const THUMB_TIP_INDEX = 4;
    const MOVEMENT_ONSET_DELTA = 0.08;
    const MOVEMENT_ONSET_CONFIRM_FRAMES = 2;

    function clamp(value, min, max) {
        return Math.max(min, Math.min(max, value));
    }

    function distance3(a, b) {
        return Math.sqrt(
            ((a.x || 0) - (b.x || 0)) ** 2 +
            ((a.y || 0) - (b.y || 0)) ** 2 +
            ((a.z || 0) - (b.z || 0)) ** 2
        );
    }

    function subtract3(a, b) {
        return {
            x: (a.x || 0) - (b.x || 0),
            y: (a.y || 0) - (b.y || 0),
            z: (a.z || 0) - (b.z || 0),
        };
    }

    function add3(a, b) {
        return {
            x: (a.x || 0) + (b.x || 0),
            y: (a.y || 0) + (b.y || 0),
            z: (a.z || 0) + (b.z || 0),
        };
    }

    function scale3(vector, scalar) {
        return {
            x: (vector.x || 0) * scalar,
            y: (vector.y || 0) * scalar,
            z: (vector.z || 0) * scalar,
        };
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

    function getFingerChain(fingerConfig) {
        return {
            pipIndex: fingerConfig.tipIndex - 2,
            dipIndex: fingerConfig.tipIndex - 1,
            tipIndex: fingerConfig.tipIndex,
        };
    }

    function createFingerState(config, fingerId) {
        const fingerConfig = config.fingers[fingerId];
        return {
            fingerId,
            label: fingerConfig.label,
            normalizedDistance: null,
            normalizedGap: null,
            completionRatio: 0,
            padCenter: null,
            padRadius: 0,
            state: 'idle',
            heldMs: 0,
            releaseHeldMs: 0,
            assisted: false,
            lastConfirmedAt: 0,
        };
    }

    function createPinchDetector(config) {
        const fingerIds = config.fingerOrder.slice();
        const perFinger = {};
        fingerIds.forEach((fingerId) => {
            perFinger[fingerId] = createFingerState(config, fingerId);
        });

        const runtime = {
            trackingOk: false,
            waitingForRelease: false,
            waitingSince: 0,
            candidateFinger: null,
            candidateSince: 0,
            candidateAssisted: false,
            candidateBaselineCompletion: 0,
            candidateMovementFrames: 0,
            candidateMovementOnsetAt: 0,
            candidateBestCompletionRatio: 0,
            candidateBestNormalizedGap: Number.POSITIVE_INFINITY,
            candidateSamples: [],
            lastConfirmAt: 0,
            allClearSince: 0,
            lastTrackingEvent: null,
        };

        function resetCandidate() {
            runtime.candidateFinger = null;
            runtime.candidateSince = 0;
            runtime.candidateAssisted = false;
            runtime.candidateBaselineCompletion = 0;
            runtime.candidateMovementFrames = 0;
            runtime.candidateMovementOnsetAt = 0;
            runtime.candidateBestCompletionRatio = 0;
            runtime.candidateBestNormalizedGap = Number.POSITIVE_INFINITY;
            runtime.candidateSamples = [];
        }

        function getPalmScale(landmarks) {
            const wrist = landmarks[0];
            return average([
                distance3(wrist, landmarks[5]),
                distance3(wrist, landmarks[9]),
                distance3(wrist, landmarks[17]),
            ]);
        }

        function resetFingerStates() {
            fingerIds.forEach((fingerId) => {
                const fingerState = perFinger[fingerId];
                fingerState.state = 'idle';
                fingerState.heldMs = 0;
                fingerState.releaseHeldMs = 0;
                fingerState.assisted = false;
                fingerState.normalizedDistance = null;
                fingerState.normalizedGap = null;
                fingerState.completionRatio = 0;
                fingerState.padCenter = null;
                fingerState.padRadius = 0;
            });
            resetCandidate();
            runtime.allClearSince = 0;
        }

        function computeThumbPad(landmarks) {
            const tip = landmarks[THUMB_TIP_INDEX];
            const ip = landmarks[THUMB_IP_INDEX];
            const distalVector = subtract3(tip, ip);
            const distalLength = distance3(tip, ip);
            return {
                distalLength,
                padCenter: add3(tip, scale3(distalVector, 0.35)),
                padRadius: distalLength * 0.42,
            };
        }

        function emitTrackingEvents(now, trackingOk, events) {
            if (trackingOk && !runtime.trackingOk) {
                events.push({ type: 'tracking_restored', at: now });
            }
            if (!trackingOk && runtime.trackingOk) {
                events.push({ type: 'tracking_lost', at: now });
            }
            runtime.trackingOk = trackingOk;
        }

        function update(frame) {
            const now = Number.isFinite(frame.now) ? frame.now : performance.now();
            const events = [];
            const trackingOk = Boolean(
                frame.trackingOk &&
                frame.landmarks &&
                frame.landmarks.length === 21
            );
            emitTrackingEvents(now, trackingOk, events);

            if (!trackingOk) {
                resetFingerStates();
                return {
                    trackingOk: false,
                    activeFinger: null,
                    states: perFinger,
                    landmarks: null,
                    events,
                };
            }

            const palmScale = getPalmScale(frame.landmarks);
            if (!Number.isFinite(palmScale) || palmScale <= 0.0001) {
                resetFingerStates();
                return {
                    trackingOk: false,
                    activeFinger: null,
                    states: perFinger,
                    landmarks: null,
                    events,
                };
            }

            const thumbTip = frame.landmarks[THUMB_TIP_INDEX];
            const thumbPad = computeThumbPad(frame.landmarks);
            const candidates = [];
            let allClear = true;

            fingerIds.forEach((fingerId) => {
                const fingerConfig = config.fingers[fingerId];
                const fingerState = perFinger[fingerId];
                const fingerChain = getFingerChain(fingerConfig);
                const fingerTip = frame.landmarks[fingerChain.tipIndex];
                const fingerDip = frame.landmarks[fingerChain.dipIndex];
                const distalVector = subtract3(fingerTip, fingerDip);
                const distalLength = distance3(fingerTip, fingerDip);
                const fingerPadCenter = add3(fingerTip, scale3(distalVector, 0.5));
                const fingerPadRadius = distalLength * 0.38;
                const rawGap = Math.max(0, distance3(thumbPad.padCenter, fingerPadCenter) - (thumbPad.padRadius + fingerPadRadius));
                const normalizedGap = rawGap / palmScale;
                const normalizedDistance = distance3(thumbTip, fingerTip) / palmScale;
                const completionRatio = clamp(1 - (normalizedGap / fingerConfig.pinchThreshold), 0, 1.15);
                const relaxedThreshold = fingerConfig.pinchThreshold + config.pinch.relaxedBuffer;
                const releaseThreshold = fingerConfig.pinchThreshold + config.pinch.releaseBuffer;
                const approachThreshold = fingerConfig.pinchThreshold + config.pinch.approachBuffer;

                fingerState.normalizedDistance = normalizedDistance;
                fingerState.normalizedGap = normalizedGap;
                fingerState.completionRatio = completionRatio;
                fingerState.padCenter = fingerPadCenter;
                fingerState.padRadius = fingerPadRadius;
                fingerState.assisted = false;
                fingerState.releaseHeldMs = normalizedGap > releaseThreshold
                    ? (runtime.allClearSince ? now - runtime.allClearSince : 0)
                    : 0;

                if (normalizedGap > releaseThreshold) {
                    fingerState.state = normalizedGap <= approachThreshold ? 'approaching' : 'released';
                } else if (normalizedGap <= fingerConfig.pinchThreshold) {
                    fingerState.state = 'pinched';
                } else if (normalizedGap <= relaxedThreshold) {
                    fingerState.state = 'approaching';
                    fingerState.assisted = true;
                } else if (normalizedGap <= approachThreshold) {
                    fingerState.state = 'approaching';
                } else {
                    fingerState.state = 'idle';
                }

                if (normalizedGap <= relaxedThreshold) {
                    candidates.push({
                        fingerId,
                        normalizedDistance,
                        normalizedGap,
                        completionRatio,
                        strict: normalizedGap <= fingerConfig.pinchThreshold,
                    });
                }

                if (normalizedGap <= releaseThreshold) {
                    allClear = false;
                }
            });

            if (allClear) {
                runtime.allClearSince = runtime.allClearSince || now;
            } else {
                runtime.allClearSince = 0;
            }

            if (runtime.waitingForRelease) {
                if (
                    (runtime.allClearSince && now - runtime.allClearSince >= config.pinch.releaseHoldMs) ||
                    (runtime.waitingSince && now - runtime.waitingSince >= config.pinch.forceReleaseMs)
                ) {
                    runtime.waitingForRelease = false;
                    runtime.waitingSince = 0;
                    events.push({ type: 'release_confirmed', at: now });
                }

                fingerIds.forEach((fingerId) => {
                    const fingerState = perFinger[fingerId];
                    if (fingerState.state === 'pinched') {
                        fingerState.state = 'confirmed';
                    }
                    fingerState.heldMs = 0;
                });

                return {
                    trackingOk: true,
                    activeFinger: null,
                    states: perFinger,
                    landmarks: frame.landmarks,
                    events,
                };
            }

            candidates.sort((a, b) => a.normalizedGap - b.normalizedGap);
            const bestCandidate = candidates[0] || null;
            const runnerUp = candidates[1] || null;
            const isAmbiguous = Boolean(
                bestCandidate &&
                runnerUp &&
                runnerUp.normalizedGap - bestCandidate.normalizedGap < config.pinch.ambiguityMargin
            );

            if (!bestCandidate || isAmbiguous || now - runtime.lastConfirmAt < config.pinch.interConfirmGapMs) {
                resetCandidate();
                fingerIds.forEach((fingerId) => {
                    perFinger[fingerId].heldMs = 0;
                });
                return {
                    trackingOk: true,
                    activeFinger: null,
                    states: perFinger,
                    landmarks: frame.landmarks,
                    events,
                };
            }

            const bestConfig = config.fingers[bestCandidate.fingerId];
            const relaxedThreshold = bestConfig.pinchThreshold + config.pinch.relaxedBuffer;
            const assistedCandidate = bestCandidate.normalizedGap > bestConfig.pinchThreshold &&
                bestCandidate.normalizedGap <= relaxedThreshold;

            if (runtime.candidateFinger !== bestCandidate.fingerId) {
                runtime.candidateFinger = bestCandidate.fingerId;
                runtime.candidateSince = now;
                runtime.candidateAssisted = assistedCandidate;
                runtime.candidateBaselineCompletion = perFinger[bestCandidate.fingerId].completionRatio;
                runtime.candidateMovementFrames = 0;
                runtime.candidateMovementOnsetAt = 0;
                runtime.candidateBestCompletionRatio = perFinger[bestCandidate.fingerId].completionRatio;
                runtime.candidateBestNormalizedGap = perFinger[bestCandidate.fingerId].normalizedGap;
                runtime.candidateSamples = [];
            } else if (assistedCandidate) {
                runtime.candidateAssisted = true;
            }

            const heldMs = now - runtime.candidateSince;
            const activeFingerState = perFinger[bestCandidate.fingerId];
            runtime.candidateBestCompletionRatio = Math.max(
                runtime.candidateBestCompletionRatio,
                activeFingerState.completionRatio
            );
            runtime.candidateBestNormalizedGap = Math.min(
                runtime.candidateBestNormalizedGap,
                activeFingerState.normalizedGap
            );
            runtime.candidateSamples.push({
                at: now,
                normalizedGap: activeFingerState.normalizedGap,
            });
            if (runtime.candidateSamples.length > 24) {
                runtime.candidateSamples.shift();
            }

            const completionGain = activeFingerState.completionRatio - runtime.candidateBaselineCompletion;
            if (completionGain >= MOVEMENT_ONSET_DELTA) {
                runtime.candidateMovementFrames += 1;
                if (!runtime.candidateMovementOnsetAt && runtime.candidateMovementFrames >= MOVEMENT_ONSET_CONFIRM_FRAMES) {
                    runtime.candidateMovementOnsetAt = now;
                }
            } else {
                runtime.candidateMovementFrames = 0;
            }

            fingerIds.forEach((fingerId) => {
                perFinger[fingerId].heldMs = fingerId === bestCandidate.fingerId ? heldMs : 0;
            });

            const confirmHoldMs = runtime.candidateAssisted ? config.pinch.relaxedHoldMs : config.pinch.confirmHoldMs;
            if (heldMs >= confirmHoldMs) {
                const holdWindow = runtime.candidateSamples
                    .filter((sample) => now - sample.at <= confirmHoldMs)
                    .map((sample) => sample.normalizedGap);
                const holdStability = clamp(
                    100 - ((standardDeviation(holdWindow) / Math.max(bestConfig.pinchThreshold, 0.0001)) * 100),
                    0,
                    100
                );
                activeFingerState.state = 'confirmed';
                activeFingerState.assisted = runtime.candidateAssisted;
                activeFingerState.lastConfirmedAt = now;
                runtime.lastConfirmAt = now;
                runtime.waitingForRelease = true;
                runtime.waitingSince = now;
                events.push({
                    type: 'pinch_confirmed',
                    finger: bestCandidate.fingerId,
                    assisted: runtime.candidateAssisted,
                    normalizedDistance: bestCandidate.normalizedDistance,
                    normalizedGap: bestCandidate.normalizedGap,
                    completionRatio: activeFingerState.completionRatio,
                    bestCompletionRatio: runtime.candidateBestCompletionRatio,
                    bestNormalizedGap: runtime.candidateBestNormalizedGap,
                    movementOnsetAt: runtime.candidateMovementOnsetAt || now,
                    holdStability,
                    at: now,
                });
                resetCandidate();
            }

            return {
                trackingOk: true,
                activeFinger: bestCandidate.fingerId,
                states: perFinger,
                landmarks: frame.landmarks,
                events,
            };
        }

        function reset() {
            runtime.trackingOk = false;
            runtime.waitingForRelease = false;
            runtime.waitingSince = 0;
            runtime.lastConfirmAt = 0;
            runtime.allClearSince = 0;
            resetFingerStates();
        }

        return {
            update,
            reset,
        };
    }

    globalObject.PinchDefenseInput = {
        createPinchDetector,
    };
}(window));

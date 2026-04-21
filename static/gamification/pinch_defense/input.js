(function initPinchDefenseInput(globalObject) {
    'use strict';

    function distance3(a, b) {
        return Math.sqrt(
            ((a.x || 0) - (b.x || 0)) ** 2 +
            ((a.y || 0) - (b.y || 0)) ** 2 +
            ((a.z || 0) - (b.z || 0)) ** 2
        );
    }

    function average(values) {
        if (!values.length) {
            return 0;
        }
        return values.reduce((sum, value) => sum + value, 0) / values.length;
    }

    function createFingerState(config, fingerId) {
        const fingerConfig = config.fingers[fingerId];
        return {
            fingerId,
            label: fingerConfig.label,
            normalizedDistance: null,
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
            lastConfirmAt: 0,
            allClearSince: 0,
            lastTrackingEvent: null,
        };

        function resetCandidate() {
            runtime.candidateFinger = null;
            runtime.candidateSince = 0;
            runtime.candidateAssisted = false;
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
            });
            resetCandidate();
            runtime.allClearSince = 0;
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

            const thumbTip = frame.landmarks[4];
            const candidates = [];
            let allClear = true;

            fingerIds.forEach((fingerId) => {
                const fingerConfig = config.fingers[fingerId];
                const fingerState = perFinger[fingerId];
                const normalizedDistance = distance3(thumbTip, frame.landmarks[fingerConfig.tipIndex]) / palmScale;
                const relaxedThreshold = fingerConfig.pinchThreshold + config.pinch.relaxedBuffer;
                const releaseThreshold = fingerConfig.pinchThreshold + config.pinch.releaseBuffer;
                const approachThreshold = fingerConfig.pinchThreshold + config.pinch.approachBuffer;

                fingerState.normalizedDistance = normalizedDistance;
                fingerState.assisted = false;
                fingerState.releaseHeldMs = normalizedDistance > releaseThreshold
                    ? (runtime.allClearSince ? now - runtime.allClearSince : 0)
                    : 0;

                if (normalizedDistance > releaseThreshold) {
                    fingerState.state = normalizedDistance <= approachThreshold ? 'approaching' : 'released';
                } else if (normalizedDistance <= fingerConfig.pinchThreshold) {
                    fingerState.state = 'pinched';
                } else if (normalizedDistance <= relaxedThreshold) {
                    fingerState.state = 'approaching';
                    fingerState.assisted = true;
                } else if (normalizedDistance <= approachThreshold) {
                    fingerState.state = 'approaching';
                } else {
                    fingerState.state = 'idle';
                }

                if (normalizedDistance <= relaxedThreshold) {
                    candidates.push({
                        fingerId,
                        normalizedDistance,
                        strict: normalizedDistance <= fingerConfig.pinchThreshold,
                    });
                }

                if (normalizedDistance <= releaseThreshold) {
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

            candidates.sort((a, b) => a.normalizedDistance - b.normalizedDistance);
            const bestCandidate = candidates[0] || null;
            const runnerUp = candidates[1] || null;
            const isAmbiguous = Boolean(
                bestCandidate &&
                runnerUp &&
                runnerUp.normalizedDistance - bestCandidate.normalizedDistance < config.pinch.ambiguityMargin
            );

            if (!bestCandidate || isAmbiguous || now - runtime.lastConfirmAt < config.pinch.interConfirmGapMs) {
                resetCandidate();
                fingerIds.forEach((fingerId) => {
                    perFinger[fingerId].heldMs = 0;
                });
                return {
                    trackingOk: true,
                    activeFinger: isAmbiguous ? null : null,
                    states: perFinger,
                    landmarks: frame.landmarks,
                    events,
                };
            }

            const bestConfig = config.fingers[bestCandidate.fingerId];
            const relaxedThreshold = bestConfig.pinchThreshold + config.pinch.relaxedBuffer;
            const assistedCandidate = bestCandidate.normalizedDistance > bestConfig.pinchThreshold &&
                bestCandidate.normalizedDistance <= relaxedThreshold;

            if (runtime.candidateFinger !== bestCandidate.fingerId) {
                runtime.candidateFinger = bestCandidate.fingerId;
                runtime.candidateSince = now;
                runtime.candidateAssisted = assistedCandidate;
            } else if (assistedCandidate) {
                runtime.candidateAssisted = true;
            }

            const heldMs = now - runtime.candidateSince;
            fingerIds.forEach((fingerId) => {
                perFinger[fingerId].heldMs = fingerId === bestCandidate.fingerId ? heldMs : 0;
            });

            const confirmHoldMs = runtime.candidateAssisted ? config.pinch.relaxedHoldMs : config.pinch.confirmHoldMs;
            if (heldMs >= confirmHoldMs) {
                const fingerState = perFinger[bestCandidate.fingerId];
                fingerState.state = 'confirmed';
                fingerState.assisted = runtime.candidateAssisted;
                fingerState.lastConfirmedAt = now;
                runtime.lastConfirmAt = now;
                runtime.waitingForRelease = true;
                runtime.waitingSince = now;
                events.push({
                    type: 'pinch_confirmed',
                    finger: bestCandidate.fingerId,
                    assisted: runtime.candidateAssisted,
                    normalizedDistance: bestCandidate.normalizedDistance,
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

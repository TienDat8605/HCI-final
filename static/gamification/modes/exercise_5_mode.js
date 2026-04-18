(function registerExercise5Mode(globalObject) {
    'use strict';

    const modeRegistry = globalObject.BlueprintGamificationModes || (globalObject.BlueprintGamificationModes = {});

    const ORDER_QUEUE = [
        { id: 'order_orange_250', icon: '🍊', targetMl: 250 },
        { id: 'order_citrus_500', icon: '🍋', targetMl: 500 },
    ];
    const SQUEEZE_THRESHOLD = 0.4;
    const RESULT_POPUP_MS = 1400;
    const ROUND_COMPLETE_POPUP_MS = 1700;
    const DUMMY_LEADERBOARD = [
        { name: 'Mina', score: 980 },
        { name: 'Duy', score: 910 },
        { name: 'An', score: 845 },
        { name: 'Linh', score: 790 },
    ];

    function clamp(value, min, max) {
        return Math.max(min, Math.min(max, value));
    }

    function distance3(a, b) {
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const dz = (a.z || 0) - (b.z || 0);
        return Math.sqrt(dx * dx + dy * dy + dz * dz);
    }

    function getSqueezeIntensity(landmarks) {
        if (!Array.isArray(landmarks) || landmarks.length !== 21) {
            return 0;
        }

        const wrist = landmarks[0];
        const middleMcp = landmarks[9];
        const tips = [landmarks[8], landmarks[12], landmarks[16], landmarks[20]];

        const handScale = distance3(wrist, middleMcp) || 1;
        const avgTipDistance = tips.reduce((sum, point) => sum + distance3(point, wrist), 0) / tips.length;
        const normalizedTipDistance = avgTipDistance / handScale;

        // Open hand is usually higher; closed fist lower.
        return clamp((1.95 - normalizedTipDistance) / 0.95, 0, 1);
    }

    function getZone(progress) {
        if (progress >= 0.35 && progress <= 0.65) {
            return { key: 'excellent', label: 'Excellent', color: 'orange' };
        }
        if ((progress >= 0.2 && progress < 0.35) || (progress > 0.65 && progress <= 0.8)) {
            return { key: 'good', label: 'Good', color: 'yellow' };
        }
        return { key: 'bad', label: 'Bad', color: 'grey' };
    }

    function createOrderQueue() {
        return ORDER_QUEUE.map((order, index) => ({
            ...order,
            progress: 0,
            status: index === 0 ? 'active' : 'queue',
            zoneKey: 'bad',
            zoneLabel: index === 0 ? 'Active' : 'Wait',
        }));
    }

    function resetCurrentOrder(state) {
        const activeOrder = state.gameData.orders[state.gameData.activeOrderIndex] || ORDER_QUEUE[0];
        state.gameData.markerProgress = 0;
        state.gameData.squeezeIntensity = 0;
        state.gameData.isSqueezing = false;
        state.gameData.cupMl = 0;
        state.gameData.targetMl = activeOrder.targetMl;
        state.gameData.zoneKey = 'bad';
        state.gameData.zoneLabel = 'Bad';
        state.gameData.wasSqueezing = false;
        state.gameData.orderResolved = false;
        state.gameData.pendingAdvanceAt = 0;
    }

    function getResultCopy(zoneKey) {
        if (zoneKey === 'excellent') {
            return {
                title: 'Great! Excellent juice',
                detail: 'Perfect squeeze timing.',
                score: 120,
            };
        }
        if (zoneKey === 'good') {
            return {
                title: 'Good juice',
                detail: 'Nice control. Try center for excellent.',
                score: 75,
            };
        }
        return {
            title: 'Bad juice',
            detail: 'Release timing was off. Try again.',
            score: 30,
        };
    }

    function buildLeaderboard(score) {
        const entries = [...DUMMY_LEADERBOARD, { name: 'You', score: Math.round(score), isPlayer: true }];
        entries.sort((a, b) => b.score - a.score);
        return entries.map((entry, index) => ({
            rank: index + 1,
            name: entry.name,
            score: entry.score,
            isPlayer: Boolean(entry.isPlayer),
        }));
    }

    function completeCurrentOrder(state, now) {
        const zone = getZone(state.gameData.markerProgress);
        const activeOrder = state.gameData.orders[state.gameData.activeOrderIndex];
        const resultCopy = getResultCopy(zone.key);
        const isFinalOrder = state.gameData.activeOrderIndex >= state.gameData.orders.length - 1;

        state.gameData.counts[zone.key] += 1;
        state.score += resultCopy.score;

        if (activeOrder) {
            activeOrder.progress = 1;
            activeOrder.status = 'done';
            activeOrder.zoneKey = zone.key;
            activeOrder.zoneLabel = zone.label;
        }

        state.gameData.zoneKey = zone.key;
        state.gameData.zoneLabel = zone.label;
        state.gameData.orderResolved = true;
        state.gameData.pendingAdvanceAt = now + (isFinalOrder ? ROUND_COMPLETE_POPUP_MS : RESULT_POPUP_MS);
        state.gameData.pendingAction = isFinalOrder ? 'show_leaderboard' : 'next_order';
        state.gameData.resultPopup = {
            visible: true,
            zoneKey: zone.key,
            title: isFinalOrder ? 'Congrats! All orders finished' : resultCopy.title,
            detail: isFinalOrder
                ? `Total score ${Math.round(state.score)}`
                : resultCopy.detail,
        };

        state.hud.primaryValue = String(Math.round(state.score));
        state.hud.secondaryValue = zone.label;
        state.hud.statusText = isFinalOrder
            ? 'Orders completed. Preparing leaderboard...'
            : `${zone.label} squeeze. Next order loading...`;
        state.summary.modeScore = Math.round(state.score);
    }

    function advanceOrder(state) {
        const orderCount = state.gameData.orders.length;
        if (!orderCount) return;
        const previousIndex = state.gameData.activeOrderIndex;
        const nextIndex = previousIndex + 1;
        const completedRound = nextIndex >= orderCount;

        if (completedRound) {
            state.gameData.orders = createOrderQueue();
            state.gameData.activeOrderIndex = 0;
        } else {
            state.gameData.activeOrderIndex = nextIndex;
            const nextOrder = state.gameData.orders[nextIndex];
            if (nextOrder) {
                nextOrder.status = 'active';
                nextOrder.zoneLabel = 'Active';
                nextOrder.progress = 0;
            }
        }

        state.gameData.resultPopup.visible = false;
        resetCurrentOrder(state);
        state.hud.secondaryValue = 'In progress';
        state.hud.statusText = completedRound
            ? 'Queue restarted. Order 1 ready.'
            : `Order ${state.gameData.activeOrderIndex + 1} ready. Start squeezing.`;
    }

    function showLeaderboard(state) {
        state.gameData.resultPopup.visible = false;
        state.gameData.sessionComplete = true;
        state.gameData.pendingAction = null;
        state.gameData.leaderboard = buildLeaderboard(state.score);
        state.hud.secondaryValue = 'Leaderboard';
        state.hud.statusText = `Total score ${Math.round(state.score)}.`;
        state.summary.modeScore = Math.round(state.score);
        state.summary.badge = 'Orders Complete';
        state.summary.notes = `Excellent ${state.gameData.counts.excellent}, Good ${state.gameData.counts.good}, Bad ${state.gameData.counts.bad}.`;
    }

    modeRegistry.exercise_5_mode = {
        id: 'exercise_5_mode',
        title: 'Game Mode B',
        description: 'Generic scaffold for exercise 5 game mode.',
        createInitialState() {
            const orders = createOrderQueue();
            const gameData = {
                markerProgress: 0,
                squeezeIntensity: 0,
                isSqueezing: false,
                cupMl: 0,
                targetMl: orders[0].targetMl,
                zoneKey: 'bad',
                zoneLabel: 'Bad',
                orderProgress: 0,
                activeOrderIndex: 0,
                wasSqueezing: false,
                orderResolved: false,
                pendingAdvanceAt: 0,
                pendingAction: null,
                orders,
                sessionComplete: false,
                leaderboard: [],
                resultPopup: {
                    visible: false,
                    zoneKey: 'bad',
                    title: '',
                    detail: '',
                },
                counts: {
                    excellent: 0,
                    good: 0,
                    bad: 0,
                },
            };

            return {
                score: 0,
                hud: {
                    primaryLabel: 'Mode Score',
                    primaryValue: '0',
                    secondaryLabel: 'Order',
                    secondaryValue: 'In progress',
                    statusText: 'Squeeze to move marker. Release to lock result.',
                },
                gameData,
                summary: {
                    modeScore: 0,
                    badge: 'Scaffold',
                    notes: 'TODO: tune scoring and stage progression for exercise 5 game mode.',
                },
            };
        },
        onSessionStart(state) {
            state.hud.statusText = 'Order 1 ready. Start squeezing.';
        },
        onFrame(state, payload) {
            const deltaSeconds = Math.max(0, payload && payload.deltaSeconds ? payload.deltaSeconds : 0);
            const now = payload && payload.now ? payload.now : 0;
            const intensity = getSqueezeIntensity(payload ? payload.liveLandmarks : null);
            const isSqueezing = intensity >= SQUEEZE_THRESHOLD;
            const releasedAfterSqueeze = state.gameData.wasSqueezing && !isSqueezing;

            if (state.gameData.resultPopup.visible && now >= state.gameData.pendingAdvanceAt) {
                if (state.gameData.pendingAction === 'show_leaderboard') {
                    showLeaderboard(state);
                } else {
                    advanceOrder(state);
                }
            }

            if (state.gameData.orderResolved || state.gameData.sessionComplete) {
                state.gameData.isSqueezing = false;
                state.gameData.squeezeIntensity = 0;
                return;
            }

            state.gameData.squeezeIntensity = intensity;
            state.gameData.isSqueezing = isSqueezing;

            if (isSqueezing) {
                const speed = 0.1 + intensity * 0.24;
                state.gameData.markerProgress = clamp(state.gameData.markerProgress + speed * deltaSeconds, 0, 1);

                const dripRateMlPerSec = 8 + intensity * 20;
                state.gameData.cupMl = clamp(state.gameData.cupMl + dripRateMlPerSec * deltaSeconds, 0, state.gameData.targetMl);
            }

            const zone = getZone(state.gameData.markerProgress);
            state.gameData.zoneKey = zone.key;
            state.gameData.zoneLabel = zone.label;
            state.gameData.orderProgress = clamp(state.gameData.cupMl / state.gameData.targetMl, 0, 1);
            const activeOrder = state.gameData.orders[state.gameData.activeOrderIndex];
            if (activeOrder) {
                activeOrder.progress = state.gameData.orderProgress;
                activeOrder.status = 'active';
                activeOrder.zoneLabel = `${Math.round(state.gameData.orderProgress * 100)}%`;
            }

            state.hud.primaryValue = String(Math.round(state.score));
            state.hud.secondaryValue = `#${state.gameData.activeOrderIndex + 1}`;
            state.hud.statusText = isSqueezing
                ? `Squeezing... intensity ${Math.round(intensity * 100)}%`
                : 'Release detected. Marker stopped.';

            const reachedEnd = state.gameData.markerProgress >= 0.999;
            if (reachedEnd || releasedAfterSqueeze) {
                completeCurrentOrder(state, now);
            }

            state.gameData.wasSqueezing = isSqueezing;
        },
        onCheckpoint() {},
        onPause(state) {
            state.hud.statusText = 'Paused';
        },
        onResume(state) {
            state.hud.statusText = 'Resumed';
        },
        onSessionEnd(state, payload) {
            state.summary.modeScore = Math.round(state.score);
            state.summary.badge = payload.completed ? 'Completed' : 'Interrupted';
            state.summary.notes = `Excellent ${state.gameData.counts.excellent}, Good ${state.gameData.counts.good}, Bad ${state.gameData.counts.bad}, juice ${Math.round(state.gameData.cupMl)}ml/${state.gameData.targetMl}ml.`;
        },
    };
}(window));

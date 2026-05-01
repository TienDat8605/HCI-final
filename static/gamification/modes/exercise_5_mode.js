(function registerExercise5Mode(globalObject) {
    'use strict';

    const modeRegistry = globalObject.BlueprintGamificationModes || (globalObject.BlueprintGamificationModes = {});

    const ORDER_QUEUE = [
        { id: 'order_orange_250', icon: '🍊', targetMl: 250 },
        { id: 'order_citrus_500', icon: '🍋', targetMl: 500 },
    ];

    const SQUEEZE_THRESHOLD   = 0.4;
    const RESULT_POPUP_MS     = 1400;
    const ROUND_COMPLETE_MS   = 1700;

    // Scoring per zone (base, before multiplier)
    const ZONE_SCORE = { excellent: 120, good: 75, bad: 30 };

    // Combo multiplier thresholds
    const COMBO_MULTIPLIER = [
        { streak: 3, mult: 1.5 },
        { streak: 2, mult: 1.2 },
        { streak: 1, mult: 1.0 },
    ];

    const DUMMY_LEADERBOARD = [
        { name: 'Mina',  score: 980 },
        { name: 'Duy',   score: 910 },
        { name: 'An',    score: 845 },
        { name: 'Linh',  score: 790 },
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
        if (!Array.isArray(landmarks) || landmarks.length !== 21) return 0;

        const wrist     = landmarks[0];
        const middleMcp = landmarks[9];
        const tips      = [landmarks[8], landmarks[12], landmarks[16], landmarks[20]];
        const handScale = distance3(wrist, middleMcp) || 1;
        const avgTip    = tips.reduce((s, p) => s + distance3(p, wrist), 0) / tips.length;

        return clamp((1.95 - avgTip / handScale) / 0.95, 0, 1);
    }

    function getZone(progress) {
        if (progress >= 0.35 && progress <= 0.65) return { key: 'excellent', label: 'Excellent', color: 'orange' };
        if ((progress >= 0.2 && progress < 0.35) || (progress > 0.65 && progress <= 0.8)) return { key: 'good', label: 'Good', color: 'yellow' };
        return { key: 'bad', label: 'Bad', color: 'grey' };
    }

    function getMultiplier(comboStreak) {
        for (const tier of COMBO_MULTIPLIER) {
            if (comboStreak >= tier.streak) return tier.mult;
        }
        return 1.0;
    }

    function createOrderQueue() {
        return ORDER_QUEUE.map((order, index) => ({
            ...order,
            progress : 0,
            status   : index === 0 ? 'active' : 'queue',
            zoneKey  : 'bad',
            zoneLabel: index === 0 ? 'Active' : 'Wait',
        }));
    }

    function resetCurrentOrder(state) {
        const active = state.gameData.orders[state.gameData.activeOrderIndex] || ORDER_QUEUE[0];
        Object.assign(state.gameData, {
            markerProgress  : 0,
            squeezeIntensity: 0,
            isSqueezing     : false,
            cupMl           : 0,
            targetMl        : active.targetMl,
            zoneKey         : 'bad',
            zoneLabel       : 'Bad',
            wasSqueezing    : false,
            orderResolved   : false,
            pendingAdvanceAt: 0,
        });
    }

    function computeScore(zoneKey, comboStreak) {
        const base = ZONE_SCORE[zoneKey] || ZONE_SCORE.bad;
        const mult = getMultiplier(comboStreak);
        return Math.round(base * mult);
    }

    function getResultCopy(zoneKey, comboStreak, pts) {
        const multiplier = getMultiplier(comboStreak);
        const comboTag   = comboStreak >= 2 ? ` ×${multiplier.toFixed(1)} COMBO!` : '';

        if (zoneKey === 'excellent') {
            return { title: 'Excellent!', detail: `Perfect timing.${comboTag}`, score: pts };
        }
        if (zoneKey === 'good') {
            return { title: 'Good!', detail: `Try the center zone.${comboTag}`, score: pts };
        }
        return { title: 'Too early / late', detail: 'Watch the timing bar. Combo reset.', score: pts };
    }

    function buildLeaderboard(score) {
        const entries = [...DUMMY_LEADERBOARD, { name: 'You', score: Math.round(score), isPlayer: true }];
        entries.sort((a, b) => b.score - a.score);
        return entries.map((entry, index) => ({
            rank    : index + 1,
            name    : entry.name,
            score   : entry.score,
            isPlayer: Boolean(entry.isPlayer),
        }));
    }

    function completeCurrentOrder(state, now) {
        const zone        = getZone(state.gameData.markerProgress);
        const activeOrder = state.gameData.orders[state.gameData.activeOrderIndex];
        const isFinal     = state.gameData.activeOrderIndex >= state.gameData.orders.length - 1;

        // Update combo streak
        if (zone.key !== 'bad') {
            state.gameData.comboStreak += 1;
        } else {
            state.gameData.comboStreak = 0;
        }
        state.gameData.bestCombo = Math.max(state.gameData.bestCombo, state.gameData.comboStreak);

        const pts        = computeScore(zone.key, state.gameData.comboStreak);
        const resultCopy = getResultCopy(zone.key, state.gameData.comboStreak, pts);

        state.gameData.counts[zone.key] += 1;
        state.score += pts;

        if (activeOrder) {
            activeOrder.progress  = 1;
            activeOrder.status    = 'done';
            activeOrder.zoneKey   = zone.key;
            activeOrder.zoneLabel = zone.label;
        }

        Object.assign(state.gameData, {
            zoneKey       : zone.key,
            zoneLabel     : zone.label,
            orderResolved : true,
            pendingAdvanceAt: now + (isFinal ? ROUND_COMPLETE_MS : RESULT_POPUP_MS),
            pendingAction : isFinal ? 'show_leaderboard' : 'next_order',
            resultPopup   : {
                visible: true,
                zoneKey: zone.key,
                title  : isFinal ? 'All orders done!' : resultCopy.title,
                detail : isFinal ? `Total score ${Math.round(state.score)}` : resultCopy.detail,
                pts    : isFinal ? null : pts,
                combo  : state.gameData.comboStreak,
            },
        });

        state.hud.primaryValue   = String(Math.round(state.score));
        state.hud.secondaryValue = zone.label;
        state.hud.statusText     = isFinal
            ? 'Orders completed — preparing leaderboard...'
            : `${zone.label} squeeze. Next order loading...`;
        state.summary.modeScore  = Math.round(state.score);
    }

    function advanceOrder(state) {
        const orderCount = state.gameData.orders.length;
        if (!orderCount) return;

        const nextIndex     = state.gameData.activeOrderIndex + 1;
        const completedRound = nextIndex >= orderCount;

        if (completedRound) {
            state.gameData.orders        = createOrderQueue();
            state.gameData.activeOrderIndex = 0;
        } else {
            state.gameData.activeOrderIndex = nextIndex;
            const nextOrder = state.gameData.orders[nextIndex];
            if (nextOrder) {
                nextOrder.status    = 'active';
                nextOrder.zoneLabel = 'Active';
                nextOrder.progress  = 0;
            }
        }

        state.gameData.resultPopup.visible = false;
        resetCurrentOrder(state);
        state.hud.secondaryValue = 'In progress';
        state.hud.statusText     = completedRound
            ? 'Queue restarted. Order 1 ready.'
            : `Order ${state.gameData.activeOrderIndex + 1} ready. Start squeezing.`;
    }

    function showLeaderboard(state) {
        state.gameData.resultPopup.visible = false;
        state.gameData.sessionComplete     = true;
        state.gameData.pendingAction       = null;
        state.gameData.leaderboard         = buildLeaderboard(state.score);
        state.hud.secondaryValue           = 'Leaderboard';
        state.hud.statusText               = `Session complete — total score ${Math.round(state.score)}.`;
        state.summary.modeScore            = Math.round(state.score);
        state.summary.badge                = 'Orders Complete';
        state.summary.notes                = [
            `Excellent ×${state.gameData.counts.excellent}`,
            `Good ×${state.gameData.counts.good}`,
            `Bad ×${state.gameData.counts.bad}`,
            `Best combo ×${state.gameData.bestCombo}`,
        ].join(' | ');
    }

    modeRegistry.exercise_5_mode = {
        id         : 'exercise_5_mode',
        title      : 'Game Mode B',
        description: 'Squeeze to move the timing marker. Release at the Excellent zone to maximise your score. Chain good results for a combo multiplier.',

        createInitialState() {
            const orders   = createOrderQueue();
            const gameData = {
                markerProgress  : 0,
                squeezeIntensity: 0,
                isSqueezing     : false,
                cupMl           : 0,
                targetMl        : orders[0].targetMl,
                zoneKey         : 'bad',
                zoneLabel       : 'Bad',
                orderProgress   : 0,
                activeOrderIndex: 0,
                wasSqueezing    : false,
                orderResolved   : false,
                pendingAdvanceAt: 0,
                pendingAction   : null,
                orders,
                sessionComplete : false,
                leaderboard     : [],

                // Combo tracking
                comboStreak: 0,
                bestCombo  : 0,

                resultPopup: {
                    visible: false,
                    zoneKey: 'bad',
                    title  : '',
                    detail : '',
                    pts    : null,
                    combo  : 0,
                },
                counts: { excellent: 0, good: 0, bad: 0 },
            };

            return {
                score: 0,
                hud: {
                    primaryLabel  : 'Score',
                    primaryValue  : '0',
                    secondaryLabel: 'Order',
                    secondaryValue: 'In progress',
                    statusText    : 'Squeeze to move the marker. Release to lock your result.',
                },
                gameData,
                summary: {
                    modeScore: 0,
                    badge    : 'In Progress',
                    notes    : '',
                },
            };
        },

        onSessionStart(state) {
            state.hud.statusText = 'Order 1 ready — start squeezing!';
        },

        onFrame(state, payload) {
            const deltaSeconds = Math.max(0, payload && payload.deltaSeconds ? payload.deltaSeconds : 0);
            const now          = payload && payload.now ? payload.now : 0;
            const intensity    = getSqueezeIntensity(payload ? payload.liveLandmarks : null);
            const isSqueezing  = intensity >= SQUEEZE_THRESHOLD;
            const released     = state.gameData.wasSqueezing && !isSqueezing;

            // Advance pending popup timer
            if (state.gameData.resultPopup.visible && now >= state.gameData.pendingAdvanceAt) {
                if (state.gameData.pendingAction === 'show_leaderboard') {
                    showLeaderboard(state);
                } else {
                    advanceOrder(state);
                }
            }

            // Lock input while order is resolving or session is done
            if (state.gameData.orderResolved || state.gameData.sessionComplete) {
                state.gameData.isSqueezing     = false;
                state.gameData.squeezeIntensity = 0;
                return;
            }

            state.gameData.squeezeIntensity = intensity;
            state.gameData.isSqueezing      = isSqueezing;

            if (isSqueezing) {
                // Marker speed: base 0.10 + intensity bonus
                const speed = 0.10 + intensity * 0.24;
                state.gameData.markerProgress = clamp(
                    state.gameData.markerProgress + speed * deltaSeconds,
                    0, 1
                );

                // Juice drip into cup
                const dripRate = 8 + intensity * 20;
                state.gameData.cupMl = clamp(
                    state.gameData.cupMl + dripRate * deltaSeconds,
                    0, state.gameData.targetMl
                );
            }

            // Zone classification & order progress sync
            const zone = getZone(state.gameData.markerProgress);
            state.gameData.zoneKey   = zone.key;
            state.gameData.zoneLabel = zone.label;

            const activeOrder = state.gameData.orders[state.gameData.activeOrderIndex];
            state.gameData.orderProgress = clamp(state.gameData.cupMl / Math.max(1, state.gameData.targetMl), 0, 1);
            if (activeOrder) {
                activeOrder.progress  = state.gameData.orderProgress;
                activeOrder.status    = 'active';
                activeOrder.zoneLabel = `${Math.round(state.gameData.orderProgress * 100)}%`;
            }

            // HUD update
            state.hud.primaryValue   = String(Math.round(state.score));
            state.hud.secondaryValue = `#${state.gameData.activeOrderIndex + 1}`;
            state.hud.statusText     = isSqueezing
                ? `Squeezing… ${Math.round(intensity * 100)}% intensity`
                : 'Released — marker locked.';

            // Resolve: marker hit end OR player released
            if (state.gameData.markerProgress >= 0.999 || (released && state.gameData.markerProgress > 0.02)) {
                completeCurrentOrder(state, now);
            }

            state.gameData.wasSqueezing = isSqueezing;
        },

        onCheckpoint() {},

        onPause(state) {
            state.hud.statusText = 'Paused';
        },

        onResume(state) {
            state.hud.statusText = 'Resumed — keep squeezing!';
        },

        onSessionEnd(state, payload) {
            const { counts, bestCombo, cupMl, targetMl } = state.gameData;
            state.summary.modeScore = Math.round(state.score);
            state.summary.badge     = payload.completed ? 'Completed' : 'Interrupted';
            state.summary.notes     = [
                `Excellent ×${counts.excellent}`,
                `Good ×${counts.good}`,
                `Bad ×${counts.bad}`,
                `Best combo ×${bestCombo}`,
                `Juice ${Math.round(cupMl)}ml / ${targetMl}ml`,
            ].join(' | ');
        },
    };

}(window));

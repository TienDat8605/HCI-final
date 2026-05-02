(function initBlueprintGamification(globalObject) {
    'use strict';

    function createDefaultHud() {
        return {
            primaryLabel: 'Mode Score',
            primaryValue: '0',
            secondaryLabel: 'Objective',
            secondaryValue: 'Implement mode logic',
            statusText: 'Gamification scaffold active',
        };
    }

    function createNullMode(modeId, title) {
        return {
            id: modeId,
            title,
            description: 'Generic fallback mode scaffold.',
            createInitialState() {
                return {
                    score: 0,
                    checkpoints: 0,
                    hud: createDefaultHud(),
                    summary: {
                        modeScore: 0,
                        badge: 'Scaffold',
                        notes: `TODO: implement mode logic for ${modeId}.`,
                    },
                    viewState: null,
                };
            },
            onSessionStart(state, context) {
                state.hud.statusText = `Mode ready for ${context.exerciseName}`;
            },
            onFrame() {},
            onCheckpoint(state) {
                state.checkpoints += 1;
                state.score += 1;
                state.hud.primaryValue = String(state.score);
                state.summary.modeScore = state.score;
            },
            onPause(state) {
                state.hud.statusText = 'Paused';
            },
            onResume(state) {
                state.hud.statusText = 'Resumed';
            },
            onSessionEnd(state, payload) {
                state.summary.modeScore = state.score;
                state.summary.badge = payload.completed ? 'Completed' : 'Interrupted';
            },
        };
    }

    const MODE_BY_EXERCISE = {
        1: 'exercise_1_mode',
        5: 'exercise_5_mode',
        6: 'pinch_defense_mode',
    };

    function getModeRegistry() {
        return globalObject.BlueprintGamificationModes || {};
    }

    function withDefaultHandlers(modeDefinition) {
        const fallback = createNullMode(modeDefinition.id || 'unknown_mode', modeDefinition.title || 'Unknown Mode');
        return {
            ...fallback,
            ...modeDefinition,
            createInitialState: modeDefinition.createInitialState || fallback.createInitialState,
            onSessionStart: modeDefinition.onSessionStart || fallback.onSessionStart,
            onFrame: modeDefinition.onFrame || fallback.onFrame,
            onCheckpoint: modeDefinition.onCheckpoint || fallback.onCheckpoint,
            onPause: modeDefinition.onPause || fallback.onPause,
            onResume: modeDefinition.onResume || fallback.onResume,
            onSessionEnd: modeDefinition.onSessionEnd || fallback.onSessionEnd,
            mount: modeDefinition.mount || null,
            unmount: modeDefinition.unmount || null,
        };
    }

    function buildRuntime(exerciseId, context) {
        const modeId = MODE_BY_EXERCISE[exerciseId] || 'unsupported_mode';
        const registry = getModeRegistry();
        const selected = registry[modeId] || createNullMode(modeId, 'Unsupported Mode');
        const mode = withDefaultHandlers(selected);
        const state = mode.createInitialState(context);

        function callSafe(handlerName, payload) {
            try {
                const result = mode[handlerName](state, payload);
                if (result && typeof result.then === 'function') {
                    result.catch((error) => {
                        console.error(`[gamification] ${mode.id}.${handlerName} async failed`, error);
                    });
                }
            } catch (error) {
                console.error(`[gamification] ${mode.id}.${handlerName} failed`, error);
        }
    }

        return {
            modeId: mode.id,
            modeTitle: mode.title,
            modeDescription: mode.description,
            notifySessionStart(payload) {
                callSafe('onSessionStart', payload);
            },
            notifyFrame(payload) {
                callSafe('onFrame', payload);
            },
            notifyCheckpoint(payload) {
                callSafe('onCheckpoint', payload);
            },
            notifyPause(payload) {
                callSafe('onPause', payload);
            },
            notifyResume(payload) {
                callSafe('onResume', payload);
            },
            notifySessionEnd(payload) {
                callSafe('onSessionEnd', payload);
            },
            mount(container) {
                if (typeof mode.mount !== 'function') {
                    return;
                }
                try {
                    mode.mount(state, container);
                } catch (error) {
                    console.error(`[gamification] ${mode.id}.mount failed`, error);
                }
            },
            unmount() {
                if (typeof mode.unmount !== 'function') {
                    return;
                }
                try {
                    mode.unmount(state);
                } catch (error) {
                    console.error(`[gamification] ${mode.id}.unmount failed`, error);
                }
            },
            snapshot() {
                return {
                    modeId: mode.id,
                    modeTitle: mode.title,
                    modeDescription: mode.description,
                    hud: state.hud || createDefaultHud(),
                    summary: state.summary || null,
                    gameData: state.gameData || null,
                    viewState: state.viewState || null,
                };
            },
        };
    }

    globalObject.BlueprintGamification = {
        createRuntime: buildRuntime,
        resolveModeId(exerciseId) {
            return MODE_BY_EXERCISE[exerciseId] || 'unsupported_mode';
        },
        listModes() {
            const registry = getModeRegistry();
            const modeIds = Object.values(MODE_BY_EXERCISE);
            return modeIds.map((modeId) => {
                const mode = registry[modeId] || createNullMode(modeId, modeId);
                return {
                    id: mode.id,
                    title: mode.title,
                    description: mode.description,
                };
            });
        },
    };
}(window));

(function registerExercise1Mode(globalObject) {
    'use strict';

    const modeRegistry = globalObject.BlueprintGamificationModes || (globalObject.BlueprintGamificationModes = {});

    modeRegistry.exercise_1_mode = {
        id: 'exercise_1_mode',
        title: 'Game Mode A',
        description: 'Generic scaffold for exercise 1 game mode.',
        createInitialState() {
            return {
                score: 0,
                hud: {
                    primaryLabel: 'Mode Score',
                    primaryValue: '0',
                    secondaryLabel: 'Objective',
                    secondaryValue: 'Implement exercise 1 mode logic',
                    statusText: 'Exercise 1 mode scaffold loaded',
                },
                summary: {
                    modeScore: 0,
                    badge: 'Scaffold',
                    notes: 'TODO: implement exercise 1 game mode behavior.',
                },
            };
        },
        onSessionStart() {},
        onFrame() {},
        onCheckpoint() {},
        onPause() {},
        onResume() {},
        onSessionEnd() {},
    };
}(window));

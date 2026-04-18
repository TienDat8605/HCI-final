(function registerExercise5Mode(globalObject) {
    'use strict';

    const modeRegistry = globalObject.BlueprintGamificationModes || (globalObject.BlueprintGamificationModes = {});

    modeRegistry.exercise_5_mode = {
        id: 'exercise_5_mode',
        title: 'Game Mode B',
        description: 'Generic scaffold for exercise 5 game mode.',
        createInitialState() {
            return {
                score: 0,
                hud: {
                    primaryLabel: 'Mode Score',
                    primaryValue: '0',
                    secondaryLabel: 'Objective',
                    secondaryValue: 'Implement exercise 5 mode logic',
                    statusText: 'Exercise 5 mode scaffold loaded',
                },
                summary: {
                    modeScore: 0,
                    badge: 'Scaffold',
                    notes: 'TODO: implement exercise 5 game mode behavior.',
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

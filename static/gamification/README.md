# Gamification Scaffold

This module is intentionally decoupled from `static/app.js` so different developers can implement game logic independently.

## Active exercise to mode mapping

- `exercise_1` -> `exercise_1_mode`
- `exercise_5` -> `exercise_5_mode`

## Runtime contract

The app creates one mode runtime per session:

- `BlueprintGamification.createRuntime(exerciseId, context)`

Each runtime exposes lifecycle hooks:

- `notifySessionStart(payload)`
- `notifyFrame(payload)`
- `notifyCheckpoint(payload)`
- `notifyPause(payload)`
- `notifyResume(payload)`
- `notifySessionEnd(payload)`
- `snapshot()`

## Mode contract

A mode object can implement:

- `id`, `title`, `description`
- `createInitialState(context)`
- `onSessionStart(state, payload)`
- `onFrame(state, payload)`
- `onCheckpoint(state, payload)`
- `onPause(state, payload)`
- `onResume(state, payload)`
- `onSessionEnd(state, payload)`

If a handler is missing, scaffold fallback handler is used.

## Team workflow suggestion

1. One developer owns `modes/exercise_1_mode.js`.
2. One developer owns `modes/exercise_5_mode.js`.
3. One developer owns UI/HUD consumption in `static/app.js`.

Because fallback handlers exist, partially implemented mode logic will not crash app.

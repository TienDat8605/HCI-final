# CLAUDE.md

## Project Overview

This repository is a hand-rehabilitation prototype with a split architecture:

- A `Flask` backend serves rehab data and comparison endpoints.
- A `Next.js 15` + `React 19` + `TypeScript` frontend renders the current user experience.
- A legacy browser gamification runtime still exists under `static/` and is bridged into the React app for some exercise modes.

The current product is centered on camera-guided hand exercises, guided exercise playback, pose checkpoints, pause/resume behavior, and a legacy pinch-defense minigame/runtime.

## High-Level Architecture

### 1. Frontend

The production UI lives in:

- `app/`
- `components/`
- `hooks/`
- `lib/`
- `app/globals.css`

The entrypoint is:

- `app/page.tsx` -> `components/home-page.tsx` -> `components/rehab-workspace.tsx`

`components/rehab-workspace.tsx` is the main orchestration component. It currently owns:

- screen state
- exercise loading
- guide-frame loading
- session lifecycle
- zone navigation logic
- camera/tracking coordination
- legacy gamification bridge mounting/unmounting
- summary generation

If a task changes session flow, exercise flow, screen transitions, pause behavior, or training behavior, start there first.

### 2. Backend

The backend entrypoint is:

- `app.py`

It serves:

- `GET /api/exercises`
- `GET /api/landmarks/<exercise_id>`
- `GET /api/video/<exercise_id>`
- `GET /api/keyframe/<exercise_id>/<position>`
- `POST /api/compare`
- `GET /legacy-static/<path>`

Important backend notes:

- The backend filters supported exercises to IDs `1`, `5`, and `6`.
- Exercise `6` is the pinch-defense runtime path.
- The frontend currently fetches exercise metadata and landmark JSON, but it does **not** appear to call `/api/compare` yet.
- `app.py` preloads reference landmark data into an in-memory cache.

### 3. Data Generation / Python Processing

Two Python scripts are core to the data pipeline:

- `process_video.py`
- `hand_compare.py`

`process_video.py` is the offline asset-generation pipeline. It:

1. splits a source video into exercise clips
2. extracts MediaPipe landmarks
3. generates representative keyframes
4. writes `data/exercises.json`

`hand_compare.py` contains the scoring logic used by the API comparison endpoint. It normalizes landmarks and compares:

- joint angles
- thumb contact profile
- finger spread profile

This is important: the comparison logic exists on the backend, but the React guided flow currently uses local placeholder accuracy/progression behavior inside `components/rehab-workspace.tsx` rather than live API comparison.

### 4. Legacy Runtime

Legacy browser assets live in:

- `static/`
- `static/gamification/`

The React app still loads these through:

- `hooks/use-legacy-gamification.ts`

That hook injects a stylesheet and several legacy scripts from `/legacy-static/...`.

The main compatibility contract is described in:

- `static/gamification/README.md`
- `legacy-globals.d.ts`

`legacy-globals.d.ts` defines the global browser types for:

- `window.Hands`
- `window.BlueprintGamification`
- `window.PinchDefenseConfig`
- legacy runtime snapshot/HUD interfaces

If you change how the React app talks to the legacy runtime, update both runtime usage and these type declarations together.

## Folder Guide

### Core app files

- `app/layout.tsx`: app shell metadata, font setup, global CSS import
- `app/page.tsx`: root route
- `components/home-page.tsx`: thin wrapper into the main workspace
- `components/rehab-workspace.tsx`: primary app logic and rendering
- `components/camera-preview.tsx`: reusable camera preview component, currently secondary
- `hooks/use-legacy-mediapipe.ts`: browser-side MediaPipe Hands loader, webcam setup, hand tracking, overlay drawing
- `hooks/use-legacy-gamification.ts`: legacy runtime loader/bootstrapping
- `lib/api.ts`: frontend API accessors
- `lib/types.ts`: shared frontend TS types
- `legacy-globals.d.ts`: browser globals for legacy scripts
- `next.config.mjs`: rewrites `/api/*` and `/legacy-static/*` to Flask
- `app/globals.css`: main visual system and screen styling

### Backend / processing

- `app.py`: Flask API server
- `hand_compare.py`: pose scoring / matching engine
- `process_video.py`: offline preprocessing pipeline
- `requirements.txt`: Python dependencies

### Reference / design artifacts

- `UI/`: design mockups, HTML prototypes, and supporting design docs

Treat `UI/` as reference material unless the task is explicitly about design artifacts or converting a mockup into the production app.

### Legacy frontend artifacts

- `static/index.html`
- `static/app.js`
- `static/style.css`
- `static/gamification/**`

These are not the primary production UI anymore, but parts of `static/gamification/` are still runtime-critical.

## Important Repo Constraints

Do **not** scan these folders broadly unless explicitly asked:

- `data/`
- `venv/`
- `.venv/`
- `node_modules/`
- `.next/`

Use targeted reads only.

Also keep in mind:

- `data/` contains generated assets and model/runtime data. Do not rewrite or regenerate it unless the task requires that.
- `node_modules/` and `.next/` are not source-of-truth.
- `UI/` contains references, not necessarily the live app.

## Development Workflow

### Frontend

Install and run:

```bash
npm install
npm run dev
```

Type-check:

```bash
npm run typecheck
```

### Backend

Install Python deps:

```bash
pip install -r requirements.txt
```

Run Flask:

```bash
python app.py
```

### Full stack expectation

Typical local development expects:

- Flask on `http://127.0.0.1:5000`
- Next.js on `http://localhost:3000`

By default, `next.config.mjs` rewrites frontend `/api/*` calls to Flask using `FLASK_API_ORIGIN`.

`NEXT_PUBLIC_API_BASE_URL` can be used to bypass rewrites and point fetches elsewhere.

## Known Behavior and Implementation Notes

### Frontend state model

`components/rehab-workspace.tsx` drives these main screens:

- `zones`
- `instructions`
- `training`
- `paused`
- `summary`

The current architecture is intentionally centralized rather than heavily componentized. Prefer extracting helpers or small subcomponents only when it meaningfully reduces risk or complexity.

### Camera and hand tracking

`hooks/use-legacy-mediapipe.ts`:

- loads MediaPipe Hands from a CDN at runtime
- requests webcam access in the browser
- tracks a single dominant hand
- draws the overlay skeleton on a canvas
- exposes `start`, `stop`, preview refs, and tracked hand state

If camera/tracking issues appear, inspect this hook before changing screen-level behavior.

### Legacy game runtime bridge

`hooks/use-legacy-gamification.ts`:

- injects legacy CSS and JS assets once
- marks the gamification runtime as ready when `window.BlueprintGamification` exists
- configures the pinch-defense asset manifest path

`components/rehab-workspace.tsx` mounts and unmounts the legacy runtime for pinch-defense sessions.

### Exercise support mismatch

There is an important distinction:

- `app.py` supports exercises `1`, `5`, and `6`
- `process_video.py` currently generates offline clip/landmark metadata for exercises `1` and `5`

That means exercise `6` is a special case and should be treated as a runtime-driven mode rather than a normal generated reference-video flow.

### Guided mode scoring

The guided training flow currently advances using local UI-side logic and synthetic accuracy values in `components/rehab-workspace.tsx`.

If a task asks for "real scoring", "live comparison", or "backend-based pose validation", connect the training flow to `POST /api/compare` instead of only adjusting presentation.

## Editing Guidance

### When changing UI behavior

Start with:

- `components/rehab-workspace.tsx`
- `app/globals.css`
- `lib/types.ts`

Check whether the task affects:

- screen flow
- session state
- zone interactions
- camera prerequisites
- training summary generation
- pinch-defense runtime behavior

### When changing API behavior

Start with:

- `app.py`
- `hand_compare.py`
- `lib/api.ts`
- `lib/types.ts`

Keep API contract changes synchronized across backend responses and frontend assumptions.

### When changing gamification behavior

Start with:

- `hooks/use-legacy-gamification.ts`
- `static/gamification/README.md`
- `static/gamification/modes/*`
- `static/gamification/pinch_defense/*`
- `legacy-globals.d.ts`

Be careful not to break global contracts expected by the React bridge.

### When changing data generation

Start with:

- `process_video.py`
- `README.md`

Do not casually regenerate `data/` or modify generated artifacts unless the task explicitly calls for it.

## Working Style Expectations

When working in this repo:

- prefer targeted reads over broad scans
- avoid touching generated or dependency folders
- preserve the current split architecture instead of collapsing Flask and Next.js together
- preserve legacy runtime compatibility unless the task explicitly replaces it
- keep TypeScript types in sync with runtime behavior
- prefer minimal, surgical edits over broad rewrites

## Good First Files To Read For Most Tasks

If starting a new task, read these first:

1. `README.md`
2. `AGENTS.md`
3. `components/rehab-workspace.tsx`
4. `hooks/use-legacy-mediapipe.ts`
5. `hooks/use-legacy-gamification.ts`
6. `lib/api.ts`
7. `lib/types.ts`
8. `app.py`

Then branch into:

- `hand_compare.py` for scoring/comparison work
- `process_video.py` for preprocessing/data issues
- `app/globals.css` for styling/layout work
- `static/gamification/**` for legacy runtime changes
- `UI/**` only when design references are needed

## Safe Assumptions

Unless the task states otherwise, assume:

- the Next.js app is the current UI surface
- Flask is the API/backend source of truth
- `static/` is legacy except for assets still loaded through `/legacy-static`
- `components/rehab-workspace.tsx` is the main behavior hub
- `data/` should be treated as generated/project data, not a place for casual exploration

## If You Are About To Make Bigger Changes

Pause and verify assumptions before:

- refactoring `components/rehab-workspace.tsx` into many files
- replacing the legacy runtime bridge
- changing exercise IDs or exercise support rules
- changing backend response shapes
- regenerating `data/`
- removing `static/gamification` assets

Those changes can have cross-cutting effects across frontend, backend, and runtime glue.

# Hand Exercise Recovery Assistant

This project now uses a split architecture:

- Flask remains the rehab API and data backend.
- Next.js + React + TypeScript now render the UI.

The new frontend replaces the old Flask-served static HTML with an App Router workspace and a Spline-powered landing sequence.

Current scope keeps these exercises in the backend:
- `exercise_1` Finger Opposition
- `exercise_5` Strengthening
- `exercise_6` Pinch Defense

## What's in the repo

- `app.py` starts the Flask API server.
- `app/`, `components/`, and `lib/` contain the Next.js frontend.
- `static/` contains the legacy browser client that has now been superseded by the Next.js UI.
- `process_video.py` generates the exercise clips, landmark JSON, keyframes, and `data/exercises.json`.
- `hand_compare.py` contains the pose-comparison logic used by the API.
- `data/hand_landmarker.task` is the MediaPipe model asset used by `process_video.py`.

## Requirements

- Python 3.10+ recommended
- Node.js 20.9+ recommended
- `ffmpeg` installed and available on your `PATH`
- A webcam and a browser with camera access for live comparison

Python packages:

- `flask`
- `opencv-python`
- `mediapipe`
- `numpy`

## How to run

1. Create and activate a virtual environment.

   ```bash
   python3 -m venv .venv
   source .venv/bin/activate
   ```

2. Install the Python dependencies.

   ```bash
   pip install flask opencv-python mediapipe numpy
   ```

3. Generate the exercise assets.

   ```bash
   python process_video.py
   ```

4. Start the Flask API.

   ```bash
   python app.py
   ```

5. Install the frontend dependencies.

   ```bash
   npm install
   ```

6. Start the Next.js frontend.

   ```bash
   npm run dev
   ```

7. Open `http://localhost:3000` in your browser.

## Notes

- The backend expects the generated assets to exist in `data/clips/`, `data/landmarks/`, `data/keyframes/`, and `data/exercises.json`.
- If you delete the generated data folders, re-run `process_video.py` after restoring the source video and model asset.
- The Next.js app rewrites `/api/*` calls to the Flask backend using `FLASK_API_ORIGIN`, which defaults to `http://127.0.0.1:5000`.
- If you want the browser client to call Flask directly instead of using rewrites, set `NEXT_PUBLIC_API_BASE_URL`.

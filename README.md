# Hand Exercise Recovery Assistant

This project is a Flask app for comparing a live hand pose against reference exercise motions. It serves a web UI, exercise clips, generated hand landmarks, and keyframes.

## What’s in the repo

- `app.py` starts the Flask server.
- `static/` contains the browser client.
- `process_video.py` generates the exercise clips, landmark JSON, keyframes, and `data/exercises.json`.
- `hand_compare.py` contains the pose-comparison logic used by the API.
- `data/hand_landmarker.task` is the MediaPipe model asset used by `process_video.py`.

## Requirements

- Python 3.10+ recommended
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

2. Install the dependencies.

   ```bash
   pip install flask opencv-python mediapipe numpy
   ```

3. Generate the exercise assets.

   ```bash
   python process_video.py
   ```

4. Start the server.

   ```bash
   python app.py
   ```

5. Open `http://localhost:5000` in your browser.

## Notes

- The server expects the generated assets to exist in `data/clips/`, `data/landmarks/`, `data/keyframes/`, and `data/exercises.json`.
- If you delete the generated data folders, re-run `process_video.py` after restoring the source video and model asset.

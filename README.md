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

## Run from scratch

If you are starting from a clean checkout, the easiest path is to use the data already included in `data/` and run the server.

1. Create and activate a virtual environment.

   ```bash
   python3 -m venv .venv
   source .venv/bin/activate
   ```

2. Install the Python dependencies.

   ```bash
   pip install flask opencv-python mediapipe numpy
   ```

3. Start the app.

   ```bash
   python app.py
   ```

4. Open `http://localhost:5000` in your browser.

## Regenerate the exercise data

Use this only if you have the source video file that the generator expects.

1. Put the reference video next to `process_video.py` as `hand-exercise.mp4`.
2. Keep `data/hand_landmarker.task` in place. It is not created by this repository; it is the prebuilt MediaPipe Hand Landmarker task model that the generator loads.
3. Run the preprocessing script.

   ```bash
   python process_video.py
   ```

That script will:

- split the source video into exercise clips under `data/clips/`
- extract landmark sequences into `data/landmarks/`
- extract keyframes into `data/keyframes/`
- regenerate `data/exercises.json`

## Notes

- The server expects the generated assets to exist in `data/clips/`, `data/landmarks/`, `data/keyframes/`, and `data/exercises.json`.
- If you delete the generated data folders, re-run `process_video.py` after restoring the source video and model asset.

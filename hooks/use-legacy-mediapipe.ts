'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

const HAND_CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [0, 9], [9, 10], [10, 11], [11, 12],
  [0, 13], [13, 14], [14, 15], [15, 16],
  [0, 17], [17, 18], [18, 19], [19, 20],
  [5, 9], [9, 13], [13, 17],
] as const;

const PROCESSING_FRAME_MS = 48;
const MEDIAPIPE_HANDS_SCRIPT = 'https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4.1675469240/hands.min.js';
const MEDIAPIPE_HANDS_BASE = 'https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4.1675469240';

export interface HandBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export interface TrackedHandState {
  landmarks: LegacyLandmark[] | null;
  bounds: HandBounds | null;
  handedness: string;
  updatedAt: number;
}

interface MediaPipeState {
  ready: boolean;
  running: boolean;
  pending: boolean;
  error: string | null;
  trackedHand: TrackedHandState;
}

function loadScriptOnce(src: string) {
  return new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[data-codex-src="${src}"]`);
    if (existing) {
      if (existing.dataset.loaded === 'true') {
        resolve();
        return;
      }

      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', () => reject(new Error(`Failed to load ${src}`)), { once: true });
      return;
    }

    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.dataset.codexSrc = src;
    script.onload = () => {
      script.dataset.loaded = 'true';
      resolve();
    };
    script.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(script);
  });
}

function getBounds(landmarks: LegacyLandmark[]): HandBounds {
  const xs = landmarks.map((point) => point.x);
  const ys = landmarks.map((point) => point.y);

  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  };
}

function getHandArea(landmarks: LegacyLandmark[]) {
  const bounds = getBounds(landmarks);
  return Math.max(0.0001, (bounds.maxX - bounds.minX) * (bounds.maxY - bounds.minY));
}

type LegacyHandednessEntry = NonNullable<LegacyHandsResults['multiHandedness']>[number];

function getHandednessLabel(entry: LegacyHandednessEntry | undefined): string {
  if (!entry) return 'Right';
  if (Array.isArray(entry)) {
    return entry.length ? getHandednessLabel(entry[0]) : 'Right';
  }
  return entry.label === 'Left' ? 'Left' : 'Right';
}

function selectActiveHand(results: LegacyHandsResults) {
  const hands = results.multiHandLandmarks || [];

  if (!hands.length) {
    return { landmarks: null, bounds: null, handedness: 'Right' };
  }

  let bestIndex = 0;
  let bestArea = -1;

  hands.forEach((candidate, index) => {
    const area = getHandArea(candidate);
    if (area > bestArea) {
      bestArea = area;
      bestIndex = index;
    }
  });

  const selected = hands[bestIndex].map((point) => ({
    x: point.x,
    y: point.y,
    z: point.z || 0,
  }));

  return {
    landmarks: selected,
    bounds: getBounds(selected),
    handedness: getHandednessLabel((results.multiHandedness || [])[bestIndex]),
  };
}

function getPalmCenter(landmarks: LegacyLandmark[] | null) {
  if (!landmarks || landmarks.length < 18) return null;
  const anchors = [0, 5, 9, 13, 17].map((index) => landmarks[index]);
  return {
    x: anchors.reduce((sum, point) => sum + point.x, 0) / anchors.length,
    y: anchors.reduce((sum, point) => sum + point.y, 0) / anchors.length,
  };
}

function syncCanvasSize(canvas: HTMLCanvasElement | null) {
  if (!canvas || !canvas.parentElement) return;

  const rect = canvas.parentElement.getBoundingClientRect();
  const width = Math.max(1, Math.round(rect.width));
  const height = Math.max(1, Math.round(rect.height));

  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
}

function toScreenPoint(canvas: HTMLCanvasElement, point: LegacyLandmark) {
  return {
    x: point.x * canvas.width,
    y: point.y * canvas.height,
  };
}

function drawOverlay(canvas: HTMLCanvasElement | null, trackedHand: TrackedHandState) {
  if (!canvas) return;

  syncCanvasSize(canvas);
  const context = canvas.getContext('2d');
  if (!context) return;

  context.clearRect(0, 0, canvas.width, canvas.height);

  if (!trackedHand.landmarks) {
    return;
  }

  context.save();
  context.lineCap = 'round';
  context.lineJoin = 'round';

  HAND_CONNECTIONS.forEach(([startIndex, endIndex]) => {
    const start = toScreenPoint(canvas, trackedHand.landmarks![startIndex]);
    const end = toScreenPoint(canvas, trackedHand.landmarks![endIndex]);
    context.strokeStyle = '#89d2dc';
    context.lineWidth = 4;
    context.globalAlpha = 0.92;
    context.beginPath();
    context.moveTo(start.x, start.y);
    context.lineTo(end.x, end.y);
    context.stroke();
  });

  trackedHand.landmarks.forEach((landmark) => {
    const point = toScreenPoint(canvas, landmark);
    context.globalAlpha = 0.88;
    context.fillStyle = 'rgba(137, 210, 220, 0.24)';
    context.beginPath();
    context.arc(point.x, point.y, 7, 0, Math.PI * 2);
    context.fill();

    context.globalAlpha = 0.98;
    context.fillStyle = '#dffcff';
    context.beginPath();
    context.arc(point.x, point.y, 3, 0, Math.PI * 2);
    context.fill();
  });

  const center = getPalmCenter(trackedHand.landmarks);
  if (center) {
    const point = toScreenPoint(canvas, center);
    context.strokeStyle = '#dffcff';
    context.fillStyle = 'rgba(255,255,255,0.12)';
    context.lineWidth = 2;
    context.beginPath();
    context.arc(point.x, point.y, 16, 0, Math.PI * 2);
    context.fill();
    context.stroke();
  }

  context.restore();
}

function areTrackedHandsEquivalent(previous: TrackedHandState, next: TrackedHandState) {
  if (previous.handedness !== next.handedness) return false;

  if (!previous.landmarks || !next.landmarks) {
    return previous.landmarks === next.landmarks;
  }

  if (previous.landmarks.length !== next.landmarks.length) return false;

  return previous.landmarks.every((point, index) => {
    const nextPoint = next.landmarks![index];
    return point.x === nextPoint.x && point.y === nextPoint.y && point.z === nextPoint.z;
  });
}

export function useLegacyMediaPipe() {
  const [state, setState] = useState<MediaPipeState>({
    ready: false,
    running: false,
    pending: false,
    error: null,
    trackedHand: {
      landmarks: null,
      bounds: null,
      handedness: 'Right',
      updatedAt: 0,
    },
  });

  const handsRef = useRef<InstanceType<NonNullable<Window['Hands']>> | null>(null);
  const processingVideoRef = useRef<HTMLVideoElement | null>(null);
  const previewVideoElementRef = useRef<HTMLVideoElement | null>(null);
  const overlayCanvasElementRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number>(0);
  const handSendInFlightRef = useRef(false);
  const lastHandsSentAtRef = useRef(0);
  const trackedHandRef = useRef<TrackedHandState>({
    landmarks: null,
    bounds: null,
    handedness: 'Right',
    updatedAt: 0,
  });

  const updatePreviewStream = useCallback(() => {
    const preview = previewVideoElementRef.current;
    if (!preview) return;

    preview.srcObject = streamRef.current;
    if (streamRef.current) {
      preview.play().catch(() => {});
    }
  }, []);

  const handleResults = useCallback((results: LegacyHandsResults) => {
    const now = performance.now();
    const active = selectActiveHand(results);

    const nextTrackedHand: TrackedHandState = {
      landmarks: active.landmarks,
      bounds: active.bounds,
      handedness: active.handedness || 'Right',
      updatedAt: now,
    };

    if (areTrackedHandsEquivalent(trackedHandRef.current, nextTrackedHand)) {
      return;
    }

    trackedHandRef.current = nextTrackedHand;

    setState((current) => ({
      ...current,
      trackedHand: nextTrackedHand,
    }));
  }, []);

  const loop = useCallback(async () => {
    const hands = handsRef.current;
    const processingVideo = processingVideoRef.current;

    if (!hands || !processingVideo || !streamRef.current) {
      return;
    }

    const now = performance.now();
    if (!handSendInFlightRef.current && now - lastHandsSentAtRef.current >= PROCESSING_FRAME_MS) {
      handSendInFlightRef.current = true;
      lastHandsSentAtRef.current = now;
      try {
        await hands.send({ image: processingVideo });
      } finally {
        handSendInFlightRef.current = false;
      }
    }

    rafRef.current = window.requestAnimationFrame(() => {
      void loop();
    });
  }, []);

  const releaseMediaResources = useCallback(() => {
    if (rafRef.current) {
      window.cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    }

    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;

    if (processingVideoRef.current) {
      processingVideoRef.current.pause();
      processingVideoRef.current.srcObject = null;
    }

    if (previewVideoElementRef.current) {
      previewVideoElementRef.current.pause();
      previewVideoElementRef.current.srcObject = null;
    }
  }, []);

  const stop = useCallback(() => {
    const now = performance.now();
    releaseMediaResources();
    trackedHandRef.current = {
      landmarks: null,
      bounds: null,
      handedness: trackedHandRef.current.handedness,
      updatedAt: now,
    };

    setState((current) => ({
      ...current,
      pending: false,
      running: false,
      trackedHand: trackedHandRef.current,
    }));

    drawOverlay(overlayCanvasElementRef.current, {
      landmarks: null,
      bounds: null,
      handedness: 'Right',
      updatedAt: now,
    });
  }, [releaseMediaResources]);

  const start = useCallback(async () => {
    if (state.running || state.pending) {
      return state.running;
    }

    setState((current) => ({
      ...current,
      pending: true,
      error: null,
    }));

    try {
      await loadScriptOnce(MEDIAPIPE_HANDS_SCRIPT);

      if (!window.Hands) {
        throw new Error('MediaPipe Hands did not load.');
      }

      if (!handsRef.current) {
        const hands = new window.Hands({
          locateFile: (file) => `${MEDIAPIPE_HANDS_BASE}/${file}`,
        });

        hands.setOptions({
          maxNumHands: 1,
          modelComplexity: 1,
          minDetectionConfidence: 0.55,
          minTrackingConfidence: 0.5,
        });

        hands.onResults(handleResults);
        handsRef.current = hands;
      }

      if (!processingVideoRef.current) {
        const video = document.createElement('video');
        video.autoplay = true;
        video.playsInline = true;
        video.muted = true;
        processingVideoRef.current = video;
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: 'user',
          width: 960,
          height: 540,
        },
      });

      streamRef.current = stream;
      processingVideoRef.current.srcObject = stream;
      await processingVideoRef.current.play();
      updatePreviewStream();

      if (rafRef.current) {
        window.cancelAnimationFrame(rafRef.current);
      }
      rafRef.current = window.requestAnimationFrame(() => {
        void loop();
      });

      setState((current) => ({
        ...current,
        ready: true,
        running: true,
        pending: false,
        error: null,
      }));

      return true;
    } catch (error) {
      stop();
      setState((current) => ({
        ...current,
        ready: current.ready,
        pending: false,
        error: error instanceof Error ? error.message : 'Could not start MediaPipe tracking.',
      }));
      return false;
    }
  }, [handleResults, loop, state.pending, state.running, stop, updatePreviewStream]);

  const setPreviewVideoElement = useCallback((node: HTMLVideoElement | null) => {
    previewVideoElementRef.current = node;
    updatePreviewStream();
  }, [updatePreviewStream]);

  const setOverlayCanvasElement = useCallback((node: HTMLCanvasElement | null) => {
    overlayCanvasElementRef.current = node;
    if (node) {
      drawOverlay(node, trackedHandRef.current);
    }
  }, []);

  useEffect(() => {
    trackedHandRef.current = state.trackedHand;
    drawOverlay(overlayCanvasElementRef.current, state.trackedHand);
  }, [state.trackedHand]);

  useEffect(() => {
    const handleResize = () => {
      drawOverlay(overlayCanvasElementRef.current, trackedHandRef.current);
    };

    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
    };
  }, []);

  useEffect(() => () => {
    releaseMediaResources();
  }, [releaseMediaResources]);

  return {
    ...state,
    start,
    stop,
    setPreviewVideoElement,
    setOverlayCanvasElement,
  };
}

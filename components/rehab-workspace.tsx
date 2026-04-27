'use client';

import type { CSSProperties, ReactNode } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useLegacyGamification } from '@/hooks/use-legacy-gamification';
import { type HandBounds, useLegacyMediaPipe } from '@/hooks/use-legacy-mediapipe';
import { getExercises, getLandmarks, getVideoUrl } from '@/lib/api';
import type { AppScreen, Exercise, GuideFrame, ReferenceData, SessionSummary, TrainingSession } from '@/lib/types';

const EXERCISE_COPY: Record<number, { label: string; overview: string; guidance: string; tips: string[] }> = {
  1: {
    label: 'Level 1 - High Priority',
    overview: 'Touch the thumb to each fingertip, then reopen into a relaxed spread before the next contact.',
    guidance: 'Move thumb-to-finger slowly. Watch the reference clip first, then confirm each checkpoint inside the live training screen.',
    tips: [
      'Start with a relaxed open hand before each contact.',
      'Only move the finger that needs to meet the thumb.',
      'Keep the wrist quiet while the fingertips change shape.',
    ],
  },
  5: {
    label: 'Level 2 - Controlled Strength',
    overview: 'Move through controlled closing and opening patterns while keeping the hand visible to the camera.',
    guidance: 'Use the reference clip for pacing, then step through checkpoints in the training workspace.',
    tips: [
      'Squeeze gradually and avoid jerky jumps between poses.',
      'Hold each matched checkpoint for a short beat.',
      'Pause any time if the patient needs to reset.',
    ],
  },
  6: {
    label: 'Pinch Defense - Runtime',
    overview: 'A gamified rehab mode centered on quick, controlled pinches and confident releases.',
    tips: [
      'Use small, confident pinches instead of snapping the hand closed.',
      'Stay centered in frame for cleaner feedback.',
      'Return to instructions whenever the patient needs a refresher.',
    ],
  },
};

const PINCH_DEFENSE_FINGER_MAP = [
  { symbol: 'Circle', finger: 'Index', color: '#4d88ff' },
  { symbol: 'Triangle', finger: 'Middle', color: '#22c55e' },
  { symbol: 'Square', finger: 'Ring', color: '#facc15' },
  { symbol: 'Diamond', finger: 'Pinky', color: '#ef4444' },
] as const;

type ZoneKey = 'top' | 'left' | 'center' | 'right';
const ZONE_HOLD_MS = 2500;
const ZONE_COOLDOWN_MS = 1000;
const ZONE_TRIGGER_FLASH_MS = 700;

interface ZoneItem {
  label: string;
  title: string;
  description: string;
  enabled: boolean;
}

interface MediaStageProps {
  live: boolean;
  mode: 'zones' | 'instructions' | 'training' | 'paused';
  videoRef: (node: HTMLVideoElement | null) => void;
  overlayCanvasRef: (node: HTMLCanvasElement | null) => void;
  children?: ReactNode;
}

interface ReferenceFrameProps {
  src: string | null;
  emptyMessage: string;
}

interface ZoneState {
  current: ZoneKey | null;
  enteredAt: number;
  progress: number;
  cooldownUntil: number;
  triggered: ZoneKey | null;
  triggeredAt: number;
}

function isSameZoneState(left: ZoneState, right: ZoneState) {
  return left.current === right.current
    && left.enteredAt === right.enteredAt
    && left.progress === right.progress
    && left.cooldownUntil === right.cooldownUntil
    && left.triggered === right.triggered
    && left.triggeredAt === right.triggeredAt;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function formatDuration(milliseconds: number) {
  const totalSeconds = Math.max(0, Math.round(milliseconds / 1000));
  const minutes = Math.floor(totalSeconds / 60)
    .toString()
    .padStart(2, '0');
  const seconds = (totalSeconds % 60).toString().padStart(2, '0');
  return `${minutes}:${seconds}`;
}

function buildGuideFrames(referenceData: ReferenceData | null): GuideFrame[] {
  const frames = (referenceData?.frames || []).filter((frame) => frame.hands?.length);

  if (!frames.length) {
    return [];
  }

  const targetCount = clamp(Math.round(frames.length / 18), 3, 8);
  return Array.from({ length: targetCount }, (_, index) => {
    const frameIndex = Math.round((index / Math.max(targetCount - 1, 1)) * (frames.length - 1));
    const frame = frames[frameIndex];
    return {
      index,
      time: typeof frame.time === 'number' ? frame.time : index,
    };
  });
}

function getInteractionMode(exercise: Exercise | null): TrainingSession['interactionMode'] {
  return exercise?.interaction_mode === 'pinch_defense' ? 'pinch_defense' : 'guided';
}

function getExerciseCopy(exercise: Exercise | null) {
  if (!exercise) {
    return {
      label: 'Loading',
      overview: 'Exercise metadata is loading from the Flask API.',
      guidance: 'As soon as the backend responds, the instruction workspace will populate.',
      tips: ['Keep the backend running on port 5000.', 'The Next.js app proxies API calls automatically.'],
    };
  }

  return (
    EXERCISE_COPY[exercise.id] || {
      label: exercise.game_mode || 'Guided Session',
      overview: `${exercise.name} is available in the React workspace.`,
      guidance: 'Use the instruction screen to review the reference asset before starting the session.',
      tips: ['Enable the camera before entering training.', 'Use pause whenever the patient needs to reset.'],
    }
  );
}

function getPalmCenter(landmarks: LegacyLandmark[] | null) {
  if (!landmarks || landmarks.length < 18) return null;
  const anchors = [0, 5, 9, 13, 17].map((index) => landmarks[index]);
  return {
    x: anchors.reduce((sum, point) => sum + point.x, 0) / anchors.length,
    y: anchors.reduce((sum, point) => sum + point.y, 0) / anchors.length,
  };
}

function getActiveZoneLabel(landmarks: LegacyLandmark[] | null) {
  const center = getPalmCenter(landmarks);
  if (!center) return 'No hand detected';

  const x = 1 - center.x;
  const y = center.y;

  if (y < 0.22 && x > 0.34 && x < 0.66) return 'Top zone';
  if (x < 0.27 && y > 0.28 && y < 0.82) return 'Left zone';
  if (x > 0.73 && y > 0.28 && y < 0.82) return 'Right zone';
  if (x > 0.34 && x < 0.66 && y > 0.3 && y < 0.82) return 'Center zone';

  return 'Inside tracking area';
}

function getActiveZoneKey(
  landmarks: LegacyLandmark[] | null,
  screen: AppScreen,
  zones: Record<ZoneKey, ZoneItem>,
): ZoneKey | null {
  const center = getPalmCenter(landmarks);
  if (!center) return null;

  const x = 1 - center.x;
  const y = center.y;

  if (screen === 'summary') {
    return x > 0.28 && x < 0.72 && y > 0.36 && y < 0.84 && zones.center.enabled ? 'center' : null;
  }

  if (zones.top.enabled && y < 0.22 && x > 0.34 && x < 0.66) return 'top';
  if (zones.left.enabled && x < 0.27 && y > 0.28 && y < 0.82) return 'left';
  if (zones.right.enabled && x > 0.73 && y > 0.28 && y < 0.82) return 'right';
  if (zones.center.enabled && x > 0.34 && x < 0.66 && y > 0.3 && y < 0.82) return 'center';

  return null;
}

function isHandWithdrawn(bounds: HandBounds | null) {
  if (!bounds) return true;
  return bounds.minX < 0.02 || bounds.maxX > 0.98 || bounds.minY < 0.02 || bounds.maxY > 0.98;
}

function buildTrendSeries(values: number[], fallback: number) {
  const source = values.length
    ? values
    : [fallback - 8, fallback - 4, fallback, fallback + 3, fallback + 5].map((value) => clamp(value, 0, 100));
  const points = clamp(source.length, 4, 12);

  return Array.from({ length: points }, (_, index) => {
    const sourceIndex = Math.round((index / Math.max(points - 1, 1)) * (source.length - 1));
    return clamp(Math.round(source[sourceIndex]), 0, 100);
  });
}

function buildTrendPath(values: number[], width: number, height: number, inset = 18) {
  if (!values.length) return '';

  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);
  const span = Math.max(1, maxValue - minValue);

  return values
    .map((value, index) => {
      const x = inset + ((width - inset * 2) * index) / Math.max(values.length - 1, 1);
      const y = height - inset - ((value - minValue) / span) * (height - inset * 2);
      return `${index === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(' ');
}

function buildAssessment(summary: SessionSummary) {
  const completionNote = summary.completed
    ? 'The patient completed the full guided exercise.'
    : `The session ended at ${summary.completionPercent} percent of the planned flow.`;
  const pauseNote = summary.pauseCount
    ? `Pause count ${summary.pauseCount} suggests the next session may need wider framing or a lighter pace.`
    : 'No pause events were recorded, which suggests a stable tracking setup.';

  return `${completionNote} Average accuracy settled near ${summary.averageAccuracy} percent. ${pauseNote}`;
}

function buildSessionSummary(
  session: TrainingSession,
  exercise: Exercise | null,
  snapshot: LegacyGameSnapshot | null,
  completed: boolean,
): SessionSummary {
  const completionPercent = Math.round((session.guideIndex / Math.max(session.totalGuides, 1)) * 100);
  const averageAccuracy = session.accuracySamples.length
    ? Math.round(session.accuracySamples.reduce((sum, value) => sum + value, 0) / session.accuracySamples.length)
    : 0;
  const gameSummary = snapshot?.summary as Record<string, unknown> | null;
  const gameScore = typeof gameSummary?.modeScore === 'number' ? gameSummary.modeScore : 0;
  const accuracyTrend = buildTrendSeries(session.accuracySamples, averageAccuracy || 78);
  const stabilityTrend = accuracyTrend.map((value, index) =>
    clamp(value - Math.abs(index - (accuracyTrend.length - 1) / 2) * 2 + 4, 0, 100),
  );

  const summary: SessionSummary = {
    exerciseName: exercise?.name || 'Unknown Exercise',
    completionPercent,
    averageAccuracy,
    bestAccuracy: session.bestAccuracy,
    pauseCount: session.pauseCount,
    durationLabel: formatDuration(Date.now() - session.startedAt),
    weakestFocus: session.lastCue,
    note:
      completionPercent >= 100
        ? 'The patient completed the full guided flow.'
        : 'The session ended early, but the workspace still captured progress and pace.',
    gameModeTitle: snapshot?.modeTitle || session.gameModeTitle,
    gameScore,
    completed,
    dateLabel: new Date().toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    }),
    pauseLabel: session.pauseCount
      ? `${session.pauseCount} pause${session.pauseCount === 1 ? '' : 's'} during session`
      : 'No pause events recorded',
    accuracyTrend,
    stabilityTrend,
    gameModeNote:
      typeof gameSummary?.notes === 'string'
        ? gameSummary.notes
        : 'Legacy game scoring remains connected through the React compatibility bridge.',
    gameBadge: typeof gameSummary?.badge === 'string' ? gameSummary.badge : 'Legacy Mode',
  };

  summary.assessment = buildAssessment(summary);
  return summary;
}

function getZoneProgress(progress: number) {
  return ({ '--zone-progress': `${Math.round(clamp(progress, 0, 1) * 100)}%` } as CSSProperties);
}

function MediaStage({ live, mode, videoRef, overlayCanvasRef, children }: MediaStageProps) {
  return (
    <div className={`media-stage ${live ? '' : 'is-hidden'}`} data-mode={mode}>
      <video ref={videoRef} autoPlay playsInline muted />
      <canvas ref={overlayCanvasRef} />
      <div className="camera-scrim" />
      {children}
    </div>
  );
}

function ReferenceFrame({ src, emptyMessage }: ReferenceFrameProps) {
  return (
    <div className="reference-frame">
      {src ? (
        <video key={src} autoPlay loop muted playsInline src={src} />
      ) : (
        <div className="empty-reference">{emptyMessage}</div>
      )}
    </div>
  );
}

function PinchDefenseBriefing() {
  return (
    <div className="pinch-defense-briefing">
      <div className="pinch-defense-briefing-head">
        <span>Adaptive pinch support enabled</span>
        <p>
          Pinch Defense starts from the legacy runtime, so this mode uses live camera tracking and the
          finger map below instead of a prerecorded guide video.
        </p>
      </div>

      <div className="pinch-defense-map-grid">
        {PINCH_DEFENSE_FINGER_MAP.map((item) => (
          <div
            key={item.finger}
            className="pinch-defense-map-card"
            style={{ '--pinch-accent': item.color } as CSSProperties}
          >
            <small>{item.symbol}</small>
            <strong>{item.finger}</strong>
          </div>
        ))}
      </div>

      <div className="pinch-defense-briefing-foot">
        <p>Place the whole hand in front of the camera and keep every fingertip visible before starting.</p>
        <span>Start flow: hold center after the camera locks on.</span>
      </div>
    </div>
  );
}

function ZoneCards({
  zones,
  zoneState,
}: {
  zones: Record<ZoneKey, ZoneItem>;
  zoneState: ZoneState;
}) {
  return (
    <>
      {(Object.entries(zones) as Array<[ZoneKey, ZoneItem]>).map(([key, zone]) => (
        <div
          key={key}
          className={[
            'zone-card',
            `zone-card-${key}`,
            zoneState.current === key && zoneState.progress > 0 ? 'is-active' : '',
            zoneState.triggered === key ? 'is-triggered' : '',
            zone.enabled ? '' : 'is-disabled',
          ]
            .filter(Boolean)
            .join(' ')}
          style={getZoneProgress(zoneState.current === key ? zoneState.progress : 0)}
        >
          <strong>{zone.label}</strong>
          <span>{zone.title}</span>
          <small>{zone.description}</small>
        </div>
      ))}
    </>
  );
}

function CameraCallout({
  title,
  body,
  actionLabel,
  pending,
  error,
  onAction,
}: {
  title: string;
  body: string;
  actionLabel: string;
  pending: boolean;
  error: string | null;
  onAction: () => void;
}) {
  return (
    <div className="camera-callout">
      <strong>{title}</strong>
      <p>{body}</p>
      <div className="button-row">
        <button className="button button-primary" type="button" onClick={onAction} disabled={pending}>
          {pending ? 'Starting Camera' : actionLabel}
        </button>
      </div>
      {error ? <p className="sr-message">{error}</p> : null}
    </div>
  );
}

export function RehabWorkspace() {
  const [screen, setScreen] = useState<AppScreen>('zones');
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [exerciseIndex, setExerciseIndex] = useState(0);
  const [guideFrames, setGuideFrames] = useState<GuideFrame[]>([]);
  const [loadingExercises, setLoadingExercises] = useState(true);
  const [apiError, setApiError] = useState<string | null>(null);
  const [training, setTraining] = useState<TrainingSession | null>(null);
  const [summary, setSummary] = useState<SessionSummary | null>(null);
  const [gameSnapshot, setGameSnapshot] = useState<LegacyGameSnapshot | null>(null);
  const [zoneState, setZoneState] = useState<ZoneState>({
    current: null,
    enteredAt: 0,
    progress: 0,
    cooldownUntil: 0,
    triggered: null,
    triggeredAt: 0,
  });

  const mediaPipe = useLegacyMediaPipe();
  const legacyGamification = useLegacyGamification();

  const runtimeRef = useRef<LegacyGameRuntime | null>(null);
  const mountedRuntimeRef = useRef<LegacyGameRuntime | null>(null);
  const gameMountRef = useRef<HTMLDivElement | null>(null);
  const frameClockRef = useRef(0);
  const handLossStartedAtRef = useRef(0);
  const zoneStateRef = useRef<ZoneState>({
    current: null,
    enteredAt: 0,
    progress: 0,
    cooldownUntil: 0,
    triggered: null,
    triggeredAt: 0,
  });

  const currentExercise = exercises[exerciseIndex] || null;
  const exerciseCopy = getExerciseCopy(currentExercise);
  const currentGuideCount = Math.max(guideFrames.length, 4);
  const interactionMode = getInteractionMode(currentExercise);
  const isPinchDefenseExercise = interactionMode === 'pinch_defense';
  const cameraLive = mediaPipe.running;
  const trackingOk = Boolean(mediaPipe.trackedHand.landmarks && !isHandWithdrawn(mediaPipe.trackedHand.bounds));
  const activeZoneLabel = useMemo(
    () => getActiveZoneLabel(mediaPipe.trackedHand.landmarks),
    [mediaPipe.trackedHand.landmarks],
  );

  const referenceVideoUrl = currentExercise?.video_ready ? getVideoUrl(currentExercise.id) : null;
  const canStartTraining = Boolean(currentExercise) && (
    interactionMode === 'pinch_defense'
      ? legacyGamification.ready
      : guideFrames.length > 0
  );

  const runtimeHud = gameSnapshot?.hud || {
    primaryLabel: 'Mode Score',
    primaryValue: '0',
    secondaryLabel: 'Objective',
    secondaryValue: 'Follow guide checkpoints',
    statusText: legacyGamification.ready ? 'Legacy runtime ready' : 'Loading legacy runtime',
  };

  const runtimeViewState = gameSnapshot?.viewState || null;
  const progressPercent = training ? Math.round((training.guideIndex / Math.max(training.totalGuides, 1)) * 100) : 0;
  const latestAccuracy = training?.accuracySamples.length
    ? training.accuracySamples[training.accuracySamples.length - 1]
    : 0;
  const trainingIsPinchDefense = training?.interactionMode === 'pinch_defense';

  const zoneConfig = useMemo<Record<ZoneKey, ZoneItem>>(() => {
    const hasSummary = Boolean(summary);
    switch (screen) {
      case 'instructions':
        return {
          top: {
            label: 'Summary',
            title: 'View summary',
            description: 'Open the latest completed summary.',
            enabled: hasSummary,
          },
          left: {
            label: 'Previous',
            title: 'Back / previous',
            description: 'Switch to the previous exercise.',
            enabled: exercises.length > 1,
          },
          center: {
            label: 'Start',
            title: 'Start training',
            description: 'Begin the live training view.',
            enabled: canStartTraining,
          },
          right: {
            label: 'Next',
            title: 'Next / forward',
            description: 'Switch to the next exercise.',
            enabled: exercises.length > 1,
          },
        };
      case 'paused':
        return {
          top: {
            label: 'Summary',
            title: 'Open summary',
            description: 'Review the current session summary.',
            enabled: Boolean(training || summary),
          },
          left: {
            label: 'Previous',
            title: 'Previous exercise',
            description: 'Leave pause and load the previous exercise.',
            enabled: exercises.length > 1,
          },
          center: {
            label: 'Resume',
            title: 'Resume session',
            description: 'Return to live training from the pause state.',
            enabled: Boolean(training),
          },
          right: {
            label: 'Next',
            title: 'Next exercise',
            description: 'Leave pause and load the next exercise.',
            enabled: exercises.length > 1,
          },
        };
      case 'summary':
        return {
          top: {
            label: 'Summary',
            title: 'Current summary',
            description: 'The latest session report is already open.',
            enabled: true,
          },
          left: {
            label: 'Menu',
            title: 'Return to menu',
            description: 'Go back to the instruction screen.',
            enabled: true,
          },
          center: {
            label: 'Return',
            title: 'Back to menu',
            description: 'Hold center or use the fallback button.',
            enabled: true,
          },
          right: {
            label: 'Repeat',
            title: 'Restart exercise',
            description: 'Open the instruction screen for another run.',
            enabled: true,
          },
        };
      default:
        return {
          top: {
            label: 'Summary',
            title: 'View summary',
            description: 'Open the most recent completed session summary.',
            enabled: hasSummary,
          },
          left: {
            label: 'Previous',
            title: 'Back / previous',
            description: 'Change exercise while browsing the menu.',
            enabled: exercises.length > 1,
          },
          center: {
            label: 'Start',
            title: 'Start / continue',
            description: 'Open the instruction screen for the selected exercise.',
            enabled: true,
          },
          right: {
            label: 'Next',
            title: 'Next / forward',
            description: 'Change exercise while browsing the menu.',
            enabled: exercises.length > 1,
          },
        };
    }
  }, [canStartTraining, exercises.length, screen, summary, training]);

  const updateZoneState = useCallback((updater: (current: ZoneState) => ZoneState) => {
    const nextState = updater(zoneStateRef.current);
    if (isSameZoneState(zoneStateRef.current, nextState)) {
      return;
    }
    zoneStateRef.current = nextState;
    setZoneState(nextState);
  }, []);

  const resetZoneState = useCallback(() => {
    const nextState: ZoneState = {
      current: null,
      enteredAt: 0,
      progress: 0,
      cooldownUntil: zoneStateRef.current.cooldownUntil,
      triggered:
        performance.now() - zoneStateRef.current.triggeredAt < ZONE_TRIGGER_FLASH_MS
          ? zoneStateRef.current.triggered
          : null,
      triggeredAt: zoneStateRef.current.triggeredAt,
    };
    if (isSameZoneState(zoneStateRef.current, nextState)) {
      return;
    }
    zoneStateRef.current = nextState;
    setZoneState(nextState);
  }, []);

  const syncRuntimeSnapshot = useCallback(() => {
    const runtime = runtimeRef.current;
    if (!runtime) {
      setGameSnapshot(null);
      return null;
    }

    const snapshot = runtime.snapshot();
    setGameSnapshot(snapshot);
    return snapshot;
  }, []);

  const disposeRuntime = useCallback(() => {
    try {
      mountedRuntimeRef.current?.unmount();
    } catch (error) {
      console.error('Failed to unmount legacy runtime', error);
    }

    mountedRuntimeRef.current = null;
    runtimeRef.current = null;
    setGameSnapshot(null);
  }, []);

  useEffect(() => {
    let cancelled = false;

    const loadExercises = async () => {
      try {
        setLoadingExercises(true);
        setApiError(null);
        const nextExercises = await getExercises();
        if (cancelled) return;
        setExercises(nextExercises);
      } catch (error) {
        if (cancelled) return;
        setApiError(error instanceof Error ? error.message : 'Could not load exercise metadata.');
      } finally {
        if (!cancelled) {
          setLoadingExercises(false);
        }
      }
    };

    void loadExercises();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!currentExercise?.landmarks_ready) {
      setGuideFrames([]);
      return;
    }

    let cancelled = false;

    const loadReferenceData = async () => {
      try {
        const referenceData = await getLandmarks(currentExercise.id);
        if (!cancelled) {
          setGuideFrames(buildGuideFrames(referenceData));
        }
      } catch {
        if (!cancelled) {
          setGuideFrames([]);
        }
      }
    };

    void loadReferenceData();

    return () => {
      cancelled = true;
    };
  }, [currentExercise?.id, currentExercise?.landmarks_ready]);

  useEffect(() => () => {
    disposeRuntime();
  }, [disposeRuntime]);

  useEffect(() => {
    const runtime = runtimeRef.current;
    const mountNode = gameMountRef.current;
    const needsMount = Boolean(
      screen === 'training' &&
      training &&
      training.interactionMode === 'pinch_defense' &&
      runtime &&
      mountNode,
    );

    if (!needsMount || !runtime || !mountNode) {
      if (mountedRuntimeRef.current) {
        mountedRuntimeRef.current.unmount();
        mountedRuntimeRef.current = null;
      }
      return;
    }

    if (mountedRuntimeRef.current !== runtime) {
      mountedRuntimeRef.current?.unmount();
      runtime.mount(mountNode);
      mountedRuntimeRef.current = runtime;
    }

    return () => {
      if (mountedRuntimeRef.current === runtime) {
        runtime.unmount();
        mountedRuntimeRef.current = null;
      }
    };
  }, [screen, training]);

  const finishTraining = useCallback((completed: boolean, sessionOverride?: TrainingSession) => {
    const activeSession = sessionOverride || training;
    if (!activeSession) return;

    const runtime = runtimeRef.current;
    if (runtime) {
      runtime.notifySessionEnd({
        completed,
        durationMs: Date.now() - activeSession.startedAt,
        completionPercent: Math.round((activeSession.guideIndex / Math.max(activeSession.totalGuides, 1)) * 100),
      });
    }

    const snapshot = syncRuntimeSnapshot();
    const nextSummary = buildSessionSummary(activeSession, currentExercise, snapshot, completed);
    setSummary(nextSummary);
    setTraining(null);
    handLossStartedAtRef.current = 0;
    disposeRuntime();
    setScreen('summary');
  }, [currentExercise, disposeRuntime, syncRuntimeSnapshot, training]);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime || !training || screen !== 'training') {
      return;
    }

    const now = performance.now();
    const deltaSeconds = frameClockRef.current ? Math.max(0, (now - frameClockRef.current) / 1000) : 0;
    frameClockRef.current = now;

    runtime.notifyFrame({
      now,
      deltaSeconds,
      landmarks: mediaPipe.trackedHand.landmarks,
      bounds: mediaPipe.trackedHand.bounds,
      handedness: mediaPipe.trackedHand.handedness,
      handPresent: Boolean(mediaPipe.trackedHand.landmarks),
      trackingOk,
      guideIndex: training.guideIndex,
      completionPercent: Math.round((training.guideIndex / Math.max(training.totalGuides, 1)) * 100),
      holdProgress: 0,
    });

    const snapshot = syncRuntimeSnapshot();
    const finishRequested = Boolean(
      snapshot?.viewState &&
      'finishRequested' in snapshot.viewState &&
      snapshot.viewState.finishRequested,
    );
    const completed = Boolean(snapshot?.viewState && 'completed' in snapshot.viewState && snapshot.viewState.completed);

    if (!trackingOk) {
      handLossStartedAtRef.current = handLossStartedAtRef.current || now;
      const pauseThreshold = training.interactionMode === 'pinch_defense' ? 800 : 900;
      if (now - handLossStartedAtRef.current >= pauseThreshold) {
        runtime.notifyPause({
          guideIndex: training.guideIndex,
          completionPercent: Math.round((training.guideIndex / Math.max(training.totalGuides, 1)) * 100),
        });
        syncRuntimeSnapshot();
        setTraining((current) => (current ? { ...current, pauseCount: current.pauseCount + 1 } : current));
        setScreen('paused');
      }
    } else {
      handLossStartedAtRef.current = 0;
    }

    if (finishRequested) {
      finishTraining(completed);
    }
  }, [
    finishTraining,
    mediaPipe.trackedHand.bounds,
    mediaPipe.trackedHand.handedness,
    mediaPipe.trackedHand.landmarks,
    mediaPipe.trackedHand.updatedAt,
    screen,
    syncRuntimeSnapshot,
    trackingOk,
    training,
  ]);

  const enableCamera = async () => {
    await mediaPipe.start();
  };

  const goToExercise = useCallback((direction: number) => {
    if (!exercises.length) return;
    setTraining(null);
    disposeRuntime();
    setExerciseIndex((current) => (current + direction + exercises.length) % exercises.length);
    setScreen('instructions');
  }, [disposeRuntime, exercises.length]);

  const startTraining = useCallback(() => {
    if (!currentExercise) return;

    disposeRuntime();

    const runtime = legacyGamification.ready && window.BlueprintGamification
      ? window.BlueprintGamification.createRuntime(currentExercise.id, {
          exerciseId: currentExercise.id,
          exerciseName: currentExercise.name,
        })
      : null;

    runtimeRef.current = runtime;

    const nextTraining: TrainingSession = {
      interactionMode,
      guideIndex: 0,
      totalGuides: currentGuideCount,
      pauseCount: 0,
      startedAt: Date.now(),
      bestAccuracy: 0,
      accuracySamples: [],
      lastCue:
        interactionMode === 'pinch_defense'
          ? 'Defend the lane with clean pinches.'
          : 'Match the first checkpoint from the reference guide.',
      detail:
        interactionMode === 'pinch_defense'
          ? 'Legacy pinch-defense logic is receiving React-based MediaPipe frames.'
          : 'Use the reference clip, then confirm each checkpoint as the pose lines up.',
      gameModeTitle: runtime?.modeTitle || currentExercise.game_mode || 'Guided Mode',
    };

    if (runtime) {
      runtime.notifySessionStart({
        exerciseId: currentExercise.id,
        exerciseName: currentExercise.name,
        guideCount: currentGuideCount,
        sessionDurationMs: (currentExercise.session_duration_seconds || currentExercise.duration || 60) * 1000,
        interactionMode,
        handedness: mediaPipe.trackedHand.handedness,
      });
    }

    frameClockRef.current = performance.now();
    handLossStartedAtRef.current = 0;
    setTraining(nextTraining);
    setScreen('training');
    syncRuntimeSnapshot();
  }, [
    currentExercise,
    currentGuideCount,
    disposeRuntime,
    interactionMode,
    legacyGamification.ready,
    mediaPipe.trackedHand.handedness,
    syncRuntimeSnapshot,
  ]);

  const advanceTraining = useCallback(() => {
    if (!training) return;

    const nextGuideIndex = Math.min(training.guideIndex + 1, training.totalGuides);
    const accuracySeed = trackingOk ? 80 : 62;
    const accuracy = clamp(accuracySeed + nextGuideIndex * 3 + Math.round(Math.random() * 12), 0, 99);
    const completed = nextGuideIndex >= training.totalGuides;

    runtimeRef.current?.notifyCheckpoint({
      previousGuideIndex: training.guideIndex,
      nextGuideIndex,
      score: accuracy,
      completionPercent: Math.round((nextGuideIndex / Math.max(training.totalGuides, 1)) * 100),
      result: {
        overall_score: accuracy,
      },
    });
    syncRuntimeSnapshot();

    const nextTraining: TrainingSession = {
      ...training,
      guideIndex: nextGuideIndex,
      bestAccuracy: Math.max(training.bestAccuracy, accuracy),
      accuracySamples: [...training.accuracySamples, accuracy],
      lastCue:
        nextGuideIndex >= training.totalGuides
          ? 'Session complete. Review the summary.'
          : `Checkpoint ${nextGuideIndex + 1} is ready. Refine the next pose.`,
      detail:
        currentExercise?.interaction_mode === 'pinch_defense'
          ? 'The legacy runtime is frame-driven, so the manual confirm button is not used here.'
          : `Guide checkpoint ${nextGuideIndex} of ${training.totalGuides} confirmed.`,
      gameModeTitle: training.gameModeTitle,
    };

    if (completed) {
      setTraining(nextTraining);
      finishTraining(true, nextTraining);
      return;
    }

    setTraining(nextTraining);
  }, [currentExercise?.interaction_mode, finishTraining, syncRuntimeSnapshot, trackingOk, training]);

  const pauseTraining = useCallback(() => {
    if (!training) return;
    runtimeRef.current?.notifyPause({
      guideIndex: training.guideIndex,
      completionPercent: Math.round((training.guideIndex / Math.max(training.totalGuides, 1)) * 100),
    });
    syncRuntimeSnapshot();
    handLossStartedAtRef.current = 0;
    setTraining({
      ...training,
      pauseCount: training.pauseCount + 1,
    });
    setScreen('paused');
  }, [syncRuntimeSnapshot, training]);

  const resumeTraining = useCallback(() => {
    if (!training) return;
    runtimeRef.current?.notifyResume({
      guideIndex: training.guideIndex,
      completionPercent: Math.round((training.guideIndex / Math.max(training.totalGuides, 1)) * 100),
    });
    syncRuntimeSnapshot();
    handLossStartedAtRef.current = 0;
    frameClockRef.current = performance.now();
    setScreen('training');
  }, [syncRuntimeSnapshot, training]);

  const openSummary = useCallback(() => {
    if (training) {
      finishTraining(false);
      return;
    }

    if (summary) {
      setScreen('summary');
    }
  }, [finishTraining, summary, training]);

  const returnToInstructions = useCallback(() => {
    setScreen('instructions');
  }, []);

  const handleZoneAction = useCallback((zoneName: ZoneKey) => {
    switch (screen) {
      case 'zones':
        if (zoneName === 'center') {
          setScreen('instructions');
        } else if (zoneName === 'top' && summary) {
          setScreen('summary');
        }
        break;
      case 'instructions':
        if (zoneName === 'left') {
          goToExercise(-1);
        } else if (zoneName === 'right') {
          goToExercise(1);
        } else if (zoneName === 'center' && canStartTraining) {
          startTraining();
        } else if (zoneName === 'top' && summary) {
          setScreen('summary');
        }
        break;
      case 'paused':
        if (zoneName === 'left') {
          goToExercise(-1);
        } else if (zoneName === 'right') {
          goToExercise(1);
        } else if (zoneName === 'center') {
          resumeTraining();
        } else if (zoneName === 'top') {
          openSummary();
        }
        break;
      case 'summary':
        if (zoneName === 'center') {
          returnToInstructions();
        }
        break;
      default:
        break;
    }
  }, [canStartTraining, goToExercise, openSummary, resumeTraining, returnToInstructions, screen, startTraining, summary]);

  const onSidebarSelect = (target: AppScreen) => {
    switch (target) {
      case 'zones':
      case 'instructions':
        setScreen(target);
        break;
      case 'training':
        if (training) {
          setScreen('training');
        } else {
          setScreen('instructions');
        }
        break;
      case 'paused':
        if (training) {
          setScreen('paused');
        }
        break;
      case 'summary':
        if (summary) {
          setScreen('summary');
        }
        break;
    }
  };

  const topbarStatus = cameraLive ? 'Camera live' : 'Camera offline';
  const exerciseMeta = loadingExercises
    ? 'Loading exercise data'
    : currentExercise
      ? `${currentExercise.name} / ${currentExercise.game_mode || 'guided'}`
      : 'Waiting for exercise data';

  useEffect(() => {
    if (!['zones', 'instructions', 'paused', 'summary'].includes(screen) || !cameraLive) {
      resetZoneState();
      return;
    }

    const now = performance.now();
    const zoneName = getActiveZoneKey(mediaPipe.trackedHand.landmarks, screen, zoneConfig);
    const currentState = zoneStateRef.current;
    const triggered = now - currentState.triggeredAt < ZONE_TRIGGER_FLASH_MS ? currentState.triggered : null;
    const inCooldown = now < currentState.cooldownUntil;

    if (!zoneName || inCooldown) {
      updateZoneState(() => ({
        current: zoneName,
        enteredAt: zoneName ? now : 0,
        progress: 0,
        cooldownUntil: currentState.cooldownUntil,
        triggered,
        triggeredAt: currentState.triggeredAt,
      }));
      return;
    }

    const enteredAt = currentState.current === zoneName ? currentState.enteredAt : now;
    const progress = clamp((now - enteredAt) / ZONE_HOLD_MS, 0, 1);

    if (progress >= 1) {
      updateZoneState(() => ({
        current: null,
        enteredAt: 0,
        progress: 0,
        cooldownUntil: now + ZONE_COOLDOWN_MS,
        triggered: zoneName,
        triggeredAt: now,
      }));
      handleZoneAction(zoneName);
      return;
    }

    updateZoneState(() => ({
      current: zoneName,
      enteredAt,
      progress,
      cooldownUntil: currentState.cooldownUntil,
      triggered,
      triggeredAt: currentState.triggeredAt,
    }));
  }, [
    cameraLive,
    handleZoneAction,
    mediaPipe.trackedHand.landmarks,
    mediaPipe.trackedHand.updatedAt,
    resetZoneState,
    screen,
    updateZoneState,
    zoneConfig,
  ]);

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand-lockup">
          <div className="brand-name">Blueprint Rehab</div>
          <div className="brand-subtitle">Camera-guided recovery training</div>
        </div>

        <nav className="topbar-nav" aria-label="Primary">
          <span>Overview</span>
          <span className="is-active">Training</span>
          <span>History</span>
        </nav>

        <div className="topbar-status">
          <span className="status-pill">
            <span className={`status-dot ${cameraLive ? 'is-live' : ''}`} />
            <span>{topbarStatus}</span>
          </span>
        </div>
      </header>

      <div className="app-layout">
        <aside className="sidebar">
          <div className="sidebar-heading">
            <div className="eyebrow">Rehab Portal</div>
            <h1>Active Session</h1>
          </div>

          <nav className="sidebar-nav" aria-label="Session">
            {[
              { key: 'instructions', icon: 'i', label: 'Instructions' },
              { key: 'training', icon: '+', label: 'Training' },
              { key: 'zones', icon: '#', label: 'Zones' },
              { key: 'paused', icon: '||', label: 'Pause' },
              { key: 'summary', icon: '=', label: 'Summary' },
            ].map((item) => {
              const target = item.key as AppScreen;
              const isActive = screen === target;
              const isDisabled = (target === 'paused' && !training) || (target === 'summary' && !summary);
              return (
                <button
                  key={item.key}
                  className={`nav-item ${isActive ? 'is-active' : ''}`}
                  type="button"
                  disabled={isDisabled}
                  onClick={() => onSidebarSelect(target)}
                >
                  <span className="nav-icon">{item.icon}</span>
                  <span>{item.label}</span>
                </button>
              );
            })}
          </nav>

          <div className="sidebar-footer">
            <div className="profile-chip">
              <div className="profile-avatar">HR</div>
              <div>
                <div className="profile-name">Hand Recovery</div>
                <div className="profile-id">{exerciseMeta}</div>
              </div>
            </div>
          </div>
        </aside>

        <main className="main-shell">
          <div className="screen-root">
            {screen === 'zones' ? (
              <section className="screen">
                <div className="screen-title-row">
                  <div>
                    <div className="screen-kicker">Tutorial Stage 01</div>
                    <h2 className="hero-title">Interface Navigation</h2>
                    <p className="body-copy">
                      Move your hand into a zone and hold long enough for the progress line to fill. The same zone logic is reused on the instruction and pause screens.
                    </p>
                  </div>
                  <div className="screen-meta">{cameraLive ? 'Optical sensors active' : 'Camera offline'}</div>
                </div>

                <div className="zones-layout">
                  <section className="zones-info">
                    {!cameraLive ? (
                      <CameraCallout
                        title="Turn On The Camera For Zone Practice"
                        body="The tutorial works best with live hand tracking so the left, center, right, and top hold zones can respond in real time."
                        actionLabel="Enable camera"
                        pending={mediaPipe.pending}
                        error={mediaPipe.error}
                        onAction={enableCamera}
                      />
                    ) : (
                      <div className="camera-callout">
                        <strong>Tracking Live</strong>
                        <p>
                          Active zone: {activeZoneLabel}. Handedness: {mediaPipe.trackedHand.handedness}. Tracking is {trackingOk ? 'stable' : 'near the frame edge'}.
                        </p>
                      </div>
                    )}

                    {apiError ? (
                      <div className="asset-warning">{apiError}</div>
                    ) : null}

                    <div className="zones-list">
                      <div className="card">
                        <strong>Center hold</strong>
                        <span>Start or continue the current flow.</span>
                      </div>
                      <div className="card">
                        <strong>Left and right</strong>
                        <span>Change exercise while browsing instructions or pause.</span>
                      </div>
                      <div className="card">
                        <strong>Top zone</strong>
                        <span>Open the latest session summary when one exists.</span>
                      </div>
                    </div>

                    <div className="button-row">
                      <button className="button button-secondary" type="button" onClick={returnToInstructions}>
                        Skip tutorial
                      </button>
                      <button className="button button-primary" type="button" onClick={returnToInstructions}>
                        Open instructions
                      </button>
                    </div>
                  </section>

                  <section className="zones-stage-shell">
                    <div className="stage-mount">
                      <MediaStage
                        live={cameraLive}
                        mode="zones"
                        videoRef={mediaPipe.setPreviewVideoElement}
                        overlayCanvasRef={mediaPipe.setOverlayCanvasElement}
                      />
                    </div>
                    <div className="zone-overlay">
                      <ZoneCards zones={zoneConfig} zoneState={zoneState} />
                    </div>
                  </section>
                </div>

                <div className="zone-footer">
                  <div className="zone-footnote">
                    <span>Latency target: live</span>
                    <span>Zone dwell: 2.5 seconds</span>
                    <span>Hand tracking: single-hand active</span>
                  </div>
                  <div className="button-row">
                    <button className="button button-secondary" type="button" onClick={returnToInstructions}>
                      Continue
                    </button>
                  </div>
                </div>
              </section>
            ) : null}

            {screen === 'instructions' ? (
              <section className="screen instructions-screen">
                <div className="screen-title-row">
                  <div>
                    <div className="screen-kicker">Preparation Stage 02</div>
                    <h2 className="hero-title">{currentExercise?.name || 'Loading Exercise'}</h2>
                    <p className="body-copy">
                      {isPinchDefenseExercise
                        ? 'Review the finger mapping, keep the whole hand visible, then use the live camera on the right to launch the defense runtime.'
                        : 'Watch the reference clip first, then use your live camera on the right to start, switch exercise, or open the summary.'}
                    </p>
                  </div>
                  <div className="screen-meta">Zone holds follow your own left and right</div>
                </div>

                <div className="instruction-layout">
                  <section className="instruction-media-column">
                    <section className="hero-panel instruction-meta-panel">
                      <div className="hero-chip">{exerciseCopy.label}</div>
                      <p className="hero-copy">{exerciseCopy.overview}</p>

                      <div className="hero-metrics">
                        <div className="hero-metric">
                          <strong>Difficulty</strong>
                          <span>{exerciseCopy.label.split(' - ')[0]}</span>
                        </div>
                        <div className="hero-metric">
                          <strong>Estimated Time</strong>
                          <span>
                            {currentExercise
                              ? `${Math.max(1, Math.round((currentExercise.session_duration_seconds || currentExercise.duration || 60) / 12))} Minutes`
                              : '--'}
                          </span>
                        </div>
                        <div className="hero-metric">
                          <strong>Guide Checkpoints</strong>
                          <span>{isPinchDefenseExercise ? 'Runtime' : guideFrames.length || '--'}</span>
                        </div>
                      </div>

                      {!cameraLive ? (
                        <CameraCallout
                          title="Enable Camera Before Starting"
                          body="You can browse the exercise without it, but live coaching, pause detection, and zone controls all need camera access."
                          actionLabel="Enable camera"
                          pending={mediaPipe.pending}
                          error={mediaPipe.error}
                          onAction={enableCamera}
                        />
                      ) : null}

                      {legacyGamification.error ? (
                        <div className="asset-warning">{legacyGamification.error}</div>
                      ) : null}

                      {apiError ? (
                        <div className="asset-warning">{apiError}</div>
                      ) : null}

                      {!isPinchDefenseExercise && (!currentExercise?.video_ready || !currentExercise?.landmarks_ready) ? (
                        <div className="asset-warning">
                          {!currentExercise?.video_ready ? 'Reference video is missing. ' : ''}
                          {!currentExercise?.landmarks_ready ? 'Landmark checkpoints are missing for this exercise.' : ''}
                        </div>
                      ) : null}

                      <div className="button-row">
                        <button className="button button-secondary" type="button" onClick={() => goToExercise(-1)}>
                          Previous
                        </button>
                        <button className="button button-secondary" type="button" onClick={() => goToExercise(1)}>
                          Next
                        </button>
                        <button
                          className={`button button-primary ${zoneState.current === 'center' && zoneState.progress > 0 ? 'is-active' : ''}`}
                          type="button"
                          onClick={startTraining}
                          disabled={!canStartTraining}
                          data-zone-card="center"
                          style={getZoneProgress(zoneState.current === 'center' ? zoneState.progress : 0)}
                        >
                          Hold center to start
                        </button>
                      </div>
                    </section>

                    <div className="instruction-video-shell">
                      {isPinchDefenseExercise ? (
                        <PinchDefenseBriefing />
                      ) : (
                        <ReferenceFrame
                          src={referenceVideoUrl}
                          emptyMessage="Reference clip unavailable for this exercise."
                        />
                      )}
                    </div>

                    <section className="hero-guidance instruction-guidance">
                      <strong>Preparation and Form</strong>
                      <p>{exerciseCopy.guidance}</p>
                      <ul>
                        {exerciseCopy.tips.map((tip) => (
                          <li key={tip}>{tip}</li>
                        ))}
                      </ul>
                    </section>
                  </section>

                  <section className="instruction-side-column">
                    <section className="instruction-stage-shell">
                      <div className="stage-mount">
                        <MediaStage
                          live={cameraLive}
                          mode="instructions"
                          videoRef={mediaPipe.setPreviewVideoElement}
                          overlayCanvasRef={mediaPipe.setOverlayCanvasElement}
                        />
                      </div>
                      <div className="zone-overlay">
                        <ZoneCards zones={zoneConfig} zoneState={zoneState} />
                      </div>
                    </section>
                  </section>
                </div>
              </section>
            ) : null}

            {screen === 'training' && training ? (
              <section className="screen training-screen">
                <div className="training-layout">
                  <aside className="progress-rail">
                    <div className="progress-bar-shell">
                      <div className="progress-bar-fill" style={{ height: `${progressPercent}%` }}>
                        <div className="progress-pop">{progressPercent}%</div>
                      </div>
                    </div>
                    <div className="progress-label">
                      <strong>Progress</strong>
                      <span>{progressPercent}% complete</span>
                    </div>
                  </aside>

                  <section>
                    <div className="training-stage-shell">
                      {trainingIsPinchDefense ? (
                        <div ref={gameMountRef} className="stage-mount" />
                      ) : (
                        <div className="stage-mount">
                          <MediaStage
                            live={cameraLive}
                            mode="training"
                            videoRef={mediaPipe.setPreviewVideoElement}
                            overlayCanvasRef={mediaPipe.setOverlayCanvasElement}
                          />
                        </div>
                      )}

                      <div className="training-overlay">
                        <div className="training-head">
                          <div>
                            <div className="training-subtitle">Target pose</div>
                            <h2 className="training-title">{currentExercise?.name || 'Training'}</h2>
                          </div>
                          <div className="status-box">
                            <strong>Calibration Status</strong>
                            <span>{trackingOk ? 'Optimal sensor lock' : 'Recenter hand'}</span>
                            <div className="status-caption">Legacy runtime bridge active</div>
                          </div>
                        </div>

                        <div className="training-cue">
                          <strong>Live guidance</strong>
                          <p>{training.lastCue}</p>
                          <span>
                            {runtimeViewState && 'cueText' in runtimeViewState
                              ? String(runtimeViewState.cueText)
                              : training.detail}
                          </span>
                        </div>

                        <div className="training-game-hud">
                          <strong>{gameSnapshot?.modeTitle || training.gameModeTitle}</strong>
                          <div className="training-game-grid">
                            <div>
                              <span>{runtimeHud.primaryLabel}</span>
                              <b>{runtimeHud.primaryValue}</b>
                            </div>
                            <div>
                              <span>{runtimeHud.secondaryLabel}</span>
                              <b>{runtimeHud.secondaryValue}</b>
                            </div>
                          </div>
                          <small>{runtimeHud.statusText}</small>
                        </div>

                        <div className="training-edge-note">Withdraw hand to pause session</div>
                      </div>
                    </div>

                    <div className="button-row" style={{ marginTop: '16px' }}>
                      <button className="button button-secondary" type="button" onClick={pauseTraining}>
                        Pause session
                      </button>
                      <button className="button button-secondary" type="button" onClick={openSummary}>
                        Finish early
                      </button>
                      {!trainingIsPinchDefense ? (
                        <button className="button button-primary" type="button" onClick={advanceTraining}>
                          Confirm checkpoint
                        </button>
                      ) : null}
                    </div>
                  </section>
                </div>
              </section>
            ) : null}

            {screen === 'paused' && training ? (
              <section className="screen paused-shell">
                <div className="paused-header">
                  <div>
                    <div className="screen-kicker" style={{ color: 'var(--danger)' }}>
                      Hand withdrawn
                    </div>
                    <h2 className="paused-title">Session Paused</h2>
                  </div>
                  <div className="screen-meta">Elapsed time {formatDuration(Date.now() - training.startedAt)}</div>
                </div>

                <div className="paused-content">
                  <div className="paused-stage-shell">
                    <div className="stage-mount">
                      <MediaStage
                        live={cameraLive}
                        mode="paused"
                        videoRef={mediaPipe.setPreviewVideoElement}
                        overlayCanvasRef={mediaPipe.setOverlayCanvasElement}
                      />
                    </div>

                    <div className="paused-overlay">
                      <div className="zone-card zone-card-top is-disabled">
                        <strong>Summary</strong>
                        <span>Move up</span>
                        <small>Open the current session summary.</small>
                      </div>
                      <div className="zone-card zone-card-left is-disabled">
                        <strong>Previous</strong>
                        <span>Switch back</span>
                        <small>Load the previous exercise.</small>
                      </div>
                      <div className="zone-card zone-card-right is-disabled">
                        <strong>Next</strong>
                        <span>Switch forward</span>
                        <small>Load the next exercise.</small>
                      </div>
                      <div
                        className="paused-center-card"
                        style={getZoneProgress(zoneState.current === 'center' ? zoneState.progress : 0)}
                      >
                        <strong>Navigation active</strong>
                        <h3>Hold center to resume</h3>
                        <p>Show the full hand again and return to the center zone when tracking is stable.</p>
                      </div>
                    </div>

                    <div className="paused-float-card">
                      <strong>Current Progress</strong>
                      <div className="paused-metric">
                        <span>Progress</span>
                        <b>{progressPercent}%</b>
                      </div>
                      <div className="paused-metric">
                        <span>Live Accuracy</span>
                        <b>{latestAccuracy}%</b>
                      </div>
                      <div className="paused-metric">
                        <span>Pauses</span>
                        <b>{training.pauseCount}</b>
                      </div>
                      <div className="button-row" style={{ marginTop: '18px' }}>
                        <button className="button button-primary" type="button" onClick={resumeTraining}>
                          Resume
                        </button>
                        <button className="button button-secondary" type="button" onClick={openSummary}>
                          Summary
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="paused-reference-shell">
                    <ReferenceFrame
                      src={referenceVideoUrl}
                      emptyMessage="Reference clip unavailable for this exercise."
                    />
                  </div>
                </div>
              </section>
            ) : null}

            {screen === 'summary' ? (
              <section className="screen summary-shell">
                {summary ? (
                  <>
                    <div className="summary-head">
                      <div>
                        <div className="screen-kicker">Performance Protocol</div>
                        <h2 className="summary-title">Session Summary</h2>
                      </div>
                      <div className="screen-meta">
                        {summary.dateLabel} - {summary.exerciseName}
                      </div>
                    </div>

                    <div className="summary-grid">
                      <div className="metrics-stack">
                        <div className="metric-card">
                          <strong>Exercise Completion</strong>
                          <div className="metric-value">
                            {summary.completionPercent}
                            <small>%</small>
                          </div>
                          <div className="metric-footer">
                            {summary.completed
                              ? 'Completed the full exercise.'
                              : `Session ended at ${summary.completionPercent}% completion.`}
                          </div>
                        </div>

                        <div className="metric-card">
                          <strong>Average Accuracy</strong>
                          <div className="metric-value">
                            {summary.averageAccuracy}
                            <small>%</small>
                          </div>
                          <div className="metric-footer">
                            Best accuracy {summary.bestAccuracy}% - focus cue {summary.weakestFocus}
                          </div>
                        </div>

                        <div className="metric-card">
                          <strong>Total Time</strong>
                          <div className="metric-value">
                            {summary.durationLabel}
                            <small>mm:ss</small>
                          </div>
                          <div className="metric-footer">{summary.pauseLabel}</div>
                        </div>

                        <div className="metric-card">
                          <strong>{summary.gameModeTitle || 'Game Mode'}</strong>
                          <div className="metric-value">
                            {summary.gameScore || 0}
                            <small>pts</small>
                          </div>
                          <div className="metric-footer">
                            {summary.gameBadge} - {summary.gameModeNote}
                          </div>
                        </div>
                      </div>

                      <section className="summary-chart-card">
                        <div className="summary-chart-header">
                          <div>
                            <h3>Stability And Accuracy Tracking</h3>
                            <div className="screen-meta">Post-session movement analysis</div>
                          </div>
                          <div className="legend">
                            <div className="legend-item">
                              <span className="legend-swatch" style={{ background: 'var(--primary)' }} />
                              <span>Accuracy</span>
                            </div>
                            <div className="legend-item">
                              <span className="legend-swatch" style={{ background: 'var(--secondary)' }} />
                              <span>Stability</span>
                            </div>
                          </div>
                        </div>

                        <div className="summary-chart">
                          <svg viewBox="0 0 760 320" preserveAspectRatio="none">
                            <path
                              d={buildTrendPath(summary.accuracyTrend || [], 760, 320)}
                              fill="none"
                              stroke="var(--primary)"
                              strokeWidth="5"
                            />
                            <path
                              d={buildTrendPath(summary.stabilityTrend || [], 760, 320)}
                              fill="none"
                              stroke="var(--secondary)"
                              strokeWidth="4"
                              strokeDasharray="10 6"
                            />
                          </svg>
                          <div className="summary-axis">
                            <span>Start</span>
                            <span>Movement midpoint</span>
                            <span>Finish</span>
                          </div>
                        </div>

                        <div className="assessment-card">
                          <strong>Architectural Assessment</strong>
                          <div>{summary.assessment}</div>
                        </div>
                      </section>
                    </div>

                    <div
                      className={`summary-action ${zoneState.current === 'center' && zoneState.progress > 0 ? 'is-active' : ''}`}
                      data-zone-card="center"
                      style={getZoneProgress(zoneState.current === 'center' ? zoneState.progress : 0)}
                    >
                      <div className="summary-action-icon">[]</div>
                      <div className="summary-action-copy">
                        <strong>Hold hand in center to return to menu</strong>
                        <span>Mouse and keyboard fallback: use the button below.</span>
                      </div>
                      <button className="button button-secondary" type="button" onClick={returnToInstructions}>
                        Back to instructions
                      </button>
                    </div>
                  </>
                ) : (
                  <div className="boot-card">
                    <div className="screen-kicker">No Summary Available</div>
                    <h2>Finish A Session First</h2>
                    <p>No completed or paused training summary is available yet. Start from the instruction screen and finish an exercise to generate one.</p>
                    <div className="button-row">
                      <button className="button button-primary" type="button" onClick={returnToInstructions}>
                        Back to instructions
                      </button>
                    </div>
                  </div>
                )}
              </section>
            ) : null}
          </div>
        </main>
      </div>
    </div>
  );
}

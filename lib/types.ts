export type AppScreen = 'zones' | 'instructions' | 'training' | 'paused' | 'summary';

export interface Exercise {
  id: number;
  name: string;
  duration?: number;
  session_duration_seconds?: number;
  interaction_mode?: string;
  game_mode?: string;
  video_ready?: boolean;
  landmarks_ready?: boolean;
  keyframes_ready?: boolean;
}

export interface ReferenceFrame {
  time?: number;
  hands?: Array<{
    landmarks?: unknown[];
    handedness?: string;
  }>;
}

export interface ReferenceData {
  frames?: ReferenceFrame[];
}

export interface GuideFrame {
  index: number;
  time: number;
}

export interface TrainingSession {
  interactionMode: 'guided' | 'pinch_defense';
  guideIndex: number;
  totalGuides: number;
  pauseCount: number;
  startedAt: number;
  bestAccuracy: number;
  accuracySamples: number[];
  lastCue: string;
  detail: string;
  gameModeTitle: string;
}

export interface SessionSummary {
  exerciseName: string;
  completionPercent: number;
  averageAccuracy: number;
  bestAccuracy: number;
  pauseCount: number;
  durationLabel: string;
  weakestFocus: string;
  note: string;
  gameModeTitle?: string;
  gameScore?: number;
  completed?: boolean;
  dateLabel?: string;
  pauseLabel?: string;
  accuracyTrend?: number[];
  stabilityTrend?: number[];
  assessment?: string;
  gameModeNote?: string;
  gameBadge?: string;
}

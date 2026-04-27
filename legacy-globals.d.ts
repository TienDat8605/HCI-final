export {};

declare global {
  interface LegacyLandmark {
    x: number;
    y: number;
    z?: number;
  }

  interface LegacyHandsResults {
    multiHandLandmarks?: LegacyLandmark[][];
    multiHandedness?: Array<
      | {
          label?: string;
        }
      | Array<{
          label?: string;
        }>
    >;
  }

  interface LegacyGameHud {
    primaryLabel: string;
    primaryValue: string;
    secondaryLabel: string;
    secondaryValue: string;
    statusText: string;
  }

  interface LegacyGameSnapshot {
    modeId: string;
    modeTitle: string;
    modeDescription?: string;
    hud?: LegacyGameHud;
    summary?: Record<string, unknown> | null;
    viewState?: Record<string, unknown> | null;
  }

  interface LegacyGameRuntime {
    modeId: string;
    modeTitle: string;
    notifySessionStart: (payload: Record<string, unknown>) => void;
    notifyFrame: (payload: Record<string, unknown>) => void;
    notifyCheckpoint: (payload: Record<string, unknown>) => void;
    notifyPause: (payload: Record<string, unknown>) => void;
    notifyResume: (payload: Record<string, unknown>) => void;
    notifySessionEnd: (payload: Record<string, unknown>) => void;
    mount: (container: HTMLElement) => void;
    unmount: () => void;
    snapshot: () => LegacyGameSnapshot;
  }

  interface Window {
    Hands?: new (config: { locateFile?: (file: string) => string }) => {
      setOptions: (options: Record<string, unknown>) => void;
      onResults: (callback: (results: LegacyHandsResults) => void) => void;
      send: (payload: { image: HTMLVideoElement }) => Promise<void>;
    };
    BlueprintGamification?: {
      createRuntime: (exerciseId: number, context: Record<string, unknown>) => LegacyGameRuntime;
    };
    PinchDefenseConfig?: {
      assetManifestPath?: string;
    };
  }
}

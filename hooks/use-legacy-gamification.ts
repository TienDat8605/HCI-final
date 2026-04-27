'use client';

import { useEffect, useState } from 'react';

const LEGACY_STYLESHEET = '/legacy-static/gamification/pinch_defense/pinch_defense.css';
const LEGACY_SCRIPT_PATHS = [
  '/legacy-static/gamification/modes/exercise_1_mode.js',
  '/legacy-static/gamification/modes/exercise_5_mode.js',
  '/legacy-static/gamification/pinch_defense/config.js',
  '/legacy-static/gamification/pinch_defense/host_bridge.js',
  '/legacy-static/gamification/pinch_defense/assets.js',
  '/legacy-static/gamification/pinch_defense/input.js',
  '/legacy-static/gamification/pinch_defense/engine.js',
  '/legacy-static/gamification/pinch_defense/renderer.js',
  '/legacy-static/gamification/modes/pinch_defense_mode.js',
  '/legacy-static/gamification/index.js',
];

function ensureStylesheet(href: string) {
  const existing = document.querySelector<HTMLLinkElement>(`link[data-codex-href="${href}"]`);
  if (existing) {
    return;
  }

  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = href;
  link.dataset.codexHref = href;
  document.head.appendChild(link);
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

export function useLegacyGamification() {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        ensureStylesheet(LEGACY_STYLESHEET);
        for (const path of LEGACY_SCRIPT_PATHS) {
          await loadScriptOnce(path);
        }

        if (window.PinchDefenseConfig) {
          window.PinchDefenseConfig.assetManifestPath = '/legacy-static/gamification/pinch_defense/assets/manifest.json';
        }

        if (!cancelled) {
          setReady(Boolean(window.BlueprintGamification));
          setError(null);
        }
      } catch (nextError) {
        if (!cancelled) {
          setReady(false);
          setError(nextError instanceof Error ? nextError.message : 'Could not load legacy gamification scripts.');
        }
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, []);

  return {
    ready,
    error,
  };
}

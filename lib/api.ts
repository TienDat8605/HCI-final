import type { Exercise, ReferenceData } from '@/lib/types';

const publicApiBase = process.env.NEXT_PUBLIC_API_BASE_URL?.replace(/\/$/, '') ?? '';

function buildUrl(path: string) {
  return `${publicApiBase}${path}`;
}

export function getVideoUrl(exerciseId: number) {
  return buildUrl(`/api/video/${exerciseId}`);
}

export async function getExercises() {
  const response = await fetch(buildUrl('/api/exercises'), {
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new Error('Could not load exercise metadata from the Flask API.');
  }

  return (await response.json()) as Exercise[];
}

export async function getLandmarks(exerciseId: number) {
  const response = await fetch(buildUrl(`/api/landmarks/${exerciseId}`), {
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new Error('Could not load reference landmarks.');
  }

  return (await response.json()) as ReferenceData;
}

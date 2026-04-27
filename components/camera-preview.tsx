'use client';

import type { ReactNode, RefCallback } from 'react';

interface CameraPreviewProps {
  live: boolean;
  title: string;
  subtitle: string;
  videoRef: RefCallback<HTMLVideoElement>;
  overlayCanvasRef?: RefCallback<HTMLCanvasElement>;
  muted?: boolean;
  dimmed?: boolean;
  captureOnly?: boolean;
  children?: ReactNode;
}

export function CameraPreview({
  live,
  title,
  subtitle,
  videoRef,
  overlayCanvasRef,
  muted = true,
  dimmed = false,
  captureOnly = false,
  children,
}: CameraPreviewProps) {
  return (
    <div className={`camera-preview ${dimmed ? 'is-dimmed' : ''} ${captureOnly ? 'is-capture-only' : ''}`}>
      {live ? <video ref={videoRef} autoPlay playsInline muted={muted} /> : <div className="camera-preview-fallback" />}
      {overlayCanvasRef ? <canvas ref={overlayCanvasRef} className="camera-preview-overlay" /> : null}
      <div className="camera-preview-scrim" />
      {!captureOnly ? (
        <div className="camera-preview-copy">
          <strong>{title}</strong>
          <span>{subtitle}</span>
        </div>
      ) : null}
      {children}
    </div>
  );
}

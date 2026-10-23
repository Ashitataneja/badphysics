import { useEffect, useRef } from 'react';
import type { Experience, OverlayMode } from '../app/Experience';

interface Props {
  video: HTMLVideoElement | null;
  experience: Experience | null;
  mode: OverlayMode;
  mirror: boolean;
  className?: string;
}

/**
 * Hosts the single shared <video> element plus a landmark overlay canvas.
 * The element is re-parented rather than duplicated, so there is only ever
 * one camera stream.
 */
export function VideoMount({ video, experience, mode, mirror, className }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const el = host.current;
    if (!el || !video) return;
    el.prepend(video);
    void video.play().catch(() => undefined);
    return () => {
      if (video.parentElement === el) video.remove();
    };
  }, [video]);

  useEffect(() => {
    if (!experience || !canvas.current) return;
    experience.setOverlay(canvas.current, mode);
    return () => experience.setOverlay(null, mode);
  }, [experience, mode]);

  return (
    <div ref={host} className={`video-mount ${mirror ? 'mirrored' : ''} ${className ?? ''}`}>
      <canvas ref={canvas} className="landmark-canvas" aria-hidden="true" />
    </div>
  );
}

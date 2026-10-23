import { useEffect, useState, type RefObject } from 'react';
import { Experience } from '../app/Experience';
import { WebGLUnavailableError } from '../scene/SceneManager';

/**
 * Creates the Experience (renderer, simulation, audio, single animation
 * loop) for a container and disposes every resource on unmount, so remounts
 * never leave duplicate loops behind.
 */
export function useSimulation(container: RefObject<HTMLDivElement | null>) {
  const [experience, setExperience] = useState<Experience | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);

  useEffect(() => {
    const el = container.current;
    if (!el) return;
    let exp: Experience;
    try {
      exp = new Experience(el);
    } catch (err) {
      setFatal(
        err instanceof WebGLUnavailableError
          ? 'Your browser or GPU does not support WebGL2, which BAD PHYSICS needs to render.'
          : `The scene failed to start: ${(err as Error).message}`,
      );
      return;
    }
    exp.start();
    setExperience(exp);
    return () => {
      exp.dispose();
      setExperience(null);
    };
  }, [container]);

  return { experience, fatal };
}

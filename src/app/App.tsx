import { useCallback, useRef } from 'react';
import { useHandTracking } from '../hooks/useHandTracking';
import { useSimulation } from '../hooks/useSimulation';
import { CalibrationOverlay } from '../ui/CalibrationOverlay';
import { ErrorState, FatalError } from '../ui/ErrorState';
import { LandingScreen } from '../ui/LandingScreen';
import { CueToast, SimulationHUD } from '../ui/SimulationHUD';
import { isInSimulation } from './interactionMachine';
import { useStore } from './state';

export default function App() {
  const stage = useRef<HTMLDivElement>(null);
  const { experience, fatal } = useSimulation(stage);
  const tracking = useHandTracking(experience);
  const machine = useStore((s) => s.machine);
  const dispatch = useStore((s) => s.dispatch);
  const reducedMotion = useStore((s) => s.settings.reducedMotion);

  // Audio is unlocked inside the click handler to satisfy autoplay policy.
  const enter = useCallback(() => {
    void experience?.unlockAudio();
    dispatch({ type: 'ENTER' });
  }, [experience, dispatch]);
  const fallback = useCallback(() => {
    void experience?.unlockAudio();
    dispatch({ type: 'ENTER_FALLBACK' });
  }, [experience, dispatch]);

  const phase = machine.phase;
  return (
    <main className={`app phase-${phase} ${reducedMotion ? 'reduced-motion' : ''}`}>
      <div ref={stage} className="stage" aria-hidden="true" />
      {fatal ? (
        <FatalError message={fatal} />
      ) : (
        <>
          {phase === 'landing' && <LandingScreen onEnter={enter} onFallback={fallback} disabled={!experience} />}
          {(phase === 'activating' || phase === 'calibrating') && (
            <CalibrationOverlay experience={experience} video={tracking.video} status={tracking.status} />
          )}
          {phase === 'error' && machine.error && <ErrorState kind={machine.error} />}
          {isInSimulation(machine) && (
            <SimulationHUD experience={experience} video={tracking.video} delegate={tracking.delegate} />
          )}
          <CueToast />
        </>
      )}
    </main>
  );
}

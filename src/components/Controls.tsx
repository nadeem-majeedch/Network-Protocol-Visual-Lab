/**
 * Controls: play/pause, step forward/backward, run, reset, speed.
 * Thin wrapper over store actions; the cursor lives in the store.
 */

import { useApp } from '../state/store';

export function Controls() {
  const run = useApp((s) => s.run);
  const step = useApp((s) => s.step);
  const reset = useApp((s) => s.reset);
  const togglePlay = useApp((s) => s.togglePlay);
  const playing = useApp((s) => s.playing);
  const stepForward = useApp((s) => s.stepForward);
  const stepBackward = useApp((s) => s.stepBackward);
  const speed = useApp((s) => s.speed);
  const setSpeed = useApp((s) => s.setSpeed);
  const status = useApp((s) => s.status);
  const hasState = useApp((s) => s.state !== null);

  return (
    <div className="controls" role="group" aria-label="Simulation controls">
      {status === 'idle' ? (
        <button className="btn primary" onClick={run}>
          ▶ Run
        </button>
      ) : (
        <button className="btn primary" onClick={togglePlay} aria-pressed={playing}>
          {playing ? '⏸ Pause' : '▶ Play'}
        </button>
      )}
      <button className="btn" onClick={stepBackward} disabled={!hasState} aria-label="Step backward">
        ⇤ Back
      </button>
      <button className="btn" onClick={stepForward} disabled={!hasState} aria-label="Step forward">
        ⇥ Forward
      </button>
      <button className="btn" onClick={step}>
        ⚙ Engine step
      </button>
      <button className="btn" onClick={reset}>
        ↺ Reset
      </button>
      <label className="speed">
        Speed
        <select value={String(speed)} onChange={(e) => setSpeed(Number(e.target.value))}>
          <option value="0.25">0.25×</option>
          <option value="0.5">0.5×</option>
          <option value="1">1×</option>
          <option value="2">2×</option>
          <option value="4">4×</option>
        </select>
      </label>
    </div>
  );
}

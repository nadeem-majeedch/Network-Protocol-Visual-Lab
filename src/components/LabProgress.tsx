/**
 * LabProgress: client-side progress panel for the numbered curriculum.
 *
 * Reads the lab catalog + the persisted completion set (src/state/progress.ts)
 * and lists every lab with a ✓/○ marker. Clicking an entry opens the lab;
 * the completion marker derives from the engine — it appears only when a
 * run of that lab actually satisfied its completion predicate.
 */

import { useApp } from '../state/store';
import { useLabProgress } from '../state/progress';
import { labs } from '../labs';
import { labNumberBadge } from '../labs/framework';

export function LabProgress() {
  const lab = useApp((s) => s.lab);
  const loadLab = useApp((s) => s.loadLab);
  const completed = useLabProgress((s) => s.completed);
  const clearAll = useLabProgress((s) => s.clearAll);

  const doneCount = labs.filter((l) => completed.has(l.id)).length;

  return (
    <section className="progress-panel" aria-label="Lab progress">
      <h3>
        Lab progress{' '}
        <span className="progress-count" aria-label="Completed labs count">
          {doneCount}/{labs.length}
        </span>
      </h3>
      <ul className="progress-list">
        {labs.map((l) => {
          const done = completed.has(l.id);
          const active = lab?.id === l.id;
          const badge = labNumberBadge(l);
          return (
            <li key={l.id}>
              <button
                className={`progress-item${done ? ' done' : ''}${active ? ' active' : ''}`}
                onClick={() => loadLab(l.id)}
                aria-current={active ? 'true' : undefined}
              >
                <span className="progress-marker" aria-hidden="true">
                  {done ? '✓' : '○'}
                </span>
                <span className="progress-title">
                  {badge !== undefined && <span className="progress-badge">{badge}</span>}
                  {l.title.replace(/^Lab \d{2} — /, '')}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {doneCount > 0 && (
        <button className="progress-clear" onClick={clearAll}>
          Clear progress
        </button>
      )}
    </section>
  );
}

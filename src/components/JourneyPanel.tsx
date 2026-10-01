/**
 * JourneyPanel: the flagship narrative. The eight stages of "Open a Web
 * Page" light up as the timeline plays; the current stage expands to
 * answer the student's questions — what happened, why, which protocol,
 * what was added, what changed, which device decided. Pure projection of
 * the event log through state/journey.ts.
 */

import { useMemo } from 'react';
import { useApp } from '../state/store';
import { journeyStages, activeStageAt } from '../state/journey';

export function JourneyPanel() {
  const state = useApp((s) => s.state);
  const cursorMs = useApp((s) => s.cursorMs);
  const lab = useApp((s) => s.lab);

  const stages = useMemo(() => (state === null ? [] : journeyStages(state.events)), [state]);
  if (state === null || lab === null || lab.id !== 'open-web-page') return null;

  const current = activeStageAt(stages, cursorMs);
  const completed = stages.filter((s) => s.completedAtMs !== undefined && s.completedAtMs <= cursorMs).length;

  return (
    <section className="cache-panel journey-panel" aria-label="Journey stages">
      <h3>The journey</h3>
      <p className="muted panel-hint">
        {cursorMs <= 0 ? 'Press Go and watch the page open.' : `Stage ${Math.min(completed + 1, 8)} of 8 · ${Math.round(cursorMs)} ms`}
      </p>
      <ol className="journey-stages">
        {stages.map((stage) => {
          const isCurrent = current?.id === stage.id;
          const isDone = stage.completedAtMs !== undefined && stage.completedAtMs <= cursorMs;
          return (
            <li
              key={stage.id}
              className={`journey-stage${isCurrent ? ' current' : ''}${isDone ? ' done' : ''}${stage.startedAtMs === undefined ? ' pending' : ''}`}
            >
              <span className="journey-title">{stage.title}</span>
              {stage.answers !== undefined && (
                <dl className="journey-answers">
                  <dt>What happened?</dt>
                  <dd>{stage.answers.what}</dd>
                  <dt>Why did it happen?</dt>
                  <dd>{stage.answers.why}</dd>
                  <dt>Which protocol?</dt>
                  <dd>{stage.answers.protocol}</dd>
                  <dt>What was added?</dt>
                  <dd>{stage.answers.added}</dd>
                  <dt>What changed?</dt>
                  <dd>{stage.answers.changed}</dd>
                  <dt>Who decided?</dt>
                  <dd>{stage.answers.decider}</dd>
                </dl>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

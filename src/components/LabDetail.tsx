/**
 * LabDetail: the full laboratory write-up — objective, learning objectives,
 * prerequisites, guided steps, task, expected observations, hints,
 * explanation, and live completion status.
 *
 * Every section derives from the lab definition (or its framework
 * fallbacks) plus the canonical engine state — no lab-specific UI logic.
 */

import { useState } from 'react';
import { useApp } from '../state/store';
import { useLabProgress, isCompleteNow } from '../state/progress';
import {
  labControls,
  labExplanation,
  labExpectedObservations,
  labHints,
  labObjectives,
  labPrerequisites,
  labCompletion,
  labNumberBadge
} from '../labs/framework';

export function LabDetail() {
  const lab = useApp((s) => s.lab);
  const state = useApp((s) => s.state);
  const completed = useLabProgress((s) => s.completed);
  const [showHints, setShowHints] = useState(false);
  const [showExplanation, setShowExplanation] = useState(false);

  if (lab === null) {
    return (
      <div className="lab-detail empty-state">
        <h2>Welcome to Network Protocol Visual Lab</h2>
        <p>
          Pick a lab on the left and press <strong>Run</strong> to watch packets move through a real
          protocol engine — the same engine that powers the inspector and timeline.
        </p>
        <ul className="hints">
          <li>Click any packet dot to inspect every protocol layer.</li>
          <li>Use <strong>Step</strong> to advance one scheduled event at a time.</li>
          <li>Every explanation is generated deterministically from packet state.</li>
        </ul>
      </div>
    );
  }

  const badge = labNumberBadge(lab);
  const complete = isCompleteNow(lab, state);
  const everCompleted = completed.has(lab.id);
  const objectives = labObjectives(lab);
  const prerequisites = labPrerequisites(lab);
  const observations = labExpectedObservations(lab);
  const hints = labHints(lab);
  const explanations = labExplanation(lab);
  const controls = labControls(lab);
  const completion = labCompletion(lab);

  return (
    <div className="lab-detail">
      <header>
        <h2>
          {badge !== undefined && <span className="lab-number-badge">{badge}</span>}
          {lab.title}
        </h2>
        <p className="objective">{lab.objective}</p>
        {complete && (
          <p className="lab-complete-banner" role="status" aria-label="Lab completion status">
            ✓ Complete — {completion.description}
          </p>
        )}
      </header>

      {objectives.length > 0 && (
        <section className="lab-section">
          <h3>Learning objectives</h3>
          <ul>
            {objectives.map((o) => (
              <li key={o}>{o}</li>
            ))}
          </ul>
        </section>
      )}

      {prerequisites.length > 0 && (
        <section className="lab-section">
          <h3>Prerequisites</h3>
          <ul>
            {prerequisites.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </section>
      )}

      <section className="lab-section">
        <h3>Simulation controls</h3>
        <ul className="lab-controls-list">
          {controls.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
      </section>

      <ol className="lab-steps">
        {lab.steps.map((step) => (
          <li key={step.id} className={state !== null && state.events.some((e) => step.watchEventTypes.includes(e.type)) ? 'reached' : ''}>
            <strong>{step.title}.</strong> {step.narration}
          </li>
        ))}
      </ol>

      <section className="lab-section">
        <h3>Expected observations</h3>
        <ul>
          {observations.map((o) => (
            <li key={o}>{o}</li>
          ))}
        </ul>
      </section>

      <div className="lab-task">
        <h3>Your task</h3>
        <p>{lab.task}</p>
      </div>

      {hints.length > 0 && (
        <section className="lab-section lab-hints">
          <h3>
            Hints{' '}
            <button className="lab-reveal" onClick={() => setShowHints((v) => !v)} aria-expanded={showHints}>
              {showHints ? 'Hide hints' : 'Show hints'}
            </button>
          </h3>
          {showHints && (
            <ol>
              {hints.map((h) => (
                <li key={h}>{h}</li>
              ))}
            </ol>
          )}
        </section>
      )}

      <section className="lab-section lab-completion">
        <h3>Completion criteria</h3>
        <p className={complete || everCompleted ? 'completion-met' : 'completion-unmet'}>
          {complete || everCompleted ? '✓ ' : '○ '}
          {completion.description}
        </p>
      </section>

      <section className="lab-section lab-explanation">
        <h3>
          Explanation{' '}
          <button className="lab-reveal" onClick={() => setShowExplanation((v) => !v)} aria-expanded={showExplanation}>
            {showExplanation ? 'Hide explanation' : 'Show explanation'}
          </button>
        </h3>
        {showExplanation &&
          explanations.map((e) => <p key={e}>{e}</p>)}
      </section>
    </div>
  );
}

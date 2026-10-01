/**
 * LabNav: lists labs grouped as flagship → numbered curriculum →
 * reference labs. Completed labs (client-side progress) carry a ✓.
 */

import { labs } from '../labs';
import { useApp } from '../state/store';
import { useLabProgress } from '../state/progress';

/** Sidebar groups: the flagship journey, then the curriculum, then legacy. */
const isNumbered = (id: string): boolean => /^lab-\d{2}-/.test(id);
const NAV_GROUPS: readonly { readonly label: string; readonly test: (id: string) => boolean }[] = [
  { label: 'Flagship journey', test: (id) => id === 'open-web-page' },
  { label: 'Guided curriculum', test: (id) => isNumbered(id) },
  { label: 'Reference labs', test: (id) => id !== 'open-web-page' && !isNumbered(id) }
];

export function LabNav() {
  const lab = useApp((s) => s.lab);
  const loadLab = useApp((s) => s.loadLab);
  const completed = useLabProgress((s) => s.completed);

  const groups = NAV_GROUPS.map((group) => ({
    label: group.label,
    labs: labs.filter((l) => group.test(l.id))
  }));

  return (
    <nav className="lab-nav" aria-label="Labs">
      <h2>Labs</h2>
      {groups.map((group) => (
        <section key={group.label} className="lab-nav-group" aria-label={group.label}>
          <h3 className="lab-nav-label">{group.label}</h3>
          <ul>
            {group.labs.map((l) => (
              <li key={l.id}>
                <button
                  className={`lab-link${lab?.id === l.id ? ' active' : ''}`}
                  aria-current={lab?.id === l.id ? 'page' : undefined}
                  onClick={() => loadLab(l.id)}
                >
                  <span className="lab-done" aria-label={completed.has(l.id) ? 'Completed' : 'Not completed yet'}>
                    {completed.has(l.id) ? '✓' : '○'}
                  </span>
                  {l.title}
                  <span className="lab-protocols">{l.protocols.join(' · ')}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </nav>
  );
}

/**
 * StatusBar: instrument-panel strip at the bottom of the shell.
 *
 * Reads canonical state only (sim time, packet/event counts, selection)
 * plus the UI playback status. Also hosts the theme toggle.
 */

import { useApp } from '../state/store';
import { useTheme } from '../state/theme';

export function StatusBar() {
  const status = useApp((s) => s.status);
  const state = useApp((s) => s.state);
  const lab = useApp((s) => s.lab);
  const selectedPacketId = useApp((s) => s.selectedPacketId);
  const theme = useTheme((t) => t.theme);
  const toggleTheme = useTheme((t) => t.toggle);

  const engineLabel =
    status === 'running' ? 'RUNNING' : status === 'done' ? 'COMPLETE' : 'IDLE';

  return (
    <footer className="status-bar" role="status" aria-label="Simulation status">
      <span className={`status-dot status-${status}`} aria-hidden="true" />
      <span className="status-item">
        Engine: <strong>{engineLabel}</strong>
      </span>
      <span className="status-item">
        Lab: <strong>{lab === null ? 'none' : lab.title.split(' — ')[0]}</strong>
      </span>
      <span className="status-item">
        Sim time: <strong>{state === null ? '0' : state.simMs} ms</strong>
      </span>
      <span className="status-item">
        Packets: <strong>{state === null ? 0 : state.packets.length}</strong>
      </span>
      <span className="status-item">
        Events: <strong>{state === null ? 0 : state.events.length}</strong>
      </span>
      <span className="status-item">
        Selected: <strong>{selectedPacketId === null ? '—' : `#${state?.packets.find((p) => p.id === selectedPacketId)?.serial ?? '?'}`}</strong>
      </span>
      <span className="status-spacer" />
      <button
        className="theme-toggle"
        onClick={toggleTheme}
        aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
        title="Toggle color theme"
      >
        {theme === 'dark' ? '☀ Light' : '☾ Dark'}
      </button>
    </footer>
  );
}

/**
 * Timeline: the deterministic event timeline.
 *
 * Renders only events visible at the cursor (ts <= cursorMs), provides a
 * range scrubber over the whole recorded duration, and makes every event
 * inspectable: clicking one opens it in the inspector pane.
 */

import { useMemo } from 'react';
import { useApp } from '../state/store';
import { describeEvent, eventKind } from '../models/events';
import { packetProtocolLabel, packetSummary } from '../models/packet';
import { eventTimes } from '../state/playback';

export function Timeline() {
  const state = useApp((s) => s.state);
  const selectedPacketId = useApp((s) => s.selectedPacketId);
  const selectPacket = useApp((s) => s.selectPacket);
  const cursorMs = useApp((s) => s.cursorMs);
  const scrubTo = useApp((s) => s.scrubTo);
  const selectedEventIndex = useApp((s) => s.selectedEventIndex);
  const selectEvent = useApp((s) => s.selectEvent);

  const times = useMemo(() => (state === null ? [] : eventTimes(state.events)), [state]);

  if (state === null) {
    return (
      <div className="timeline empty-state">
        <p>Run a lab to populate the timeline.</p>
      </div>
    );
  }

  const visible = state.events.filter((e) => e.ts <= cursorMs);
  const maxTs = times.length > 0 ? (times[times.length - 1] ?? 0) : 0;

  return (
    <div className="timeline" aria-label="Simulation timeline">
      <label className="scrubber">
        <span className="sr-only">Timeline position</span>
        <input
          type="range"
          min={0}
          max={Math.max(maxTs, 1)}
          step={1}
          value={Math.min(cursorMs, maxTs)}
          onChange={(e) => scrubTo(Number(e.target.value))}
          aria-label="Scrub timeline"
        />
        <span className="scrubber-time">{Math.round(cursorMs)} / {maxTs} ms</span>
      </label>

      <PacketChips state={state} cursorMs={cursorMs} selectedId={selectedPacketId} onSelect={selectPacket} />

      <ol className="event-log">
        {visible.map((event) => {
          const index = state.events.indexOf(event);
          return (
            <li key={`${index}-${event.ts}`} className={`event event-${eventKind(event)}`}>
              <button
                className={`event-row${selectedEventIndex === index ? ' selected' : ''}`}
                aria-pressed={selectedEventIndex === index}
                onClick={() => selectEvent(selectedEventIndex === index ? null : index)}
              >
                <span className="event-ts">{event.ts} ms</span>
                <span className="event-desc">{describeEvent(event)}</span>
              </button>
            </li>
          );
        })}
        {visible.length === 0 && <li className="event muted">Scrub or play to reveal events…</li>}
      </ol>
    </div>
  );
}

function PacketChips({
  state,
  cursorMs,
  selectedId,
  onSelect
}: {
  readonly state: NonNullable<ReturnType<typeof useApp.getState>['state']>;
  readonly cursorMs: number;
  readonly selectedId: string | null;
  readonly onSelect: (id: string) => void;
}) {
  const born = (p: (typeof state.packets)[number]) => p.hops[0]?.startMs ?? p.bornMs;
  const chips = state.packets.filter((p) => born(p) <= cursorMs);
  return (
    <div className="packet-chips" role="listbox" aria-label="Packets">
      {chips.map((p) => (
        <button
          key={p.id}
          role="option"
          aria-selected={p.id === selectedId}
          className={`chip${p.id === selectedId ? ' selected' : ''}`}
          onClick={() => onSelect(p.id)}
        >
          #{p.serial} {packetProtocolLabel(p.frame)} · {packetSummary(p.frame)} · {p.state}
        </button>
      ))}
      {chips.length === 0 && <span className="muted">No packets in flight at this moment.</span>}
    </div>
  );
}

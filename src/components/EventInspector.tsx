/**
 * EventInspector: shows the structured fields of a selected timeline
 * event. Field data comes from eventFields() — pure derivation from the
 * canonical event, no UI-side knowledge of what events mean.
 */

import { describeEvent, eventFields } from '../models/events';
import type { SimulationEvent } from '../models/events';

export function EventInspector({ event }: { readonly event: SimulationEvent | undefined }) {
  if (event === undefined) return null;
  const fields = eventFields(event);
  return (
    <div className="inspector" aria-label="Event inspector">
      <header className="inspector-header">
        <h3>
          Event <span className={`badge proto-${event.type}`}>{event.type}</span>
        </h3>
      </header>
      <p className="event-explain">{describeEvent(event)}</p>
      <dl className="field-list">
        {fields.map((f) => (
          <div key={f.name} className="field">
            <dt>{f.name}</dt>
            <dd>{f.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

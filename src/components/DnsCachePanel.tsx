/**
 * DnsCachePanel: inspects every node's DNS cache as of the current
 * timeline cursor, reconstructed purely from DNS_CACHE_WRITE events
 * (entries that have expired by the cursor are shown as such, exactly
 * like the ttl-aware lookup the engine performs). Reads only canonical
 * NetworkState — the same data the resolver answers from.
 */

import { useApp } from '../state/store';

export function DnsCachePanel() {
  const state = useApp((s) => s.state);
  const cursorMs = useApp((s) => s.cursorMs);

  if (state === null) return null;

  const nodeNames = new Map(state.topology.nodes.map((n) => [n.id, n.name]));
  const writers = state.topology.nodes
    .map((n) => n.id)
    .filter((nodeId) => Object.keys(state.dnsCaches[nodeId] ?? {}).length > 0);

  // Fall back to event reconstruction when state.caches are absent for a
  // node (events ≤ cursor are the source of truth for the timeline view).
  const writesByNode = new Map<string, Map<string, { name: string; type: string; value: string; ttl: number; ts: number; authoritative: boolean }>>();
  for (const event of state.events) {
    if (event.type !== 'DNS_CACHE_WRITE' || event.ts > cursorMs) continue;
    const perNode = writesByNode.get(event.nodeId) ?? new Map();
    perNode.set(`${event.name}|${event.recordType}`, {
      name: event.name,
      type: event.recordType,
      value: event.value,
      ttl: event.ttl,
      ts: event.ts,
      authoritative: event.authoritative
    });
    writesByNode.set(event.nodeId, perNode);
  }

  const nodeIds = new Set<string>([...writers, ...writesByNode.keys()]);
  if (nodeIds.size === 0) return null;

  return (
    <section className="cache-panel" aria-label="DNS caches">
      <h3>DNS caches</h3>
      <p className="muted panel-hint">
        State at {Math.round(cursorMs)} ms — expired entries are kept visible but marked.
      </p>
      <div className="cache-section">
        {[...nodeIds].map((nodeId) => {
          const entries = [...(writesByNode.get(nodeId)?.values() ?? [])];
          return (
            <div key={nodeId} className="cache-node">
              <span className="cache-node-name">{nodeNames.get(nodeId) ?? nodeId}</span>
              <ul className="cache-list">
                {entries.map((e) => {
                  const expiresAt = e.ts + e.ttl;
                  const expired = cursorMs >= expiresAt;
                  return (
                    <li key={`${e.name}|${e.type}`} className={expired ? 'dns-expired' : ''}>
                      <span className="mono">{e.name}</span> ({e.type}) → <span className="mono">{e.value}</span>
                      <span className="muted cache-ts"> ttl {e.ttl}{expired ? ' — EXPIRED' : ` · valid ${Math.max(0, expiresAt - cursorMs)} ms more`}</span>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </div>
    </section>
  );
}

/**
 * ArpCachePanel: inspects the ARP cache of every IP node and the MAC
 * tables of switches, as of the current timeline cursor. Reads only
 * canonical NetworkState — the same data the engine produced.
 */

import { useApp } from '../state/store';
import type { NetworkState } from '../models/network-state';

export function ArpCachePanel() {
  const state = useApp((s) => s.state);
  const lab = useApp((s) => s.lab);
  const cursorMs = useApp((s) => s.cursorMs);

  if (state === null || lab === null) return null;

  const nodeNames = new Map(state.topology.nodes.map((n) => [n.id, n.name]));

  return (
    <section className="cache-panel" aria-label="ARP cache and MAC tables">
      <h3>Protocol tables</h3>
      <p className="muted panel-hint">
        State at {Math.round(cursorMs)} ms — {state.events.filter((e) => e.type === 'ARP_WRITE' && e.ts <= cursorMs).length} cache write(s) so far.
      </p>

      <CacheSection state={state} cursorMs={cursorMs} nodeNames={nodeNames} />
      <MacTableSection state={state} nodeNames={nodeNames} />
    </section>
  );
}

function CacheSection({
  state,
  cursorMs,
  nodeNames
}: {
  readonly state: NetworkState;
  readonly cursorMs: number;
  readonly nodeNames: Map<string, string>;
}) {
  const writesByNode = new Map<string, Map<string, { mac: string; ts: number }>>();
  for (const event of state.events) {
    if (event.type !== 'ARP_WRITE' || event.ts > cursorMs) continue;
    const perNode = writesByNode.get(event.nodeId) ?? new Map();
    perNode.set(event.ip, { mac: event.mac, ts: event.ts });
    writesByNode.set(event.nodeId, perNode);
  }

  const ipNodes = state.topology.nodes.filter((n) => n.interfaces.some((i) => i.ip !== undefined));

  return (
    <div className="cache-section">
      <h4>ARP caches</h4>
      {ipNodes.map((node) => {
        const entries = writesByNode.get(node.id);
        return (
          <div key={node.id} className="cache-node">
            <span className="cache-node-name">{nodeNames.get(node.id) ?? node.id}</span>
            {entries === undefined || entries.size === 0 ? (
              <span className="muted cache-empty">cache empty</span>
            ) : (
              <ul className="cache-list">
                {[...entries.entries()].map(([ip, { mac, ts }]) => (
                  <li key={ip}>
                    <span className="mono">{ip}</span> ⇔ <span className="mono">{mac}</span>
                    <span className="muted cache-ts"> @{ts} ms</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
      {ipNodes.length === 0 && <p className="muted">No IP devices in this topology.</p>}
    </div>
  );
}

function MacTableSection({
  state,
  nodeNames
}: {
  readonly state: NetworkState;
  readonly nodeNames: Map<string, string>;
}) {
  const switches = state.topology.nodes.filter((n) => n.kind === 'switch');
  if (switches.length === 0) return null;

  return (
    <div className="cache-section">
      <h4>Switch MAC tables</h4>
      {switches.map((sw) => {
        const learned = Object.entries(state.macTables[sw.id] ?? {}).filter(
          ([, port]) => port !== undefined
        );
        return (
          <div key={sw.id} className="cache-node">
            <span className="cache-node-name">{nodeNames.get(sw.id) ?? sw.id}</span>
            {learned.length === 0 ? (
              <span className="muted cache-empty">nothing learned</span>
            ) : (
              <ul className="cache-list">
                {learned.map(([mac, port]) => (
                  <li key={mac}>
                    <span className="mono">{mac}</span> → port {port}
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
}

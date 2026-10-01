/**
 * TcpStateInspector: the live state machine view — connection id, both
 * endpoints with their current state, the most recent SEQ/ACK per side,
 * the flags of the segment that caused the last transition, and the
 * advertised window. Pure projection of NetworkState.tcpConnections and
 * the TCP_STATE_CHANGE event log; no protocol logic lives here.
 */

import { useApp } from '../state/store';
import type { NetworkState } from '../models/network-state';
import type { SimulationEvent } from '../models/events';
import type { TcpStateName } from '../models/tcp';

type TcpStateEvent = Extract<SimulationEvent, { type: 'TCP_STATE_CHANGE' }>;

export function TcpStateInspector() {
  const state = useApp((s) => s.state);
  const cursorMs = useApp((s) => s.cursorMs);
  if (state === null) return null;

  // Project the connection table AS OF the timeline cursor by replaying
  // TCP_STATE_CHANGE events up to it — consistent with the other panels.
  const connections = tcpConnectionsAt(state, cursorMs);
  if (connections.length === 0) return null;

  const nodeNames = new Map(state.topology.nodes.map((n) => [n.id, n.name]));
  const eventsByConnection = latestTcpEvents(state);

  return (
    <section className="cache-panel" aria-label="TCP state inspector">
      <h3>TCP state</h3>
      {connections.map((conn) => {
        const last = eventsByConnection.get(conn.id);
        return (
          <div key={conn.id} className="cache-node">
            <span className="cache-node-name mono">{conn.id}</span>
            <table className="route-table">
              <thead>
                <tr>
                  <th scope="col">Endpoint</th>
                  <th scope="col">State</th>
                  <th scope="col">SEQ</th>
                  <th scope="col">ACK</th>
                  <th scope="col">Window</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>{nodeNames.get(conn.client.nodeId) ?? conn.client.nodeId}</td>
                  <td className="mono">{conn.client.state}</td>
                  <td className="mono">{conn.clientSeq ?? '—'}</td>
                  <td className="mono">{conn.clientAck ?? '—'}</td>
                  <td className="mono">{conn.clientWindow ?? '—'}</td>
                </tr>
                <tr>
                  <td>{nodeNames.get(conn.server.nodeId) ?? conn.server.nodeId}</td>
                  <td className="mono">{conn.server.state}</td>
                  <td className="mono">{conn.serverSeq ?? '—'}</td>
                  <td className="mono">{conn.serverAck ?? '—'}</td>
                  <td className="mono">{conn.serverWindow ?? '—'}</td>
                </tr>
              </tbody>
            </table>
            <p className="muted panel-hint">
              Last transition: {last !== undefined ? `${last.from} → ${last.to} — ${last.trigger}${last.flags !== undefined ? ` [${last.flags}]` : ''}` : 'none yet'}
            </p>
          </div>
        );
      })}
    </section>
  );
}

/** The most recent TCP_STATE_CHANGE per connection (path order). */
function latestTcpEvents(state: NetworkState): ReadonlyMap<string, TcpStateEvent> {
  const latest = new Map<string, TcpStateEvent>();
  for (const event of state.events) {
    if (event.type === 'TCP_STATE_CHANGE') latest.set(event.connectionId, event);
  }
  return latest;
}

interface ProjectedConnection {
  readonly id: string;
  readonly client: { readonly nodeId: string; readonly state: TcpStateName };
  readonly server: { readonly nodeId: string; readonly state: TcpStateName };
  readonly clientSeq?: number;
  readonly clientAck?: number;
  readonly clientWindow?: number;
  readonly serverSeq?: number;
  readonly serverAck?: number;
  readonly serverWindow?: number;
  readonly lastFlags?: string;
}

/**
 * Rebuilds the TCP connection table as of the cursor: replays
 * TCP_STATE_CHANGE events in order, starting from each endpoint's
 * initial state and overlaying the latest SEQ/ACK/window per side.
 */
function tcpConnectionsAt(state: NetworkState, cursorMs: number): ProjectedConnection[] {
  const byConnection = new Map<
    string,
    {
      client: { nodeId: string; state: TcpStateName; seq?: number; ack?: number; window?: number };
      server: { nodeId: string; state: TcpStateName; seq?: number; ack?: number; window?: number };
    }
  >();

  for (const event of state.events) {
    if (event.ts > cursorMs) continue;
    if (event.type !== 'TCP_STATE_CHANGE') continue;
    const entry =
      byConnection.get(event.connectionId) ??
      {
        client: { nodeId: '', state: 'CLOSED' as TcpStateName },
        server: { nodeId: '', state: 'LISTEN' as TcpStateName }
      };
    const side = { nodeId: event.nodeId, state: event.to };
    const updated = { ...entry, [event.role]: side } as typeof entry;
    const detail = { ...updated[event.role], ...(event.seq !== undefined ? { seq: event.seq } : {}), ...(event.ack !== undefined ? { ack: event.ack } : {}), ...(event.window !== undefined ? { window: event.window } : {}) };
    updated[event.role] = detail;
    byConnection.set(event.connectionId, updated);
  }

  return [...byConnection.entries()].map(([id, e]) => ({
    id,
    client: e.client,
    server: e.server,
    ...(e.client.seq !== undefined ? { clientSeq: e.client.seq } : {}),
    ...(e.client.ack !== undefined ? { clientAck: e.client.ack } : {}),
    ...(e.client.window !== undefined ? { clientWindow: e.client.window } : {}),
    ...(e.server.seq !== undefined ? { serverSeq: e.server.seq } : {}),
    ...(e.server.ack !== undefined ? { serverAck: e.server.ack } : {}),
    ...(e.server.window !== undefined ? { serverWindow: e.server.window } : {})
  }));
}

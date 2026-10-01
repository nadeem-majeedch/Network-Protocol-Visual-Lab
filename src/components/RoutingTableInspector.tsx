/**
 * RoutingTableInspector: shows every router's routing table — connected
 * routes derived from interfaces plus configured static routes — exactly
 * as the engine's longest-prefix lookup sees it. Reads only canonical
 * NetworkState; the tables are config-derived, so they are valid at any
 * cursor position.
 */

import { useApp } from '../state/store';

export function RoutingTableInspector() {
  const state = useApp((s) => s.state);
  const lab = useApp((s) => s.lab);

  if (state === null || lab === null) return null;
  const routers = state.topology.nodes.filter((n) => n.kind === 'router');
  if (routers.length === 0) return null;

  const ifaceLabels = new Map(
    state.topology.nodes.flatMap((n) => n.interfaces.map((i) => [i.id, i.label] as const))
  );

  return (
    <section className="cache-panel" aria-label="Routing tables">
      <h3>Routing tables</h3>
      <p className="muted panel-hint">Longest prefix wins; ties break on metric, then route id.</p>
      <div className="cache-section">
        {routers.map((router) => {
          const table = state.routingTables[router.id] ?? [];
          return (
            <div key={router.id} className="cache-node">
              <span className="cache-node-name">{router.name}</span>
              {table.length === 0 ? (
                <span className="muted cache-empty">no routes</span>
              ) : (
                <table className="route-table">
                  <thead>
                    <tr>
                      <th scope="col">Destination</th>
                      <th scope="col">Prefix</th>
                      <th scope="col">Origin</th>
                      <th scope="col">Next hop</th>
                      <th scope="col">Interface</th>
                    </tr>
                  </thead>
                  <tbody>
                    {table.map((entry) => (
                      <tr key={entry.id}>
                        <td className="mono">{entry.prefix === 0 ? 'default' : entry.destination}</td>
                        <td className="mono">/{entry.prefix}</td>
                        <td>{entry.origin}</td>
                        <td className="mono">{entry.nextHop ?? 'on-link'}</td>
                        <td className="mono">{ifaceLabels.get(entry.interfaceId) ?? entry.interfaceId}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

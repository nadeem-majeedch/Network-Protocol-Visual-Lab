/**
 * RouterDecisionPanel — "How did the router decide?" for the selected
 * packet. Renders one block per router that touched the packet, in path
 * order, each showing: destination, every matching route with its prefix
 * length, the selected route, the chosen next hop and egress interface.
 * Hosts' gateway decisions appear too, so the whole path is explainable.
 * Nothing here re-implements routing; it projects what the engine
 * already decided (ROUTE_LOOKUP events) onto the screen.
 */

import { useMemo } from 'react';
import { useApp } from '../state/store';
import type { NetworkState } from '../models/network-state';
import type { SimulationEvent } from '../models/events';
import { matchingRoutes, routeSelectionReason } from '../models/routing';
import type { RoutingEntry } from '../models/routing';

type RouteLookupEvent = Extract<SimulationEvent, { type: 'ROUTE_LOOKUP' }>;

export function RouterDecisionPanel() {
  const state = useApp((s) => s.state);
  const selectedPacketId = useApp((s) => s.selectedPacketId);

  const lookups: readonly RouteLookupEvent[] = useMemo(() => {
    if (state === null) return [];
    const relevant = state.events.filter(
      (e): e is RouteLookupEvent =>
        e.type === 'ROUTE_LOOKUP' &&
        (selectedPacketId === null || e.packetId === selectedPacketId)
    );
    // One block per device, in first-occurrence (path) order.
    const byNode = new Map<string, RouteLookupEvent>();
    for (const e of relevant) {
      if (!byNode.has(e.nodeId)) byNode.set(e.nodeId, e);
    }
    return [...byNode.values()];
  }, [state, selectedPacketId]);

  if (state === null || lookups.length === 0) return null;

  return (
    <>
      {lookups.map((lookup) => (
        <RouterDecisionBlock key={lookup.nodeId} state={state} lookup={lookup} />
      ))}
    </>
  );
}

function RouterDecisionBlock({ state, lookup }: { readonly state: NetworkState; readonly lookup: RouteLookupEvent }) {
  const router = state.topology.nodes.find((n) => n.id === lookup.nodeId);
  if (router === undefined) return null;

  const ifaceLabels = new Map(
    state.topology.nodes.flatMap((n) => n.interfaces.map((i) => [i.id, i.label] as const))
  );

  // Live table (same data the engine used) for selection annotations.
  const table = state.routingTables[router.id] ?? [];
  const destination = asIp(lookup.destination);
  const selected = destination !== undefined ? table.find((e) => formatMatch(e) === lookup.matched) : undefined;
  const candidates: readonly RoutingEntry[] =
    destination !== undefined ? matchingRoutes(table, destination) : [];

  return (
    <section className="cache-panel" aria-label={`How did ${router.name} decide`}>
      <h3>How did {router.name} decide?</h3>
      <table className="route-table">
        <tbody>
          <tr>
            <th scope="row">Destination</th>
            <td className="mono">{lookup.destination}</td>
          </tr>
          <tr>
            <th scope="row">Matching routes</th>
            <td>{lookup.allMatches?.length ?? 0}</td>
          </tr>
        </tbody>
      </table>

      {lookup.allMatches !== undefined && lookup.allMatches.length > 0 && (
        <table className="route-table">
          <thead>
            <tr>
              <th scope="col">Route</th>
              <th scope="col">Prefix</th>
              <th scope="col">Next hop</th>
              <th scope="col">Interface</th>
              <th scope="col">Verdict</th>
            </tr>
          </thead>
          <tbody>
            {lookup.allMatches.map((m) => {
              const isWinner = `${m.destination}/${m.prefix}` === lookup.matched;
              const entry = candidates.find((e) => e.destination === m.destination && e.prefix === m.prefix);
              return (
                <tr key={`${m.destination}/${m.prefix}`} className={isWinner ? 'route-winner' : ''}>
                  <td className="mono">{m.destination}</td>
                  <td className="mono">/{m.prefix}</td>
                  <td className="mono">{m.nextHop ?? 'on-link'}</td>
                  <td className="mono">{ifaceLabels.get(m.interfaceId) ?? m.interfaceId}</td>
                  <td>
                    {isWinner
                      ? '✓ selected'
                      : entry !== undefined && selected !== undefined
                        ? routeSelectionReason(entry, candidates, selected)
                        : 'longer prefix elsewhere'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <table className="route-table">
        <tbody>
          <tr>
            <th scope="row">Selected route</th>
            <td className="mono">{lookup.matched}</td>
          </tr>
          {lookup.prefixLength !== undefined && (
            <tr>
              <th scope="row">Prefix length</th>
              <td className="mono">/{lookup.prefixLength}</td>
            </tr>
          )}
          <tr>
            <th scope="row">Next hop</th>
            <td className="mono">{lookup.nextHops?.[0] ?? lookup.via}</td>
          </tr>
          {lookup.interfaceId !== undefined && (
            <tr>
              <th scope="row">Interface</th>
              <td className="mono">{ifaceLabels.get(lookup.interfaceId) ?? lookup.interfaceId}</td>
            </tr>
          )}
        </tbody>
      </table>

      {lookup.matched === 'no match' && (
        <p className="muted panel-hint">No route contained the destination, so the packet was dropped ("No route to host").</p>
      )}
    </section>
  );
}

function formatMatch(entry: RoutingEntry): string {
  return `${entry.destination}/${entry.prefix}`;
}

function asIp(value: string): import('../models/ipv4').Ipv4Address | undefined {
  return /^(\d{1,3}\.){3}\d{1,3}$/.test(value) ? (value as import('../models/ipv4').Ipv4Address) : undefined;
}

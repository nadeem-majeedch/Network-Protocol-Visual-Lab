/**
 * Routing table model with longest-prefix-match semantics.
 *
 * The table is an immutable, serializable record. Lookup is a pure
 * function so both the engine, the UI and tests can exercise it directly.
 */

import { networkAddress } from './ipv4';
import type { Ipv4Address } from './ipv4';

export interface RoutingEntry {
  readonly id: string;
  readonly destination: Ipv4Address;
  readonly prefix: number;
  /** Absent for directly connected routes. */
  readonly nextHop?: Ipv4Address;
  readonly interfaceId: string;
  readonly metric: number;
  readonly origin: 'connected' | 'static';
}

export type RoutingTable = readonly RoutingEntry[];

export interface RouteMatch {
  readonly entry: RoutingEntry;
  /** The IP the frame must resolve to (entry next hop, or the destination itself on connected routes). */
  readonly nextHopIp: Ipv4Address;
  /** The interface the matched route egresses through. */
  readonly interfaceId: string;
}

/** Longest-prefix match; ties broken by metric then by stable id order. */
export function lookupRoute(
  table: RoutingTable,
  destination: Ipv4Address
): RouteMatch | undefined {
  const best = bestEntryFor(table, destination);
  if (best === undefined) return undefined;
  return {
    entry: best,
    nextHopIp: best.nextHop ?? destination,
    interfaceId: best.interfaceId
  };
}

/**
 * Every route whose network contains the destination, ordered the same
 * way lookupRoute orders them (longest prefix, then metric, then id).
 * Powers the "matching routes" view of the decision panel.
 */
export function matchingRoutes(table: RoutingTable, destination: Ipv4Address): readonly RoutingEntry[] {
  return table
    .filter((entry) => networkAddress(entry.destination, entry.prefix) === networkAddress(destination, entry.prefix))
    .sort((a, b) =>
      b.prefix - a.prefix || a.metric - b.metric || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
    );
}

function bestEntryFor(table: RoutingTable, destination: Ipv4Address): RoutingEntry | undefined {
  let best: RoutingEntry | undefined;
  let bestPrefix = -1;
  let bestMetric = Number.POSITIVE_INFINITY;
  for (const entry of table) {
    if (networkAddress(entry.destination, entry.prefix) !== networkAddress(destination, entry.prefix)) {
      continue;
    }
    if (
      entry.prefix > bestPrefix ||
      (entry.prefix === bestPrefix && entry.metric < bestMetric)
    ) {
      best = entry;
      bestPrefix = entry.prefix;
      bestMetric = entry.metric;
    }
  }
  return best;
}

/** Why each candidate won or lost — shown next to every matching route. */
export function routeSelectionReason(
  entry: RoutingEntry,
  all: readonly RoutingEntry[],
  selected: RoutingEntry | undefined
): string {
  if (selected === undefined) return 'candidate';
  if (entry.id === selected.id) {
    const contenders = all.filter((e) => e.id !== selected.id && e.prefix < selected.prefix);
    return contenders.length > 0
      ? `longest prefix (${selected.prefix} bits beats ${contenders.length} shorter)`
      : 'only matching route';
  }
  const sameLength = all.filter((e) => e.id !== entry.id && e.prefix === entry.prefix);
  return sameLength.some((e) => e.metric < entry.metric || (e.metric === entry.metric && e.id < entry.id))
    ? 'longest prefix — but another route of equal length won'
    : `same or shorter prefix than /${selected.prefix}`;
}

/** One-line human text for a route match, used by explain panels. */
export function explainRoute(
  destination: Ipv4Address,
  match: RouteMatch,
  table: RoutingTable
): string {
  const candidates = matchingRoutes(table, destination);
  const others = candidates.filter((e) => e.id !== match.entry.id);
  const head =
    match.entry.prefix === 0
      ? `Only the default route (0.0.0.0/0) matches ${destination}`
      : `${match.entry.destination}/${match.entry.prefix} is the longest prefix containing ${destination}`;
  const tail =
    others.length === 0
      ? '.'
      : `; ${others.length} shorter route${others.length === 1 ? '' : 's'} also matched but lost.`;
  const next =
    match.entry.nextHop !== undefined
      ? `Frame goes to next hop ${match.nextHopIp} out ${match.interfaceId}.`
      : `Destination is on-link; the frame resolves ${destination} directly via ARP out ${match.interfaceId}.`;
  return `${head}${tail} ${next}`;
}

export function formatRouteDestination(entry: RoutingEntry): string {
  return entry.prefix === 0 ? 'default' : `${entry.destination}/${entry.prefix}`;
}

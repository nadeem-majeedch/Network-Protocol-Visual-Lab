/**
 * Laboratory framework helpers.
 *
 * Everything here is a PURE projection over canonical NetworkState —
 * the same state the engine produces for the free-form simulator. No
 * protocol logic lives here: completion checks only read events, caches
 * and TCP state that the engine already recorded.
 *
 * Labs without explicit framework fields get sensible fallbacks so the
 * older catalog stays first-class inside the new framework.
 */

import type { NetworkState, TcpConnectionState } from '../models/network-state';
import type { SimulationEvent } from '../models/events';
import type { LabCompletion, LabDefinition } from './types';
import { dnsCacheKey } from '../models/dns';

/* ------------------------------------------------------------------ */
/* Event projections                                                   */
/* ------------------------------------------------------------------ */

/** All events of one canonical type, fully narrowed. */
export function eventsOf<K extends SimulationEvent['type']>(
  state: NetworkState,
  type: K
): readonly Extract<SimulationEvent, { type: K }>[] {
  return state.events.filter((e): e is Extract<SimulationEvent, { type: K }> => e.type === type);
}

/** Number of events matching an arbitrary predicate. */
export function countEvents(state: NetworkState, predicate: (event: SimulationEvent) => boolean): number {
  return state.events.filter(predicate).length;
}

/** True when at least one event of the given type was recorded. */
export function eventSeen(state: NetworkState, type: SimulationEvent['type']): boolean {
  return state.events.some((e) => e.type === type);
}

/** Events a specific node transmitted, optionally filtered by protocol. */
export function sentBy(state: NetworkState, nodeId: string, protocol?: string): readonly Extract<SimulationEvent, { type: 'PACKET_SENT' }>[] {
  return eventsOf(state, 'PACKET_SENT').filter((e) => e.nodeId === nodeId && (protocol === undefined || e.protocol === protocol));
}

/** True when a node received at least one packet of the given protocol. */
export function receivedBy(state: NetworkState, nodeId: string, protocol?: string): boolean {
  return eventsOf(state, 'PACKET_RECEIVED').some(
    (e) => e.nodeId === nodeId && (protocol === undefined || e.protocol === protocol)
  );
}

/** True when a packet was dropped for a reason containing the fragment. */
export function dropReasonContains(state: NetworkState, fragment: string): boolean {
  return eventsOf(state, 'PACKET_DROPPED').some((e) => e.reason.includes(fragment));
}

/* ------------------------------------------------------------------ */
/* State projections                                                   */
/* ------------------------------------------------------------------ */

/** ARP cache holds a binding for ip on nodeId. */
export function arpEntry(state: NetworkState, nodeId: string, ip: string): boolean {
  return state.arpCaches[nodeId]?.[ip] !== undefined;
}

/** Number of MAC addresses the switch has learned. */
export function macTableSize(state: NetworkState, nodeId: string): number {
  return Object.keys(state.macTables[nodeId] ?? {}).length;
}

/** DNS cache holds a (fresh or expired) record for name on nodeId. */
export function dnsCached(state: NetworkState, nodeId: string, name: string, type = 'A'): boolean {
  return state.dnsCaches[nodeId]?.[dnsCacheKey(name, type as never)] !== undefined;
}

/** First TCP connection in state, if any. */
export function firstTcpConnection(state: NetworkState): TcpConnectionState | undefined {
  return state.tcpConnections[0];
}

/** Any connection's side sits in (or ended in) the given TCP state. */
export function tcpSideIs(state: NetworkState, role: 'client' | 'server', stateName: string): boolean {
  return state.tcpConnections.some((c) => c[role].state === stateName);
}

/** A transition from → to was observed on any endpoint. */
export function tcpTransitionSeen(state: NetworkState, from: string, to: string): boolean {
  return eventsOf(state, 'TCP_STATE_CHANGE').some((e) => e.from === from && e.to === to);
}

/** Number of inbound data segments a receiver acknowledged. */
export function tcpDataAcks(state: NetworkState, minimum = 1): boolean {
  return (
    eventsOf(state, 'TCP_STATE_CHANGE').filter((e) => e.trigger.startsWith('data received')).length >= minimum
  );
}

/** A packet arrived at nodeId whose IPv4 TTL equals the expected value. */
export function ttlArrivedAt(state: NetworkState, nodeId: string, ttl: number): boolean {
  return eventsOf(state, 'PACKET_RECEIVED').some((e) => {
    if (e.nodeId !== nodeId) return false;
    const packet = state.packets.find((p) => p.id === e.packetId);
    if (packet === undefined) return false;
    const payload = packet.frame.payload;
    return payload.kind === 'ip' && payload.ip.ttl === ttl;
  });
}

/** A route lookup at nodeId matched exactly this route (e.g. '0.0.0.0/0'). */
export function routeMatched(state: NetworkState, nodeId: string, matched: string): boolean {
  return eventsOf(state, 'ROUTE_LOOKUP').some((e) => e.nodeId === nodeId && e.matched === matched);
}

/** A lookup at nodeId weighed ≥2 candidate routes — longest prefix decided. */
export function longestPrefixDecided(state: NetworkState, nodeId: string): boolean {
  return eventsOf(state, 'ROUTE_LOOKUP').some((e) => e.nodeId === nodeId && (e.allMatches?.length ?? 0) >= 2);
}

/** An HTTP request (optionally of a method) was seen. */
export function httpRequestSeen(state: NetworkState, method?: string): boolean {
  return eventsOf(state, 'HTTP_REQUEST').some((e) => method === undefined || e.method === method);
}

/** An HTTP response (optionally with a status code) was seen. */
export function httpResponseSeen(state: NetworkState, status?: number): boolean {
  return eventsOf(state, 'HTTP_RESPONSE').some((e) => status === undefined || e.status === status);
}

/** Both halves of an HTTP exchange happened: request AND response. */
export function httpExchange(state: NetworkState, method?: string, status?: number): boolean {
  return httpRequestSeen(state, method) && httpResponseSeen(state, status);
}

/** A frame addressed to `mac` arrived at `nodeId` (unicast delivery check). */
export function macArrivedAt(state: NetworkState, nodeId: string, mac: string): boolean {
  return eventsOf(state, 'PACKET_RECEIVED').some((e) => {
    if (e.nodeId !== nodeId) return false;
    const packet = state.packets.find((p) => p.id === e.packetId);
    return packet !== undefined && packet.frame.destination === mac;
  });
}

/** A packet carries HTTP nested in TCP nested in IPv4 nested in Ethernet. */
export function encapsulatedHttp(state: NetworkState): boolean {
  return state.packets.some((p) => {
    const payload = p.frame.payload;
    if (payload.kind !== 'ip') return false;
    const inner = payload.ip.payload;
    if (inner.kind !== 'tcp') return false;
    const segment = inner.payload;
    return segment !== undefined && (segment.kind === 'request' || segment.kind === 'response');
  });
}

/* ------------------------------------------------------------------ */
/* Completion construction                                             */
/* ------------------------------------------------------------------ */

/** Wraps a pure predicate + student-facing description as LabCompletion. */
export function completedWhen(
  description: string,
  check: (state: NetworkState) => boolean
): LabCompletion {
  return { description, check };
}

/** Conjunction of several predicates — all must hold. */
export function allOf(
  ...checks: readonly ((state: NetworkState) => boolean)[]
): (state: NetworkState) => boolean {
  return (state) => checks.every((check) => check(state));
}

/** Events that only exist when the lab's script actually did something. */
export function isScheduledActivity(event: SimulationEvent): boolean {
  return event.type !== 'NODE_CREATED' && event.type !== 'LINK_CREATED';
}

const DEFAULT_COMPLETION: LabCompletion = {
  description: 'The scenario ran to the end of its script — every scheduled transmission executed on the engine.',
  check: (state) => countEvents(state, isScheduledActivity) > 0
};

/** The lab's completion criteria, with a ran-to-completion default. */
export function labCompletion(lab: LabDefinition): LabCompletion {
  return lab.completion ?? DEFAULT_COMPLETION;
}

/* ------------------------------------------------------------------ */
/* Fallback accessors for optional framework fields                    */
/* ------------------------------------------------------------------ */

/** Simulation controls every lab exposes (Controls component). */
export const DEFAULT_CONTROLS: readonly string[] = [
  'Run — execute the whole scenario and play the animation',
  'Pause / Play — freeze the playback at any moment',
  'Engine step — advance one scheduled engine action at a time',
  'Forward / Back — move the playback cursor one event at a time',
  'Reset — return the lab to its pristine initial topology',
  'Speed — 0.25× to 4× playback'
];

/** Learning objectives: explicit, or derived from the lab's objective. */
export function labObjectives(lab: LabDefinition): readonly string[] {
  return lab.objectives ?? [lab.objective];
}

/** Prerequisite labs/topics: explicit, or none. */
export function labPrerequisites(lab: LabDefinition): readonly string[] {
  return lab.prerequisites ?? [];
}

/** Expected observations: explicit, or the narrated step titles. */
export function labExpectedObservations(lab: LabDefinition): readonly string[] {
  return lab.expectedObservations ?? lab.steps.map((s) => s.title);
}

/** Hints: explicit, or none. */
export function labHints(lab: LabDefinition): readonly string[] {
  return lab.hints ?? [];
}

/** Deeper explanation: explicit, or the objective. */
export function labExplanation(lab: LabDefinition): readonly string[] {
  return lab.explanation !== undefined ? [lab.explanation] : [lab.objective];
}

/** Controls the student should exercise: explicit, or the standard set. */
export function labControls(lab: LabDefinition): readonly string[] {
  return lab.controls ?? DEFAULT_CONTROLS;
}

/** 'Lab 07' style badge for numbered labs; undefined for the older catalog. */
export function labNumberBadge(lab: LabDefinition): string | undefined {
  const match = /^lab-(\d{2})-/.exec(lab.id);
  return match === null ? undefined : `Lab ${match[1] ?? ''}`;
}

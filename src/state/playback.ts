/**
 * Playback helpers: pure functions over the recorded event timeline.
 *
 * The model supports true backward stepping because every event carries
 * its own timestamp: the cursor is a position in sim-time, "step back"
 * means "jump to the previous distinct event time", and visibility of any
 * packet/hop is a pure function of (packet, cursor). No protocol logic
 * and no animation state live here.
 */

import type { NetworkState } from '../models/network-state';
import type { Packet } from '../models/packet';
import type { SimulationEvent } from '../models/events';

/** Sorted, distinct event timestamps — the timeline's ruler. */
export function eventTimes(events: readonly SimulationEvent[]): number[] {
  const set = new Set<number>();
  for (const e of events) set.add(e.ts);
  return [...set].sort((a, b) => a - b);
}

/** Previous distinct event time before `cursor` (null at the start). */
export function previousEventTime(events: readonly SimulationEvent[], cursor: number): number | null {
  let prev: number | null = null;
  for (const t of eventTimes(events)) {
    if (t < cursor) prev = t;
    else break;
  }
  return prev;
}

/** Next distinct event time after `cursor` (null at the end). */
export function nextEventTime(events: readonly SimulationEvent[], cursor: number): number | null {
  for (const t of eventTimes(events)) {
    if (t > cursor) return t;
  }
  return null;
}

/** Events visible at a given cursor position (ts <= cursor). */
export function visibleEvents(events: readonly SimulationEvent[], cursor: number): readonly SimulationEvent[] {
  return events.filter((e) => e.ts <= cursor);
}

/** Packets that exist at the cursor (created, not yet expired). */
export function visiblePackets(state: NetworkState, cursor: number): readonly Packet[] {
  return state.packets.filter((p) => {
    const born = p.hops[0]?.startMs ?? p.bornMs;
    return born <= cursor;
  });
}

/** A packet is mid-flight when the cursor is inside one of its hops. */
export function packetInFlight(packet: Packet, cursor: number): boolean {
  return packet.hops.some((hop) => cursor >= hop.startMs && cursor <= hop.endMs);
}

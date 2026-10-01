/**
 * Wire simulation: models latency across a link between two interfaces.
 * The engine schedules an 'arrive' callback at (now + latencyMs).
 */

import type { Packet } from '../models/packet';

export interface WireTransmission {
  readonly packetId: string;
  readonly linkId: string;
  readonly fromInterface: string;
  readonly toInterface: string;
  readonly departMs: number;
  readonly arriveMs: number;
}

export function makeTransmission(
  packet: Packet,
  linkId: string,
  fromInterface: string,
  toInterface: string,
  departMs: number,
  latencyMs: number
): WireTransmission {
  return {
    packetId: packet.id,
    linkId,
    fromInterface,
    toInterface,
    departMs,
    arriveMs: departMs + latencyMs
  };
}

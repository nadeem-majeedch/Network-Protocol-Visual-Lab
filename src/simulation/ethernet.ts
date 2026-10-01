/**
 * Ethernet layer: frame acceptance and learning-switch bookkeeping.
 * The engine performs actual forwarding; these pure helpers encode the
 * acceptance rule (own MAC or broadcast) and MAC-table learning.
 */

import { BROADCAST_MAC } from '../models/mac';

export function frameAccepted(interfaces: readonly { mac: string }[], frameDestination: string): boolean {
  if (frameDestination === BROADCAST_MAC) return true;
  return interfaces.some((iface) => iface.mac === frameDestination);
}

export function switchLearn(
  table: Readonly<Record<string, string>>,
  address: string,
  interfaceId: string
): Record<string, string> {
  return { ...table, [address]: interfaceId };
}

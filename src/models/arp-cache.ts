/**
 * ARP cache model: an immutable IP→MAC map with optional pending queue.
 */

import type { Ipv4Address } from './ipv4';
import type { MacAddress } from './mac';

export type ArpCache = Readonly<Record<string, MacAddress>>;

export function arpCacheSet(cache: ArpCache, ip: Ipv4Address, mac: MacAddress): ArpCache {
  return { ...cache, [ip]: mac };
}

export function arpCacheGet(cache: ArpCache, ip: Ipv4Address): MacAddress | undefined {
  return cache[ip];
}

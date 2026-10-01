/**
 * Subnet model: a configured IP network on the simulated topology.
 *
 * Stored fields are descriptive/authoritative identity; derived values
 * (network address, broadcast, size) are computed, never stored, so
 * stored data cannot disagree with the math.
 */

import type { Ipv4Address } from './ipv4';

export interface Subnet {
  readonly id: string;
  readonly name: string;
  /** Dotted-decimal network address, e.g. "192.168.1.0". */
  readonly network: Ipv4Address;
  /** Prefix length 0-32. */
  readonly prefix: number;
  /** Display color token shared by members. */
  readonly color: string;
}

export interface SubnetInfo {
  readonly network: Ipv4Address;
  readonly broadcast: Ipv4Address;
  readonly hostCount: number;
}

export function subnetInfo(subnet: Subnet): SubnetInfo {
  const base = networkBits(subnet.network, subnet.prefix);
  const size = subnet.prefix >= 31 ? (subnet.prefix === 31 ? 2 : 1) : 2 ** (32 - subnet.prefix);
  return {
    network: subnet.network,
    broadcast: fromBits(base | (0xffffffff >>> subnet.prefix)),
    hostCount: subnet.prefix >= 31 ? size : size - 2
  };
}

export function subnetContains(subnet: Subnet, ip: Ipv4Address): boolean {
  return networkBits(ip, subnet.prefix) === networkBits(subnet.network, subnet.prefix);
}

function networkBits(ip: string, prefix: number): number {
  const parts = ip.split('.').map(Number);
  const value =
    (((parts[0] ?? 0) << 24) | ((parts[1] ?? 0) << 16) | ((parts[2] ?? 0) << 8) | (parts[3] ?? 0)) >>> 0;
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (value & mask) >>> 0;
}

function fromBits(value: number): Ipv4Address {
  const n = value >>> 0;
  return `${(n >>> 24) & 0xff}.${(n >>> 16) & 0xff}.${(n >>> 8) & 0xff}.${n & 0xff}` as Ipv4Address;
}

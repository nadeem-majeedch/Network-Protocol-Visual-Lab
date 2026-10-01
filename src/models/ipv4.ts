/**
 * IPv4 address model.
 *
 * IPv4 addresses are immutable value objects normalized to dotted-decimal
 * strings, e.g. "10.0.0.1". The brand prevents accidental mixing with
 * MAC or port types while remaining a plain serializable string.
 */

const IPV4_PATTERN = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;
const IPV4_CIDR_PATTERN = /^(.+)\/(\d|[12]\d|3[0-2])$/;

export type Ipv4Address = string & { readonly __brand: 'Ipv4Address' };

export function ipv4(input: string): Ipv4Address {
  const trimmed = input.trim();
  if (!IPV4_PATTERN.test(trimmed)) {
    throw new Error(`Invalid IPv4 address: ${input}`);
  }
  return trimmed as Ipv4Address;
}

export function isIpv4(value: string): boolean {
  return IPV4_PATTERN.test(value);
}

/** Parses "10.0.0.5/24" into address + prefix length. */
export function parseCidr(input: string): { address: Ipv4Address; prefix: number } {
  const match = IPV4_CIDR_PATTERN.exec(input.trim());
  if (!match || !isIpv4(match[1] as string)) {
    throw new Error(`Invalid CIDR: ${input}`);
  }
  return { address: ipv4(match[1] as string), prefix: Number(match[2]) };
}

export function toUint32(value: Ipv4Address): number {
  const parts = value.split('.').map(Number);
  return ((parts[0]! << 24) | (parts[1]! << 16) | (parts[2]! << 8) | parts[3]!) >>> 0;
}

export function fromUint32(value: number): Ipv4Address {
  const n = value >>> 0;
  return ipv4(`${(n >>> 24) & 0xff}.${(n >>> 16) & 0xff}.${(n >>> 8) & 0xff}.${n & 0xff}`);
}

/** Network address of the subnet containing `addr` for the given prefix. */
export function networkAddress(addr: Ipv4Address, prefix: number): Ipv4Address {
  return fromUint32(toUint32(addr) & maskFor(prefix));
}

/** SMALLEST host address of the subnet (not reserved for network id here). */
export function firstHost(addr: Ipv4Address, prefix: number): Ipv4Address {
  return fromUint32((toUint32(addr) & maskFor(prefix)) | (prefix < 31 ? 1 : 0));
}

export function maskFor(prefix: number): number {
  return prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
}

export function sameSubnet(a: Ipv4Address, b: Ipv4Address, prefix: number): boolean {
  return networkAddress(a, prefix) === networkAddress(b, prefix);
}

export function formatIp(value: string): string {
  return value;
}

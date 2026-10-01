/**
 * MAC address model.
 *
 * MAC addresses are immutable value objects normalized to lowercase
 * colon-separated hex, e.g. "aa:bb:cc:00:00:01".
 */

const MAC_PATTERN = /^[0-9a-f]{2}(:[0-9a-f]{2}){5}$/;
export const BROADCAST_MAC = 'ff:ff:ff:ff:ff:ff' as MacAddress;

export type MacAddress = string & { readonly __brand: 'MacAddress' };

/** Parses any common MAC formatting (dashes, dots, mixed case). */
export function mac(input: string): MacAddress {
  const hex = input.toLowerCase().replace(/[^0-9a-f]/g, '');
  if (hex.length !== 12) {
    throw new Error(`Invalid MAC address: ${input}`);
  }
  const octets: string[] = [];
  for (let i = 0; i < 12; i += 2) {
    octets.push(hex.slice(i, i + 2));
  }
  const value = octets.join(':');
  assertMac(value);
  return value as MacAddress;
}

export function assertMac(value: string): void {
  if (!MAC_PATTERN.test(value)) {
    throw new Error(`Invalid MAC address: ${value}`);
  }
}

export function isUnicast(value: MacAddress): boolean {
  return value !== BROADCAST_MAC;
}

export function isBroadcast(value: MacAddress): boolean {
  return value === BROADCAST_MAC;
}

/** IEEE OUI locally-administered prefix used for simulated devices. */
export function labOui(index: number): MacAddress {
  return mac(`02:00:00:00:${hex2((index >> 8) & 0xff)}:${hex2(index & 0xff)}`);
}

export function formatMac(value: string): string {
  return value.toUpperCase();
}

function hex2(n: number): string {
  return n.toString(16).padStart(2, '0');
}

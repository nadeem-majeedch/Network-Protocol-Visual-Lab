/**
 * ARP packet model (RFC 826 shape).
 */

import type { Ipv4Address } from './ipv4';
import type { MacAddress } from './mac';

export type ArpOperation = 'request' | 'reply';

export interface ArpPacket {
  readonly kind: 'arp';
  readonly operation: ArpOperation;
  readonly senderIp: Ipv4Address;
  readonly senderMac: MacAddress;
  readonly targetIp: Ipv4Address;
  /** Unknown during a request. */
  readonly targetMac?: MacAddress;
}

export const ARP_REQUEST = 'request' as const;
export const ARP_REPLY = 'reply' as const;

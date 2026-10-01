/**
 * Ethernet frame model.
 *
 * An Ethernet II frame is the outermost layer of every simulated packet.
 * Payload is stored as a discriminated union so the inspector can render
 * exactly the fields that exist for the packet.
 */

import type { MacAddress } from './mac';
import type { ArpPacket } from './arp';
import type { IpPacket } from './ip';

export type EtherType = 0x0800 | 0x0806;

export interface EthernetFrame<
  TPayload extends Payload = Payload
> {
  readonly kind: 'frame';
  readonly source: MacAddress;
  readonly destination: MacAddress;
  readonly etherType: EtherType;
  readonly payload: TPayload;
}

export type Payload = ArpPayload | IpPayload;

export interface ArpPayload {
  readonly kind: 'arp';
  readonly arp: ArpPacket;
}

export interface IpPayload {
  readonly kind: 'ip';
  readonly ip: IpPacket;
}

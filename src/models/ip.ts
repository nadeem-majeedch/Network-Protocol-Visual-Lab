/**
 * IPv4 packet model.
 */

import type { Ipv4Address } from './ipv4';
import type { TcpSegment } from './tcp';
import type { UdpDatagram } from './udp';
import type { IcmpMessage } from './icmp';

export type IpProtocol = 'icmp' | 'tcp' | 'udp';

export interface IpPacket {
  readonly kind: 'ip';
  readonly source: Ipv4Address;
  readonly destination: Ipv4Address;
  readonly ttl: number;
  readonly protocol: IpProtocol;
  /** Transport or ICMP payload. */
  readonly payload: TransportPayload;
}

export type TransportPayload = TcpSegment | UdpDatagram | IcmpMessage;

/**
 * UDP datagram model.
 */

import type { DnsMessage } from './dns';
import type { HttpMessage } from './http';

export interface UdpDatagram {
  readonly kind: 'udp';
  readonly sourcePort: number;
  readonly destinationPort: number;
  readonly payload: DnsMessage | HttpMessage;
}

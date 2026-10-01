/**
 * TCP segment model.
 */

import type { HttpMessage } from './http';

export interface TcpFlags {
  readonly syn: boolean;
  readonly ack: boolean;
  readonly fin: boolean;
  readonly rst: boolean;
  readonly psh: boolean;
}

/** Application data carried in a TCP segment (HTTP today; opaque bytes to TCP). */
export type TcpPayload = HttpMessage | { readonly kind: 'data'; readonly text: string };

export interface TcpSegment {
  readonly kind: 'tcp';
  readonly sourcePort: number;
  readonly destinationPort: number;
  readonly sequence: number;
  readonly acknowledgment: number;
  readonly flags: TcpFlags;
  readonly window: number;
  readonly payload?: TcpPayload;
}

export type TcpStateName =
  | 'CLOSED'
  | 'LISTEN'
  | 'SYN_SENT'
  | 'SYN_RCVD'
  | 'ESTABLISHED'
  | 'FIN_WAIT_1'
  | 'FIN_WAIT_2'
  | 'CLOSE_WAIT'
  | 'CLOSING'
  | 'LAST_ACK'
  | 'TIME_WAIT';

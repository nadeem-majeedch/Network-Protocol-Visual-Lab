/**
 * ICMP message model, used to visualize TTL expiry and unreachable destinations.
 */

export type IcmpType = 'echo-request' | 'echo-reply' | 'ttl-exceeded' | 'destination-unreachable';

export interface IcmpMessage {
  readonly kind: 'icmp';
  readonly type: IcmpType;
  readonly code?: string;
}

/**
 * DNS message model (RFC 1035 shape, simplified for simulation).
 */

export type DnsRecordType = 'A' | 'AAAA' | 'CNAME' | 'NS' | 'MX';

export interface DnsQuestion {
  readonly name: string;
  readonly type: DnsRecordType;
}

export interface DnsRecord {
  readonly name: string;
  readonly type: DnsRecordType;
  readonly value: string;
  readonly ttl: number;
}

export interface DnsMessage {
  readonly kind: 'dns';
  readonly transactionId: number;
  readonly isResponse: boolean;
  readonly questions: readonly DnsQuestion[];
  /** Present only in responses. */
  readonly answers?: readonly DnsRecord[];
  /**
   * Recursive mode: set on the resolver→authoritative exchange so the
   * resolver can route the reply back to its original client instead of
   * broadcasting to UDP/53.
   */
  readonly originalClient?: string;
  readonly originalClientPort?: number;
}

/** One cached DNS answer: the record plus the sim-time it was written. */
export interface DnsCacheEntry {
  readonly record: DnsRecord;
  /** Simulation time (ms) at which the record was cached. */
  readonly writtenAtMs: number;
  /** True when the record came from the local zone rather than the wire. */
  readonly authoritative: boolean;
}

/** DNS cache: nodeId → (name|type → entry). Key format: `${name}|${type}`. */
export type DnsCache = Readonly<Record<string, DnsCacheEntry>>;

/** Builds the per-record cache key. */
export function dnsCacheKey(name: string, type: DnsRecordType): string {
  return `${name}|${type}`;
}

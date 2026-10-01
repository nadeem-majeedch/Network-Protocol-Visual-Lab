/**
 * NetworkState: the canonical, serializable simulation state.
 *
 * The engine produces this state; every visualization, inspector, and lab
 * consumes it. Rebuilding it from events must yield an equal structure.
 */

import type { ArpCache } from './arp-cache';
import type { Packet } from './packet';
import type { RoutingTable } from './routing';
import type { DnsCache } from './dns';
import type { SimulationEvent } from './events';
import type { TcpStateName } from './tcp';
import type { Topology } from './topology';

export interface TcpConnectionState {
  readonly id: string;
  readonly client: { readonly nodeId: string; readonly state: TcpStateName };
  readonly server: { readonly nodeId: string; readonly state: TcpStateName };
  /** Most recent endpoint state, keyed per side (may be absent early). */
  readonly clientSeq?: number;
  readonly clientAck?: number;
  readonly clientWindow?: number;
  readonly serverSeq?: number;
  readonly serverAck?: number;
  readonly serverWindow?: number;
  readonly lastFlags?: string;
}

export interface NetworkState {
  readonly simMs: number;
  readonly packets: readonly Packet[];
  readonly arpCaches: Readonly<Record<string, ArpCache>>;
  /** Learning-switch tables: nodeId → (MAC → port label). */
  readonly macTables: Readonly<Record<string, Readonly<Record<string, string>>>>;
  readonly routingTables: Readonly<Record<string, RoutingTable>>;
  /** DNS caches: nodeId → (name|type → entry), as of the current sim time. */
  readonly dnsCaches: Readonly<Record<string, DnsCache>>;
  readonly tcpConnections: readonly TcpConnectionState[];
  readonly events: readonly SimulationEvent[];
  readonly topology: Topology;
}

export function emptyNetworkState(topology: Topology): NetworkState {
  return {
    simMs: 0,
    packets: [],
    arpCaches: {},
    macTables: {},
    routingTables: {},
    dnsCaches: {},
    tcpConnections: [],
    events: [],
    topology
  };
}

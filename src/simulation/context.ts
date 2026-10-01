/**
 * Simulation context: the only handles a protocol handler may use.
 * Handlers own no state; they read via ctx and schedule future work,
 * keeping every mutation inside the engine's deterministic tick loop.
 */

import type { Packet } from '../models/packet';
import type { Ipv4Address } from '../models/ipv4';
import type { MacAddress } from '../models/mac';
import type { RoutingTable } from '../models/routing';
import type { SimulationEvent } from '../models/events';

export interface SimulationContext {
  /** Current simulation time in milliseconds. */
  now(): number;
  /** Emit a simulation event into the canonical log. */
  emit(event: SimulationEvent): void;
  /** Send a frame out of a node's interface onto its link. */
  transmit(frame: Packet['frame'], fromNodeId: string, fromInterfaceId: string): void;
  /** Schedule a callback at a future simulation time. */
  after(delayMs: number, handler: (ctx: SimulationContext) => void): void;
  /** Routing table for a node. */
  routingTable(nodeId: string): RoutingTable;
  /** ARP cache operations. */
  arpGet(nodeId: string, ip: Ipv4Address): MacAddress | undefined;
  arpSet(nodeId: string, ip: Ipv4Address, mac: MacAddress): void;
  /** Record TCP connection state for the UI. */
  setTcpState(nodeId: string, connectionId: string, state: TcpEndpointState): void;
}

export interface TcpEndpointState {
  readonly localPort: number;
  readonly remotePort: number;
  readonly state: string;
}

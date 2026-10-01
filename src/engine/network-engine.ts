/**
 * NetworkEngine: the single canonical simulation engine.
 *
 * - Deterministic: same topology + script → identical event log.
 * - Serializable: NetworkState is plain data; the engine itself is
 *   reconstructible from (topology, script).
 * - Protocol logic lives in src/simulation; the engine only moves
 *   packets, advances time, and dispatches to handlers.
 *
 * ARP-gated transmission: `transmitResolved` checks the node's ARP cache
 * for the next-hop IP. On hit, the frame goes out immediately with the
 * learned MAC. On miss, the packet is PARKED in a per-node pending queue
 * and an ARP request is broadcast; when the reply is written to the cache
 * (ARP_WRITE), the queue is flushed and the parked packet continues with
 * the learned MAC. This is real unresolved-destination behavior, not an
 * animation shortcut.
 */

import type { Topology, Node, NetworkInterface, Link } from '../models/topology';
import type { Packet, PacketHop, PacketState } from '../models/packet';
import type { EthernetFrame } from '../models/ethernet';
import type { Ipv4Address } from '../models/ipv4';
import type { MacAddress } from '../models/mac';
import type { RoutingTable, RoutingEntry } from '../models/routing';
import type { DnsCacheEntry } from '../models/dns';
import { dnsCacheKey } from '../models/dns';
import type { SimulationEvent, TcpStateName } from '../models/events';
import type { NetworkState, TcpConnectionState } from '../models/network-state';
import { Scheduler } from './scheduler';
import {
  buildPacket,
  withHops,
  makeHop,
  resetBuilders,
  buildFrame,
  buildArpRequest
} from '../simulation/builder';
import { defaultStack } from '../simulation/stack';
import type { HandlerContext } from '../simulation/stack';
import { emptyNetworkState } from '../models/network-state';
import { networkAddress } from '../models/ipv4';

type TickHandler = (ctx: HandlerContext) => void;

export interface SimulationContextLike extends Omit<HandlerContext, '__receiver'> {
  /** Attach receiver info for handler dispatch. */
  __receiver?: { node: Node; iface: NetworkInterface };
}

interface InFlight {
  readonly packet: Packet;
  readonly toIface: NetworkInterface;
  readonly toNode: Node;
  readonly arriveMs: number;
}

interface PendingEntry {
  readonly packet: Packet;
  readonly nextHopIp: Ipv4Address;
  readonly egressIfaceId: string;
  readonly originalIface: NetworkInterface;
  readonly description: string;
}

export class NetworkEngine {
  private topology: Topology;
  private scheduler = new Scheduler<TickHandler>();
  private packets: Packet[] = [];
  private inFlight: InFlight[] = [];
  private events: SimulationEvent[] = [];
  private arpCaches: Record<string, Record<string, MacAddress>> = {};
  private macTables: Record<string, Record<string, string>> = {};
  private pendingArp: Record<string, PendingEntry[]> = {};
  private dnsCaches: Record<string, Record<string, DnsCacheEntry>> = {};
  private tcpOverrides: Record<string, TcpEndpointState> = {};
  private serialCounter = 0;
  private nowMs = 0;

  private linksByIface = new Map<string, Link>();
  private ifaceById = new Map<string, NetworkInterface>();

  constructor(topology: Topology) {
    this.topology = topology;
    this.reindex();
  }

  get topologyRef(): Topology {
    return this.topology;
  }

  /** Rebuilds adjacency indexes; call after topology changes. */
  reindex(): void {
    this.linksByIface.clear();
    this.ifaceById.clear();
    for (const link of this.topology.links) {
      for (const ep of link.endpoints) {
        this.linksByIface.set(ep, link);
      }
    }
    for (const node of this.topology.nodes) {
      for (const iface of node.interfaces) {
        this.ifaceById.set(iface.id, iface);
      }
    }
  }

  /** Runs the given script to completion; returns the final state. */
  run(script: (ctx: SimulationContextLike) => void): NetworkState {
    this.resetInternal();
    const ctx = this.makeContext();
    script(ctx);
    this.drain();
    return this.getState();
  }

  /** Advances one pending scheduler item; used by Step mode. */
  step(seed?: (ctx: SimulationContextLike) => void): NetworkState {
    // A fresh engine must look like run(): emit the topology intro before
    // the first scheduled item, so Step mode replays the same sequence.
    if (this.scheduler.size === 0 && this.events.length === 0 && seed !== undefined) {
      this.resetInternal();
      seed(this.makeContext());
    }
    const next = this.scheduler.pop();
    if (next !== undefined) {
      this.nowMs = next.time;
      next.value(this.makeContext());
    }
    return this.getState();
  }

  private drain(): void {
    let guard = 0;
    while (this.scheduler.size > 0 && guard < 10000) {
      const next = this.scheduler.pop();
      if (next === undefined) break;
      this.nowMs = next.time;
      next.value(this.makeContext());
      guard++;
    }
    this.inFlight = [];
  }

  private resetInternal(): void {
    resetBuilders();
    this.scheduler.clear();
    this.packets = [];
    this.inFlight = [];
    this.events = [];
    this.arpCaches = {};
    this.macTables = {};
    this.pendingArp = {};
    this.dnsCaches = {};
    this.tcpOverrides = {};
    this.serialCounter = 0;
    this.nowMs = 0;

    // Canonical topology lifecycle events open every run.
    for (const node of this.topology.nodes) {
      this.events.push({ type: 'NODE_CREATED', ts: 0, nodeId: node.id, kind: node.kind, name: node.name });
    }
    for (const link of this.topology.links) {
      this.events.push({ type: 'LINK_CREATED', ts: 0, linkId: link.id, a: link.endpoints[0]!, b: link.endpoints[1]! });
    }
  }

  private makeContext(): SimulationContextLike {
    // eslint-disable-next-line @typescript-eslint/no-this-alias -- stable alias for arrow closures below
    const self = this;
    return {
      now: () => self.nowMs,
      emit: (event) => {
        self.events.push(event);
      },
      transmit: (frame, fromNodeId, fromInterfaceId) => {
        self.transmitInternal(frame, fromNodeId, fromInterfaceId);
      },
      after: (delayMs, handler) => {
        self.scheduler.schedule(self.nowMs + delayMs, handler as TickHandler);
      },
      routingTable: (nodeId) => self.routingTableFor(nodeId),
      arpGet: (nodeId, ip) => self.arpCaches[nodeId]?.[ip],
      arpSet: (nodeId, ip, macAddr) => {
        const cache = self.arpCaches[nodeId] ?? {};
        cache[ip] = macAddr;
        self.arpCaches[nodeId] = cache;
        self.events.push({ type: 'ARP_WRITE', ts: self.nowMs, nodeId, ip, mac: macAddr });
        self.onArpWrite(nodeId, ip, macAddr);
      },
      dnsGet: (nodeId, name, recordType) => {
        const entry = self.dnsCaches[nodeId]?.[dnsCacheKey(name, recordType)];
        if (entry === undefined) return undefined;
        if (self.nowMs >= entry.writtenAtMs + entry.record.ttl) {
          return { ...entry, record: entry.record, expired: true };
        }
        return { ...entry, expired: false };
      },
      dnsSet: (nodeId, record) => {
        const cache = self.dnsCaches[nodeId] ?? {};
        cache[dnsCacheKey(record.name, record.type)] = { record, writtenAtMs: self.nowMs, authoritative: false };
        self.dnsCaches[nodeId] = cache;
        self.events.push({
          type: 'DNS_CACHE_WRITE',
          ts: self.nowMs,
          nodeId,
          name: record.name,
          recordType: record.type,
          value: record.value,
          ttl: record.ttl,
          expiresAtMs: self.nowMs + record.ttl,
          authoritative: false
        });
      },
      setTcpState: (nodeId, connectionId, state) => {
        const key = `${nodeId}|${connectionId}`;
        const previous = self.tcpOverrides[key];
        // Merge: a transition that only advances ack keeps the last seq.
        self.tcpOverrides[key] = { ...previous, ...state } as TcpEndpointState;
      },
      tcpGet: (nodeId, connectionId) => {
        const entry = self.tcpOverrides[`${nodeId}|${connectionId}`];
        if (entry === undefined) return undefined;
        return {
          state: entry.state as TcpStateName,
          ...(entry.seq !== undefined ? { seq: entry.seq } : {}),
          ...(entry.ack !== undefined ? { ack: entry.ack } : {}),
          ...(entry.window !== undefined ? { window: entry.window } : {})
        };
      },
      transmitResolved: (packet, fromNodeId, nextHopIp, description, egressInterfaceId) => {
        self.transmitResolvedInternal(packet, fromNodeId, nextHopIp, description, egressInterfaceId);
      }
    };
  }

  /**
   * ARP-gated egress: resolve nextHopIp from the node's cache and transmit;
   * park the packet and broadcast an ARP request on a cache miss.
   */
  private transmitResolvedInternal(
    packet: Packet,
    fromNodeId: string,
    nextHopIp: Ipv4Address,
    description: string,
    egressInterfaceId?: string
  ): void {
    const node = this.nodeById(fromNodeId);
    if (node === undefined) return;
    const cached = this.arpCaches[fromNodeId]?.[nextHopIp];

    // First sight of this packet: record its creation in the canonical
    // log with a real serial (runners hand packets serial 0).
    let canonical = packet;
    if (!this.packets.some((p) => p.id === packet.id)) {
      const serial = packet.serial > 0 ? packet.serial : ++this.serialCounter;
      canonical = { ...packet, serial };
      this.packets.push({ ...canonical, state: cached !== undefined ? 'in-flight' : 'queued' });
      this.events.push({
        type: 'PACKET_CREATED',
        ts: this.nowMs,
        packetId: canonical.id,
        serial,
        protocol: protocolLabel(canonical.frame)
      });
    }

    if (cached !== undefined) {
      // Cache hit: egress immediately through the route's interface
      // (explicit when given, otherwise the first interface toward the
      // subnet that contains the next hop).
      const egress = this.egressToward(fromNodeId, nextHopIp, egressInterfaceId);
      if (egress === undefined) {
        this.events.push({ type: 'PACKET_DROPPED', ts: this.nowMs, nodeId: fromNodeId, packetId: packet.id, reason: 'No interface on the target subnet' });
        this.markPacketState(packet.id, 'dropped', 'No interface on the target subnet');
        return;
      }
      const frame = buildFrame({
        source: egress.mac,
        destination: cached,
        etherType: 0x0800,
        payload: packet.frame.payload
      });
      this.events.push({
        type: 'PACKET_SENT',
        ts: this.nowMs,
        nodeId: fromNodeId,
        interfaceId: egress.id,
        packetId: packet.id,
        protocol: protocolLabel(frame),
        summary: description
      });
      this.sendOnLink(canonical, frame, fromNodeId, egress);
      return;
    }

    // Cache miss: park the packet and broadcast an ARP request.
    const egress = this.egressToward(fromNodeId, nextHopIp, egressInterfaceId);
    if (egress === undefined) {
      this.events.push({ type: 'PACKET_DROPPED', ts: this.nowMs, nodeId: fromNodeId, packetId: packet.id, reason: 'No interface on the target subnet' });
      this.markPacketState(packet.id, 'dropped', 'No interface on the target subnet');
      return;
    }
    const queue = this.pendingArp[fromNodeId] ?? [];
    const alreadyPending = queue.some((q) => q.nextHopIp === nextHopIp);
    queue.push({
      packet: { ...canonical, state: 'queued' },
      nextHopIp,
      egressIfaceId: egress.id,
      originalIface: egress,
      description
    });
    this.pendingArp[fromNodeId] = queue;
    this.events.push({
      type: 'NOTE',
      ts: this.nowMs,
      nodeId: fromNodeId,
      message: `ARP cache miss for ${nextHopIp} — ${description} held until ARP resolves`
    });
    if (!alreadyPending) {
      this.broadcastArpRequest(fromNodeId, egress, nextHopIp);
      // Unresolved-destination behavior: if nobody answers, the held packet
      // is dropped after a bounded wait (deterministic).
      const parkedPacketId = queue[queue.length - 1]!.packet.id;
      const parkedDescription = description;
      this.scheduler.schedule(this.nowMs + 200, () => {
        const q = this.pendingArp[fromNodeId];
        if (q === undefined) return;
        const stillWaiting = q.some((entry: PendingEntry) => entry.nextHopIp === nextHopIp);
        if (!stillWaiting) return; // resolved in the meantime
        this.pendingArp[fromNodeId] = q.filter((entry: PendingEntry) => entry.nextHopIp !== nextHopIp);
        this.events.push({
          type: 'PACKET_DROPPED',
          ts: this.nowMs,
          nodeId: fromNodeId,
          packetId: parkedPacketId,
          reason: `ARP never resolved ${nextHopIp} — ${parkedDescription} discarded`
        });
        this.markPacketState(parkedPacketId, 'dropped', `ARP never resolved ${nextHopIp}`);
      });
    }
  }

  private broadcastArpRequest(fromNodeId: string, egress: NetworkInterface, targetIp: Ipv4Address): void {
    const arp = buildArpRequest(targetIp, egress.ip as Ipv4Address, egress.mac);
    const frame = buildFrame({
      source: egress.mac,
      destination: ('ff:ff:ff:ff:ff:ff' as MacAddress),
      etherType: 0x0806,
      payload: { kind: 'arp', arp }
    });
    this.events.push({
      type: 'ARP_REQUEST',
      ts: this.nowMs,
      nodeId: fromNodeId,
      packetId: `arp-${fromNodeId}-${targetIp}`,
      senderIp: egress.ip as Ipv4Address,
      targetIp
    });
    const probe: Packet = buildPacket(frame, this.nowMs);
    this.packets.push({ ...probe, state: 'in-flight' });
    this.events.push({
      type: 'PACKET_CREATED',
      ts: this.nowMs,
      packetId: probe.id,
      serial: probe.serial,
      protocol: 'ARP'
    });
    this.events.push({
      type: 'PACKET_SENT',
      ts: this.nowMs,
      nodeId: fromNodeId,
      interfaceId: egress.id,
      packetId: probe.id,
      protocol: 'ARP',
      summary: `who has ${targetIp}?`
    });
    this.sendOnLink(probe, frame, fromNodeId, egress);
  }

  /** Wire ARP_WRITE → pending-queue flush (called from ctx.arpSet). */
  private onArpWrite(nodeId: string, ip: Ipv4Address, learnedMac: MacAddress): void {
    this.flushPending(nodeId, ip, learnedMac);
  }

  /** Flush packets parked for a node once an IP is resolved. */
  private flushPending(nodeId: string, ip: Ipv4Address, learnedMac: MacAddress): void {
    const queue = this.pendingArp[nodeId];
    if (queue === undefined || queue.length === 0) return;
    const remaining: PendingEntry[] = [];
    for (const entry of queue) {
      if (entry.nextHopIp === ip) {
        const frame = buildFrame({
          source: entry.originalIface.mac,
          destination: learnedMac,
          etherType: 0x0800,
          payload: entry.packet.frame.payload
        });
        this.events.push({
          type: 'NOTE',
          ts: this.nowMs,
          nodeId,
          message: `ARP resolved ${ip} → ${learnedMac}; releasing held packet`
        });
        this.events.push({
          type: 'PACKET_SENT',
          ts: this.nowMs,
          nodeId,
          interfaceId: entry.originalIface.id,
          packetId: entry.packet.id,
          protocol: protocolLabel(frame),
          summary: entry.description
        });
        this.sendOnLink(entry.packet, frame, nodeId, entry.originalIface);
      } else {
        remaining.push(entry);
      }
    }
    this.pendingArp[nodeId] = remaining;
  }

  private sendOnLink(packet: Packet, frame: EthernetFrame, fromNodeId: string, fromIface: NetworkInterface): void {
    const link = this.linksByIface.get(fromIface.id);
    if (link === undefined || !link.enabled || !fromIface.enabled) {
      this.events.push({ type: 'PACKET_DROPPED', ts: this.nowMs, nodeId: fromNodeId, packetId: packet.id, reason: 'Egress link down' });
      this.markPacketState(packet.id, 'dropped', 'Egress link down');
      return;
    }
    this.events.push({
      type: 'PACKET_FORWARDED',
      ts: this.nowMs,
      nodeId: fromNodeId,
      packetId: packet.id,
      via: `link ${link.id}`,
      reason: 'frame transmission'
    });
    const targets = this.resolveTargets(fromIface);
    if (targets.length === 0) {
      this.events.push({ type: 'PACKET_DROPPED', ts: this.nowMs, nodeId: fromNodeId, packetId: packet.id, reason: 'Dead end — no cable attached' });
      this.markPacketState(packet.id, 'dropped', 'Dead end — no cable attached');
      return;
    }
    // On-link movement carries the RESOLVED frame — the placeholder frame
    // held by `packet` still shows the parked destination MAC, and hops
    // only record link/timing data, never payload.
    for (const t of targets) {
      const withFrame: Packet = { ...packet, frame };
      const hop: PacketHop = makeHop(link.id, fromIface.id, t.iface.id, this.nowMs, this.nowMs + link.latencyMs);
      const withHop = withHops(withFrame, [...withFrame.hops, hop]);
      this.replacePacket(withHop);
      this.inFlight.push({
        packet: withHop,
        toIface: t.iface,
        toNode: t.node,
        arriveMs: this.nowMs + link.latencyMs
      });
      this.scheduler.schedule(this.nowMs + link.latencyMs, () => this.deliver(t.node, t.iface, withHop));
    }
  }

  private egressToward(nodeId: string, targetIp: Ipv4Address, preferInterfaceId?: string): NetworkInterface | undefined {
    const node = this.nodeById(nodeId);
    if (node === undefined) return undefined;
    // An explicitly requested interface (e.g. the route's) wins when usable.
    if (preferInterfaceId !== undefined) {
      const explicit = node.interfaces.find((i) => i.id === preferInterfaceId && i.enabled);
      if (explicit !== undefined) return explicit;
    }
    // First interface whose subnet (by prefix) contains the target IP.
    return (
      node.interfaces.find(
        (i) => i.enabled && i.ip !== undefined && i.prefix !== undefined && sameNetwork(i.ip, i.prefix, targetIp)
      ) ?? node.interfaces.find((i) => i.enabled)
    );
  }

  private replacePacket(packet: Packet): void {
    const index = this.packets.findIndex((p) => p.id === packet.id);
    if (index >= 0) this.packets[index] = packet;
  }

  private transmitInternal(frame: EthernetFrame, fromNodeId: string, fromInterfaceId: string, logical?: Packet): void {
    const fromIface = this.ifaceById.get(fromInterfaceId);
    if (fromIface === undefined) return;
    const link = this.linksByIface.get(fromInterfaceId);
    if (link === undefined || !link.enabled || !fromIface.enabled) return;

    const isNew = logical === undefined;
    const packet: Packet = isNew
      ? { ...buildPacket(frame, this.nowMs), state: 'in-flight' }
      : logical;
    if (isNew) {
      this.packets.push(packet);
      this.events.push({
        type: 'PACKET_CREATED',
        ts: this.nowMs,
        packetId: packet.id,
        serial: packet.serial,
        protocol: protocolLabel(frame)
      });
      this.events.push({
        type: 'PACKET_SENT',
        ts: this.nowMs,
        nodeId: fromNodeId,
        interfaceId: fromInterfaceId,
        packetId: packet.id,
        protocol: protocolLabel(frame),
        summary: summaryLabel(frame)
      });
    }

    const targets = this.resolveTargets(fromIface);
    for (const t of targets) {
      const hop: PacketHop = makeHop(link.id, fromInterfaceId, t.iface.id, this.nowMs, this.nowMs + link.latencyMs);
      const withHop = withHops(packet, [...packet.hops, hop]);
      this.replacePacket(withHop);
      this.inFlight.push({
        packet: withHop,
        toIface: t.iface,
        toNode: t.node,
        arriveMs: this.nowMs + link.latencyMs
      });
      this.scheduler.schedule(this.nowMs + link.latencyMs, () => this.deliver(t.node, t.iface, withHop));
    }
  }

  private resolveTargets(fromIface: NetworkInterface): Array<{ node: Node; iface: NetworkInterface }> {
    const link = this.linksByIface.get(fromIface.id);
    if (link === undefined) return [];
    const peerIfaceId = link.endpoints[0] === fromIface.id ? link.endpoints[1] : link.endpoints[0];
    const peerIface = this.ifaceById.get(peerIfaceId);
    const peerNode = peerIface !== undefined ? this.nodeById(peerIface.nodeId) : undefined;
    if (peerIface === undefined || peerNode === undefined) return [];

    // Repeater (hub): flood onward to all its other links.
    if (peerNode.kind === 'hub') {
      const out: Array<{ node: Node; iface: NetworkInterface }> = [];
      for (const hubIface of peerNode.interfaces) {
        if (hubIface.id === peerIface.id) continue;
        const hubLink = this.linksByIface.get(hubIface.id);
        if (hubLink === undefined) continue;
        const nextIfaceId = hubLink.endpoints[0] === hubIface.id ? hubLink.endpoints[1] : hubLink.endpoints[0];
        const nextIface = this.ifaceById.get(nextIfaceId);
        const nextNode = nextIface !== undefined ? this.nodeById(nextIface.nodeId) : undefined;
        if (nextIface !== undefined && nextNode !== undefined) {
          out.push({ node: nextNode, iface: nextIface });
        }
      }
      return out;
    }
    return [{ node: peerNode, iface: peerIface }];
  }

  private deliver(node: Node, iface: NetworkInterface, packet: Packet): void {
    // Device state: a powered-off node receives nothing.
    if (!node.enabled) return;
    this.events.push({
      type: 'PACKET_RECEIVED',
      ts: this.nowMs,
      nodeId: node.id,
      interfaceId: iface.id,
      packetId: packet.id,
      protocol: protocolLabel(packet.frame)
    });

    // Learning switch: learn source port, forward or flood. L2 only.
    if (node.kind === 'switch') {
      this.switchForward(node, iface, packet);
      return;
    }

    // The frame reached an endpoint: its journey is complete. Delivery to
    // a switch is relay, not arrival. Handlers may still reject the packet
    // (TTL expired, no UDP/53 listener, …) — a drop supersedes delivery.
    this.markPacketState(packet.id, 'delivered');
    const eventsBeforeHandlers = this.events.length;

    const ctx = this.makeContext();
    ctx.__receiver = { node, iface };
    defaultStack.onFrame(packet, ctx);

    const dropped = this.events
      .slice(eventsBeforeHandlers)
      .find((e): e is Extract<SimulationEvent, { type: 'PACKET_DROPPED' }> => e.type === 'PACKET_DROPPED' && e.packetId === packet.id);
    if (dropped !== undefined) {
      this.markPacketState(packet.id, 'dropped', dropped.reason);
    }
  }

  /**
   * Advances a packet's canonical lifecycle state. Precedence: a drop is
   * final and supersedes delivery (handlers may reject an already-accepted
   * frame); delivery never overwrites a drop, and neither terminal state
   * regresses — later hops of a broadcast copy cannot resurrect a packet.
   */
  private markPacketState(packetId: string, state: Exclude<PacketState, 'queued' | 'in-flight'>, dropReason?: string): void {
    const index = this.packets.findIndex((p) => p.id === packetId);
    if (index < 0) return;
    const current = this.packets[index]!;
    if (current.state === 'dropped' || current.state === 'expired') return;
    if (state === 'delivered' && current.state === 'delivered') return;
    this.packets[index] = { ...current, state, finishedMs: this.nowMs, ...(dropReason !== undefined ? { dropReason } : {}) };
  }

  private switchForward(node: Node, ingress: NetworkInterface, packet: Packet): void {
    const table = this.macTables[node.id] ?? {};
    const learned = table[packet.frame.source] === undefined;
    if (learned) {
      table[packet.frame.source] = ingress.id;
      this.macTables[node.id] = table;
      this.events.push({
        type: 'NOTE',
        ts: this.nowMs,
        nodeId: node.id,
        message: `Learned ${packet.frame.source} is on port ${ingress.label}`
      });
    }
    const known = table[packet.frame.destination];
    // MAC table hits pointing back at the ingress port mean the destination
    // is the sender itself (hub-in-a-loop wiring) — treat as no route out.
    const effective = known === ingress.id ? undefined : known;
    for (const port of node.interfaces) {
      if (port.id === ingress.id || !port.enabled) continue;
      if (effective !== undefined && port.id !== effective) continue;
      this.events.push({
        type: 'PACKET_FORWARDED',
        ts: this.nowMs,
        nodeId: node.id,
        packetId: packet.id,
        via: port.label,
        reason: effective !== undefined ? 'MAC table hit' : 'unknown destination — flooded'
      });
      this.transmitInternal(packet.frame, node.id, port.id, packet);
    }
  }

  private routingTableFor(nodeId: string): RoutingTable {
    const node = this.nodeById(nodeId);
    if (node === undefined) return [];
    const connected: RoutingEntry[] = [];
    for (const iface of node.interfaces) {
      if (iface.ip !== undefined && iface.prefix !== undefined && iface.enabled) {
        connected.push({
          id: `conn-${iface.id}`,
          destination: networkAddress(iface.ip, iface.prefix),
          prefix: iface.prefix,
          interfaceId: iface.id,
          metric: 0,
          origin: 'connected'
        });
      }
    }
    const staticRoutes: RoutingEntry[] = (node.kind === 'router' ? (node.routes ?? []) : []).map((r, i) => ({
      id: `static-${nodeId}-${i}`,
      destination: networkAddress(routeDest(r.destination), r.prefix),
      prefix: r.prefix,
      ...(r.nextHop !== undefined ? { nextHop: r.nextHop } : {}),
      interfaceId: r.interfaceId ?? node.interfaces[0]?.id ?? '',
      metric: r.metric,
      origin: 'static' as const
    }));
    // A configured default gateway IS a default route in the host's table.
    const defaultRoutes: RoutingEntry[] =
      (node.kind === 'host' || node.kind === 'server') && node.gateway !== undefined
        ? [
            {
              id: `default-${nodeId}`,
              destination: networkAddress('0.0.0.0' as Ipv4Address, 0),
              prefix: 0,
              nextHop: node.gateway,
              interfaceId: node.interfaces.find((i) => i.enabled)?.id ?? '',
              metric: 0,
              origin: 'connected' as const
            }
          ]
        : [];
    return [...connected, ...staticRoutes, ...defaultRoutes];
  }

  getState(): NetworkState {
    const tcpConnections = buildTcpConnections(this.tcpOverrides);
    const base = emptyNetworkState(this.topology);
    return {
      ...base,
      simMs: this.nowMs,
      packets: this.packets,
      arpCaches: { ...this.arpCaches },
      macTables: { ...this.macTables },
      dnsCaches: { ...this.dnsCaches },
      routingTables: this.topology.nodes.reduce<Record<string, RoutingTable>>((acc, n) => {
        acc[n.id] = this.routingTableFor(n.id);
        return acc;
      }, {}),
      tcpConnections,
      events: [...this.events]
    };
  }

  private nodeById(id: string): Node | undefined {
    return this.topology.nodes.find((n) => n.id === id);
  }
}

function sameNetwork(a: Ipv4Address, prefix: number, b: Ipv4Address): boolean {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  const bits = (x: number[]) => (((x[0] ?? 0) << 24) | ((x[1] ?? 0) << 16) | ((x[2] ?? 0) << 8) | (x[3] ?? 0)) >>> 0;
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return ((bits(pa) & mask) >>> 0) === ((bits(pb) & mask) >>> 0);
}

interface TcpEndpointState {
  localPort: number;
  remotePort: number;
  state: string;
  role: 'client' | 'server';
  seq?: number;
  ack?: number;
  window?: number;
}

function protocolLabel(frame: EthernetFrame): string {
  switch (frame.payload.kind) {
    case 'arp':
      return 'ARP';
    case 'ip': {
      switch (frame.payload.ip.payload.kind) {
        case 'tcp':
          return 'TCP';
        case 'udp':
          return 'UDP';
        case 'icmp':
          return 'ICMP';
        default:
          return 'IPv4';
      }
    }
  }
}

function summaryLabel(frame: EthernetFrame): string {
  switch (frame.payload.kind) {
    case 'arp':
      return frame.payload.arp.operation;
    case 'ip': {
      const ip = frame.payload.ip;
      return `${ip.source} → ${ip.destination}`;
    }
  }
}

function routeDest(dest: string): Ipv4Address {
  return dest as Ipv4Address;
}

function buildTcpConnections(overrides: Record<string, TcpEndpointState>): TcpConnectionState[] {
  const byConnection = new Map<string, { client: { nodeId: string; state: TcpStateName } | undefined; server: { nodeId: string; state: TcpStateName } | undefined; detail: { clientSeq?: number; clientAck?: number; clientWindow?: number; serverSeq?: number; serverAck?: number; serverWindow?: number; lastFlags?: string } }>();
  for (const [key, value] of Object.entries(overrides)) {
    const [nodeId, connectionId] = key.split('|');
    if (nodeId === undefined || connectionId === undefined) continue;
    const state = value.state as TcpStateName;
    const side = { nodeId, state };
    const entry = byConnection.get(connectionId) ?? { client: undefined, server: undefined, detail: {} };
    if (value.role === 'client') {
      entry.client = side;
      if (value.seq !== undefined) entry.detail.clientSeq = value.seq;
      if (value.ack !== undefined) entry.detail.clientAck = value.ack;
      if (value.window !== undefined) entry.detail.clientWindow = value.window;
    } else {
      entry.server = side;
      if (value.seq !== undefined) entry.detail.serverSeq = value.seq;
      if (value.ack !== undefined) entry.detail.serverAck = value.ack;
      if (value.window !== undefined) entry.detail.serverWindow = value.window;
    }
    byConnection.set(connectionId, entry);
  }
  return [...byConnection.entries()].map(([id, e]) => ({
    id,
    client: e.client ?? { nodeId: '', state: 'CLOSED' as TcpStateName },
    server: e.server ?? { nodeId: '', state: 'LISTEN' as TcpStateName },
    ...e.detail
  }));
}

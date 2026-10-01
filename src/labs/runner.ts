/**
 * Lab runner: the ONLY code that turns LabScriptEntry values into engine
 * activity. Both the interactive simulator and the lab browser go through
 * this, so labs and free-form simulation share identical semantics.
 *
 * Senders are ARP-gated: an IP packet leaves via ctx.transmitResolved,
 * which resolves the next-hop MAC from the node's cache or parks the
 * packet and broadcasts an ARP request. This makes the ARP lab's
 * "request → reply → cache → real traffic" sequence genuine.
 */

import type { LabDefinition, LabScriptEntry } from './types';
import type { DnsRecordType } from '../models/dns';
import type { TcpEndpointRef } from '../simulation/tcp';
import { tcpActiveOpen, tcpSendData, tcpSendFin, tcpSendRst, tcpSendHttpRequest } from '../simulation/tcp';
import type { NetworkEngine, SimulationContextLike } from '../engine/network-engine';
import {
  buildArpRequest,
  buildFrame,
  buildHttpRequest,
  buildIpPacket,
  buildUdpDatagram,
  buildDnsQuery
} from '../simulation/builder';
import { ipv4 } from '../models/ipv4';
import { mac as toMac } from '../models/mac';
import type { Topology, NetworkInterface } from '../models/topology';

export interface LabRunResult {
  readonly simMs: number;
  readonly packetCount: number;
  readonly eventCount: number;
}

export function runLab(engine: NetworkEngine, lab: LabDefinition): LabRunResult {
  engine.reindex();
  const state = engine.run(labSeed(engine, lab));
  return { simMs: state.simMs, packetCount: state.packets.length, eventCount: state.events.length };
}

/**
 * Seed that installs a lab's script into the scheduler without running it.
 * Used by Step mode: the engine executes exactly one scheduled item per
 * step, and re-seeds when the schedule runs dry.
 */
export function labSeed(engine: NetworkEngine, lab: LabDefinition): (ctx: SimulationContextLike) => void {
  const topology = engine.topologyRef;
  return (ctx) => {
    for (const entry of lab.script) {
      scheduleEntry(ctx, topology, entry);
    }
  };
}

function scheduleEntry(ctx: SimulationContextLike, topology: Topology, entry: LabScriptEntry): void {
  switch (entry.action) {
    case 'note':
      ctx.after(entry.atMs, (c) => {
        c.emit({ type: 'NOTE', ts: c.now(), nodeId: entry.nodeId, message: entry.message });
      });
      break;
    case 'send-arp':
      ctx.after(entry.atMs, (c) => sendArp(c, topology, entry.from, entry.targetIp));
      break;
    case 'send-dns':
      ctx.after(entry.atMs, (c) => sendDns(c, topology, entry.from, entry.name, entry.recordType));
      break;
    case 'send-ping':
      ctx.after(entry.atMs, (c) => sendPing(c, topology, entry.from, entry.toIp, entry.ttl));
      break;
    case 'send-http':
      ctx.after(entry.atMs, (c) => sendHttp(c, topology, entry));
      break;
    case 'tcp-open':
      ctx.after(entry.atMs, (c) => tcpAction(c, topology, entry.from, entry.serverId, entry.localPort ?? 49152, entry.serverPort ?? 80, (cc, local, isServer) => tcpActiveOpen(cc, nodeOf(topology, entry.from), local, isServer)));
      break;
    case 'tcp-send':
      ctx.after(entry.atMs, (c) => tcpAction(c, topology, entry.from, entry.serverId, 49152, 80, (cc, local, isServer) => tcpSendData(cc, nodeOf(topology, entry.from), local, entry.text, entry.byteOffset ?? 0, isServer)));
      break;
    case 'tcp-close':
      ctx.after(entry.atMs, (c) => tcpAction(c, topology, entry.from, entry.serverId, 49152, 80, (cc, local, isServer) => tcpSendFin(cc, nodeOf(topology, entry.from), local, isServer)));
      break;
    case 'tcp-reset':
      ctx.after(entry.atMs, (c) => tcpAction(c, topology, entry.from, entry.serverId, 49152, 80, (cc, local) => tcpSendRst(cc, nodeOf(topology, entry.from), local, false)));
      break;
  }
}

function firstIface(topology: Topology, nodeId: string): NetworkInterface | undefined {
  return topology.nodes.find((n) => n.id === nodeId)?.interfaces[0];
}

function nodeOf(topology: Topology, nodeId: string): import('../models/topology').Node {
  const node = topology.nodes.find((n) => n.id === nodeId);
  if (node === undefined) throw new Error(`Unknown node ${nodeId}`);
  return node;
}

/** Resolves the endpoint pair for a TCP script action and runs it.
 * The TCP-server side (port 80) is whichever node is kind 'server'; the
 * actor gets its own side as the local ref. */
function tcpAction(
  ctx: SimulationContextLike,
  topology: Topology,
  fromId: string,
  peerId: string,
  localPort: number,
  serverPort: number,
  action: (ctx: SimulationContextLike, local: TcpEndpointRef, localIsServer: boolean) => void
): void {
  const fromIface = firstIface(topology, fromId);
  const peerIface = firstIface(topology, peerId);
  if (fromIface?.ip === undefined || peerIface?.ip === undefined) return;
  const fromIsServer = nodeOf(topology, fromId).kind === 'server';
  const clientIp = fromIsServer ? peerIface.ip : fromIface.ip;
  const clientPort = fromIsServer ? 49152 : localPort;
  const serverIp = fromIsServer ? fromIface.ip : peerIface.ip;
  const serverPortResolved = fromIsServer ? serverPort : 80;
  const local: TcpEndpointRef = fromIsServer
    ? { localIp: serverIp, localPort: serverPortResolved, remoteIp: clientIp, remotePort: clientPort }
    : { localIp: clientIp, localPort: clientPort, remoteIp: serverIp, remotePort: serverPortResolved };
  action(ctx, local, fromIsServer);
}



/** Broadcast-only ARP probe (used by the standalone Ethernet lab). */
function sendArp(ctx: SimulationContextLike, topology: Topology, fromId: string, targetIp: string): void {
  const iface = firstIface(topology, fromId);
  if (iface === undefined || iface.ip === undefined) return;
  ctx.emit({ type: 'NOTE', ts: ctx.now(), nodeId: fromId, message: `ARP cache miss — sending request for ${targetIp}` });
  const arp = buildArpRequest(ipv4(targetIp), iface.ip, iface.mac);
  ctx.transmit(
    buildFrame({ source: iface.mac, destination: toMac('ff:ff:ff:ff:ff:ff'), etherType: 0x0806, payload: { kind: 'arp', arp } }),
    fromId,
    iface.id
  );
}

/** Resolve the server-kind node sharing the client's subnet. */
function resolverIpFor(topology: Topology, fromId: string): ReturnType<typeof ipv4> | undefined {
  const client = firstIface(topology, fromId);
  if (client === undefined || client.ip === undefined || client.prefix === undefined) return undefined;
  for (const node of topology.nodes) {
    if (node.kind !== 'server') continue;
    const iface = node.interfaces[0];
    if (iface?.ip === undefined || iface.prefix === undefined) continue;
    if (networkOf(iface.ip, iface.prefix) === networkOf(client.ip, client.prefix)) {
      return iface.ip;
    }
  }
  return undefined;
}

/** Next-hop IP for a destination: gateway if remote, the destination itself if on-link. */
function nextHopFor(topology: Topology, fromId: string, destination: string): string {
  const node = topology.nodes.find((n) => n.id === fromId);
  const client = firstIface(topology, fromId);
  if (node === undefined || client === undefined || client.ip === undefined || client.prefix === undefined) {
    return destination;
  }
  const onLink = networkOf(destination, client.prefix) === networkOf(client.ip, client.prefix);
  if (onLink) return destination;
  if (node.kind === 'host' || node.kind === 'server') {
    return node.gateway ?? destination;
  }
  return destination;
}

/** The host-side route decision, recorded as a ROUTE_LOOKUP event like a router's. */
function emitHostRouteLookup(
  ctx: SimulationContextLike,
  topology: Topology,
  fromId: string,
  iface: NetworkInterface,
  destination: string,
  packetId: string
): void {
  const client = iface;
  if (client.ip === undefined || client.prefix === undefined) return;
  const onLink = networkOf(destination, client.prefix) === networkOf(client.ip, client.prefix);
  const prefix = onLink ? client.prefix : 0;
  const routeNet = onLink ? networkOf(destination, client.prefix).split('/')[0] ?? destination : '0.0.0.0';
  const nextHop = nextHopFor(topology, fromId, destination);
  ctx.emit({
    type: 'ROUTE_LOOKUP',
    ts: ctx.now(),
    nodeId: fromId,
    packetId,
    destination,
    matched: `${routeNet}/${prefix}`,
    via: nextHop,
    prefixLength: prefix,
    interfaceId: client.id,
    nextHops: [nextHop],
    allMatches: [
      {
        destination: routeNet,
        prefix,
        origin: 'connected',
        interfaceId: client.id,
        ...(onLink ? {} : { nextHop })
      }
    ]
  });
}

function sendDns(
  ctx: SimulationContextLike,
  topology: Topology,
  fromId: string,
  name: string,
  recordType: DnsRecordType = 'A'
): void {
  const iface = firstIface(topology, fromId);
  if (iface === undefined || iface.ip === undefined) return;

  // Client-side cache: a fresh answer means the query never touches the wire.
  const cached = ctx.dnsGet(fromId, name, recordType);
  const expired = cached?.expired === true;
  ctx.emit({
    type: 'DNS_CACHE_LOOKUP',
    ts: ctx.now(),
    nodeId: fromId,
    name,
    recordType,
    hit: cached !== undefined,
    expired,
    ...(cached !== undefined ? { value: cached.record.value } : {})
  });
  if (cached !== undefined && !expired) {
    const remaining = Math.max(1, cached.record.ttl - (ctx.now() - cached.writtenAtMs));
    ctx.emit({ type: 'NOTE', ts: ctx.now(), nodeId: fromId, message: `${name} = ${cached.record.value} (cache, ${remaining} ms left) — no query sent` });
    return;
  }

  const resolverIp = resolverIpFor(topology, fromId);
  if (resolverIp === undefined) return;
  const datagram = buildUdpDatagram(40000, 53, buildDnsQuery(0x1234, name, recordType));
  const ip = buildIpPacket({
    source: iface.ip,
    destination: resolverIp,
    ttl: 32,
    protocol: 'udp',
    payload: datagram
  });
  ctx.emit({ type: 'NOTE', ts: ctx.now(), nodeId: fromId, message: `Resolving ${name}/${recordType} via DNS` });
  const packetId = `dns-${fromId}-${name}-${ctx.now()}`;
  emitHostRouteLookup(ctx, topology, fromId, iface, resolverIp as string, packetId);
  ctx.transmitResolved(
    {
      id: packetId,
      serial: 0,
      frame: buildFrame({
        source: iface.mac,
        destination: iface.mac,
        etherType: 0x0800,
        payload: { kind: 'ip', ip }
      }),
      hops: [],
      state: 'queued',
      bornMs: ctx.now()
    },
    fromId,
    ipv4(nextHopFor(topology, fromId, resolverIp)),
    `DNS query for ${name}`
  );
}

function sendPing(ctx: SimulationContextLike, topology: Topology, fromId: string, toIp: string, ttl: number): void {
  const iface = firstIface(topology, fromId);
  if (iface === undefined || iface.ip === undefined) return;
  const ip = buildIpPacket({
    source: iface.ip,
    destination: ipv4(toIp),
    ttl,
    protocol: 'icmp',
    payload: { kind: 'icmp', type: 'echo-request' }
  });
  const packetId = `ping-${fromId}-${toIp}-${ctx.now()}`;
  emitHostRouteLookup(ctx, topology, fromId, iface, toIp, packetId);
  ctx.transmitResolved(
    {
      id: packetId,
      serial: 0,
      frame: buildFrame({
        source: iface.mac,
        destination: iface.mac,
        etherType: 0x0800,
        payload: { kind: 'ip', ip }
      }),
      hops: [],
      state: 'queued',
      bornMs: ctx.now()
    },
    fromId,
    ipv4(nextHopFor(topology, fromId, toIp)),
    `echo request to ${toIp}`
  );
}

function sendHttp(
  ctx: SimulationContextLike,
  topology: Topology,
  entry: Extract<LabScriptEntry, { action: 'send-http' }>
): void {
  const fromIface = firstIface(topology, entry.from);
  const serverIface = firstIface(topology, 'web-server');
  if (fromIface?.ip === undefined || serverIface?.ip === undefined) return;
  const local: TcpEndpointRef = {
    localIp: fromIface.ip,
    localPort: 49152,
    remoteIp: serverIface.ip,
    remotePort: 80
  };
  const clientNode = nodeOf(topology, entry.from);
  const request = buildHttpRequest('GET', entry.path, entry.serverName) as import('../models/http').HttpRequest;

  const openAndFetch = (c: SimulationContextLike): void => {
    // The client's routing decision: on-link or default gateway? Recorded
    // before the SYN so the Routing stage of the journey precedes it.
    const webIface = firstIface(topology, entry.from);
    if (webIface !== undefined) {
      emitHostRouteLookup(c, topology, entry.from, webIface, serverIface.ip as string, `route-${entry.from}-${entry.serverName}-${c.now()}`);
    }
    // TCP handshake via the real state machine (SYN, SYN+ACK, ACK).
    tcpActiveOpen(c, clientNode, local, false);
    // HTTP GET rides the established connection; the server answers 200 OK.
    c.after(60, (cc) => tcpSendHttpRequest(cc, clientNode, local, request));
    // After the response settles, terminate: the full lifecycle in one chain.
    c.after(200, (cc) => tcpSendFin(cc, clientNode, local, false));
  };

  // Optional DNS first (the complete resolution → connection → fetch chain).
  // The 80 ms beat is deterministic and past the full DNS round trip.
  if (entry.resolveFirst) {
    sendDns(ctx, topology, entry.from, entry.serverName, 'A');
    ctx.after(80, openAndFetch);
  } else {
    openAndFetch(ctx);
  }
}

function networkOf(ip: string, prefix: number): string {
  const parts = ip.split('.').map(Number);
  const value = ((parts[0]! << 24) | (parts[1]! << 16) | (parts[2]! << 8) | parts[3]!) >>> 0;
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  const masked = (value & mask) >>> 0;
  return `${(masked >>> 24) & 0xff}.${(masked >>> 16) & 0xff}.${(masked >>> 8) & 0xff}.${masked & 0xff}/${prefix}`;
}

export type { LabDefinition } from './types';

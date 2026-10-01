/**
 * TCP protocol implementation — a faithful, deterministic teaching state
 * machine (RFC 793 shape, one connection per endpoint pair).
 *
 * Client: CLOSED → SYN_SENT → ESTABLISHED → FIN_WAIT_1 → FIN_WAIT_2 →
 *         TIME_WAIT → (2·MSL timer) → CLOSED   (or CLOSING on simult. close)
 * Server: LISTEN → SYN_RCVD → ESTABLISHED → CLOSE_WAIT → LAST_ACK → CLOSED
 *
 * Transitions are GUARDED by the current state (ctx.tcpGet), so duplicate
 * or out-of-order segments cannot corrupt the machine. Every transition
 * emits TCP_STATE_CHANGE with role, seq, ack, window and the wire flags.
 * Sequence numbers are deterministic (isnFor); TIME-WAIT is a real
 * scheduled 2·MSL timer. No React, no sockets — pure protocol logic.
 */

import type { Packet } from '../models/packet';
import type { Node, NetworkInterface } from '../models/topology';
import type { HandlerContext } from './stack';
import type { TcpSegment, TcpStateName } from '../models/tcp';
import type { IpPacket } from '../models/ip';
import type { HttpRequest } from '../models/http';
import { buildFrame, buildTcpSegment, buildHttpResponse } from './builder';

type Role = 'client' | 'server';

export interface TcpEndpointRef {
  readonly localIp: string;
  readonly localPort: number;
  readonly remoteIp: string;
  readonly remotePort: number;
}

/** Deterministic initial sequence number per connection pair and side. */
export function isnFor(localIp: string, localPort: number, remoteIp: string, remotePort: number, isServer: boolean): number {
  const toInt = (ip: string) => {
    const p = ip.split('.').map(Number);
    return (((p[0] ?? 0) << 24) | ((p[1] ?? 0) << 16) | ((p[2] ?? 0) << 8) | (p[3] ?? 0)) >>> 0;
  };
  const raw = (toInt(localIp) ^ (localPort << 16) ^ toInt(remoteIp) ^ ((remotePort << 8) >>> 0) ^ (isServer ? 0x5a5a5a : 0xa5a5a5)) >>> 0;
  return (raw % 100000) + 1;
}

/** The connection id both roles agree on (client-side-first form). */
export function tcpConnectionId(ip: IpPacket, segment: TcpSegment): string {
  const serverSends = segment.sourcePort === 80;
  const clientIp = serverSends ? ip.destination : ip.source;
  const clientPort = serverSends ? segment.destinationPort : segment.sourcePort;
  const serverIp = serverSends ? ip.source : ip.destination;
  const serverPort = serverSends ? segment.sourcePort : segment.destinationPort;
  return `${clientIp}:${clientPort}-${serverIp}:${serverPort}`;
}

/** Connection id for a locally-initiated segment (runner / active open). */
export function tcpConnectionIdFor(local: TcpEndpointRef, localIsServer: boolean): string {
  return localIsServer
    ? `${local.remoteIp}:${local.remotePort}-${local.localIp}:${local.localPort}`
    : `${local.localIp}:${local.localPort}-${local.remoteIp}:${local.remotePort}`;
}

export function tcpInbound(packet: Packet, ctx: HandlerContext, node: Node, segment: TcpSegment): void {
  const ip = inboundIp(packet);
  if (ip === undefined) return;
  const role: Role = node.kind === 'server' ? 'server' : 'client';
  const connId = tcpConnectionId(ip, segment);
  const flagsLabel = flagsToLabel(segment);
  const state = ctx.tcpGet(node.id, connId)?.state;

  // RST aborts immediately, in any state, for both roles.
  if (segment.flags.rst) {
    if (state !== undefined && state !== 'CLOSED') {
      transition(ctx, node, connId, role, state, 'CLOSED', `RST received (${flagsLabel})`, segment, {});
    }
    return;
  }

  // SYN (no ACK): open request — we must be the server.
  if (segment.flags.syn && !segment.flags.ack) {
    if (role !== 'server') return;
    if (state !== undefined && state !== 'LISTEN' && state !== 'SYN_RCVD') return; // duplicate SYN
    const isn = isnFor(ip.destination, segment.destinationPort, ip.source, segment.sourcePort, true);
    transition(ctx, node, connId, role, 'LISTEN', 'SYN_RCVD', 'SYN received', segment, { seq: isn, ack: segment.sequence + 1 });
    replyTcp(ip, segment, buildTcpSegment({
      sourcePort: segment.destinationPort,
      destinationPort: segment.sourcePort,
      sequence: isn,
      acknowledgment: segment.sequence + 1,
      flags: { syn: true, ack: true },
      window: 65535
    }), ctx, node, role);
    return;
  }

  // SYN+ACK: the client completes its half of the handshake.
  if (segment.flags.syn && segment.flags.ack) {
    if (role !== 'client' || state !== 'SYN_SENT') return;
    transition(ctx, node, connId, role, 'SYN_SENT', 'ESTABLISHED', 'SYN+ACK received', segment, { ack: segment.sequence + 1 });
    replyTcp(ip, segment, buildTcpSegment({
      sourcePort: segment.destinationPort,
      destinationPort: segment.sourcePort,
      sequence: segment.acknowledgment,
      acknowledgment: segment.sequence + 1,
      flags: { ack: true },
      window: 65535
    }), ctx, node, role);
    return;
  }

  // Bare ACK (no payload, no FIN).
  if (segment.flags.ack && !segment.flags.fin && segment.payload === undefined) {
    if (role === 'server' && state === 'SYN_RCVD') {
      transition(ctx, node, connId, role, 'SYN_RCVD', 'ESTABLISHED', 'final ACK received', segment, { ack: segment.sequence + 1 });
      return;
    }
    if (role === 'client' && state === 'FIN_WAIT_1') {
      transition(ctx, node, connId, role, 'FIN_WAIT_1', 'FIN_WAIT_2', `ACK of our FIN (${flagsLabel})`, segment, { ack: segment.sequence + 1 });
      return;
    }
    if (role === 'server' && state === 'LAST_ACK') {
      transition(ctx, node, connId, role, 'LAST_ACK', 'CLOSED', `ACK of our FIN (${flagsLabel})`, segment, {});
      return;
    }
    return;
  }

  // Application data: HTTP request (client → server).
  if (segment.payload !== undefined && segment.payload.kind === 'request') {
    if (role === 'server' && state === 'ESTABLISHED') {
      const request: HttpRequest = segment.payload;
      ctx.emit({
        type: 'HTTP_REQUEST', ts: ctx.now(), nodeId: node.id, packetId: packet.id,
        method: request.method, path: request.path, host: request.headers['Host'] ?? ''
      });
      const response = buildHttpResponse(200, 'OK', '<html><body>Hello from NPVL</body></html>', 'text/html');
      const seg = buildTcpSegment({
        sourcePort: segment.destinationPort,
        destinationPort: segment.sourcePort,
        sequence: segment.acknowledgment,
        acknowledgment: segment.sequence + byteLen(segment),
        flags: { ack: true, psh: true },
        window: 65535,
        payload: response
      });
      transition(ctx, node, connId, role, 'ESTABLISHED', 'ESTABLISHED', 'request served, response sent', seg, { seq: seg.sequence, ack: seg.acknowledgment });
      replyTcp(ip, segment, seg, ctx, node, role);
      ctx.emit({ type: 'HTTP_RESPONSE', ts: ctx.now(), nodeId: node.id, packetId: packet.id, status: 200, reason: 'OK', contentType: 'text/html' });
    }
    return;
  }

  // Application data: HTTP response (server → client).
  if (segment.payload !== undefined && segment.payload.kind === 'response') {
    if (role === 'client' && state === 'ESTABLISHED') {
      const nextAck = segment.sequence + byteLen(segment);
      transition(ctx, node, connId, role, 'ESTABLISHED', 'ESTABLISHED', `data received (${flagsLabel})`, segment, { ack: nextAck });
      replyTcp(ip, segment, buildTcpSegment({
        sourcePort: segment.destinationPort,
        destinationPort: segment.sourcePort,
        sequence: segment.acknowledgment,
        acknowledgment: nextAck,
        flags: { ack: true },
        window: 65535
      }), ctx, node, role);
      ctx.emit({
        type: 'NOTE', ts: ctx.now(), nodeId: node.id,
        message: `${node.name}: HTTP ${segment.payload.status} ${segment.payload.reason} received and acknowledged`
      });
    }
    return;
  }

  // Opaque application data (TCP data-transfer / acknowledgement labs).
  if (segment.payload !== undefined && segment.payload.kind === 'data') {
    if (state === 'ESTABLISHED') {
      const nextAck = segment.sequence + byteLen(segment);
      transition(ctx, node, connId, role, 'ESTABLISHED', 'ESTABLISHED', `data received: "${segment.payload.text}"`, segment, { ack: nextAck });
      replyTcp(ip, segment, buildTcpSegment({
        sourcePort: segment.destinationPort,
        destinationPort: segment.sourcePort,
        sequence: ctx.tcpGet(node.id, connId)?.seq ?? segment.acknowledgment,
        acknowledgment: nextAck,
        flags: { ack: true },
        window: 65535
      }), ctx, node, role);
      ctx.emit({
        type: 'NOTE', ts: ctx.now(), nodeId: node.id,
        message: `${node.name}: received ${byteLen(segment)} byte(s): "${segment.payload.text}"`
      });
    }
    return;
  }

  // FIN (with or without ACK): teardown.
  if (segment.flags.fin) {
    handleInboundFin(ctx, node, connId, role, state, segment, ip, flagsLabel);
  }
}

/* ------------------------------------------------------------------ */
/* Teardown                                                            */
/* ------------------------------------------------------------------ */

function handleInboundFin(
  ctx: HandlerContext,
  node: Node,
  connId: string,
  role: Role,
  state: TcpStateName | undefined,
  segment: TcpSegment,
  ip: IpPacket,
  flagsLabel: string
): void {
  const ackFin = (seq: number): void =>
    replyTcp(ip, segment, buildTcpSegment({
      sourcePort: segment.destinationPort,
      destinationPort: segment.sourcePort,
      sequence: seq,
      acknowledgment: segment.sequence + 1,
      flags: { ack: true },
      window: 65535
    }), ctx, node, role);

  if (role === 'server') {
    if (state === 'ESTABLISHED') {
      transition(ctx, node, connId, role, 'ESTABLISHED', 'CLOSE_WAIT', `FIN received (${flagsLabel})`, segment, { ack: segment.sequence + 1 });
      ackFin(segment.acknowledgment);
      // The server application closes after a bounded, deterministic beat:
      // CLOSE_WAIT → LAST_ACK, its own FIN on the wire.
      const serverLocal: TcpEndpointRef = {
        localIp: ip.destination,
        localPort: segment.destinationPort,
        remoteIp: ip.source,
        remotePort: segment.sourcePort
      };
      ctx.after(10, (laterCtx) => tcpSendFin(laterCtx, node, serverLocal, true));
    }
    return;
  }

  switch (state) {
    case 'ESTABLISHED': {
      // Simultaneous close: we were open, peer closes at the same moment.
      transition(ctx, node, connId, role, 'ESTABLISHED', 'FIN_WAIT_1', `simultaneous FIN received (${flagsLabel})`, segment, { ack: segment.sequence + 1 });
      ackFin(segment.acknowledgment);
      return;
    }
    case 'FIN_WAIT_1': {
      if (segment.flags.ack) {
        // Our FIN acknowledged AND peer's FIN seen: cross directly to TIME-WAIT.
        transition(ctx, node, connId, role, 'FIN_WAIT_1', 'TIME_WAIT', `FIN+ACK received (${flagsLabel})`, segment, { ack: segment.sequence + 1 });
        ackFin(segment.acknowledgment);
        scheduleTimeWait(ctx, node, connId, role);
      } else {
        transition(ctx, node, connId, role, 'FIN_WAIT_1', 'CLOSING', `simultaneous FIN received (${flagsLabel})`, segment, { ack: segment.sequence + 1 });
        ackFin(segment.acknowledgment);
      }
      return;
    }
    case 'FIN_WAIT_2': {
      transition(ctx, node, connId, role, 'FIN_WAIT_2', 'TIME_WAIT', `peer FIN received (${flagsLabel})`, segment, { ack: segment.sequence + 1 });
      ackFin(segment.acknowledgment);
      scheduleTimeWait(ctx, node, connId, role);
      return;
    }
    case 'CLOSING': {
      transition(ctx, node, connId, role, 'CLOSING', 'TIME_WAIT', 'final ACK in simultaneous close', segment, { ack: segment.sequence + 1 });
      ackFin(segment.acknowledgment);
      scheduleTimeWait(ctx, node, connId, role);
      return;
    }
    default:
      return;
  }
}

/**
 * Active open (called by the runner for a 'tcp-open' script action):
 * CLOSED → SYN_SENT locally, then the SYN goes on the wire.
 */
export function tcpActiveOpen(ctx: HandlerContext, node: Node, local: TcpEndpointRef, localIsServer: boolean): void {
  const role: Role = localIsServer ? 'server' : 'client';
  const connId = tcpConnectionIdFor(local, localIsServer);
  // Guard: only a CLOSED endpoint can open (duplicate SYN is swallowed).
  const current = ctx.tcpGet(node.id, connId)?.state;
  if (current !== undefined && current !== 'CLOSED') return;
  const isn = isnFor(local.localIp, local.localPort, local.remoteIp, local.remotePort, localIsServer);
  transition(ctx, node, connId, role, 'CLOSED', 'SYN_SENT', 'active open — SYN sent', undefined, { seq: isn });
  sendSegmentFrom(node, local, buildTcpSegment({
    sourcePort: local.localPort,
    destinationPort: local.remotePort,
    sequence: isn,
    acknowledgment: 0,
    flags: { syn: true },
    window: 65535
  }), `SYN from ${node.name} (CLOSED → SYN_SENT)`, ctx);
}

/**
 * HTTP request send over an ESTABLISHED connection (HTTP lab): guarded,
 * advances sequence bookkeeping, and the request rides the wire.
 */
export function tcpSendHttpRequest(ctx: HandlerContext, node: Node, local: TcpEndpointRef, request: import('../models/http').HttpRequest): void {
  const connId = tcpConnectionIdFor(local, false);
  const current = ctx.tcpGet(node.id, connId);
  if ((current?.state ?? 'CLOSED') !== 'ESTABLISHED') return;
  const seq = current?.seq ?? 0;
  const ack = current?.ack ?? 1;
  transition(ctx, node, connId, 'client', 'ESTABLISHED', 'ESTABLISHED', `HTTP ${request.method} ${request.path} sent`, undefined, { seq, ack });
  sendSegmentFrom(node, local, buildTcpSegment({
    sourcePort: local.localPort,
    destinationPort: local.remotePort,
    sequence: seq,
    acknowledgment: ack,
    flags: { ack: true, psh: true },
    window: 65535,
    payload: request
  }), `HTTP ${request.method} ${request.path} from ${node.name}`, ctx);
}

/**
 * RST abort (called by the runner for a 'tcp-reset' script action): any
 * active state → CLOSED and a reset segment hits the wire.
 */
export function tcpSendRst(ctx: HandlerContext, node: Node, local: TcpEndpointRef, localIsServer: boolean): void {
  const role: Role = localIsServer ? 'server' : 'client';
  const connId = tcpConnectionIdFor(local, localIsServer);
  const current = ctx.tcpGet(node.id, connId);
  const from: TcpStateName = current?.state ?? 'CLOSED';
  const seq = current?.seq ?? 0;
  if (from !== 'CLOSED') {
    transition(ctx, node, connId, role, from, 'CLOSED', 'RST sent — connection aborted', undefined, { seq });
  }
  sendSegmentFrom(node, local, buildTcpSegment({
    sourcePort: local.localPort,
    destinationPort: local.remotePort,
    sequence: seq,
    acknowledgment: 0,
    flags: { rst: true, ack: true },
    window: 0
  }), `RST from ${node.name} (abort)`, ctx);
}

/**
 * Data send (called by the runner for a 'tcp-send' script action):
 * ESTABLISHED stays ESTABLISHED but the sequence bookkeeping advances.
 */
export function tcpSendData(ctx: HandlerContext, node: Node, local: TcpEndpointRef, text: string, byteOffset: number, localIsServer: boolean): void {
  const role: Role = localIsServer ? 'server' : 'client';
  const connId = tcpConnectionIdFor(local, localIsServer);
  const current = ctx.tcpGet(node.id, connId);
  // Guard: data flows only on ESTABLISHED connections.
  if ((current?.state ?? 'CLOSED') !== 'ESTABLISHED') return;
  const seq = (current?.seq ?? isnFor(local.localIp, local.localPort, local.remoteIp, local.remotePort, localIsServer)) + byteOffset;
  const ack = current?.ack ?? 1;
  transition(ctx, node, connId, role, 'ESTABLISHED', 'ESTABLISHED', `data sent: "${text}"`, undefined, { seq, ack });
  sendSegmentFrom(node, local, buildTcpSegment({
    sourcePort: local.localPort,
    destinationPort: local.remotePort,
    sequence: seq,
    acknowledgment: ack,
    flags: { ack: true, psh: true },
    window: 65535,
    payload: { kind: 'data', text }
  }), `data "${text}" from ${node.name}`, ctx);
}

/**
 * Active close from either endpoint (called by the runner when a script
 * says "close this connection"): ESTABLISHED→FIN_WAIT_1 (client) or
 * CLOSE_WAIT→LAST_ACK (server), and the FIN goes on the wire.
 */
export function tcpSendFin(ctx: HandlerContext, node: Node, local: TcpEndpointRef, localIsServer: boolean): void {
  const role: Role = localIsServer ? 'server' : 'client';
  const connId = tcpConnectionIdFor(local, localIsServer);
  const current = ctx.tcpGet(node.id, connId);
  const state = current?.state;
  // Guard: close only makes sense from ESTABLISHED (active) or
  // CLOSE_WAIT (the passive side finishing up).
  if (state !== 'ESTABLISHED' && state !== 'CLOSE_WAIT') return;
  const from: TcpStateName = state;
  const to: TcpStateName = localIsServer ? 'LAST_ACK' : 'FIN_WAIT_1';
  const seq = current?.seq ?? isnFor(local.localIp, local.localPort, local.remoteIp, local.remotePort, localIsServer);
  const ack = current?.ack ?? 1;

  transition(ctx, node, connId, role, from, to, localIsServer ? 'local close — FIN sent' : 'active close — FIN sent', undefined, { seq, ack });
  sendSegmentFrom(node, local, buildTcpSegment({
    sourcePort: local.localPort,
    destinationPort: local.remotePort,
    sequence: seq,
    acknowledgment: ack,
    flags: { fin: true, ack: true },
    window: 65535
  }), `FIN from ${node.name} (${from} → ${to})`, ctx);
}

/** Schedules the deterministic 2·MSL TIME-WAIT → CLOSED transition. */
function scheduleTimeWait(ctx: HandlerContext, node: Node, connId: string, _role: Role): void {
  ctx.after(30, (laterCtx) => {
    if (laterCtx.tcpGet(node.id, connId)?.state === 'TIME_WAIT') {
      laterCtx.emit({
        type: 'TCP_STATE_CHANGE', ts: laterCtx.now(), nodeId: node.id,
        connectionId: connId, from: 'TIME_WAIT', to: 'CLOSED',
        trigger: '2·MSL timer expired', role: _role
      });
      laterCtx.setTcpState(node.id, connId, { localPort: 0, remotePort: 0, state: 'CLOSED', role: _role });
    }
  });
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function transition(
  ctx: HandlerContext,
  node: Node,
  connId: string,
  role: Role,
  from: TcpStateName,
  to: TcpStateName,
  trigger: string,
  segment: TcpSegment | undefined,
  detail: { seq?: number; ack?: number }
): void {
  const ports = segment !== undefined
    ? (role === 'server'
        ? { localPort: segment.destinationPort, remotePort: segment.sourcePort }
        : { localPort: segment.sourcePort, remotePort: segment.destinationPort })
    : { localPort: 0, remotePort: 0 };
  ctx.setTcpState(node.id, connId, {
    ...ports,
    state: to,
    role,
    ...(detail.seq !== undefined ? { seq: detail.seq } : {}),
    ...(detail.ack !== undefined ? { ack: detail.ack } : {}),
    window: segment?.window ?? 65535
  });
  ctx.emit({
    type: 'TCP_STATE_CHANGE',
    ts: ctx.now(),
    nodeId: node.id,
    connectionId: connId,
    from,
    to,
    trigger,
    role,
    ...(detail.seq !== undefined ? { seq: detail.seq } : {}),
    ...(detail.ack !== undefined ? { ack: detail.ack } : {}),
    ...(segment !== undefined ? { window: segment.window, flags: flagsToLabel(segment) } : {})
  });
}

/** Transmit a segment the LOCAL node originated (no inbound packet to mirror). */
function sendSegmentFrom(node: Node, local: TcpEndpointRef, segment: TcpSegment, description: string, ctx: HandlerContext): void {
  const iface = egressIface(node, local.remoteIp);
  if (iface.ip === undefined) return;
  const onLink = iface.prefix !== undefined && sameSubnet(iface.ip, local.remoteIp, iface.prefix);
  const gateway = (node as { gateway?: string }).gateway;
  const nextHop = onLink || gateway === undefined ? local.remoteIp : gateway;
  ctx.transmitResolved(
    {
      id: `tcp-${node.id}-${segment.destinationPort}-${ctx.now()}`,
      serial: 0,
      frame: buildFrame({
        source: iface.mac,
        destination: iface.mac,
        etherType: 0x0800,
        payload: {
          kind: 'ip',
          ip: {
            kind: 'ip',
            source: iface.ip,
            destination: asIp(local.remoteIp),
            ttl: 64,
            protocol: 'tcp',
            payload: segment
          }
        }
      }),
      hops: [],
      state: 'queued',
      bornMs: ctx.now()
    },
    node.id,
    asIp(nextHop),
    description,
    onLink ? iface.id : undefined
  );
}

function replyTcp(ip: IpPacket, inbound: TcpSegment, segment: TcpSegment, ctx: HandlerContext, node: Node, _role: Role): void {
  const iface = node.interfaces[0];
  if (iface === undefined || iface.ip === undefined) return;
  const remoteIp = ip.source;
  const onLink = iface.prefix !== undefined && sameSubnet(iface.ip, remoteIp, iface.prefix);
  const gateway = (node as { gateway?: string }).gateway;
  const nextHop = onLink || gateway === undefined ? remoteIp : gateway;
  const frame = buildFrame({
    source: iface.mac,
    destination: iface.mac,
    etherType: 0x0800,
    payload: {
      kind: 'ip',
      ip: { ...ip, source: ip.destination, destination: ip.source, payload: segment }
    }
  });
  ctx.transmitResolved(
    {
      id: `tcp-${node.id}-${inbound.sourcePort}-${ctx.now()}`,
      serial: 0,
      frame,
      hops: [],
      state: 'queued',
      bornMs: ctx.now()
    },
    node.id,
    asIp(nextHop),
    `${flagsToLabel(segment)} from ${node.name}`,
    onLink ? iface.id : undefined
  );
}

function egressIface(node: Node, remoteIp: string): NetworkInterface {
  return (
    node.interfaces.find((i) => i.enabled && i.ip !== undefined && i.prefix !== undefined && sameSubnet(i.ip, remoteIp, i.prefix)) ??
    (node.interfaces[0] as NetworkInterface)
  );
}

function byteLen(segment: TcpSegment): number {
  const payload = segment.payload;
  if (payload === undefined) return 1;
  if (payload.kind === 'data') return payload.text.length;
  if (payload.kind === 'request') return (payload.body?.length ?? 0) + 40;
  if (payload.kind === 'response') return (payload.body?.length ?? 0);
  return 1;
}

function flagsToLabel(segment: TcpSegment): string {
  return [segment.flags.syn && 'SYN', segment.flags.ack && 'ACK', segment.flags.fin && 'FIN', segment.flags.rst && 'RST', segment.flags.psh && 'PSH']
    .filter(Boolean)
    .join('+');
}

function inboundIp(packet: Packet): IpPacket | undefined {
  return packet.frame.payload.kind === 'ip' ? packet.frame.payload.ip : undefined;
}

function asIp(value: string): import('../models/ipv4').Ipv4Address {
  return value as import('../models/ipv4').Ipv4Address;
}

function sameSubnet(a: string, b: string, prefix: number): boolean {
  const toInt = (ip: string) => {
    const p = ip.split('.').map(Number);
    return (((p[0] ?? 0) << 24) | ((p[1] ?? 0) << 16) | ((p[2] ?? 0) << 8) | (p[3] ?? 0)) >>> 0;
  };
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return ((toInt(a) & mask) >>> 0) === ((toInt(b) & mask) >>> 0);
}

/**
 * ICMP protocol: answers echo requests with echo replies.
 *
 * Replies are routed like any other IP packet: on-link destinations are
 * resolved directly, off-link ones go to the node's default gateway via
 * the ARP-gated path (transmitResolved). No frame-MAC guessing.
 */

import type { Packet } from '../models/packet';
import type { Node, NetworkInterface } from '../models/topology';
import type { HandlerContext } from './stack';
import type { IcmpMessage } from '../models/icmp';
import type { IpPacket } from '../models/ip';
import type { Ipv4Address } from '../models/ipv4';
import { buildFrame, buildIpPacket } from './builder';
import { sameSubnet } from '../models/ipv4';

export function icmpInbound(packet: Packet, ctx: HandlerContext, node: Node, message: IcmpMessage): void {
  if (message.type !== 'echo-request') return;
  const payload = packet.frame.payload;
  if (payload.kind !== 'ip') return;
  const ip: IpPacket = payload.ip;
  const iface = node.interfaces[0];
  if (iface === undefined) return;

  const reply: IcmpMessage = { kind: 'icmp', type: 'echo-reply' };
  const replyIp = buildIpPacket({
    source: ip.destination,
    destination: ip.source,
    ttl: 64,
    protocol: 'icmp',
    payload: reply
  });

  // Next hop: the destination itself when on-link, else the default gateway.
  const nextHop = nextHopForReply(node, iface, ip.source);
  const replyPacket: Packet = {
    id: `icmp-reply-${node.id}-${ip.source}-${ctx.now()}`,
    serial: 0,
    frame: buildFrame({
      source: iface.mac,
      destination: iface.mac, // placeholder until ARP resolves
      etherType: 0x0800,
      payload: { kind: 'ip', ip: replyIp }
    }),
    hops: [],
    state: 'queued',
    bornMs: ctx.now()
  };
  ctx.transmitResolved(replyPacket, node.id, nextHop, `echo reply to ${ip.source}`);
  ctx.emit({ type: 'NOTE', ts: ctx.now(), nodeId: node.id, message: `Echo reply sent to ${ip.source} via ${nextHop === ip.source ? 'direct delivery' : `gateway ${nextHop}`}` });
}

function nextHopForReply(node: Node, iface: NetworkInterface, destination: Ipv4Address): Ipv4Address {
  const onLink =
    iface.ip !== undefined && iface.prefix !== undefined && sameSubnet(iface.ip, destination, iface.prefix);
  if (onLink) return destination;
  if ((node.kind === 'host' || node.kind === 'server') && node.gateway !== undefined) {
    return node.gateway;
  }
  return destination;
}

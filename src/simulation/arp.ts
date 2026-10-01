/**
 * ARP protocol implementation (RFC 826 behavior).
 *
 * Inbound requests are answered by the target; every inbound ARP message
 * teaches the receiver the sender's IP↔MAC binding (gratuitous learning).
 */

import type { Packet } from '../models/packet';
import type { Node, NetworkInterface } from '../models/topology';
import type { HandlerContext } from './stack';
import type { Ipv4Address } from '../models/ipv4';
import { buildFrame, buildArpReplyPacket } from './builder';

export function arpInbound(packet: Packet, ctx: HandlerContext, node: Node, iface: NetworkInterface): void {
  const payload = packet.frame.payload;

  if (payload.kind !== 'arp') return;
  const arp = payload.arp;

  // RFC 826: learn the sender binding before anything else.
  ctx.arpSet(node.id, arp.senderIp, arp.senderMac);
  ctx.emit({ type: 'ARP_LEARN', ts: ctx.now(), nodeId: node.id, ip: arp.senderIp, mac: arp.senderMac });

  if (arp.operation === 'request') {
    if (iface.ip !== undefined && iface.ip === arp.targetIp) {
      ctx.emit({
        type: 'ARP_REPLY',
        ts: ctx.now(),
        nodeId: node.id,
        packetId: packet.id,
        senderIp: arp.targetIp,
        senderMac: iface.mac
      });
      const replyFrame = buildFrame({
        source: iface.mac,
        destination: arp.senderMac,
        etherType: 0x0806,
        payload: {
          kind: 'arp',
          arp: buildArpReplyPacket(iface.ip as Ipv4Address, iface.mac, arp)
        }
      });
      ctx.transmit(replyFrame, node.id, iface.id);
    } else {
      ctx.emit({
        type: 'ARP_REQUEST',
        ts: ctx.now(),
        nodeId: node.id,
        packetId: packet.id,
        senderIp: arp.senderIp,
        targetIp: arp.targetIp
      });
    }
    return;
  }
}

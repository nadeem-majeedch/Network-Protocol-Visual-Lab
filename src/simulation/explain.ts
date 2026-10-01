/**
 * Deterministic packet explanations.
 *
 * Generates human-readable teaching text purely from packet structure —
 * no AI, no network calls, no randomness. The same packet always yields
 * the same explanation, making explanations testable.
 */

import type { Packet } from '../models/packet';

export interface ExplainSection {
  readonly title: string;
  readonly lines: readonly string[];
}

export function explainPacket(packet: Packet): readonly ExplainSection[] {
  const sections: ExplainSection[] = [];
  const frame = packet.frame;

  sections.push({
    title: 'Ethernet layer',
    lines: [
      `This frame leaves ${frame.source} bound for ${frame.destination}.`,
      frame.destination === 'ff:ff:ff:ff:ff:ff'
        ? 'The all-ones destination MAC means every device on the link must receive it.'
        : 'A unicast destination means only the matching network card accepts this frame.'
    ]
  });

  if (frame.payload.kind === 'arp') {
    const arp = frame.payload.arp;
    sections.push({
      title: 'ARP layer',
      lines:
        arp.operation === 'request'
          ? [
              `${arp.senderIp} broadcasts “Who has ${arp.targetIp}?” because MAC addresses, not IPs, are needed to build a frame.`,
              'The request is a broadcast: the target machine recognizes its own IP and answers.'
            ]
          : [
              `${arp.senderIp} answers: “that IP is at ${arp.senderMac}”.`,
              'The reply is unicast, and both machines now cache the IP↔MAC binding.'
            ]
    });
  }

  if (frame.payload.kind === 'ip') {
    const ip = frame.payload.ip;
    sections.push({
      title: 'IPv4 layer',
      lines: [
        `The IP header routes the packet from ${ip.source} to ${ip.destination}.`,
        `Each router decrements TTL (now ${ip.ttl}); at zero the packet dies, preventing routing loops.`
      ]
    });

    switch (ip.payload.kind) {
      case 'tcp': {
        sections.push(...explainTcp(ip.payload));
        const app = ip.payload.payload;
        if (app !== undefined) sections.push(explainHttp(app));
        break;
      }
      case 'udp':
        sections.push({
          title: 'UDP layer',
          lines: [
            `UDP sends a lightweight datagram from port ${ip.payload.sourcePort} to port ${ip.payload.destinationPort} with no handshake.`,
            ip.payload.payload.kind === 'dns'
              ? 'DNS uses UDP because a single small query/answer fits one datagram.'
              : 'Other UDP applications trade reliability for speed.'
          ]
        });
        if (ip.payload.payload.kind === 'dns') sections.push(explainDns(ip.payload.payload));
        break;
      case 'icmp':
        sections.push({
          title: 'ICMP layer',
          lines:
            ip.payload.type === 'echo-request'
              ? ['Ping works by sending an ICMP echo request and awaiting an echo reply.']
              : [`ICMP ${ip.payload.type} is control-plane feedback, not user data.`]
        });
        break;
    }
  }

  return sections;
}

function explainTcp(segment: import('../models/tcp').TcpSegment): ExplainSection[] {
  const flags = [segment.flags.syn && 'SYN', segment.flags.ack && 'ACK', segment.flags.fin && 'FIN', segment.flags.rst && 'RST']
    .filter(Boolean)
    .join('+');
  const lines: string[] = [];

  if (segment.flags.syn && !segment.flags.ack) {
    lines.push('SYN opens a connection: the client proposes an initial sequence number.');
  } else if (segment.flags.syn && segment.flags.ack) {
    lines.push('SYN+ACK is the server agreeing and proposing its own sequence number.');
  } else if (segment.flags.fin) {
    lines.push('FIN politely closes one direction of the connection.');
  } else if (segment.payload?.kind === 'request') {
    lines.push(`This segment carries an HTTP ${segment.payload.method} request inside the TCP stream.`);
  } else if (segment.payload?.kind === 'response') {
    lines.push(`This segment carries an HTTP ${segment.payload.status} response inside the TCP stream.`);
  } else {
    lines.push('ACK segments confirm bytes received; TCP is reliable because every byte is acknowledged.');
  }
  lines.push(`Flags: ${flags}. Sequence ${segment.sequence}, ack ${segment.acknowledgment}, window ${segment.window}.`);

  return [{ title: 'TCP layer', lines }];
}

function explainDns(dns: import('../models/dns').DnsMessage): ExplainSection {
  const question = dns.questions[0];
  if (!dns.isResponse) {
    return {
      title: 'DNS layer',
      lines: [
        `Transaction ID 0x${dns.transactionId.toString(16).padStart(4, '0')} matches this query with its eventual response.`,
        `The resolver asks for ${question === undefined ? 'a name' : `${question.name} (${question.type})`} — an A record maps a name to an IPv4 address.`
      ]
    };
  }
  const answer = dns.answers?.[0];
  return {
    title: 'DNS layer',
    lines: [
      `The response carries the same transaction ID 0x${dns.transactionId.toString(16).padStart(4, '0')} so the asker can match it.`,
      answer === undefined
        ? 'No answer records came back — the name could not be resolved.'
        : `The answer ${answer.name} ${answer.type} ${answer.value} is cached for ${answer.ttl} ms before it must be asked for again.`
    ]
  };
}

function explainHttp(msg: import('../models/http').HttpMessage | { readonly kind: 'data'; readonly text: string }): ExplainSection {
  if (msg.kind === 'data') {
    return {
      title: 'Data payload',
      lines: [`The TCP stream carries raw application bytes: "${msg.text}". TCP does not care what they mean — reliability is its job.`]
    };
  }
  if (msg.kind === 'request') {
    const host = msg.headers['Host'];
    return {
      title: 'HTTP layer',
      lines: [
        `${msg.method} ${msg.path} asks the server for a resource (${msg.version}).`,
        host === undefined ? 'The request headers describe the client and what it accepts.' : `The Host header (${host}) lets one server machine host many websites.`,
        msg.body === undefined ? 'GET requests carry no body — all context is in the URL and headers.' : 'The request includes a body: data the client is sending to the server.'
      ]
    };
  }
  return {
    title: 'HTTP layer',
    lines: [
      `Status ${msg.status} ${msg.reason} — ${msg.status < 400 ? 'the request succeeded.' : 'something went wrong.'}`,
      msg.body === undefined ? 'The response has no body.' : `The body carries ${msg.body.length} characters of content the browser will render.`
    ]
  };
}

/**
 * Journey stages: a pure, deterministic projection of the canonical event
 * log into the eight narrative stages of "Open a Web Page". For each stage
 * the model answers the student's questions: what happened, why, which
 * protocol is responsible, what information was added, what changed, and
 * which device made the decision. No React, no engine state mutation —
 * this module only reads events.
 */

import type { SimulationEvent } from '../models/events';

export interface JourneyAnswers {
  /** What happened? */
  readonly what: string;
  /** Why did it happen? */
  readonly why: string;
  /** Which protocol is responsible? */
  readonly protocol: string;
  /** What information was added? */
  readonly added: string;
  /** What information changed? */
  readonly changed: string;
  /** What device made the decision? */
  readonly decider: string;
}

export interface JourneyStage {
  readonly id: string;
  readonly title: string;
  readonly order: number;
  /** Events of this stage in log order (empty until the stage starts). */
  readonly events: readonly SimulationEvent[];
  /** First event time of the stage; undefined until it has begun. */
  readonly startedAtMs?: number;
  /** Last event time of the stage; undefined until it has completed. */
  readonly completedAtMs?: number;
  readonly answers?: JourneyAnswers;
  /** True when every stage before this one has completed. */
  readonly active: boolean;
}

const STAGE_DEFS: readonly {
  id: string;
  title: string;
  types: readonly SimulationEvent['type'][];
  match?: (e: SimulationEvent) => boolean;
  answers: JourneyAnswers;
}[] = [
  {
    id: 'dns',
    title: '1 · DNS resolution',
    types: ['DNS_QUERY', 'DNS_RESPONSE', 'DNS_CACHE_LOOKUP', 'DNS_CACHE_WRITE', 'DNS_RECURSE'],
    answers: {
      what: 'The browser asked a DNS resolver for the address behind example.local and received 172.30.0.20.',
      why: 'Applications speak names, but the network delivers packets to IP addresses — the name must be translated first.',
      protocol: 'DNS (over UDP port 53)',
      added: 'A UDP header (ports), an IP header (client → resolver), an Ethernet frame — plus the answer: example.local = 172.30.0.20.',
      changed: 'The DNS cache on the browser now holds the A record; the resolver answered from its zone.',
      decider: 'The DNS resolver decided the answer from its authoritative zone; the browser decided to cache it.'
    }
  },
  {
    id: 'arp',
    title: '2 · ARP resolution',
    types: ['ARP_REQUEST', 'ARP_REPLY', 'ARP_LEARN', 'ARP_WRITE'],
    answers: {
      what: 'The browser broadcast “who has 172.20.0.1?” and its gateway answered with a MAC address.',
      why: 'Ethernet frames are delivered by MAC address, not IP. Before any IP packet can cross the LAN, its next hop needs a MAC.',
      protocol: 'ARP (EtherType 0x0806)',
      added: 'An Ethernet broadcast frame, an ARP request/reply pair, and a cache entry: 172.20.0.1 ⇔ the router’s MAC.',
      changed: 'The ARP caches on both sides filled in; frames can now be addressed to the gateway.',
      decider: 'The browser decided to ask (cache miss); the gateway decided to answer for its own IP.'
    }
  },
  {
    id: 'routing',
    title: '3 · Routing',
    types: ['ROUTE_LOOKUP', 'PACKET_FORWARDED', 'PACKET_DROPPED'],
    match: (e) => e.type !== 'PACKET_FORWARDED' || !e.reason.includes('frame transmission'),
    answers: {
      what: 'The browser noticed 172.30.0.20 is outside its subnet and handed the packet to its default gateway; the router matched 172.30.0.0/24 and forwarded.',
      why: 'IP delivers across networks. Hosts send off-link traffic to a gateway; routers pick the best route by longest prefix.',
      protocol: 'IPv4 forwarding with longest-prefix match',
      added: 'A routing decision on every device: the client picked its default route (0.0.0.0/0 via 172.20.0.1); the router picked 172.30.0.0/24 out its web interface.',
      changed: 'The TTL decremented at the router and the Ethernet frame was rewritten for the outgoing link.',
      decider: 'The browser chose its default route; the Router chose the longest-prefix match.'
    }
  },
  {
    id: 'handshake',
    title: '4 · TCP handshake',
    types: ['TCP_STATE_CHANGE'],
    match: (e) =>
      e.type === 'TCP_STATE_CHANGE' &&
      (e.to === 'SYN_SENT' || e.to === 'SYN_RCVD' || (e.to === 'ESTABLISHED' && e.from !== 'ESTABLISHED')),
    answers: {
      what: 'Client and server exchanged SYN, SYN+ACK and ACK, both landing in ESTABLISHED.',
      why: 'TCP needs agreement on ports and initial sequence numbers before any application byte can flow reliably.',
      protocol: 'TCP (ports 49152 → 80)',
      added: 'Two 32-bit initial sequence numbers, both endpoint states, and the connection itself.',
      changed: 'Client: CLOSED → SYN_SENT → ESTABLISHED. Server: LISTEN → SYN_RCVD → ESTABLISHED.',
      decider: 'The client decided to open; the server accepted; both state machines decided the transitions.'
    }
  },
  {
    id: 'get',
    title: '5 · HTTP GET',
    types: ['HTTP_REQUEST'],
    answers: {
      what: 'The request line “GET /index.html HTTP/1.1” crossed the network inside a TCP segment.',
      why: 'With the pipe established, the application can finally ask for the document it wanted all along.',
      protocol: 'HTTP/1.1 over TCP',
      added: 'The request line, the Host header, and the payload bytes inside the TCP sequence space.',
      changed: 'The TCP sequence numbers advanced by the length of the request.',
      decider: 'The browser application decided to fetch this path; TCP decided when the bytes were reliable to send.'
    }
  },
  {
    id: 'response',
    title: '6 · HTTP response',
    types: ['HTTP_RESPONSE'],
    answers: {
      what: 'The server answered “HTTP/1.1 200 OK” with an HTML body.',
      why: 'The server found /index.html and answered with the representation the client asked for.',
      protocol: 'HTTP/1.1 over TCP',
      added: 'The status line, Content-Type: text/html, Content-Length, and the page body.',
      changed: 'The server’s TCP sequence numbers advanced by the response size; the page now exists on the client.',
      decider: 'The web server decided the resource exists (200) and what representation to send.'
    }
  },
  {
    id: 'data',
    title: '7 · Data & acknowledgements',
    types: ['PACKET_SENT', 'PACKET_RECEIVED'],
    match: (e) =>
      (e.type === 'PACKET_SENT' || e.type === 'PACKET_RECEIVED') && e.protocol === 'TCP',
    answers: {
      what: 'Every data segment was acknowledged: ACK = SEQ + length, in both directions.',
      why: 'TCP only knows a byte arrived when the receiver says so — that is what makes retransmission possible.',
      protocol: 'TCP',
      added: 'An ACK number for every byte range received.',
      changed: 'Each side’s expected-ACK watermark advanced as data arrived.',
      decider: 'Each receiving endpoint decides, byte range by byte range, what to acknowledge.'
    }
  },
  {
    id: 'teardown',
    title: '8 · Termination',
    types: ['TCP_STATE_CHANGE'],
    match: (e) =>
      e.type === 'TCP_STATE_CHANGE' &&
      (e.from === 'FIN_WAIT_1' || e.from === 'CLOSE_WAIT' || e.from === 'TIME_WAIT' || e.to === 'CLOSED' || e.to === 'LAST_ACK' || e.to === 'CLOSE_WAIT'),
    answers: {
      what: 'The connection closed with FIN, ACK, FIN, ACK — and the client held TIME_WAIT before its final CLOSED.',
      why: 'Both directions must finish independently, and TIME_WAIT keeps late duplicates from corrupting the next connection.',
      protocol: 'TCP',
      added: 'Two FINs, two ACKs, and a 2·MSL timer.',
      changed: 'Client: ESTABLISHED → FIN_WAIT_1 → FIN_WAIT_2 → TIME_WAIT → CLOSED. Server: ESTABLISHED → CLOSE_WAIT → LAST_ACK → CLOSED.',
      decider: 'The browser decided to close first (active close); both state machines drove the rest.'
    }
  }
];

/** All journey stages with the events assigned from the log. */
export function journeyStages(events: readonly SimulationEvent[]): readonly JourneyStage[] {
  const used = new Set<SimulationEvent>();
  // Routing for the WEB flow starts with the first SYN; earlier lookups
  // (e.g. the DNS query's on-link decision) belong to earlier stages.
  const firstSynTs = events.find((e) => e.type === 'TCP_STATE_CHANGE' && e.to === 'SYN_SENT')?.ts;
  const raw = STAGE_DEFS.map((def, index) => {
    const stageEvents = events.filter(
      (e) =>
        !used.has(e) &&
        def.types.includes(e.type) &&
        (def.match === undefined || def.match(e)) &&
        (def.id !== 'routing' || firstSynTs === undefined || e.ts >= firstSynTs)
    );
    for (const e of stageEvents) used.add(e);
    return { def, index, stageEvents };
  });

  return raw.map(({ def, stageEvents }, index) => {
    const startedAtMs = stageEvents[0]?.ts;
    const completedAtMs = stageEvents.length > 0 ? stageEvents[stageEvents.length - 1]?.ts : undefined;
    const previous = raw.slice(0, index);
    const active =
      stageEvents.length > 0 &&
      previous.every((p) => p.stageEvents.length > 0);
    return {
      id: def.id,
      title: def.title,
      order: index + 1,
      events: stageEvents,
      ...(startedAtMs !== undefined ? { startedAtMs } : {}),
      ...(completedAtMs !== undefined ? { completedAtMs } : {}),
      answers: def.answers,
      active
    };
  });
}

/**
 * The stage visible at a given cursor: the one that OWNS the most recent
 * event at or before the cursor. Stages interleave in sim-time (the ARP
 * for the gateway overlaps the SYN), so ownership of the latest wire
 * event is the honest "what is happening right now" signal. Ties go to
 * the earlier stage in journey order.
 */
export function activeStageAt(stages: readonly JourneyStage[], cursorMs: number): JourneyStage | undefined {
  let latest = -1;
  for (const stage of stages) {
    for (const e of stage.events) {
      if (e.ts <= cursorMs && e.ts > latest) latest = e.ts;
    }
  }
  if (latest < 0) return undefined;
  return stages.find((s) => s.events.some((e) => e.ts === latest));
}

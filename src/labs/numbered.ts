/**
 * The numbered curriculum (Lab 01 – Lab 18): a coherent, ordered course
 * from Ethernet frames to a complete web request.
 *
 * Framework contract for every lab here:
 *  - topology: an EXISTING deterministic topology from labs/*.ts (no new
 *    network definitions, no new protocol behavior);
 *  - script: only LabScriptEntry actions, executed by labs/runner.ts on
 *    the same NetworkEngine as every other lab;
 *  - completion: a pure predicate over NetworkState (framework.ts) that
 *    the lab's own script must satisfy — enforced by the test suite.
 *
 * Nothing in this file implements protocol behavior; it only schedules
 * it and describes what the student should learn.
 */

import type { LabDefinition } from './types';
import { allOf, completedWhen } from './framework';
import {
  arpEntry,
  countEvents,
  dnsCached,
  dropReasonContains,
  encapsulatedHttp,
  eventSeen,
  firstTcpConnection,
  httpExchange,
  httpRequestSeen,
  httpResponseSeen,
  longestPrefixDecided,
  macArrivedAt,
  macTableSize,
  receivedBy,
  routeMatched,
  tcpDataAcks,
  tcpSideIs,
  tcpTransitionSeen,
  ttlArrivedAt
} from './framework';
import {
  arpTopology,
  dnsTopology,
  ethernetTopology,
  httpTopology,
  routingTopology
} from './topologies';
import { gatewayTopology } from './gateway-topology';
import { recursiveDnsTopology } from './dns-topology';
import { tcpLabTopology } from './tcp-topology';
import { webTopology } from './web-topology';
import { forwardingTopology, longestPrefixTopology } from './forwarding-topologies';

const STANDARD_CONTROLS = [
  'Run — execute the whole scenario and play the animation',
  'Pause / Play — freeze the playback at any moment',
  'Engine step — advance one scheduled engine action at a time',
  'Forward / Back — move the playback cursor one event at a time',
  'Reset — return the lab to its pristine initial topology',
  'Speed — 0.25× to 4× playback'
];

/** Adds the numbered title and the standard control list to a lab body. */
function numberedLab(
  id: string,
  number: number,
  topic: string,
  lab: Omit<LabDefinition, 'id' | 'title' | 'controls'>
): LabDefinition {
  return {
    id,
    title: `Lab ${String(number).padStart(2, '0')} — ${topic}`,
    controls: STANDARD_CONTROLS,
    ...lab
  };
}

/* ------------------------------------------------------------------ */
/* 01 — Ethernet Frames                                                */
/* ------------------------------------------------------------------ */

const lab01: LabDefinition = numberedLab('lab-01-ethernet-frames', 1, 'Ethernet Frames', {
  protocols: ['Ethernet', 'MAC', 'ARP'],
  objective: 'Watch one frame traverse a hub — repeated blindly out of every port — and a second frame traverse a switch, which forwards unicast.',
  topology: ethernetTopology,
  script: [
    { atMs: 0, action: 'note', nodeId: 'pc-a', message: 'PC A addresses a frame to PC B through the HUB — a repeater copies the signal everywhere' },
    { atMs: 0, action: 'send-ping', from: 'pc-a', toIp: '10.0.0.2', ttl: 64, destMacOf: 'pc-b' },
    { atMs: 300, action: 'note', nodeId: 'pc-c', message: 'PC C addresses a frame to PC D through the SWITCH — only the destination port receives it' },
    { atMs: 300, action: 'send-ping', from: 'pc-c', toIp: '10.0.0.4', ttl: 64, destMacOf: 'pc-d' },
    { atMs: 700, action: 'note', nodeId: 'switch-1', message: 'The switch has learned both MACs — later frames travel a single path, not a flood' }
  ],
  steps: [
    { id: 'f-1', title: 'Resolve before you send', narration: 'Even on the hub, PC A must first learn PC B’s MAC with ARP — frames speak MAC, not IP.', watchEventTypes: ['ARP_REQUEST', 'ARP_WRITE'] },
    { id: 'f-2', title: 'Hub = repeat everything', narration: 'The hub has no brain: the frame’s electrical signal is copied out of every other port. PC B accepts it; everyone else ignores it.', watchEventTypes: ['PACKET_SENT', 'PACKET_RECEIVED'] },
    { id: 'f-3', title: 'Switch = learn and forward', narration: 'The switch reads the source MAC, records the port, then forwards only toward the destination port.', watchEventTypes: ['PACKET_FORWARDED'] },
    { id: 'f-4', title: 'Same frame, two worlds', narration: 'One frame flooded the hub domain; the other walked a single switched path. That difference is why switches replaced hubs.', watchEventTypes: ['NOTE'] }
  ],
  task: 'Compare PACKET_RECEIVED events: how many nodes saw the hub frame vs the switched frame?',
  objectives: [
    'State what an Ethernet frame header contains (destination MAC, source MAC, EtherType).',
    'Explain why a hub repeats every frame out of every port while a switch forwards selectively.',
    'Describe how a switch builds its MAC table from source addresses.'
  ],
  prerequisites: ['What a network interface and a MAC address are'],
  expectedObservations: [
    'ARP request (ff:ff:ff:ff:ff:ff) before any unicast frame can be addressed',
    'The hub delivers the frame to PC B — and the repeater path means no learning happens',
    'The switch records source MACs into its MAC table as frames pass through',
    'PACKET_FORWARDED on switch-1 says “MAC table hit” once learning is complete'
  ],
  hints: [
    'Select the first packet and look at the ETHERNET layer: destination is broadcast for ARP.',
    'Watch switch-1’s MAC table fill — the switch learns senders, it never learns from hubs.',
    'Count PACKET_RECEIVED events per segment; the hub floods, the switch does not.'
  ],
  explanation: 'Ethernet identifies stations by 48-bit MAC address. A hub is a physical repeater: it has no MAC logic, so every frame floods the whole collision domain. A switch is a learning bridge: it reads the SOURCE MAC of every frame to learn which port owns it, then uses the DESTINATION MAC to forward unicast frames on exactly one port — flooding only when the destination is still unknown.',
  completion: completedWhen('ARP resolved both pairs and the switch learned at least two MAC addresses — every frame in the run was delivered on real MACs.', allOf(
    (state) => arpEntry(state, 'pc-a', '10.0.0.2'),
    (state) => arpEntry(state, 'pc-c', '10.0.0.4'),
    (state) => macTableSize(state, 'switch-1') >= 2,
    (state) => eventSeen(state, 'PACKET_RECEIVED')
  ))
});

/* ------------------------------------------------------------------ */
/* 02 — MAC Addresses                                                  */
/* ------------------------------------------------------------------ */

const lab02: LabDefinition = numberedLab('lab-02-mac-addresses', 2, 'MAC Addresses', {
  protocols: ['MAC', 'Ethernet', 'ARP'],
  objective: 'Follow one ARP exchange and see MAC addresses do all the delivery work: broadcast to ask, unicast to answer.',
  topology: arpTopology,
  script: [
    { atMs: 0, action: 'send-arp', from: 'host-1', targetIp: '10.0.0.12' },
    { atMs: 400, action: 'note', nodeId: 'host-1', message: 'Host 1 now owns the IP→MAC binding and can build unicast frames to Host 2' }
  ],
  steps: [
    { id: 'm-1', title: 'The broadcast question', narration: 'Host 1 asks the whole segment: who has 10.0.0.12? The destination MAC is ff:ff:ff:ff:ff:ff — every NIC must listen.', watchEventTypes: ['ARP_REQUEST', 'PACKET_SENT'] },
    { id: 'm-2', title: 'The unicast answer', narration: 'Host 2 replies with its MAC, addressed only to Host 1’s MAC. No broadcast needed for the answer.', watchEventTypes: ['ARP_REPLY', 'PACKET_RECEIVED'] },
    { id: 'm-3', title: 'Bindings on both sides', narration: 'Both hosts cache the IP↔MAC pair — every later frame between them is pure unicast.', watchEventTypes: ['ARP_WRITE'] }
  ],
  task: 'Select the ARP reply and read both MAC fields: which one equals Host 1’s NIC address, and why?',
  objectives: [
    'Recognize the destination/source MAC fields on any frame.',
    'Distinguish a broadcast MAC (ff:ff:ff:ff:ff:ff) from a unicast MAC.',
    'Explain why ARP must broadcast the question but unicast the answer.'
  ],
  prerequisites: ['Lab 01 — Ethernet Frames'],
  expectedObservations: [
    'ARP_REQUEST carries destination ff:ff:ff:ff:ff:ff and target IP 10.0.0.12',
    'ARP_REPLY carries Host 2’s MAC as sender and Host 1’s MAC as destination',
    'ARP_WRITE records 10.0.0.12 ⇔ 02:00:00:00:01:02 on Host 1'
  ],
  hints: [
    'Open the ETHERNET layer of both ARP packets and compare destination MACs.',
    'The switch in this lab floods the request but can forward the reply unicast once it has learned Host 1.',
    'MACs are Layer 2 — they never travel past a router; IPs identify the endpoints.'
  ],
  explanation: 'A MAC address names a network interface inside one link segment. Ethernet delivery is entirely MAC-based: the NIC accepts frames addressed to its own MAC or to the broadcast address. Because IP packets must ride inside frames, a sender that only knows an IP needs ARP to discover the MAC before any unicast frame can be built — broadcast to ask, unicast to answer.',
  completion: completedWhen('The reply arrived at Host 1 as a unicast frame addressed to Host 1’s MAC, and the binding was cached.', allOf(
    (state) => arpEntry(state, 'host-1', '10.0.0.12'),
    (state) => macArrivedAt(state, 'host-1', '02:00:00:00:01:01')
  ))
});

/* ------------------------------------------------------------------ */
/* 03 — ARP Request and Reply                                          */
/* ------------------------------------------------------------------ */

const lab03: LabDefinition = numberedLab('lab-03-arp-request-reply', 3, 'ARP Request and Reply', {
  protocols: ['ARP', 'Ethernet', 'MAC'],
  objective: 'The canonical two-packet dance: a broadcast ARP request for 10.0.0.12 and Host 2’s unicast ARP reply.',
  topology: arpTopology,
  script: [
    { atMs: 0, action: 'send-arp', from: 'host-1', targetIp: '10.0.0.12' },
    { atMs: 400, action: 'note', nodeId: 'host-1', message: 'Request → reply → cache: ARP completed in two packets' }
  ],
  steps: [
    { id: 'r-1', title: 'Who has 10.0.0.12?', narration: 'Host 1 broadcasts the request. Every host receives it; only Host 2 recognizes its own IP.', watchEventTypes: ['ARP_REQUEST'] },
    { id: 'r-2', title: 'Reply to the asker', narration: 'Host 2 answers directly: “10.0.0.12 is at 02:00:00:00:01:02”. Only Host 1 needs this.', watchEventTypes: ['ARP_REPLY'] },
    { id: 'r-3', title: 'Both caches learn', narration: 'The requester caches the target; the target also caches the requester from the request — ARP is symmetric.', watchEventTypes: ['ARP_WRITE', 'ARP_LEARN'] }
  ],
  task: 'Count the ARP packets on the wire. Why can the reply be unicast when the request had to flood?',
  objectives: [
    'Describe both directions of the ARP exchange, packet by packet.',
    'Explain why the request is broadcast and the reply is unicast.',
    'Identify the sender/target IP and MAC fields in each packet.'
  ],
  prerequisites: ['Lab 02 — MAC Addresses'],
  expectedObservations: [
    'Exactly one ARP_REQUEST broadcast from Host 1',
    'Exactly one ARP_REPLY unicast back to Host 1',
    'ARP_WRITE entries on both hosts'
  ],
  hints: [
    'Filter the timeline for ARP events — there should be exactly two packets.',
    'Read the ARP layer of each packet: operation “request” vs “reply”.'
  ],
  explanation: 'ARP (Address Resolution Protocol) maps IPv4 addresses to MAC addresses inside one subnet. The request is broadcast because the asker does not know where the target is; every station receives it, and the owner of the queried IP answers. The reply is unicast because the request’s sender MAC is already known — that same field also lets the target cache the asker, which is why even one exchange usually fills two caches.',
  completion: completedWhen('A broadcast request for 10.0.0.12 was answered by a unicast reply and Host 1 cached the binding.', allOf(
    (state) => countEvents(state, (e) => e.type === 'ARP_REQUEST' && e.targetIp === '10.0.0.12') >= 1,
    (state) => countEvents(state, (e) => e.type === 'ARP_REPLY' && e.senderIp === '10.0.0.12') >= 1,
    (state) => arpEntry(state, 'host-1', '10.0.0.12')
  ))
});

/* ------------------------------------------------------------------ */
/* 04 — ARP Cache                                                      */
/* ------------------------------------------------------------------ */

const lab04: LabDefinition = numberedLab('lab-04-arp-cache', 4, 'ARP Cache', {
  protocols: ['ARP', 'Ethernet', 'HTTP', 'TCP', 'DNS'],
  objective: 'The first exchange fills the ARP cache; the second ride costs nothing. Watch repeat traffic skip ARP entirely.',
  topology: httpTopology,
  script: [
    { atMs: 0, action: 'send-http', from: 'http-client', serverName: 'www.example.com', path: '/first.html', resolveFirst: true },
    { atMs: 2000, action: 'note', nodeId: 'http-client', message: 'The ARP cache is warm now — every later frame reuses the learned MACs' },
    { atMs: 2000, action: 'send-ping', from: 'http-client', toIp: '192.168.9.80', ttl: 64 }
  ],
  steps: [
    { id: 'c-1', title: 'Cold cache, real ARP', narration: 'The first journey ARPs for 192.168.9.80 (and the resolver) — the packet is held until MACs are learned.', watchEventTypes: ['ARP_REQUEST', 'ARP_WRITE'] },
    { id: 'c-2', title: 'Warm cache, instant frames', narration: 'The second transmission needs no ARP at all: the cache answers in nanoseconds and the frame leaves immediately.', watchEventTypes: ['PACKET_SENT', 'PACKET_RECEIVED'] }
  ],
  task: 'Open the ARP cache panel before running, then after: which bindings appeared, and which later packets reused them?',
  objectives: [
    'Explain what an ARP cache stores and why it exists.',
    'Observe a cache miss holding traffic and a cache hit releasing it instantly.',
    'Know that cache entries are bounded by a lifetime in real networks.'
  ],
  prerequisites: ['Lab 03 — ARP Request and Reply'],
  expectedObservations: [
    'ARP_WRITE entries for 192.168.9.80 and 192.168.9.53 on http-client',
    'The ping to 192.168.9.80 emits no new ARP_REQUEST — the cache answers',
    'A DNS_CACHE_WRITE as the client caches the resolved name'
  ],
  hints: [
    'Compare the ARP_REQUEST count of the HTTP journey with the ping that follows it.',
    'The ARP cache panel shows every learned binding per node — check http-client.',
    'Real caches expire entries after seconds to minutes; this lab keeps them for the run.'
  ],
  explanation: 'ARPing for every frame would double the traffic of every exchange, so ARP results are cached per node. A cache miss parks the outbound packet while a request/reply exchange runs; a cache hit lets the frame leave immediately. In real systems entries expire after a timeout, trading a little extra ARP traffic for correctness when MACs change.',
  completion: completedWhen('The full first journey ran and the second transmission reused the cache — no new ARP request was needed.', allOf(
    (state) => arpEntry(state, 'http-client', '192.168.9.80'),
    (state) => httpExchange(state, 'GET', 200),
    (state) => dnsCached(state, 'http-client', 'www.example.com')
  ))
});

/* ------------------------------------------------------------------ */
/* 05 — IPv4 Addressing                                                */
/* ------------------------------------------------------------------ */

const lab05: LabDefinition = numberedLab('lab-05-ipv4-addressing', 5, 'IPv4 Addressing', {
  protocols: ['IPv4', 'Routing', 'Ethernet', 'ARP'],
  objective: 'Watch two addresses meet one mask: the Workstation and its router interface share 192.168.1.0/24, so delivery between them is direct — no routing, no TTL change.',
  topology: routingTopology,
  script: [
    { atMs: 0, action: 'note', nodeId: 'src-host', message: 'The Workstation masks both addresses with /24: same network — this is local delivery' },
    { atMs: 0, action: 'send-ping', from: 'src-host', toIp: '192.168.1.1', ttl: 64 },
    { atMs: 300, action: 'send-ping', from: 'src-host', toIp: '192.168.1.1', ttl: 64 }
  ],
  steps: [
    { id: 'ip-1', title: 'Read the addresses', narration: 'Workstation 192.168.1.10/24 and router interface 192.168.1.1/24 — the /24 mask puts them in one network.', watchEventTypes: ['ROUTE_LOOKUP'] },
    { id: 'ip-2', title: 'On-link is on-link', narration: 'The route table says “connected”: the next hop IS the destination. ARP asks for 192.168.1.1 itself.', watchEventTypes: ['ARP_REQUEST'] },
    { id: 'ip-3', title: 'TTL untouched', narration: 'The echo arrives with TTL still 64. Routers decrement; a switch and a NIC never do.', watchEventTypes: ['PACKET_RECEIVED'] }
  ],
  task: 'In the packet inspector, compare the IPv4 layer of the echo request and the reply: what do source and destination swap, and what stays the same?',
  objectives: [
    'Read an IPv4 address with its prefix length (/24).',
    'Decide whether two addresses share a subnet by masking both.',
    'Explain what “on-link” means for delivery and TTL.'
  ],
  prerequisites: ['Lab 04 — ARP Cache'],
  expectedObservations: [
    'ROUTE_LOOKUP matches the connected 192.168.1.0/24 route',
    'ARP targets 192.168.1.1 directly — no gateway involved',
    'Every PACKET_RECEIVED carries the TTL the sender chose (64)'
  ],
  hints: [
    'Open the Routing table inspector on the Workstation — the connected route is there.',
    'Select the received echo and check the TTL field in the IPv4 layer.',
    'The prefix /24 means the first three octets identify the network.'
  ],
  explanation: 'An IPv4 address is split by its prefix length into a network part and a host part. To decide whether a destination is local, a host masks its own address and the destination with the same prefix: equal results mean “on-link”, so frames go straight to the destination’s MAC and no router (hence no TTL decrement) is involved. Everything else must go to a gateway.',
  completion: completedWhen('The on-link pings to 192.168.1.1 were answered — delivery stayed inside 192.168.1.0/24 with TTL intact.', allOf(
    (state) => receivedBy(state, 'router-1', 'ICMP'),
    (state) => ttlArrivedAt(state, 'router-1', 64),
    (state) => arpEntry(state, 'src-host', '192.168.1.1')
  ))
});

/* ------------------------------------------------------------------ */
/* 06 — Default Gateway                                                */
/* ------------------------------------------------------------------ */

const lab06: LabDefinition = numberedLab('lab-06-default-gateway', 6, 'Default Gateway', {
  protocols: ['ARP', 'Ethernet', 'IPv4'],
  objective: 'PC1 has a packet for the router itself (192.168.1.1): watch ARP translate the gateway’s IP into its MAC so traffic can leave the subnet.',
  topology: gatewayTopology,
  script: [
    { atMs: 0, action: 'note', nodeId: 'pc1', message: 'PC1 prepares a packet for 192.168.1.1 — its default gateway' },
    { atMs: 0, action: 'send-ping', from: 'pc1', toIp: '192.168.1.1', ttl: 64 },
    { atMs: 300, action: 'note', nodeId: 'gateway-router', message: 'The router received the request — its MAC is now known to PC1' },
    { atMs: 400, action: 'send-ping', from: 'pc1', toIp: '192.168.1.1', ttl: 64 },
    { atMs: 700, action: 'note', nodeId: 'pc1', message: 'Second ping needed no ARP — the cache had the answer' }
  ],
  steps: [
    { id: 'gw-1', title: 'Cache miss', narration: 'PC1 has a packet for 192.168.1.1 but its ARP cache is empty. It cannot build a frame with an IP alone, so the packet is held.', watchEventTypes: ['NOTE'] },
    { id: 'gw-2', title: 'ARP request (broadcast)', narration: 'PC1 broadcasts an ARP request to ff:ff:ff:ff:ff:ff asking “who has 192.168.1.1?”.', watchEventTypes: ['ARP_REQUEST', 'PACKET_SENT'] },
    { id: 'gw-3', title: 'Through the switch', narration: 'The switch floods the broadcast out every other port and learns which port PC1 lives on.', watchEventTypes: ['PACKET_FORWARDED'] },
    { id: 'gw-4', title: 'Router receives', narration: 'The router sees its own IP in the request and, like every receiver, first learns the sender’s binding.', watchEventTypes: ['PACKET_RECEIVED', 'ARP_LEARN'] },
    { id: 'gw-5', title: 'ARP reply (unicast)', narration: 'The router replies directly to PC1: “192.168.1.1 is at 02:00:00:0a:00:21”. No broadcast needed.', watchEventTypes: ['ARP_REPLY'] },
    { id: 'gw-6', title: 'Cache updated', narration: 'PC1 writes 192.168.1.1 ⇔ 02:00:00:0a:00:21 into its ARP cache and releases the held packet.', watchEventTypes: ['ARP_WRITE'] },
    { id: 'gw-7', title: 'Second ping, zero ARP', narration: 'The second ping needs no ARP at all: the cache supplies the MAC instantly. That is why ARP exists — ask once, reuse many times.', watchEventTypes: ['NOTE'] }
  ],
  task: 'Inspect the ARP cache panel before and after the exchange, then explain why the second ping shows no ARP_REQUEST.',
  objectives: [
    'Explain what a default gateway is and when it is used.',
    'Walk the full ARP request → reply → cache sequence for the gateway IP.',
    'Predict which packets need ARP and which do not.'
  ],
  prerequisites: ['Lab 04 — ARP Cache', 'Lab 05 — IPv4 Addressing'],
  expectedObservations: [
    'One broadcast ARP_REQUEST targeting 192.168.1.1',
    'One unicast ARP_REPLY from the router',
    'ARP_WRITE on pc1 for 192.168.1.1; the second ping emits no ARP'
  ],
  hints: [
    'The gateway is the router interface on PC1’s own subnet — ARP treats it like any neighbor.',
    'Compare the timeline around both pings: only the first has ARP traffic.',
    'If the cache were empty forever, every packet would pay the ARP round trip.'
  ],
  explanation: 'A default gateway is the router interface that receives all traffic destined outside the local subnet. Hosts address such frames to the GATEWAY’s MAC while the IP header still names the final destination — but before any frame can leave, the gateway’s own IP→MAC binding must be learned by ARP, exactly as for any on-link neighbor.',
  completion: completedWhen('PC1 pinged its default gateway twice: the first ping performed ARP and filled the cache, the second reused it.', allOf(
    (state) => arpEntry(state, 'pc1', '192.168.1.1'),
    (state) => receivedBy(state, 'gateway-router', 'ICMP'),
    (state) => countEvents(state, (e) => e.type === 'PACKET_SENT' && e.protocol === 'ICMP') >= 2
  ))
});

/* ------------------------------------------------------------------ */
/* 07 — Routing Table Lookup                                           */
/* ------------------------------------------------------------------ */

const lab07: LabDefinition = numberedLab('lab-07-routing-table-lookup', 7, 'Routing Table Lookup', {
  protocols: ['IPv4', 'Routing', 'ARP'],
  objective: 'Follow one packet from 192.168.1.0/24 to 10.20.5.8: the workstation picks its gateway, the router matches 10.20.0.0/16, TTL drops, frame rewritten.',
  topology: routingTopology,
  script: [
    { atMs: 0, action: 'send-ping', from: 'src-host', toIp: '10.20.5.8', ttl: 64 },
    { atMs: 500, action: 'note', nodeId: 'router-1', message: 'The decision: longest prefix 10.20.0.0/16 matched, TTL decremented, new frame built for the next hop' },
    { atMs: 800, action: 'send-ping', from: 'src-host', toIp: '10.20.5.8', ttl: 1 }
  ],
  steps: [
    { id: 'rt-1', title: 'Not my subnet', narration: 'The workstation masks both addresses with /24 and sees 10.20.5.8 is remote, so it hands the packet to its gateway.', watchEventTypes: ['ROUTE_LOOKUP'] },
    { id: 'rt-2', title: 'Router longest-prefix match', narration: 'The router searches its table for the most specific match, decrements TTL and rewrites the Ethernet header for the outgoing link.', watchEventTypes: ['PACKET_FORWARDED', 'ROUTE_LOOKUP'] },
    { id: 'rt-3', title: 'Delivery', narration: 'The file server sees its own IP, accepts the packet and answers with an ICMP echo reply.', watchEventTypes: ['PACKET_RECEIVED', 'NOTE'] },
    { id: 'rt-4', title: 'TTL = 1 dies here', narration: 'A packet sent with TTL 1 makes it to the router, the decrement hits zero, and the packet is dropped — routing loops cannot live long.', watchEventTypes: ['PACKET_DROPPED'] }
  ],
  task: 'Open the Routing table inspector on the Router and find the two connected routes; then lower the TTL to 1 and watch the drop.',
  objectives: [
    'Read a routing table: destination, prefix, interface, origin.',
    'Explain how a host decides “local or gateway”.',
    'Trace a routed hop: lookup, TTL decrement, frame rewrite.'
  ],
  prerequisites: ['Lab 06 — Default Gateway'],
  expectedObservations: [
    'ROUTE_LOOKUP on the workstation matching 0.0.0.0/0 (default via 192.168.1.1)',
    'ROUTE_LOOKUP on router-1 matching 10.20.0.0/16',
    'TTL 64 at the server, and a PACKET_DROPPED “TTL expired in transit” for the TTL-1 ping'
  ],
  hints: [
    'Every hop emits a ROUTE_LOOKUP event — follow one packetId through the timeline.',
    'The TTL-1 ping is scheduled second; watch it die at the router.',
    'The router rewrites only the frame; the IP header keeps its addresses.'
  ],
  explanation: 'Every IP node forwards using a routing table: connected routes from its interfaces, plus static or learned routes. The lookup masks the destination with each entry’s prefix and keeps the most specific match. Hosts usually hold exactly two kinds — their connected network and a default route. Routers additionally decrement TTL and rebuild the frame for the outgoing link, leaving the IP addresses untouched.',
  completion: completedWhen('A packet crossed the router and arrived at the server, AND a TTL-1 packet was dropped at the router — both faces of routing.', allOf(
    (state) => routeMatched(state, 'router-1', '10.20.0.0/16'),
    (state) => ttlArrivedAt(state, 'dst-host', 63),
    (state) => dropReasonContains(state, 'TTL expired')
  ))
});

/* ------------------------------------------------------------------ */
/* 08 — Longest Prefix Matching                                        */
/* ------------------------------------------------------------------ */

const lab08: LabDefinition = numberedLab('lab-08-longest-prefix-match', 8, 'Longest Prefix Matching', {
  protocols: ['IPv4', 'Routing'],
  objective: 'Router1 holds a default route AND a specific /24 to the same destination. Watch 192.168.40.20 take the /24 — specific beats general.',
  topology: longestPrefixTopology,
  script: [
    { atMs: 0, action: 'note', nodeId: 'br-r1', message: 'Both the /24 and the default route match 192.168.40.20 — the table must break the tie' },
    { atMs: 0, action: 'send-ping', from: 'br-pc1', toIp: '192.168.40.20', ttl: 64 }
  ],
  steps: [
    { id: 'lp-1', title: 'Two candidates', narration: 'The lookup finds 192.168.40.0/24 and 0.0.0.0/0 — both contain the destination.', watchEventTypes: ['ROUTE_LOOKUP'] },
    { id: 'lp-2', title: 'Longest prefix wins', narration: '/24 beats /0 regardless of metrics. The ROUTE_LOOKUP event lists both routes and marks the winner.', watchEventTypes: ['ROUTE_LOOKUP'] },
    { id: 'lp-3', title: 'The losing route', narration: 'The default route would have sent the packet to Router3 — the wrong way. Specific beats general.', watchEventTypes: ['PACKET_FORWARDED'] }
  ],
  task: 'In the decision panel, compare the prefix lengths of the two matching routes. Which one was selected, and why did the other lose?',
  objectives: [
    'Explain longest-prefix match as the routing tie-breaker.',
    'Read the allMatches list of a ROUTE_LOOKUP event.',
    'Predict the egress interface from the winning prefix.'
  ],
  prerequisites: ['Lab 07 — Routing Table Lookup'],
  expectedObservations: [
    'A ROUTE_LOOKUP on Router1 whose allMatches lists both 192.168.40.0/24 and 0.0.0.0/0',
    'matched = 192.168.40.0/24 with prefixLength 24',
    'PACKET_FORWARDED out to-r2 (toward Router2), not to-r3'
  ],
  hints: [
    'Open the “How did the router decide?” panel after the run.',
    'Both candidates match — only the prefix length differs.',
    'A /24 is always more specific than /0, whatever the metric says.'
  ],
  explanation: 'When several routes contain a destination, longest-prefix match wins: the entry with the most network bits is the most specific description of the destination and is always preferred. Ties on prefix length fall to metric, then to stable order. This single rule lets a default route (0.0.0.0/0) coexist with precise routes everywhere in the Internet.',
  completion: completedWhen('Router1 weighed at least two candidate routes and the /24 won: the packet went toward Router2.', allOf(
    (state) => longestPrefixDecided(state, 'br-r1'),
    (state) => routeMatched(state, 'br-r1', '192.168.40.0/24'),
    (state) => receivedBy(state, 'br-server-a', 'ICMP')
  ))
});

/* ------------------------------------------------------------------ */
/* 09 — Multi-Router Routing                                           */
/* ------------------------------------------------------------------ */

const lab09: LabDefinition = numberedLab('lab-09-multi-router-routing', 9, 'Multi-Router Routing', {
  protocols: ['IPv4', 'Routing', 'ARP'],
  objective: 'Follow one packet across PC1 → Router1 → Router2 → Server and count the TTL cost of every hop; then watch the reply travel the chain in reverse.',
  topology: forwardingTopology,
  script: [
    { atMs: 0, action: 'send-ping', from: 'fwd-pc1', toIp: '192.168.2.20', ttl: 64 },
    { atMs: 600, action: 'note', nodeId: 'fwd-r2', message: 'The reply from the server now travels the chain in reverse' }
  ],
  steps: [
    { id: 'mr-1', title: 'Hop 1: Router1', narration: 'Router1 decrements 64 → 63 and matches 192.168.2.0/24 out its WAN interface.', watchEventTypes: ['ROUTE_LOOKUP'] },
    { id: 'mr-2', title: 'Hop 2: Router2', narration: 'Router2 decrements 63 → 62; 192.168.2.0/24 is connected, so the next hop is the server itself.', watchEventTypes: ['PACKET_FORWARDED'] },
    { id: 'mr-3', title: 'Delivery and reply', narration: 'The server answers; its own route table sends the reply back through Router2, Router1, PC1.', watchEventTypes: ['PACKET_RECEIVED'] }
  ],
  task: 'Select the ICMP packets at each stage in the inspector and read the TTL: what number do you see at the server, and why?',
  objectives: [
    'Trace an end-to-end path across multiple routers.',
    'Count one TTL decrement per router — and only per router.',
    'Understand that the reply path mirrors the forward path via each host’s routing table.'
  ],
  prerequisites: ['Lab 08 — Longest Prefix Matching'],
  expectedObservations: [
    'ROUTE_LOOKUP on Router1 matching 192.168.2.0/24',
    'The echo arriving at the server with TTL 62 (two router hops)',
    'A reply traversing the same routers back to PC1'
  ],
  hints: [
    'Each ROUTE_LOOKUP names its router — follow the packetId hop by hop.',
    '64 − 2 = 62: the server sees TTL 62 because exactly two routers handled it.',
    'Switches and hubs never touch TTL; only routers decrement.'
  ],
  explanation: 'IP delivery is hop-by-hop: every router repeats the same lookup → decrement → re-encapsulate procedure, and the reply depends on each host knowing its own way back. TTL exists precisely because loops in this distributed process are possible; each router spends one unit, so a packet cannot circulate forever.',
  completion: completedWhen('The echo crossed both routers and reached the server with TTL 62 — two hops, two decrements.', allOf(
    (state) => routeMatched(state, 'fwd-r1', '192.168.2.0/24'),
    (state) => ttlArrivedAt(state, 'fwd-server', 62),
    (state) => receivedBy(state, 'fwd-server', 'ICMP')
  ))
});

/* ------------------------------------------------------------------ */
/* 10 — DNS Resolution                                                 */
/* ------------------------------------------------------------------ */

const lab10: LabDefinition = numberedLab('lab-10-dns-resolution', 10, 'DNS Resolution', {
  protocols: ['DNS', 'UDP', 'IPv4', 'ARP'],
  objective: 'One name in, one address out: the Laptop asks the resolver for www.example.com and learns 203.0.113.10 over a real UDP round trip.',
  topology: dnsTopology,
  script: [
    { atMs: 0, action: 'send-dns', from: 'dns-client', name: 'www.example.com' }
  ],
  steps: [
    { id: 'dr-1', title: 'Ask the resolver', narration: 'The laptop sends a UDP datagram to port 53 with one question: the A record for www.example.com.', watchEventTypes: ['PACKET_SENT', 'PACKET_RECEIVED'] },
    { id: 'dr-2', title: 'The zone answers', narration: 'The resolver looks in its zone and builds a response with an answer record, including a TTL.', watchEventTypes: ['DNS_RESPONSE', 'PACKET_SENT'] },
    { id: 'dr-3', title: 'Client caches', narration: 'The laptop stores the record for the TTL duration, so future lookups skip the network.', watchEventTypes: ['DNS_RESPONSE', 'DNS_CACHE_WRITE', 'NOTE'] }
  ],
  task: 'Follow the query in the DNS inspector: what record type was asked, what address came back, and how long is it valid?',
  objectives: [
    'Describe a DNS query and response over UDP/53.',
    'Read an A record: name, address, TTL.',
    'Understand why the client caches the answer.'
  ],
  prerequisites: ['Lab 06 — Default Gateway'],
  expectedObservations: [
    'A DNS_QUERY for www.example.com/A on the resolver',
    'A DNS_RESPONSE answering 203.0.113.10 with a TTL',
    'A DNS_CACHE_WRITE on the Laptop'
  ],
  hints: [
    'DNS rides on UDP port 53 — select the packet and inspect the UDP and DNS layers.',
    'The answer record carries the TTL that bounds the cache lifetime.',
    'Without DNS you would have to memorize addresses instead of names.'
  ],
  explanation: 'DNS translates names people remember into addresses machines need. The client sends a UDP datagram to port 53 containing a question (name + record type); the server answers with records, each carrying a TTL that says how long the answer may be cached. The whole exchange is one request and one response — fast enough to run before every connection.',
  completion: completedWhen('The client asked for www.example.com and cached its A record 203.0.113.10.', allOf(
    (state) => eventSeen(state, 'DNS_QUERY'),
    (state) => eventSeen(state, 'DNS_RESPONSE'),
    (state) => dnsCached(state, 'dns-client', 'www.example.com')
  ))
});

/* ------------------------------------------------------------------ */
/* 11 — DNS Caching                                                    */
/* ------------------------------------------------------------------ */

const lab11: LabDefinition = numberedLab('lab-11-dns-caching', 11, 'DNS Caching', {
  protocols: ['DNS', 'UDP', 'IPv4', 'Routing'],
  objective: 'The same name is asked twice: the first lookup recurses through the resolver to the authoritative server; the second is answered from cache — remaining TTL, zero recursion.',
  topology: recursiveDnsTopology,
  script: [
    { atMs: 0, action: 'send-dns', from: 'dns-client', name: 'www.example.com', recordType: 'A' },
    { atMs: 300, action: 'note', nodeId: 'dns-resolver', message: 'The answer is now in the cache — the next ask never reaches the authoritative server' },
    { atMs: 400, action: 'send-dns', from: 'dns-client', name: 'www.example.com', recordType: 'A' }
  ],
  steps: [
    { id: 'dc-1', title: 'Cold lookup', narration: 'First ask: cache miss, recursion to the authority, answer cached at both resolver and client.', watchEventTypes: ['DNS_RECURSE', 'DNS_CACHE_WRITE'] },
    { id: 'dc-2', title: 'Warm lookup', narration: 'Second ask: the client answers from its OWN cache before any packet leaves — no query is sent at all.', watchEventTypes: ['DNS_CACHE_LOOKUP', 'NOTE'] },
    { id: 'dc-3', title: 'Count the messages', narration: 'One recursion, zero the second time. That ratio is what caches buy in the real world.', watchEventTypes: ['NOTE'] }
  ],
  task: 'Compare the two lookups in the DNS inspector: which DNS events appear twice, and which appear only once?',
  objectives: [
    'Distinguish a recursive lookup from a cached answer.',
    'Track where a DNS answer is cached (client and resolver).',
    'Explain what the record TTL buys and what it costs.'
  ],
  prerequisites: ['Lab 10 — DNS Resolution'],
  expectedObservations: [
    'Exactly one DNS_RECURSE — only the cold lookup crosses the router',
    'DNS_CACHE_WRITE on both the Resolver and the Client',
    'The second lookup shows a cache HIT and no new DNS query on the wire'
  ],
  hints: [
    'Count DNS_RECURSE events: there must be exactly one.',
    'The second lookup never builds a packet — the runner answers it from the client cache.',
    'Shorter TTLs mean fresher answers but more recursions; that is the trade-off.'
  ],
  explanation: 'Caching is DNS’s shock absorber. Every answer carries a TTL naming how long it may be reused; caches live on the client and on every resolver along the path. A warm cache answers instantly with no network traffic, and resolvers answer from cache with the remaining TTL — so popular names cost almost nothing after the first lookup.',
  completion: completedWhen('The first lookup recursed to the authority; the second was answered from the client’s cache with no recursion.', allOf(
    (state) => countEvents(state, (e) => e.type === 'DNS_RECURSE') === 1,
    (state) => dnsCached(state, 'dns-resolver', 'www.example.com'),
    (state) => dnsCached(state, 'dns-client', 'www.example.com'),
    (state) => countEvents(state, (e) => e.type === 'DNS_CACHE_LOOKUP' && e.nodeId === 'dns-client' && e.hit) >= 1
  ))
});

/* ------------------------------------------------------------------ */
/* 12 — TCP Three-Way Handshake                                        */
/* ------------------------------------------------------------------ */

const lab12: LabDefinition = numberedLab('lab-12-tcp-three-way-handshake', 12, 'TCP Three-Way Handshake', {
  protocols: ['TCP'],
  objective: 'Watch every bit of the handshake: SYN (SEQ x), SYN+ACK (SEQ y, ACK x+1), ACK (ACK y+1) — and both endpoints land in ESTABLISHED.',
  topology: tcpLabTopology,
  script: [
    { atMs: 0, action: 'tcp-open', from: 'tcp-lab-client', serverId: 'tcp-lab-server', localPort: 49152, serverPort: 80 }
  ],
  steps: [
    { id: 'th-1', title: 'SYN — CLOSED → SYN_SENT', narration: 'The client picks a deterministic initial sequence number and sends SYN. State: CLOSED → SYN_SENT.', watchEventTypes: ['TCP_STATE_CHANGE', 'PACKET_SENT'] },
    { id: 'th-2', title: 'SYN+ACK — LISTEN → SYN_RCVD', narration: 'The server answers with its own ISN and ACKs the client’s. State: LISTEN → SYN_RCVD.', watchEventTypes: ['TCP_STATE_CHANGE'] },
    { id: 'th-3', title: 'ACK — SYN_RCVD → ESTABLISHED', narration: 'The client ACKs the server’s ISN; the server enters ESTABLISHED. Both sides may send data.', watchEventTypes: ['TCP_STATE_CHANGE'] }
  ],
  task: 'Read the SEQ and ACK numbers off each segment in the inspector: whose sequence number does each ACK acknowledge?',
  objectives: [
    'Name the three handshake segments and their flags.',
    'Explain what each ACK number acknowledges.',
    'Describe both endpoints’ state transitions during the handshake.'
  ],
  prerequisites: ['Lab 05 — IPv4 Addressing'],
  expectedObservations: [
    'SYN from the client (CLOSED → SYN_SENT)',
    'SYN+ACK from the server (LISTEN → SYN_RCVD)',
    'Final ACK and both sides in ESTABLISHED'
  ],
  hints: [
    'Watch the TCP state inspector while the segments fly.',
    'Every ACK is “your last SEQ plus one” — verify it in the inspector.',
    'Only after the third segment may data flow; that is the point of the dance.'
  ],
  explanation: 'TCP is a conversation about numbers. SYN: “my sequence starts at x”. SYN+ACK: “mine starts at y, and I have your x+1”. ACK: “got your y+1”. Both sides now share two independent byte counters, which is what makes the stream reliable — lost data is noticed as a gap in the counts. Three segments are the minimum to synchronize both directions.',
  completion: completedWhen('SYN, SYN+ACK and ACK completed the handshake: both endpoints are ESTABLISHED on one connection.', allOf(
    (state) => firstTcpConnection(state)?.client.state === 'ESTABLISHED',
    (state) => firstTcpConnection(state)?.server.state === 'ESTABLISHED',
    (state) => tcpTransitionSeen(state, 'LISTEN', 'SYN_RCVD')
  ))
});

/* ------------------------------------------------------------------ */
/* 13 — TCP Sequence and ACK                                           */
/* ------------------------------------------------------------------ */

const lab13: LabDefinition = numberedLab('lab-13-tcp-sequence-ack', 13, 'TCP Sequence and ACK', {
  protocols: ['TCP'],
  objective: 'After the handshake, the client ships bytes: every data segment advances SEQ, and the server answers with ACK = SEQ + length.',
  topology: tcpLabTopology,
  script: [
    { atMs: 0, action: 'tcp-open', from: 'tcp-lab-client', serverId: 'tcp-lab-server' },
    { atMs: 400, action: 'tcp-send', from: 'tcp-lab-client', serverId: 'tcp-lab-server', text: 'hello', byteOffset: 0 },
    { atMs: 700, action: 'tcp-send', from: 'tcp-lab-client', serverId: 'tcp-lab-server', text: 'world', byteOffset: 5 }
  ],
  steps: [
    { id: 'sq-1', title: 'First bytes', narration: '“hello” leaves with the handshake ISN as SEQ. The server ACKs ISN + 5 — the next byte it expects.', watchEventTypes: ['TCP_STATE_CHANGE', 'NOTE'] },
    { id: 'sq-2', title: 'Bytes continue', narration: '“world” uses SEQ = ISN + 5: the sequence numbers count every byte. ACK arrives: ISN + 10.', watchEventTypes: ['TCP_STATE_CHANGE'] },
    { id: 'sq-3', title: 'The reliable pipe', narration: 'Each side tracks what it sent and what it owes the other — that bookkeeping IS TCP.', watchEventTypes: ['NOTE'] }
  ],
  task: 'In the inspector, verify byte accounting: does every ACK equal the peer’s last SEQ plus the bytes it carried?',
  objectives: [
    'Read SEQ and ACK as byte offsets, not packet counts.',
    'Verify ACK = SEQ + payload length on real segments.',
    'Explain why sequence numbers make loss detectable.'
  ],
  prerequisites: ['Lab 12 — TCP Three-Way Handshake'],
  expectedObservations: [
    'Two data segments (“hello”, “world”) with advancing SEQ',
    'Two server ACKs — the second exactly ISN + 10',
    'Both endpoints stay ESTABLISHED throughout'
  ],
  hints: [
    '“hello” is 5 bytes and “world” is 5 — the ACKs must differ by exactly 5.',
    'The TCP state inspector shows per-side SEQ/ACK after every event.',
    'A missing ACK would mean a lost segment — that is how retransmission is triggered.'
  ],
  explanation: 'TCP numbers every payload byte. A sender marks each segment with the offset of its first byte (SEQ); the receiver answers with the offset it expects next (ACK). Those two counters per direction are the entire reliability story: gaps demand retransmission, duplicates are dropped, and reordering is repaired by sorting on the numbers.',
  completion: completedWhen('Two data segments were sent and acknowledged with byte-accurate ACKs — the pipe stayed ESTABLISHED.', allOf(
    (state) => tcpDataAcks(state, 2),
    (state) => tcpSideIs(state, 'client', 'ESTABLISHED'),
    (state) => tcpSideIs(state, 'server', 'ESTABLISHED')
  ))
});

/* ------------------------------------------------------------------ */
/* 14 — TCP Connection Termination                                     */
/* ------------------------------------------------------------------ */

const lab14: LabDefinition = numberedLab('lab-14-tcp-termination', 14, 'TCP Connection Termination', {
  protocols: ['TCP'],
  objective: 'Four segments to say goodbye: FIN/ACK, ACK, FIN/ACK, ACK — and the client lingers in TIME_WAIT for 2·MSL before the final CLOSED.',
  topology: tcpLabTopology,
  script: [
    { atMs: 0, action: 'tcp-open', from: 'tcp-lab-client', serverId: 'tcp-lab-server' },
    { atMs: 400, action: 'tcp-close', from: 'tcp-lab-client', serverId: 'tcp-lab-server' }
  ],
  steps: [
    { id: 'tm-1', title: 'Active close — FIN_WAIT_1', narration: 'The client sends FIN: ESTABLISHED → FIN_WAIT_1. Half of the pipe is closing.', watchEventTypes: ['TCP_STATE_CHANGE'] },
    { id: 'tm-2', title: 'Server half-closes — CLOSE_WAIT', narration: 'The server ACKs the FIN but may still send: ESTABLISHED → CLOSE_WAIT. The client rests in FIN_WAIT_2.', watchEventTypes: ['TCP_STATE_CHANGE'] },
    { id: 'tm-3', title: 'Server closes — LAST_ACK', narration: 'When the server is done it sends its own FIN: CLOSE_WAIT → LAST_ACK. The client ACKs into TIME_WAIT.', watchEventTypes: ['TCP_STATE_CHANGE'] },
    { id: 'tm-4', title: 'TIME_WAIT — the last wait', narration: 'The client holds TIME_WAIT for 2·MSL (30 ms here) so a lost final ACK could still be re-sent, then CLOSED.', watchEventTypes: ['TCP_STATE_CHANGE'] }
  ],
  task: 'Why does only ONE side enter TIME_WAIT? What breaks if both sides closed instantly?',
  objectives: [
    'Walk both endpoints through the full teardown state diagram.',
    'Explain why closing is four segments, not one.',
    'Justify TIME_WAIT with the 2·MSL timer.'
  ],
  prerequisites: ['Lab 13 — TCP Sequence and ACK'],
  expectedObservations: [
    'Client: ESTABLISHED → FIN_WAIT_1 → FIN_WAIT_2 → TIME_WAIT → CLOSED',
    'Server: ESTABLISHED → CLOSE_WAIT → LAST_ACK → CLOSED',
    'A real 30 ms gap between TIME_WAIT and CLOSED'
  ],
  hints: [
    'Each FIN is acknowledged separately — count the ACK segments on the wire.',
    'The state inspector lists both endpoints; watch them close in a different order.',
    'TIME_WAIT exists so a re-sent final ACK could still be answered.'
  ],
  explanation: 'A TCP connection closes one direction at a time. Each side sends a FIN and must see it acknowledged; between the two FINs the connection is half-open, letting a server finish its last bytes. The active closer then waits 2·MSL in TIME_WAIT: if its final ACK was lost, the peer’s retransmitted FIN can still be answered instead of dying unheard.',
  completion: completedWhen('Both endpoints reached CLOSED after the full FIN exchange — and the client passed through a real TIME_WAIT.', allOf(
    (state) => tcpSideIs(state, 'client', 'CLOSED'),
    (state) => tcpSideIs(state, 'server', 'CLOSED'),
    (state) => tcpTransitionSeen(state, 'FIN_WAIT_2', 'TIME_WAIT'),
    (state) => tcpTransitionSeen(state, 'TIME_WAIT', 'CLOSED')
  ))
});

/* ------------------------------------------------------------------ */
/* 15 — HTTP GET                                                       */
/* ------------------------------------------------------------------ */

const lab15: LabDefinition = numberedLab('lab-15-http-get', 15, 'HTTP GET', {
  protocols: ['HTTP', 'TCP', 'DNS', 'ARP'],
  objective: 'The complete page load: resolve www.example.com, open a TCP connection, GET /index.html, receive 200 OK with an HTML body — then close the connection cleanly.',
  topology: httpTopology,
  script: [
    { atMs: 0, action: 'send-http', from: 'http-client', serverName: 'www.example.com', path: '/index.html', resolveFirst: true }
  ],
  steps: [
    { id: 'hg-1', title: 'Resolve the name', narration: 'DNS comes first: the client asks the resolver for www.example.com and caches the answer.', watchEventTypes: ['DNS_QUERY', 'DNS_RESPONSE'] },
    { id: 'hg-2', title: 'Open the pipe', narration: 'TCP handshake: SYN, SYN+ACK, ACK. The reliable byte stream exists before any HTTP is written.', watchEventTypes: ['TCP_STATE_CHANGE'] },
    { id: 'hg-3', title: 'GET and 200 OK', narration: 'The request line “GET /index.html HTTP/1.1” rides a TCP segment; the server answers “HTTP/1.1 200 OK” with the body.', watchEventTypes: ['HTTP_REQUEST', 'HTTP_RESPONSE'] },
    { id: 'hg-4', title: 'Say goodbye', narration: 'Connection termination: FIN, ACK, FIN, ACK — the full lifecycle in one run.', watchEventTypes: ['TCP_STATE_CHANGE'] }
  ],
  task: 'Follow the lifecycle in the inspectors: which layer speaks first, and which layer says goodbye?',
  objectives: [
    'Name the request line and the required Host header of an HTTP GET.',
    'Recognize a 200 OK response and its content type.',
    'Order the protocols of a page load: DNS → TCP → HTTP → teardown.'
  ],
  prerequisites: ['Lab 11 — DNS Caching', 'Lab 12 — TCP Three-Way Handshake'],
  expectedObservations: [
    'A DNS exchange before any TCP',
    'HTTP_REQUEST “GET /index.html” with Host: www.example.com',
    'HTTP_RESPONSE 200 OK (text/html) and a clean FIN teardown'
  ],
  hints: [
    'The packet chips label each run — find the GET and the 200 OK.',
    'HTTP needs an ESTABLISHED connection first; watch the state inspector.',
    'After the response the client still ACKs it — every byte is counted.'
  ],
  explanation: 'HTTP is a plain-text request/response protocol that assumes a reliable byte stream. The client opens a TCP connection to port 80, sends a request line plus headers (“GET /path HTTP/1.1”, “Host: …”), and the server answers with a status line, headers and a body. When the page is delivered, the connection closes with the standard FIN exchange.',
  completion: completedWhen('A full HTTP exchange happened: GET /index.html out, 200 OK back, over an ESTABLISHED connection.', allOf(
    (state) => httpExchange(state, 'GET', 200),
    (state) => tcpTransitionSeen(state, 'SYN_RCVD', 'ESTABLISHED')
  ))
});

/* ------------------------------------------------------------------ */
/* 16 — HTTP Response                                                  */
/* ------------------------------------------------------------------ */

const lab16: LabDefinition = numberedLab('lab-16-http-response', 16, 'HTTP Response', {
  protocols: ['HTTP', 'TCP'],
  objective: 'Zoom in on the server’s answer: status line 200 OK, Content-Type text/html, the HTML body — and the client’s ACK counting every byte.',
  topology: httpTopology,
  script: [
    { atMs: 0, action: 'send-http', from: 'http-client', serverName: 'www.example.com', path: '/page.html', resolveFirst: false }
  ],
  steps: [
    { id: 'hr-1', title: 'The request that asks', narration: '“GET /page.html HTTP/1.1” is the question — without it no response exists.', watchEventTypes: ['HTTP_REQUEST'] },
    { id: 'hr-2', title: 'Status line', narration: '“HTTP/1.1 200 OK” says the request succeeded. The status code is the protocol’s verdict.', watchEventTypes: ['HTTP_RESPONSE'] },
    { id: 'hr-3', title: 'Body and acknowledgement', narration: 'The server returns text/html with the page body; the client answers with ACK = SEQ + length.', watchEventTypes: ['TCP_STATE_CHANGE'] }
  ],
  task: 'Select the response packet and find the status line, the Content-Type header and the first bytes of the body.',
  objectives: [
    'Read the three parts of an HTTP response: status line, headers, body.',
    'Interpret the 200 status code and the text/html content type.',
    'Connect HTTP responses to TCP acknowledgements.'
  ],
  prerequisites: ['Lab 15 — HTTP GET'],
  expectedObservations: [
    'HTTP_RESPONSE 200 OK with content type text/html',
    'The response travels inside a TCP segment (ACK+PSH flags)',
    'The client emits “data received” bookkeeping and ACKs the body'
  ],
  hints: [
    'The HTTP inspector shows the full status line and headers of the selected packet.',
    'One TCP segment may carry the whole small body — ACKs still count its bytes.',
    'Status codes are grouped: 2xx success, 3xx redirects, 4xx client errors, 5xx server errors.'
  ],
  explanation: 'A response is the server’s verdict plus the goods: a status line (“HTTP/1.1 200 OK”), headers describing the payload (Content-Type, Content-Length), and the body itself. HTTP itself has no delivery guarantees — the bytes ride inside TCP segments, and each one is acknowledged like any other data.',
  completion: completedWhen('The server answered 200 OK with an HTML body and the client acknowledged every byte of it.', allOf(
    (state) => httpResponseSeen(state, 200),
    (state) => httpRequestSeen(state, 'GET'),
    (state) => tcpDataAcks(state, 1)
  ))
});

/* ------------------------------------------------------------------ */
/* 17 — Protocol Encapsulation                                         */
/* ------------------------------------------------------------------ */

const lab17: LabDefinition = numberedLab('lab-17-protocol-encapsulation', 17, 'Protocol Encapsulation', {
  protocols: ['HTTP', 'TCP', 'IPv4', 'Ethernet', 'DNS', 'ARP'],
  objective: 'One GET, five layers: Ethernet frames carry IP datagrams carry TCP segments carry HTTP — plus DNS and ARP setting the stage. Watch it all in one run.',
  topology: httpTopology,
  script: [
    { atMs: 0, action: 'send-http', from: 'http-client', serverName: 'www.example.com', path: '/index.html', resolveFirst: true }
  ],
  steps: [
    { id: 'en-1', title: 'The stage crew', narration: 'DNS resolves the name; ARP resolves the MAC. Neither carries page data, but nothing works without them.', watchEventTypes: ['DNS_RESPONSE', 'ARP_REPLY'] },
    { id: 'en-2', title: 'The envelope stack', narration: 'Select the HTTP response packet and walk outward: HTTP → TCP → IPv4 → Ethernet. Every layer adds exactly one header.', watchEventTypes: ['HTTP_RESPONSE', 'PACKET_SENT'] },
    { id: 'en-3', title: 'Symmetry of teardown', narration: 'The connection closes with the same care it opened: FIN, ACK, FIN, ACK, TIME_WAIT.', watchEventTypes: ['TCP_STATE_CHANGE'] }
  ],
  task: 'Open the packet inspector on the response and list every header you can find, outermost to innermost. Which layer has no header of its own here?',
  objectives: [
    'Define encapsulation as one layer’s payload being the next layer down’s data.',
    'Name all four headers around one HTTP message.',
    'Identify the supporting protocols (DNS, ARP) that make the journey possible.'
  ],
  prerequisites: ['Lab 15 — HTTP GET', 'Lab 16 — HTTP Response'],
  expectedObservations: [
    'DNS and ARP traffic before the connection',
    'A packet whose inspector shows HTTP → TCP → IPv4 → Ethernet',
    'The full lifecycle: handshake, GET, 200 OK, FIN exchange'
  ],
  hints: [
    'The protocol-stack view nests the layers visually — use it on the response packet.',
    'Each layer adds a header, never a trailer, in this stack.',
    'DNS and ARP never carry page bytes; they prepare addresses.'
  ],
  explanation: 'Encapsulation is the layering trick that makes the Internet composable: HTTP hands its message to TCP, which wraps it in a segment; TCP hands the segment to IP, which wraps it in a datagram; IP hands the datagram to Ethernet, which frames it for the wire. The receiver unwraps in reverse. Each layer’s payload is the layer above’s whole message — headers stack like envelopes.',
  completion: completedWhen('The run contains a real HTTP message nested in TCP inside IPv4 inside Ethernet — encapsulation in the flesh.', allOf(
    (state) => encapsulatedHttp(state),
    (state) => httpExchange(state, 'GET', 200),
    (state) => eventSeen(state, 'DNS_RESPONSE'),
    (state) => eventSeen(state, 'ARP_REPLY')
  ))
});

/* ------------------------------------------------------------------ */
/* 18 — Complete Web Request                                           */
/* ------------------------------------------------------------------ */

const lab18: LabDefinition = numberedLab('lab-18-complete-web-request', 18, 'Complete Web Request', {
  protocols: ['HTTP', 'DNS', 'ARP', 'TCP', 'IPv4', 'Routing', 'Ethernet'],
  objective: 'The final exam: the student opens http://example.local/index.html and every layer of the flagship journey does its job — DNS, ARP, routing, TCP, HTTP, teardown — across a real router.',
  topology: webTopology,
  script: [
    { atMs: 0, action: 'note', nodeId: 'web-browser', message: 'The student pressed Enter: http://example.local/index.html' },
    { atMs: 0, action: 'send-http', from: 'web-browser', serverName: 'example.local', path: '/index.html', resolveFirst: true }
  ],
  steps: [
    { id: 'j-1', title: '1 · DNS resolution', narration: 'Before anything else the browser needs the IP behind example.local. A UDP query flies to the resolver on the LAN and comes back with 172.30.0.20.', watchEventTypes: ['DNS_QUERY', 'DNS_RESPONSE'] },
    { id: 'j-2', title: '2 · ARP resolution', narration: 'Frames speak MAC, not IP. ARP asks who has 172.20.0.1 — the default gateway — so the very first frame can be addressed.', watchEventTypes: ['ARP_REQUEST', 'ARP_REPLY'] },
    { id: 'j-3', title: '3 · Routing', narration: 'The server is on another subnet. The client hands the packet to its gateway; the router picks the route toward 172.30.0.0/24.', watchEventTypes: ['ROUTE_LOOKUP'] },
    { id: 'j-4', title: '4 · TCP handshake', narration: 'SYN, SYN+ACK, ACK: the client and the server agree ports and sequence numbers. The reliable pipe exists before any HTTP.', watchEventTypes: ['TCP_STATE_CHANGE'] },
    { id: 'j-5', title: '5 · HTTP GET', narration: '“GET /index.html HTTP/1.1” travels inside a TCP segment with ACK+PSH flags — HTTP is just bytes to TCP.', watchEventTypes: ['HTTP_REQUEST'] },
    { id: 'j-6', title: '6 · HTTP response', narration: 'The server answers “HTTP/1.1 200 OK” with Content-Type text/html and the page body.', watchEventTypes: ['HTTP_RESPONSE'] },
    { id: 'j-7', title: '7 · Data & acknowledgements', narration: 'Every byte is counted: the client ACKs the page with ACK = SEQ + length. That bookkeeping is what makes TCP reliable.', watchEventTypes: ['PACKET_SENT', 'TCP_STATE_CHANGE'] },
    { id: 'j-8', title: '8 · Termination', narration: 'Four segments to say goodbye — FIN, ACK, FIN, ACK — and the client waits in TIME_WAIT before the final CLOSED.', watchEventTypes: ['TCP_STATE_CHANGE'] }
  ],
  task: 'Pause anywhere, select a packet, and answer for it: what happened, why, which protocol, what was added, what changed, who decided?',
  objectives: [
    'Narrate a complete web request at every layer, in order.',
    'Point at the wire evidence for each stage in the timeline.',
    'Explain what the router changes (frame) and what it preserves (IP addresses).'
  ],
  prerequisites: [
    'Lab 11 — DNS Caching',
    'Lab 12 — TCP Three-Way Handshake',
    'Lab 15 — HTTP GET',
    'Lab 17 — Protocol Encapsulation'
  ],
  expectedObservations: [
    'DNS for example.local answering 172.30.0.20',
    'ARP for the gateway 172.20.0.1 and, on the router, for 172.30.0.20',
    'ROUTE_LOOKUP toward 172.30.0.20 on the Router',
    'A full TCP lifecycle and a 200 OK HTML response'
  ],
  hints: [
    'Follow one packetId through all hops — the journey panel stages light up in order.',
    'The frame changes at the router; the IP destination never does.',
    'Everything you learned in Labs 01–17 happens here, once, in order.'
  ],
  explanation: 'A web request is the curriculum in one act: DNS turns the name into an address, ARP turns the address into a MAC, routing walks the packet across subnets, TCP builds a reliable pipe, HTTP speaks over it, and both sides close politely. Every layer depends on the ones below it — which is exactly why networks are layered at all.',
  completion: completedWhen('The complete journey finished: DNS, ARP, routing, a full TCP lifecycle with 200 OK, and a clean close.', allOf(
    (state) => dnsCached(state, 'web-browser', 'example.local'),
    (state) => arpEntry(state, 'web-browser', '172.20.0.1'),
    (state) => arpEntry(state, 'web-router', '172.30.0.20'),
    (state) => eventSeen(state, 'ROUTE_LOOKUP'),
    (state) => tcpTransitionSeen(state, 'TIME_WAIT', 'CLOSED'),
    (state) => httpExchange(state, 'GET', 200)
  ))
});

/* ------------------------------------------------------------------ */
/* Registry                                                            */
/* ------------------------------------------------------------------ */

export const numberedLabs: readonly LabDefinition[] = [
  lab01,
  lab02,
  lab03,
  lab04,
  lab05,
  lab06,
  lab07,
  lab08,
  lab09,
  lab10,
  lab11,
  lab12,
  lab13,
  lab14,
  lab15,
  lab16,
  lab17,
  lab18
];

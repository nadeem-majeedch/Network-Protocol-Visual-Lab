/**
 * Lab registry: the full catalog of guided labs.
 * Every lab executes against the same NetworkEngine as the interactive
 * simulator — there is no bespoke lab runtime.
 *
 * Order: the flagship journey first (it is the default lab and the app's
 * centerpiece), then the numbered curriculum Lab 01 – Lab 18, then the
 * original topical catalog (still fully supported inside the framework).
 */

import type { LabDefinition } from './types';
import { numberedLabs } from './numbered';
import { arpTopology, dnsTopology, ethernetTopology, httpTopology, routingTopology, tcpTopology, ttlTopology } from './topologies';
import { gatewayTopology } from './gateway-topology';
import { recursiveDnsTopology } from './dns-topology';
import { tcpLabTopology } from './tcp-topology';
import { webTopology } from './web-topology';
import {
  forwardingTopology,
  localDeliveryTopology,
  longestPrefixTopology,
  staticRoutesTopology
} from './forwarding-topologies';

const gatewayLab: LabDefinition = {
  id: 'gateway-arp',
  title: 'ARP — discover the default gateway',
  protocols: ['ARP', 'Ethernet', 'MAC'],
  objective:
    'PC1 (192.168.1.10) must send to its default gateway (192.168.1.1) but only knows the IP. Watch the complete ARP exchange fill the gap.',
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
    { id: 'gw-6', title: 'PC1 receives the reply', narration: 'The switch forwards the unicast reply — a MAC table hit, not a flood this time.', watchEventTypes: ['PACKET_RECEIVED'] },
    { id: 'gw-7', title: 'Cache updated', narration: 'PC1 writes 192.168.1.1 ⇔ 02:00:00:0a:00:21 into its ARP cache and releases the held packet, now addressed to the learned MAC.', watchEventTypes: ['ARP_WRITE'] },
    { id: 'gw-8', title: 'Subsequent traffic is direct', narration: 'The second ping needs no ARP at all: the cache supplies the MAC instantly. That is why ARP exists — ask once, reuse many times.', watchEventTypes: ['NOTE'] }
  ],
  task: 'Inspect the ARP cache panel before and after the exchange, then explain why the second ping shows no ARP_REQUEST.'
};

const localDeliveryLab: LabDefinition = {
  id: 'local-delivery',
  title: 'Routing — local network delivery',
  protocols: ['IPv4', 'Ethernet', 'ARP'],
  objective:
    'Two hosts on one subnet need no router at all: watch the frame go straight to the destination MAC after one ARP exchange.',
  topology: localDeliveryTopology,
  script: [
    { atMs: 0, action: 'note', nodeId: 'ld-pc1', message: 'PC1 checks its routing table: 192.168.1.20 is ON-LINK — no router involved' },
    { atMs: 0, action: 'send-ping', from: 'ld-pc1', toIp: '192.168.1.20', ttl: 64 }
  ],
  steps: [
    { id: 'ld-1', title: 'On-link decision', narration: 'PC1 masks 192.168.1.20 with /24: same network. The route is “connected” — the next hop IS the destination.', watchEventTypes: ['ROUTE_LOOKUP'] },
    { id: 'ld-2', title: 'ARP for the neighbor', narration: 'Because the destination is on-link, PC1 asks ARP for 192.168.1.20 itself, not for a gateway.', watchEventTypes: ['ARP_REQUEST'] },
    { id: 'ld-3', title: 'Direct frame', narration: 'One switch, one hop, TTL still 64 — nothing routed, nothing decremented.', watchEventTypes: ['PACKET_RECEIVED', 'NOTE'] }
  ],
  task: 'Compare this with the “Default gateway” lab: what is missing here, and why does the ping still succeed?'
};

const gatewayRoutingLab: LabDefinition = {
  id: 'gateway-routing',
  title: 'Routing — through the default gateway',
  protocols: ['IPv4', 'Routing', 'ARP'],
  objective:
    'PC1 cannot reach 192.168.2.20 alone: its connected route misses, so the default route hands the packet to Router1.',
  topology: forwardingTopology,
  script: [
    { atMs: 0, action: 'note', nodeId: 'fwd-pc1', message: 'PC1 has no route to 192.168.2.0/24 — only a default route via 192.168.1.1' },
    { atMs: 0, action: 'send-ping', from: 'fwd-pc1', toIp: '192.168.2.20', ttl: 64 }
  ],
  steps: [
    { id: 'gr-1', title: 'No connected route', narration: '192.168.2.20 is outside PC1\'s /24. The only candidate is the default route 0.0.0.0/0.', watchEventTypes: ['ROUTE_LOOKUP'] },
    { id: 'gr-2', title: 'Next hop = gateway', narration: 'The default route\'s next hop is 192.168.1.1 — PC1 ARPs for its gateway, not for the server.', watchEventTypes: ['ARP_REQUEST'] },
    { id: 'gr-3', title: 'Frame to the MAC of Router1', narration: 'The frame carries the server\'s IP but Router1\'s MAC — that is what a gateway is.', watchEventTypes: ['PACKET_SENT', 'PACKET_RECEIVED'] },
    { id: 'gr-4', title: 'Routers take over', narration: 'From here the packet is in the routers\' hands: watch TTL drop to 62 at the server.', watchEventTypes: ['PACKET_FORWARDED'] }
  ],
  task: 'Remove PC1\'s default route mentally: what event would replace ROUTE_LOOKUP, and where would the packet die?'
};

const staticRoutesLab: LabDefinition = {
  id: 'static-routes',
  title: 'Routing — static routes branch the path',
  protocols: ['IPv4', 'Routing'],
  objective:
    'Router1 holds two static routes: 192.168.40.0/24 points left to Router2, 192.168.60.0/24 points right to Router3.',
  topology: staticRoutesTopology,
  script: [
    { atMs: 0, action: 'send-ping', from: 'br-pc1', toIp: '192.168.40.20', ttl: 64 },
    { atMs: 300, action: 'note', nodeId: 'br-r1', message: 'Same router, different route: the next ping will leave through a different interface' },
    { atMs: 400, action: 'send-ping', from: 'br-pc1', toIp: '192.168.60.20', ttl: 64 }
  ],
  steps: [
    { id: 'sr-1', title: 'Static route to Server A', narration: 'Router1 matches 192.168.40.0/24 and forwards out to-r2 toward 10.50.0.2.', watchEventTypes: ['ROUTE_LOOKUP', 'PACKET_FORWARDED'] },
    { id: 'sr-2', title: 'A second destination', narration: '192.168.60.20 arrives at the same router but matches a different static route.', watchEventTypes: ['ROUTE_LOOKUP'] },
    { id: 'sr-3', title: 'Different interface', narration: 'This route egresses to-r3 — same device, different decision, purely because the table says so.', watchEventTypes: ['PACKET_FORWARDED'] }
  ],
  task: 'Open the Routing table inspector on Router1 and find the two static routes that split the traffic.'
};

const multiRouterLab: LabDefinition = {
  id: 'multi-router',
  title: 'Routing — two routers, hop by hop',
  protocols: ['IPv4', 'Routing', 'ARP'],
  objective:
    'Follow one packet across PC1 → Router1 → Router2 → Server and count the TTL cost of every hop.',
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
  task: 'Select the ICMP packets at each stage in the inspector and read the TTL: what number do you see at the server, and why?'
};

const longestPrefixLab: LabDefinition = {
  id: 'longest-prefix',
  title: 'Routing — longest prefix match wins',
  protocols: ['IPv4', 'Routing'],
  objective:
    'Router1 holds a default route AND a specific /24 to the same server network. Watch 192.168.40.20 take the /24, not the default.',
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
  task: 'In the decision panel, compare the prefix lengths of the two matching routes. Which one was selected, and why did the other lose?'
};

const arpLab: LabDefinition = {
  id: 'arp',
  title: 'ARP — finding a MAC address',
  protocols: ['ARP', 'Ethernet', 'MAC'],
  objective: 'Watch ARP translate an IPv4 address into a MAC address before any unicast frame can be sent.',
  topology: arpTopology,
  script: [
    { atMs: 0, action: 'send-arp', from: 'host-1', targetIp: '10.0.0.12' },
    { atMs: 400, action: 'note', nodeId: 'host-1', message: 'ARP cache complete — unicast traffic can begin' }
  ],
  steps: [
    { id: 'arp-1', title: 'Broadcast the question', narration: 'Host 1 needs the MAC for 10.0.0.12, so it broadcasts an ARP request to ff:ff:ff:ff:ff:ff.', watchEventTypes: ['NOTE', 'PACKET_SENT'] },
    { id: 'arp-2', title: 'The target answers', narration: 'Host 2 recognizes its own IP and unicasts an ARP reply containing its MAC address.', watchEventTypes: ['PACKET_RECEIVED', 'ARP_LEARN'] },
    { id: 'arp-3', title: 'Cache and continue', narration: 'Both hosts store the IP↔MAC binding. Subsequent frames go straight to the destination.', watchEventTypes: ['ARP_WRITE', 'NOTE'] }
  ],
  task: 'Trigger a second exchange and confirm no ARP request is needed the second time.'
};

const dnsALab: LabDefinition = {
  id: 'dns-a-record',
  title: 'DNS — resolve an A record',
  protocols: ['DNS', 'UDP', 'IPv4'],
  objective:
    'A full recursive lookup: Client asks Resolver, Resolver misses its cache, asks the Authoritative server across the router, and returns 93.184.216.34.',
  topology: recursiveDnsTopology,
  script: [
    { atMs: 0, action: 'note', nodeId: 'dns-client', message: 'The Client needs the address of www.example.com — its cache is empty' },
    { atMs: 0, action: 'send-dns', from: 'dns-client', name: 'www.example.com', recordType: 'A' }
  ],
  steps: [
    { id: 'da-1', title: 'Query creation', narration: 'The Client builds a UDP datagram for port 53: one question, A record for www.example.com.', watchEventTypes: ['DNS_QUERY', 'PACKET_SENT'] },
    { id: 'da-2', title: 'Resolver cache miss', narration: 'The Resolver checks its cache first — empty — so it must recurse.', watchEventTypes: ['DNS_CACHE_LOOKUP', 'DNS_RECURSE'] },
    { id: 'da-3', title: 'Authoritative lookup', narration: 'Across the router, the Authoritative server finds www.example.com A 93.184.216.34 (ttl 120) in its zone.', watchEventTypes: ['DNS_QUERY', 'DNS_RESPONSE'] },
    { id: 'da-4', title: 'Cache update & answer', narration: 'The Resolver caches the record and answers the Client, which caches it too.', watchEventTypes: ['DNS_CACHE_WRITE', 'DNS_RESPONSE'] }
  ],
  task: 'Follow the query in the DNS inspector: which node cached the answer first, and with what TTL?'
};

const dnsCacheLab: LabDefinition = {
  id: 'dns-caching',
  title: 'DNS — observe caching',
  protocols: ['DNS', 'UDP', 'IPv4'],
  objective:
    'The same name is asked twice: the first lookup crosses the router, the second is answered from the resolver\'s cache — no recursion at all.',
  topology: recursiveDnsTopology,
  script: [
    { atMs: 0, action: 'send-dns', from: 'dns-client', name: 'www.example.com', recordType: 'A' },
    { atMs: 300, action: 'note', nodeId: 'dns-resolver', message: 'The answer is now in the cache — the next ask never reaches the authoritative server' },
    { atMs: 400, action: 'send-dns', from: 'dns-client', name: 'www.example.com', recordType: 'A' }
  ],
  steps: [
    { id: 'dc-1', title: 'Cold lookup', narration: 'First ask: cache miss, recursion to the authority, answer cached at both resolver and client.', watchEventTypes: ['DNS_RECURSE', 'DNS_CACHE_WRITE'] },
    { id: 'dc-2', title: 'Warm lookup', narration: 'Second ask: the resolver answers from cache with the REMAINING TTL — watch DNS_RECURSE stay absent.', watchEventTypes: ['DNS_CACHE_LOOKUP', 'DNS_RESPONSE'] },
    { id: 'dc-3', title: 'Count the messages', narration: 'One recursion, zero the second time. That ratio is what caches buy in the real world.', watchEventTypes: ['NOTE'] }
  ],
  task: 'Compare the two DNS_RESPONSE events: which fields differ, and why is the second TTL smaller?'
};

const dnsCnameLab: LabDefinition = {
  id: 'dns-cname',
  title: 'DNS — resolve a CNAME',
  protocols: ['DNS', 'UDP', 'IPv4'],
  objective:
    'cdn.example.com is an alias for www.example.com. The resolver chases the CNAME chain before it can hand the client a real address.',
  topology: recursiveDnsTopology,
  script: [
    { atMs: 0, action: 'send-dns', from: 'dns-client', name: 'cdn.example.com', recordType: 'A' }
  ],
  steps: [
    { id: 'dn-1', title: 'Ask the alias', narration: 'The Client asks for cdn.example.com — it expects an address, not another name.', watchEventTypes: ['DNS_QUERY'] },
    { id: 'dn-2', title: 'The alias answers', narration: 'The authority reveals: cdn.example.com is a CNAME for www.example.com (ttl 60).', watchEventTypes: ['DNS_RESPONSE'] },
    { id: 'dn-3', title: 'Chase the chain', narration: 'The Resolver caches the alias and immediately recurses for the target name.', watchEventTypes: ['DNS_CACHE_WRITE', 'DNS_RECURSE'] },
    { id: 'dn-4', title: 'The real address', narration: 'www.example.com resolves to 93.184.216.34 — the Client finally gets its A record.', watchEventTypes: ['DNS_RESPONSE'] }
  ],
  task: 'Open the DNS cache inspector: which entry holds the alias, and which holds the address?'
};

const dnsCompareLab: LabDefinition = {
  id: 'dns-cache-compare',
  title: 'DNS — cached vs uncached lookup',
  protocols: ['DNS', 'UDP', 'IPv4'],
  objective:
    'Two clients ask the same name back to back: Client 1 pays the full recursive price, Client 2\'s answer comes from the resolver\'s cache.',
  topology: recursiveDnsTopology,
  script: [
    { atMs: 0, action: 'send-dns', from: 'dns-client', name: 'www.example.com', recordType: 'A' },
    { atMs: 500, action: 'send-dns', from: 'dns-client2', name: 'www.example.com', recordType: 'A' }
  ],
  steps: [
    { id: 'dp-1', title: 'Client 1 pays full price', narration: 'Miss at the resolver, recursion across the router, answer from the authority.', watchEventTypes: ['DNS_RECURSE'] },
    { id: 'dp-2', title: 'Client 2 rides the cache', narration: 'Same name, different client: the resolver answers instantly from its cache — remaining TTL, no recursion.', watchEventTypes: ['DNS_CACHE_LOOKUP', 'DNS_RESPONSE'] },
    { id: 'dp-3', title: 'Why caches exist', narration: 'Every nameserver between you and the authority does exactly this. The cache is the internet\'s shock absorber.', watchEventTypes: ['NOTE'] }
  ],
  task: 'Count UDP packets per lookup in the packet inspector. What does Client 2 save, and who paid for it?'
};

const tcpHandshakeLab: LabDefinition = {
  id: 'tcp-handshake',
  title: 'TCP — the three-way handshake',
  protocols: ['TCP'],
  objective:
    'Watch every bit of the handshake: SYN (SEQ x), SYN+ACK (SEQ y, ACK x+1), ACK (ACK y+1) — and both endpoints land in ESTABLISHED.',
  topology: tcpLabTopology,
  script: [
    { atMs: 0, action: 'tcp-open', from: 'tcp-lab-client', serverId: 'tcp-lab-server', localPort: 49152, serverPort: 80 }
  ],
  steps: [
    { id: 'th-1', title: 'SYN — CLOSED → SYN_SENT', narration: 'The client picks a deterministic initial sequence number and sends SYN. State: CLOSED → SYN_SENT.', watchEventTypes: ['TCP_STATE_CHANGE', 'PACKET_SENT'] },
    { id: 'th-2', title: 'SYN+ACK — LISTEN → SYN_RCVD', narration: 'The server answers with its own ISN and ACKs the client\'s. State: LISTEN → SYN_RCVD.', watchEventTypes: ['TCP_STATE_CHANGE'] },
    { id: 'th-3', title: 'ACK — SYN_RCVD → ESTABLISHED', narration: 'The client ACKs the server\'s ISN; the server enters ESTABLISHED. Both sides may send data.', watchEventTypes: ['TCP_STATE_CHANGE'] }
  ],
  task: 'Read the SEQ and ACK numbers off each segment in the inspector: whose sequence number does each ACK acknowledge?'
};

const tcpDataLab: LabDefinition = {
  id: 'tcp-data',
  title: 'TCP — data transfer',
  protocols: ['TCP'],
  objective:
    'After the handshake, the client ships bytes: every data segment advances SEQ, and the server answers with ACK = SEQ + length.',
  topology: tcpLabTopology,
  script: [
    { atMs: 0, action: 'tcp-open', from: 'tcp-lab-client', serverId: 'tcp-lab-server' },
    { atMs: 400, action: 'tcp-send', from: 'tcp-lab-client', serverId: 'tcp-lab-server', text: 'hello', byteOffset: 0 },
    { atMs: 700, action: 'tcp-send', from: 'tcp-lab-client', serverId: 'tcp-lab-server', text: 'world', byteOffset: 5 }
  ],
  steps: [
    { id: 'td-1', title: 'First bytes', narration: '“hello” leaves with the handshake ISN as SEQ. The server ACKs ISN + 5 — the next byte it expects.', watchEventTypes: ['TCP_STATE_CHANGE', 'NOTE'] },
    { id: 'td-2', title: 'Bytes continue', narration: '“world” uses SEQ = ISN + 5: the sequence numbers count every byte. ACK arrives: ISN + 10.', watchEventTypes: ['TCP_STATE_CHANGE'] },
    { id: 'td-3', title: 'The reliable pipe', narration: 'Each side tracks what it sent and what it owes the other — that bookkeeping IS TCP.', watchEventTypes: ['NOTE'] }
  ],
  task: 'In the inspector, verify byte accounting: does every ACK equal the peer\'s last SEQ plus the bytes it carried?'
};

const tcpAckLab: LabDefinition = {
  id: 'tcp-ack',
  title: 'TCP — acknowledgement',
  protocols: ['TCP'],
  objective:
    'The server talks back: watch the reverse data flow and how each side ACKs the other — one sequence space per direction.',
  topology: tcpLabTopology,
  script: [
    { atMs: 0, action: 'tcp-open', from: 'tcp-lab-client', serverId: 'tcp-lab-server' },
    { atMs: 400, action: 'tcp-send', from: 'tcp-lab-client', serverId: 'tcp-lab-server', text: 'ready?', byteOffset: 0 },
    { atMs: 800, action: 'tcp-send', from: 'tcp-lab-server', serverId: 'tcp-lab-client', text: 'ready!', byteOffset: 0 }
  ],
  steps: [
    { id: 'ta-1', title: 'Client speaks', narration: 'The client\'s “ready?” is ACKed by the server — SEQ space #1 (client → server).', watchEventTypes: ['TCP_STATE_CHANGE', 'NOTE'] },
    { id: 'ta-2', title: 'Server answers', narration: '“ready!” flows back with the SERVER\'s own ISN — a completely separate sequence space.', watchEventTypes: ['TCP_STATE_CHANGE'] },
    { id: 'ta-3', title: 'Two counters', narration: 'Each endpoint keeps an outgoing SEQ and an expected ACK for the other side. Both are visible in the inspector.', watchEventTypes: ['NOTE'] }
  ],
  task: 'Compare the two directions: whose ISN appears in the server\'s data segment, and what does the client ACK back?'
};

const tcpTeardownLab: LabDefinition = {
  id: 'tcp-teardown',
  title: 'TCP — connection termination',
  protocols: ['TCP'],
  objective:
    'Four segments to say goodbye: FIN/ACK, ACK, FIN/ACK, ACK — and the client lingers in TIME_WAIT before the final CLOSED.',
  topology: tcpLabTopology,
  script: [
    { atMs: 0, action: 'tcp-open', from: 'tcp-lab-client', serverId: 'tcp-lab-server' },
    { atMs: 400, action: 'tcp-close', from: 'tcp-lab-client', serverId: 'tcp-lab-server' }
  ],
  steps: [
    { id: 'tt-1', title: 'Active close — FIN_WAIT_1', narration: 'The client sends FIN: ESTABLISHED → FIN_WAIT_1. Half of the pipe is closing.', watchEventTypes: ['TCP_STATE_CHANGE'] },
    { id: 'tt-2', title: 'Server half-closes — CLOSE_WAIT', narration: 'The server ACKs the FIN but may still send: ESTABLISHED → CLOSE_WAIT. The client rests in FIN_WAIT_2.', watchEventTypes: ['TCP_STATE_CHANGE'] },
    { id: 'tt-3', title: 'Server closes — LAST_ACK', narration: 'When the server is done it sends its own FIN: CLOSE_WAIT → LAST_ACK. The client ACKs into TIME_WAIT.', watchEventTypes: ['TCP_STATE_CHANGE'] },
    { id: 'tt-4', title: 'TIME_WAIT — the last wait', narration: 'The client holds TIME_WAIT for 2·MSL (30 ms here) so a lost final ACK could still be re-sent, then CLOSED.', watchEventTypes: ['TCP_STATE_CHANGE'] }
  ],
  task: 'Why does only ONE side enter TIME_WAIT? What breaks if both sides closed instantly?'
};

const openWebPageLab: LabDefinition = {
  id: 'open-web-page',
  title: 'Open a Web Page — the complete journey',
  protocols: ['HTTP', 'DNS', 'ARP', 'TCP', 'IPv4', 'Routing', 'Ethernet'],
  objective:
    'The student opens http://example.local/index.html and watches every layer do its job: DNS, ARP, routing, the TCP handshake, the GET, the 200 OK, the data exchange, and the teardown — across a real router.',
  topology: webTopology,
  script: [
    { atMs: 0, action: 'note', nodeId: 'web-browser', message: 'The student pressed Enter: http://example.local/index.html' },
    { atMs: 0, action: 'send-http', from: 'web-browser', serverName: 'example.local', path: '/index.html', resolveFirst: true }
  ],
  steps: [
    { id: 'j-1', title: '1 · DNS resolution', narration: 'Before anything else the browser needs the IP behind example.local. A UDP query flies to the resolver on the LAN and comes back with 172.30.0.20.', watchEventTypes: ['DNS_QUERY', 'DNS_RESPONSE'] },
    { id: 'j-2', title: '2 · ARP resolution', narration: 'Frames speak MAC, not IP. ARP asks who has 172.20.0.1 — the default gateway — so the very first frame can be addressed.', watchEventTypes: ['ARP_REQUEST', 'ARP_REPLY'] },
    { id: 'j-3', title: '3 · Routing', narration: 'The server is on another subnet. The client hands the packet to its gateway; the router picks the longest-prefix route toward 172.30.0.0/24.', watchEventTypes: ['ROUTE_LOOKUP'] },
    { id: 'j-4', title: '4 · TCP handshake', narration: 'SYN, SYN+ACK, ACK: the client and the server agree ports and sequence numbers. The reliable pipe exists before any HTTP.', watchEventTypes: ['TCP_STATE_CHANGE'] },
    { id: 'j-5', title: '5 · HTTP GET', narration: '“GET /index.html HTTP/1.1” travels inside a TCP segment with ACK+PSH flags — HTTP is just bytes to TCP.', watchEventTypes: ['HTTP_REQUEST'] },
    { id: 'j-6', title: '6 · HTTP response', narration: 'The server answers “HTTP/1.1 200 OK” with Content-Type text/html and the page body.', watchEventTypes: ['HTTP_RESPONSE'] },
    { id: 'j-7', title: '7 · Data & acknowledgements', narration: 'Every byte is counted: the client ACKs the page with ACK = SEQ + length. That bookkeeping is what makes TCP reliable.', watchEventTypes: ['PACKET_SENT', 'TCP_STATE_CHANGE'] },
    { id: 'j-8', title: '8 · Termination', narration: 'Four segments to say goodbye — FIN, ACK, FIN, ACK — and the client waits in TIME_WAIT before the final CLOSED.', watchEventTypes: ['TCP_STATE_CHANGE'] }
  ],
  task: 'Pause anywhere, select a packet, and answer for it: what happened, why, which protocol, what was added, what changed, who decided?'
};

const ethernetLab: LabDefinition = {
  id: 'ethernet',
  title: 'Ethernet — hubs, switches and MAC learning',
  protocols: ['Ethernet', 'MAC'],
  objective: 'Compare hub flooding with a switch that learns which port owns each MAC address.',
  topology: ethernetTopology,
  script: [
    { atMs: 0, action: 'note', nodeId: 'pc-a', message: 'PC A sends to PC B through the hub — watch it arrive everywhere' },
    { atMs: 0, action: 'send-ping', from: 'pc-a', toIp: '10.0.0.2', ttl: 64, destMacOf: 'pc-b' },
    { atMs: 300, action: 'note', nodeId: 'pc-c', message: 'PC C sends to PC D through the switch — unicast forwarding' },
    { atMs: 300, action: 'send-ping', from: 'pc-c', toIp: '10.0.0.4', ttl: 64, destMacOf: 'pc-d' },
    { atMs: 600, action: 'note', nodeId: 'switch-1', message: 'The switch has learned both MACs — no flooding needed' }
  ],
  steps: [
    { id: 'eth-1', title: 'Through the hub', narration: 'The hub is a repeater: it copies the electrical signal out of every other port. PC B accepts the frame; the NIC simply ignores what is not addressed to it.', watchEventTypes: ['PACKET_SENT', 'PACKET_RECEIVED'] },
    { id: 'eth-2', title: 'Through the switch', narration: 'The switch inspects the source MAC and records which port it arrived on, then forwards only toward the destination port.', watchEventTypes: ['forward', 'rx'] },
    { id: 'eth-3', title: 'MAC table complete', narration: 'Both MAC addresses are learned, so later frames travel a single path instead of being flooded.', watchEventTypes: ['note'] }
  ],
  task: 'Send a frame from PC B to PC D and note which devices see it in each segment.'
};

const routingLab: LabDefinition = {
  id: 'routing',
  title: 'IPv4 routing — crossing subnets',
  protocols: ['IPv4', 'Routing', 'ARP'],
  objective: 'Follow a packet from the 192.168.1.0/24 LAN to 10.20.5.8 via a default-less static route.',
  topology: routingTopology,
  script: [
    { atMs: 0, action: 'send-ping', from: 'src-host', toIp: '10.20.5.8', ttl: 64 },
    { atMs: 500, action: 'note', nodeId: 'router-1', message: 'The decision: longest prefix 10.20.0.0/16 matched, TTL decremented, new frame built for the next hop' },
    { atMs: 800, action: 'send-ping', from: 'src-host', toIp: '10.20.5.8', ttl: 1 }
  ],
  steps: [
    { id: 'rt-1', title: 'Not my subnet', narration: 'The workstation masks both addresses with /24 and sees 10.20.5.8 is remote, so it hands the packet to its gateway.', watchEventTypes: ['forward', 'tx'] },
    { id: 'rt-2', title: 'Router longest-prefix match', narration: 'The router searches its table for the most specific match, lists every candidate in the ROUTE_LOOKUP event, decrements TTL and rewrites the Ethernet header for the outgoing link.', watchEventTypes: ['PACKET_FORWARDED', 'ROUTE_LOOKUP'] },
    { id: 'rt-3', title: 'Delivery', narration: 'The file server sees its own IP, accepts the packet and (for ping) answers with an ICMP echo reply.', watchEventTypes: ['PACKET_RECEIVED', 'NOTE'] },
    { id: 'rt-4', title: 'TTL = 1 dies here', narration: 'A packet sent with TTL 1 makes it to the router, the decrement hits zero, and the packet is dropped — routing loops cannot live long.', watchEventTypes: ['PACKET_DROPPED'] }
  ],
  task: 'Lower the TTL to 1 and watch the router drop the packet with “TTL expired”.'
};

const dnsLab: LabDefinition = {
  id: 'dns',
  title: 'DNS — resolving a hostname',
  protocols: ['DNS', 'UDP', 'IPv4'],
  objective: 'Resolve www.example.com through the lab resolver and watch the UDP round trip.',
  topology: dnsTopology,
  script: [
    { atMs: 0, action: 'send-dns', from: 'dns-client', name: 'www.example.com' }
  ],
  steps: [
    { id: 'dns-1', title: 'Ask the resolver', narration: 'The laptop sends a UDP datagram to port 53 with one question: the A record for www.example.com.', watchEventTypes: ['PACKET_SENT', 'PACKET_RECEIVED'] },
    { id: 'dns-2', title: 'The zone answers', narration: 'The resolver looks in its zone and builds a response with an answer record, including a TTL.', watchEventTypes: ['DNS_RESPONSE', 'PACKET_SENT'] },
    { id: 'dns-3', title: 'Client caches', narration: 'The laptop stores the record for the TTL duration, so future lookups skip the network.', watchEventTypes: ['DNS_RESPONSE', 'NOTE'] }
  ],
  task: 'Query a name that is not in the zone and observe the NXDOMAIN note.'
};

const tcpLab: LabDefinition = {
  id: 'tcp',
  title: 'TCP — the three-way handshake',
  protocols: ['TCP', 'IPv4'],
  objective: 'Establish a connection segment by segment: SYN, SYN+ACK, ACK.',
  topology: tcpTopology,
  script: [
    { atMs: 0, action: 'note', nodeId: 'tcp-client', message: 'Client opens a connection to port 80' }
  ],
  steps: [
    { id: 'tcp-1', title: 'SYN', narration: 'The client picks an initial sequence number and sends SYN. State: CLOSED → SYN_SENT.', watchEventTypes: ['tx', 'tcp-state'] },
    { id: 'tcp-2', title: 'SYN+ACK', narration: 'The server proposes its own sequence number and acknowledges the client’s. State: LISTEN → SYN_RCVD.', watchEventTypes: ['tx', 'tcp-state'] },
    { id: 'tcp-3', title: 'ACK', narration: 'The client acknowledges. Both sides are ESTABLISHED and data can flow.', watchEventTypes: ['tx', 'tcp-state'] }
  ],
  task: 'Step through the timeline one event at a time and name the state of both endpoints after each packet.'
};

const httpLab: LabDefinition = {
  id: 'http',
  title: 'HTTP — one page load, full stack',
  protocols: ['HTTP', 'DNS', 'TCP', 'IPv4', 'ARP'],
  objective: 'Load a page end to end: resolve the name, shake hands, request the document, receive the HTML.',
  topology: httpTopology,
  script: [
    { atMs: 0, action: 'send-http', from: 'http-client', serverName: 'www.example.com', path: '/index.html', resolveFirst: true }
  ],
  steps: [
    { id: 'http-1', title: 'Resolve the name', narration: 'Before any HTTP, the browser needs the web server’s IP: a DNS exchange happens first.', watchEventTypes: ['dns-resolve'] },
    { id: 'http-2', title: 'Open the connection', narration: 'A TCP handshake to port 80 creates the reliable pipe HTTP needs.', watchEventTypes: ['TCP_STATE_CHANGE', 'PACKET_SENT'] },
    { id: 'http-3', title: 'Request and response', narration: 'GET /index.html goes out; 200 OK with an HTML body comes back. Both travel inside TCP segments.', watchEventTypes: ['HTTP_RESPONSE', 'PACKET_RECEIVED'] }
  ],
  task: 'Inspect the HTTP request and response layers and find the Host header the server used.'
};

const httpGetLab: LabDefinition = {
  id: 'http-get',
  title: 'HTTP — send a GET request',
  protocols: ['HTTP', 'TCP', 'DNS', 'ARP'],
  objective:
    'The complete page load: resolve www.example.com, open a TCP connection, GET /index.html, receive 200 OK with an HTML body — then close the connection cleanly.',
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
  task: 'Follow the lifecycle in the inspectors: which layer speaks first, and which layer says goodbye?'
};

const httpTcpLab: LabDefinition = {
  id: 'http-tcp-underneath',
  title: 'HTTP — inspect TCP underneath',
  protocols: ['HTTP', 'TCP'],
  objective:
    'The same GET, but watch the TCP layer: ports 49152 → 80, sequence numbers advancing by byte counts, ACKs answering every data segment.',
  topology: httpTopology,
  script: [
    { atMs: 0, action: 'send-http', from: 'http-client', serverName: 'www.example.com', path: '/index.html', resolveFirst: false }
  ],
  steps: [
    { id: 'ht-1', title: 'Ports before paths', narration: 'Before the request line exists, TCP must agree ports and sequence numbers. Watch SYN choose 49152 → 80.', watchEventTypes: ['PACKET_SENT', 'TCP_STATE_CHANGE'] },
    { id: 'ht-2', title: 'HTTP is just bytes', narration: 'The GET rides a segment with ACK+PSH flags — to TCP it is opaque payload, counted byte by byte.', watchEventTypes: ['HTTP_REQUEST'] },
    { id: 'ht-3', title: 'ACK the page', narration: 'The 200 OK response is acknowledged like any other bytes: ACK = SEQ + length.', watchEventTypes: ['HTTP_RESPONSE', 'TCP_STATE_CHANGE'] }
  ],
  task: 'Open the TCP state inspector after the response: what is the client\'s ACK value, and which segment caused it?'
};

const httpIpLab: LabDefinition = {
  id: 'http-ip-underneath',
  title: 'HTTP — inspect IP underneath TCP',
  protocols: ['HTTP', 'TCP', 'IPv4', 'Routing'],
  objective:
    'Zoom one layer deeper: the TCP segments travel inside IPv4 packets — source 192.168.9.10, destination 192.168.9.80, TTL counting the hops.',
  topology: httpTopology,
  script: [
    { atMs: 0, action: 'send-http', from: 'http-client', serverName: 'www.example.com', path: '/index.html', resolveFirst: false }
  ],
  steps: [
    { id: 'hi-1', title: 'Addresses before ports', narration: 'IP chose the endpoints before TCP could: 192.168.9.10 → 192.168.9.80. Select any TCP segment and read the IP header around it.', watchEventTypes: ['PACKET_SENT'] },
    { id: 'hi-2', title: 'TTL at work', narration: 'Every datagram carries TTL 64 — the same field that kills routing loops guards this page load.', watchEventTypes: ['ROUTE_LOOKUP'] },
    { id: 'hi-3', title: 'One envelope, many letters', narration: 'Two HTTP messages, several TCP segments — each wrapped in its own IP datagram. Select them and compare TTLs.', watchEventTypes: ['PACKET_RECEIVED'] }
  ],
  task: 'In the packet inspector, expand the IPv4 layer of the HTTP response: what are source, destination and TTL?'
};

const httpEthernetLab: LabDefinition = {
  id: 'http-ethernet-underneath',
  title: 'HTTP — inspect Ethernet underneath IP',
  protocols: ['HTTP', 'Ethernet', 'ARP'],
  objective:
    'The frames that carry everything: ARP resolves the server\'s MAC, and every HTTP byte travels as EtherType 0x0800 frames across the switch.',
  topology: httpTopology,
  script: [
    { atMs: 0, action: 'send-http', from: 'http-client', serverName: 'www.example.com', path: '/index.html', resolveFirst: false }
  ],
  steps: [
    { id: 'he-1', title: 'ARP before anything', narration: 'The very first wire event is ARP: who has 192.168.9.80? Frames need MACs before IPs are usable.', watchEventTypes: ['ARP_REQUEST', 'ARP_REPLY'] },
    { id: 'he-2', title: 'EtherType 0x0800', narration: 'Every frame in this run carries IPv4 — but the switch only reads MAC addresses, never the payload.', watchEventTypes: ['PACKET_SENT'] },
    { id: 'he-3', title: 'MAC learning in action', narration: 'The switch learned both MACs from the ARP exchange, so the HTTP frames forward unicast — no flooding.', watchEventTypes: ['PACKET_FORWARDED'] }
  ],
  task: 'Compare the first frame (ARP, 0x0806) with an HTTP frame (0x0800). What do their destination MACs have in common — and what differs?'
};

const httpEncapsulationLab: LabDefinition = {
  id: 'http-encapsulation',
  title: 'HTTP — the complete encapsulation',
  protocols: ['HTTP', 'TCP', 'IPv4', 'Ethernet', 'DNS', 'ARP'],
  objective:
    'One GET, five layers: Ethernet frames carry IP datagrams carry TCP segments carry HTTP — plus DNS and ARP setting the stage. Watch it all in one run.',
  topology: httpTopology,
  script: [
    { atMs: 0, action: 'send-http', from: 'http-client', serverName: 'www.example.com', path: '/index.html', resolveFirst: true }
  ],
  steps: [
    { id: 'hc-1', title: 'The stage crew', narration: 'DNS resolves the name; ARP resolves the MAC. Neither carries page data, but nothing works without them.', watchEventTypes: ['DNS_RESPONSE', 'ARP_REPLY'] },
    { id: 'hc-2', title: 'The envelope stack', narration: 'Select the HTTP response packet and walk outward: HTTP → TCP → IPv4 → Ethernet. Every layer adds exactly one header.', watchEventTypes: ['HTTP_RESPONSE', 'PACKET_SENT'] },
    { id: 'hc-3', title: 'Symmetry of teardown', narration: 'The connection closes with the same care it opened: FIN, ACK, FIN, ACK, TIME_WAIT.', watchEventTypes: ['TCP_STATE_CHANGE'] }
  ],
  task: 'Open the packet inspector on the response and list every header you can find, outermost to innermost. Which layer has no header of its own here?'
};

const ttlLab: LabDefinition = {
  id: 'ttl',
  title: 'TTL — why routing loops cannot last',
  protocols: ['IPv4', 'Routing', 'ICMP'],
  objective: 'Send a packet with a tiny TTL across two routers and watch it expire.',
  topology: ttlTopology,
  script: [
    { atMs: 0, action: 'send-ping', from: 'ttl-src', toIp: '10.3.0.10', ttl: 1 }
  ],
  steps: [
    { id: 'ttl-1', title: 'TTL = 1 departs', narration: 'The source sends with TTL 1 — enough to reach one hop.', watchEventTypes: ['PACKET_SENT'] },
    { id: 'ttl-2', title: 'Router decrements to zero', narration: 'Router 1 must forward, but the decrement rule brings TTL to 0, so it drops the packet instead.', watchEventTypes: ['PACKET_DROPPED'] }
  ],
  task: 'Raise the TTL to 5 and confirm the packet now reaches the destination.'
};

export const labs: readonly LabDefinition[] = [
  openWebPageLab,
  ...numberedLabs,
  gatewayLab,
  localDeliveryLab,
  gatewayRoutingLab,
  staticRoutesLab,
  multiRouterLab,
  longestPrefixLab,
  ethernetLab,
  arpLab,
  routingLab,
  dnsLab,
  dnsALab,
  dnsCacheLab,
  dnsCnameLab,
  dnsCompareLab,
  tcpLab,
  tcpHandshakeLab,
  tcpDataLab,
  tcpAckLab,
  tcpTeardownLab,
  httpLab,
  httpGetLab,
  httpTcpLab,
  httpIpLab,
  httpEthernetLab,
  httpEncapsulationLab,
  ttlLab
];

export function labById(id: string | undefined): LabDefinition | undefined {
  return id === undefined ? undefined : labs.find((l) => l.id === id);
}

export type { LabDefinition, LabScriptEntry } from './types';

# Labs

Labs are the guided heart of the application. A lab is **pure data** — topology, script, steps, task — and it executes on the *same* `NetworkEngine` as everything else. There is no bespoke lab runtime, so what a student sees in a lab is exactly what the engine does.

The **laboratory framework** wraps that data in a consistent teaching shape: every lab can carry learning objectives, prerequisites, expected observations, hints, a deeper explanation, the simulation controls to exercise, and a **completion check** — a pure predicate over `NetworkState`. The catalog has three tiers: the flagship journey, the numbered curriculum (Lab 01 – Lab 18), and the original topical labs.

## Anatomy

```ts
interface LabDefinition {
  id: string;               // stable id ('open-web-page', 'lab-01-ethernet-frames', ...)
  title: string;
  protocols: string[];      // badge list in the sidebar
  objective: string;        // what the student will see
  topology: Topology;       // devices, links, fixed addresses, layout
  script: LabScriptEntry[]; // scheduled transmissions + notes
  steps: LabStep[];         // narrated beats, tied to event types
  task: string;             // something to try independently
  // ---- laboratory framework (optional; sensible fallbacks exist) ----
  objectives?: string[];          // what the student can explain afterwards
  prerequisites?: string[];       // earlier labs to master first
  expectedObservations?: string[];// concrete events/values to spot
  hints?: string[];               // progressive, cheapest first
  explanation?: string;           // the deeper story, revealed on demand
  controls?: string[];            // simulation controls to exercise
  completion?: {                  // pure predicate over NetworkState
    description: string;
    check: (state: NetworkState) => boolean;
  };
}
```

Script entries schedule work at `atMs`: `send-arp`, `send-dns`, `send-ping`, `send-http`, `tcp-open/send/close/reset`, or `note`. Each `send-*` entry builds canonical packets through the same builders the engine uses — no shortcuts.

Completion checks are **derived from the engine**, never asserted by the lab: they read only the events, caches and TCP state the engine recorded (see `labs/framework.ts` for the shared predicates — `arpEntry`, `httpExchange`, `tcpTransitionSeen`, `ttlArrivedAt`, …). The test suite (`tests/lab-framework.test.tsx`) runs every lab and proves its completion predicate holds after a full run — and *only* after a run: a fresh, untouched engine must not satisfy any lab's criteria.

## Lab Progress (client-side)

The sidebar's **Lab progress** panel tracks which labs are complete. Progress is a tiny Zustand slice (`src/state/progress.ts`) persisted to `localStorage` — no account, no backend, nothing leaves the browser. A lab is marked ✓ **only** when a real run of that lab satisfied its completion predicate on the engine; `Reset` clears the simulation, not the record. The panel also offers a full local reset.

## The catalog

**The numbered curriculum (Lab 01 – Lab 18)** — an ordered course; each lab builds on the previous:

| Lab | Focus | Completion evidence |
|---|---|---|
| 01 Ethernet Frames | hub flooding vs switch learning | switch learns ≥2 MACs; ARP resolved both pairs |
| 02 MAC Addresses | broadcast vs unicast delivery | the unicast reply arrives at Host 1's MAC; binding cached |
| 03 ARP Request and Reply | the two-packet resolution dance | one broadcast request, one unicast reply, cache written |
| 04 ARP Cache | miss holds traffic, hit releases it | journey ran; repeat traffic reused the cache |
| 05 IPv4 Addressing | masking decides local vs gateway | on-link echo arrives with TTL intact |
| 06 Default Gateway | ARP for the router's MAC | two pings; ARP exactly once |
| 07 Routing Table Lookup | host default route, router /16 | packet crosses with TTL 63; TTL-1 copy dropped |
| 08 Longest Prefix Matching | /24 beats /0 | both candidates listed; specific route won |
| 09 Multi-Router Routing | TTL as a hop counter | echo arrives with TTL 62 after two routers |
| 10 DNS Resolution | a UDP/53 A-record round trip | query, response, client cache write |
| 11 DNS Caching | recursion once, cache forever | exactly one recursion; second lookup is a hit |
| 12 TCP Three-Way Handshake | SYN, SYN+ACK, ACK | both endpoints ESTABLISHED |
| 13 TCP Sequence and ACK | byte-counted bookkeeping | two data segments byte-accurately ACKed |
| 14 TCP Connection Termination | FIN ×2, TIME_WAIT | both sides CLOSED after a real 30 ms TIME_WAIT |
| 15 HTTP GET | DNS → TCP → GET → 200 | request + response over an established connection |
| 16 HTTP Response | status line, headers, body | 200 OK text/html acknowledged byte-accurately |
| 17 Protocol Encapsulation | HTTP → TCP → IPv4 → Ethernet | a real nested packet + DNS/ARP stage crew |
| 18 Complete Web Request | the whole curriculum in one act | DNS, ARP, routing, TCP lifecycle, 200 OK, clean close |

**Flagship and topical labs:**

| Lab | Focus | Key moment |
|---|---|---|
| Open a Web Page (flagship) | the complete journey: DNS → ARP → routing → TCP → HTTP → teardown | the frame changes at the router; the IP destination never does |
| ARP — discover the default gateway | PC1 → Switch → Router, the textbook ARP exchange | held packet released the instant the cache is filled |
| Routing — local network delivery | one subnet, zero routers | the frame goes straight to the destination MAC |
| Routing — through the default gateway | PC1's default route hands off to Router1 | the frame carries the server's IP but the router's MAC |
| Routing — static routes | one router, two static routes, two paths | same device, different interface, purely from the table |
| Routing — two routers, hop by hop | TTL 64 → 62 across Router1 and Router2 | the reply travels the chain in reverse |
| Routing — longest prefix match | default route vs. specific /24 | both match; /24 wins regardless of metric |
| DNS — resolve an A record | full recursion: client → resolver → authority → back | 93.184.216.34 learned and cached at both levels |
| DNS — observe caching | the same name asked twice | second answer: remaining TTL, zero recursion |
| DNS — resolve a CNAME | alias chasing across two recursions | the client finally gets the real address |
| DNS — cached vs uncached | two clients, one name | the second ride is free — that is what caches buy |
| TCP — three-way handshake | SYN, SYN+ACK, ACK with deterministic ISNs | both endpoints land in ESTABLISHED |
| TCP — data transfer | byte-counted sequence numbers | every ACK equals SEQ + length |
| TCP — acknowledgement | reverse data flow | two independent sequence spaces, one per direction |
| TCP — connection termination | FIN, ACK, FIN, ACK | the client lingers in TIME_WAIT for 2·MSL |
| HTTP — send a GET request | the full lifecycle: DNS → TCP → GET/200 → teardown | one run, every layer speaking in order |
| HTTP — inspect TCP underneath | ports, sequence numbers, ACKs beneath the GET | HTTP is just bytes to TCP |
| HTTP — inspect IP underneath TCP | datagrams beneath the segments | TTL guards even a page load |
| HTTP — inspect Ethernet underneath IP | ARP, EtherTypes, MAC learning beneath it all | frames first, meaning later |
| HTTP — the complete encapsulation | one GET, five layers | every header, outermost to innermost |
| Ethernet | Hub flooding vs switch learning | same frame, two very different segments |
| ARP | IP → MAC resolution | broadcast question, unicast answer, cache filled |
| IPv4 routing | Crossing subnets | router longest-prefix match + TTL decrement |
| DNS | Name resolution | UDP/53 question, answer record with TTL |
| TCP | Handshake | SYN → SYN+ACK → ACK with endpoint states |
| HTTP | Full stack | DNS, then handshake, then GET/200 inside TCP |
| TTL | Loop safety | TTL 1 dies at the first router |

## Deterministic topologies

Every lab topology (in `labs/topologies.ts`, `labs/gateway-topology.ts`, `labs/forwarding-topologies.ts`, `labs/dns-topology.ts` and `labs/tcp-topology.ts`) uses fixed MACs, IPs, prefix lengths and latencies. Nothing is randomized, so the same lab always produces the same timeline — a hard requirement for teaching and for the test suite, which executes each lab and asserts on its events.

## Adding a lab

1. Reuse an existing deterministic topology (or add one to `labs/topologies.ts` with fixed addresses).
2. Add a `LabDefinition` to `labs/index.ts` (or `labs/numbered.ts` for the curriculum) with a script, steps, and — for numbered labs — the full framework: objectives, prerequisites, observations, hints, explanation and a `completion` predicate built from `labs/framework.ts` helpers.
3. The sidebar, progress panel, canvas, timeline, inspector and tests pick it up automatically; `tests/lab-framework.test.tsx` will fail if the completion predicate is unreachable or if a fresh engine already satisfies it.

If a lab needs a new kind of scripted action, extend `LabScriptEntry` and add one `case` in `labs/runner.ts`. Protocol behavior itself should never live in a lab — only scheduling of it.

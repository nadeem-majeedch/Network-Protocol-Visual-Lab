# Simulation Model

How the engine represents time, packets, and network behavior.

## Time

- Time is **simulated milliseconds** (`simMs`). It advances only when the engine pops an event from the scheduler — never in real time.
- The scheduler orders callbacks by `(time, insertionOrder)`, so identical scripts produce identical schedules.
- Link latency is deterministic per link (`latencyMs` in the topology). Transmitting at time *t* schedules delivery at *t + latency*.
- `drain()` runs the scheduler to exhaustion (with a hard cap to catch runaway scenarios); `step()` advances exactly one scheduled item for step-by-step teaching.

## Canonical state

`NetworkState` (in `models/network-state.ts`) is the single source of truth the UI reads:

```ts
interface NetworkState {
  simMs: number;
  packets: Packet[];
  arpCaches: Record<nodeId, Record<ip, mac>>;
  routingTables: Record<nodeId, RouteEntry[]>;
  tcpConnections: TcpConnectionState[];
  events: SimulationEvent[];
  topology: Topology;
}
```

It is plain JSON — verified by a round-trip test — so it can be logged, diffed, or replayed.

## Packets

A `Packet` carries an immutable snapshot of every layer it contains:

```
Packet
 └─ EthernetFrame            (MACs, EtherType)
     └─ ArpPacket | IpPacket
                      └─ TcpSegment | UdpDatagram | IcmpMessage
                                              └─ DnsMessage | HttpMessage
```

The engine appends a `PacketHop` (link, from-interface, to-interface, start/end ms) each time the frame crosses a link. Hops give the inspector its path view and the canvas its animation positions.

## Determinism rules

- No wall-clock time, `Math.random()`, or iteration-order dependence anywhere in the engine or handlers.
- Packet ids/serials come from counters reset at the start of every run.
- Two engines built from the same topology and script produce byte-identical event logs (asserted in `tests/engine.test.ts`).

## Failure behavior

- A host receiving an IP packet not addressed to it **drops** it with a reason.
- A router with no matching route drops ("No route to host"); a router that decrements TTL to zero drops ("TTL expired in transit").
- A DNS server without the requested name answers with an NXDOMAIN note.
- A packet held for ARP whose target never answers is dropped after 200 ms ("ARP never resolved <ip>").
- A router whose lookup finds no route drops immediately ("No route to host"); a router whose next hop never answers ARP drops the held packet after the bounded wait — forwarding is ARP-gated per hop, never faked with a broadcast fallback.
- A DNS name missing from the authoritative zone produces NXDOMAIN (`DNS_NXDOMAIN`); negative answers are not cached.

## DNS resolution

The resolver is genuinely recursive over the simulated wire: it probes its TTL-aware cache (`DNS_CACHE_LOOKUP`), answers fresh hits with the *remaining* TTL, and on a miss sends a real routed UDP query to the authoritative server (`DNS_RECURSE`), chasing CNAME chains as they appear. Every learned record is written to the cache (`DNS_CACHE_WRITE`) at both resolver and client, so later queries can skip the wire entirely. Zone data is fixed per lab topology — nothing external is ever queried, and the same script always produces the same event log.

## Routing decisions

Every router (and every host choosing between on-link delivery and its default gateway) emits a `ROUTE_LOOKUP` carrying the full decision: destination, every matching route with its prefix length and origin, the selected route, the resolved next hop and the egress interface. Longest prefix wins; ties break on metric, then stable route id. The routing table inspector and the "How did the router decide?" panel render exactly this data — no parallel decision logic exists in the UI.

Every drop is a first-class `drop` event with a human-readable reason — failures are teaching moments, not errors.

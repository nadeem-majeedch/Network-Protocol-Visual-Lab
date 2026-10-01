# Protocol Model

The serializable types in `src/models/` and what each layer means. Every type is plain data; the brand types (`MacAddress`, `Ipv4Address`) are compile-time labels over plain strings so they serialize transparently.

## Addressing

- **`MacAddress`** — lowercase colon-separated hex (`02:00:00:00:00:01`). Parsed from any common formatting; `ff:ff:ff:ff:ff:ff` is the broadcast constant.
- **`Ipv4Address`** — dotted decimal (`10.0.0.1`). `parseCidr("10.0.0.5/24")` yields address + prefix; helpers compute masks, network addresses, and subnet membership.
- **`Subnet`** — a descriptive record (id, name, prefix, color) for display; derived values are computed, never stored.

## Topology

```
Topology
 ├─ Node[]        discriminated union, one interface per type:
 │   ├─ HostNode      { kind: 'host' }
 │   ├─ ServerNode    { kind: 'server' }
 │   ├─ SwitchNode    { kind: 'switch' }
 │   ├─ HubNode       { kind: 'hub', isRepeater: true }
 │   └─ RouterNode    { kind: 'router', routes?: RoutingEntry[] }
 │   (all share: id, name, interfaces, description?)
 ├─ NetworkInterface[]   mac, ip?, prefix?, enabled, label
 ├─ Link[]        endpoints: [ifaceId, ifaceId], latencyMs, enabled
 └─ layout        canvas positions + optional link waypoints
```

Node kinds are **strongly typed**: `routes` exists only on `RouterNode` and `isRepeater` only on `HubNode`, so the engine can narrow with `node.kind` and the compiler guarantees role-specific fields are used safely.

`validateTopology` rejects duplicate ids/MACs/IPs/links, bad endpoints, self-loops, and ip/prefix mismatches.

## Frames and payloads

- **`EthernetFrame`** — source MAC, destination MAC, EtherType (`0x0800` IPv4, `0x0806` ARP), and a discriminated `payload` union. The inspector renders exactly the branches the packet contains.
- **`ArpPacket`** — operation (`request`/`reply`), sender IP+MAC, target IP, optional target MAC (unknown during a request).

ARP is a genuine gate on every transmission: a sender that lacks the next-hop MAC **parks the packet**, broadcasts `who has <ip>?`, and only egresses when the reply writes the binding into the cache (`ARP_WRITE`). If nobody answers within 200 ms the held packet is dropped — "ARP never resolved" — exactly as a real host gives up. Every hop carries the resolved destination MAC, so the cache you inspect is the cache the wire actually used.
- **`IpPacket`** — source, destination, TTL, protocol (`icmp`/`tcp`/`udp`), transport payload.
- **`TcpSegment`** — ports, sequence, acknowledgment, `TcpFlags` (syn/ack/fin/rst/psh), window, optional HTTP payload.
- **`UdpDatagram`** — ports plus a DNS (or, structurally, HTTP) payload.
- **`DnsMessage`** — transaction id, `isResponse`, questions (name + record type), optional answers (value + record TTL).
- **`HttpMessage`** — request (method, path, version, headers, body) or response (status, reason, version, headers, body).
- **`IcmpMessage`** — type (`echo-request`, `echo-reply`, `ttl-exceeded`, `destination-unreachable`).

## Routing table

The *configured* route on a router node is a `RoutingEntry` (`destination, prefix, nextHop?, interfaceId?, metric`). At engine build time each node's table is derived into enriched `TableRoutingEntry` records (id, origin, resolved interface): connected routes from interface addresses, plus the router's static entries. `lookupRoute` performs longest-prefix match: most specific prefix wins; ties break on metric, then stable id order.

## Events

`SimulationEvent` is a tagged union covering everything observable: `tx`, `rx`, `forward`, `drop`, `arp-learn`, `arp-write`, `arp-query-start`, `arp-cache-wait`, `arp-hit`/`arp-miss`, `tcp-state` (from → to with trigger), `http-exchange`, `dns-resolve`, and `note`. The timeline renders `describeEvent(event)`; because events are data, the log is replayable and diffable.

## Packet lifecycle

`queued → in-flight → delivered | dropped | expired`, with `bornMs`/`finishedMs` timestamps and a `dropReason` where applicable. The packet model documentation in [simulation-model.md](simulation-model.md) shows how hops accumulate along the way.

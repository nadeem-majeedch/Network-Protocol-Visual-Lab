# Network Protocol Visual Lab — Architecture Design Specification

Status: design specification (v1.0). The `src/` tree implements exactly this design; this document is the normative reference for why it is shaped the way it is.

---

## 1. Purpose

An interactive, browser-only laboratory for learning computer networks by watching and inspecting protocol behavior: **Ethernet, MAC addressing, IPv4, ARP, routing, DNS, TCP, HTTP** (with ICMP for control-plane feedback). Deployable as a static site on GitHub Pages.

### Non-negotiable design principles

1. **One canonical simulation engine.** Every packet that moves, moves through `NetworkEngine`. No second execution path for labs, demos, or the UI.
2. **React UI contains no protocol logic.** Components render state; they never interpret it.
3. **Deterministic protocol behavior.** Same topology + same script ⇒ byte-identical event log (test-enforced).
4. **Serializable simulation state.** `NetworkState` is plain JSON — no functions, class instances, Maps, or randomness cross the boundary.
5. **Visualizations consume canonical state.** All on-screen geometry derives from `NetworkState` through pure functions.
6. **Packet inspection uses the canonical packet model.** The inspector renders whatever layers a `Packet` actually contains — never a parallel description.
7. **Labs execute against the same engine.** A lab is *data* (topology + script + narration) interpreted by the lab runner on top of the one engine.
8. **No backend. No database. No authentication. No external APIs. No runtime network requests.** The built `dist/` is fully self-contained; the app works from `file://` semantics upward (static hosting only).
9. **Extensible for future protocols.** Adding a protocol touches models, one handler module, one dispatch case — and nothing in the UI.

---

## 2. Layer map and dependency rule

```
components/   React presentation (topology canvas, inspector, timeline, nav)
state/        Zustand store: canonical state + UI concerns
visualization/  canonical state → geometry (pure functions)
labs/         lab definitions (data) + the one runner that scripts the engine
simulation/   protocol handlers (ARP, IPv4/routing, TCP, DNS, ICMP) + explanations
engine/       NetworkEngine: scheduler, wire, time, dispatch
models/       canonical, serializable domain types
```

**Dependency direction is strictly downward.** `components → state → visualization → labs → simulation → engine → models`. `models/` imports nothing from the app. Any upward import is a defect. The one structural exception is deliberate: `simulation/stack.ts` declares a *structural* mirror of the engine's context type rather than importing the engine module, breaking what would otherwise be a load-order cycle while remaining type-safe.

---

## 3. Domain model

The domain is a **closed world of immutable value objects**: addresses, interfaces, nodes, links, frames, packets, routes, and events. Everything is a plain serializable structure; behavior lives in pure functions beside the types.

### 3.1 MAC address model (`models/mac.ts`)

- Type: `MacAddress` — a **branded string** (`string & { __brand: 'MacAddress' }`): full string interoperability (JSON-transparent), compile-time protection against mixing with IPs or ports.
- Canonical form: lowercase, colon-separated hex — `02:00:00:00:00:01`.
- `mac(input)` parses any common formatting (dashes, dots, mixed case) and **throws on malformed input** — bad addresses never enter the sim.
- `BROADCAST_MAC` (`ff:ff:ff:ff:ff:ff`) is the single broadcast constant; `isBroadcast`/`isUnicast` classify; `formatMac` renders human-uppercase for display only.
- Simulated devices use the locally-administered OUI `02:00:00:…` (`labOui`), so lab MACs can never collide with real vendor prefixes.

### 3.2 IPv4 model (`models/ipv4.ts`)

- Type: `Ipv4Address` — branded string, dotted-decimal canonical form.
- `ipv4(input)` validates strictly (each octet 0–255) and throws otherwise.
- `parseCidr("10.20.5.8/16")` → `{ address, prefix }` with prefix 0–32.
- Bit-exact helpers over a uint32 packing: `maskFor(prefix)`, `networkAddress(addr, prefix)`, `sameSubnet(a, b, prefix)`, `toUint32`/`fromUint32` round-trip.
- Rationale: subnet decisions ("is this mine or the gateway's?") are the heart of the routing lesson, so the arithmetic is isolated in one tested module rather than smeared across handlers.

### 3.3 Subnet model (`models/subnet.ts`)

A subnet is **descriptive, not authoritative**: `{ id, name, prefix, color }` attached for display (color-coding members on the canvas). Derived values — network address, broadcast, host count (`SubnetInfo`) — are computed on demand, never stored, so stored data cannot disagree with the math.

### 3.4 Interface model (`models/topology.ts`)

```
NetworkInterface { id, nodeId, mac, ip?, prefix?, enabled, label }
```

- An interface owns exactly **one L2 identity (MAC)** and **at most one L3 identity (IPv4 + prefix)**. Interfaces are the *only* place addresses live — addressing decisions stay local and testable.
- `ip` and `prefix` are set or unset **together** (validated); a frame-only member of a hub segment may have neither.
- `enabled` models link up/down; the engine refuses to transmit through a disabled interface.

### 3.5 Node model (`models/topology.ts`)

Node kinds are a **discriminated union** — each device is its own strongly typed shape sharing a common base (`id, name, interfaces, description?`):

```
HostNode   { kind: 'host' }
ServerNode { kind: 'server' }
SwitchNode { kind: 'switch' }
HubNode    { kind: 'hub',    isRepeater: true }
RouterNode { kind: 'router', routes?: RoutingEntry[] }
```

- The engine narrows on `node.kind`; role-specific fields are *impossible to misuse* — `routes` exists only on `RouterNode`, `isRepeater` only on `HubNode` (compile-time, not convention).
- `RoutingEntry` (destination, prefix, optional nextHop/interfaceId, metric) is the *configured* static route; the engine derives the runnable table (see 3.10).
- `description` feeds tooltips/teaching text — prose belongs to data, not to UI conditionals.

### 3.6 Topology model (`models/topology.ts`)

```
Topology { id, name, nodes[], links[], layout }
Link    { id, endpoints: [ifaceId, ifaceId], latencyMs, enabled }
TopologyLayoutInput { nodes: Record<nodeId, Point>, links: Record<linkId, Point[]> }
```

- Links connect **interfaces** (not nodes) — the precise L2 attachment point, which ARP and the wire model both need.
- `layout` carries canvas positions and optional polyline waypoints so links can dodge devices. It travels with the topology (serializable) but is consumed only by the visualization layer.
- `validateTopology()` is the structural gate: duplicate node/interface ids, duplicate MACs or IPs, duplicate links, unknown endpoints, self-loops, and ip/prefix pairing. A topology with errors is refused before an engine is built.

### 3.7 Ethernet frame model (`models/ethernet.ts`)

```
EthernetFrame { kind: 'frame', source: MacAddress, destination: MacAddress,
                etherType: 0x0800 | 0x0806, payload: ArpPayload | IpPayload }
```

Ethernet II framing; the payload is a **discriminated union** keyed by `kind`, which is what lets the inspector render *only* the layers a packet has. EtherType is limited to the two values the lab actually models — an honest constraint rather than a fake generality.

### 3.8 ARP packet model (`models/arp.ts`)

```
ArpPacket { kind: 'arp', operation: 'request' | 'reply',
            senderIp, senderMac, targetIp, targetMac? }
```

RFC 826 shape. `targetMac` is absent in a request (that is the *point* of ARP), and the inspector's conditional rendering of that field is itself part of the lesson.

### 3.9 IP packet model (`models/ip.ts`)

```
IpPacket { kind: 'ip', source, destination, ttl,
           protocol: 'icmp' | 'tcp' | 'udp', payload: TcpSegment | UdpDatagram | IcmpMessage }
```

Minimal honest header: the fields that drive visible behavior (routing, TTL expiry, demultiplexing). Options, fragmentation, and DSCP are deliberately omitted — the lab teaches the datagram's role, not header trivia.

### 3.10 Routing table model (`models/routing.ts`)

```
RoutingEntry { id, destination: Ipv4Address, prefix, nextHop?, interfaceId, metric,
               origin: 'connected' | 'static' }
RoutingTable = readonly RoutingEntry[]
lookupRoute(table, destination) → { entry } | undefined
```

(The same name `RoutingEntry` is used on `RouterNode` for the *configured* static route — a structural subset without `id`/`origin`, which the engine enriches when building the runnable table.)

- **Longest-prefix match**; ties break on metric, then stable id order (determinism preserved even for equal-cost routes).
- Connected routes are *derived* from interface ip/prefix at engine-build time; static routes come from `node.routes`. Derived data can't drift.
- `prefix === 0` renders as "default".

### 3.11 DNS message model (`models/dns.ts`)

```
DnsMessage { kind: 'dns', transactionId, isResponse,
             questions: { name, type: 'A'|'AAAA'|'CNAME'|'NS'|'MX' }[],
             answers?: { name, type, value, ttl }[] }
```

Query/response in one type with `isResponse`; answers (with record TTL) exist only on responses. The lab's zone data maps names to lab addresses.

### 3.12 TCP segment model (`models/tcp.ts`)

```
TcpSegment { kind: 'tcp', sourcePort, destinationPort, sequence, acknowledgment,
             flags: { syn, ack, fin, rst, psh }, window, payload?: HttpMessage }
```

Flags as a struct (inspector renders exactly the set bits); optional HTTP payload models "data in the stream" — the GET rides its own segment after the handshake, which is the correct choreography the lab shows.

### 3.13 HTTP message model (`models/http.ts`)

```
HttpRequest  { kind: 'request',  method: 'GET'|'POST'|'HEAD', path, version: 'HTTP/1.1', headers, body? }
HttpResponse { kind: 'response', status, reason, version: 'HTTP/1.1', headers, body? }
HttpMessage  = HttpRequest | HttpResponse
```

Headers are a plain string record — serializable and inspector-renderable as field rows.

### 3.14 ICMP model (`models/icmp.ts`)

`IcmpMessage { kind: 'icmp', type: 'echo-request' | 'echo-reply' | 'ttl-exceeded' | 'destination-unreachable', code? }` — control-plane feedback (ping, TTL death) as first-class payloads.

---

## 4. Simulation event model (`models/events.ts`)

`SimulationEvent` is a **tagged union** — the entire observable surface of the engine:

- L2/L3 movement: `tx`, `rx`, `forward` (with via + reason), `drop` (with reason)
- ARP narrative: `arp-query-start`, `arp-cache-wait`, `arp-hit`, `arp-miss`, `arp-learn`, `arp-write`, `arp-pending-dequeued`
- Transport: `tcp-state` (from → to with trigger), `http-exchange`, `dns-resolve`
- Teaching annotations: `note`, plus `app-start`/`app-layer-ready`

Every event carries `ts` (sim-ms). `describeEvent(event)` renders the timeline line. Events are append-only and replayable: the log *is* the run's history, and determinism is asserted by comparing logs byte-for-byte.

---

## 5. Canonical packet model & lifecycle (`models/packet.ts`)

```
Packet { id, serial, frame, hops: PacketHop[], state, bornMs, finishedMs?, dropReason? }
PacketHop { linkId, fromInterface, toInterface, startMs, endMs }
PacketState = 'queued' | 'in-flight' | 'delivered' | 'dropped' | 'expired'
```

**Lifecycle:**

1. **Created** (`queued`) by a builder with a deterministic id/serial (counters reset per run).
2. **Transmitted** → `in-flight`: engine records `tx`, appends the first hop, schedules arrival at `now + link.latencyMs`. The frame snapshot is immutable in transit.
3. **Delivered** at a node: `rx` recorded, then routed by role —
   *hub*: copies out all other ports; *switch*: learns source MAC→port, forwards or floods (each forward = a `forward` event + a new hop on the same packet); *host/server/router*: protocol stack decides.
4. **Terminal**: the handler chain ends the packet (`delivered`), refuses it (`dropped`, reason attached), or kills it at TTL zero (`expired`). Replies are **new** packets with fresh lifecycles.

`hops` accumulate per link crossing — the inspector's Path view and the canvas animation both interpolate over them. `packetProtocolLabel`/`packetSummary` derive display strings ("ARP · Who has 10.0.0.12?") purely from the frame.

---

## 6. Simulation engine (`engine/`)

`NetworkEngine` is the single owner of:

- **Time** — simulated milliseconds, advanced only by popping the scheduler. Never wall-clock.
- **The scheduler** (`scheduler.ts`) — `(time, insertionOrder)` priority queue; stable ties ⇒ identical runs.
- **The wire** (`wire.ts`) — transmission is just "schedule delivery at +latency"; `WireTransmission` records depart/arrive.
- **Adjacency indexes** — iface→link and iface tables rebuilt by `reindex()`.
- **Derived state** — per-node routing tables (connected + static) and TCP connection snapshots.

`run(script)` resets internal state, executes the script against a fresh context, drains the scheduler (hard-capped), and returns final `NetworkState`. `step(seed)` pops exactly one scheduled item — the primitive behind Step mode. `resetInternal()` zeroes counters, caches, MAC tables and events between runs (a test asserts run-twice equality).

Handlers receive a **context** (`now`, `emit`, `transmit`, `after`, `routingTable`, `arpGet/arpSet`, `setTcpState`) and own no state; all mutation flows through the engine, keeping determinism and serialization intact.

---

## 7. Protocol behavior layer (`simulation/`)

- `stack.ts` — dispatch by payload kind to handlers; carries the receiver attachment (node + ingress interface).
- `arp.ts` — RFC 826: learn sender binding on any ARP; answer only when the receiving interface owns the target IP; replies are unicast.
- `ip.ts` — accept-if-mine / forward / drop. Forwarding = route lookup → TTL decrement (drop at 0) → egress interface → next-hop MAC from the ARP cache → frame rewrite → retransmit.
- `tcp.ts` — SYN/SYN+ACK/ACK handshake with endpoint state events (`LISTEN→SYN_RCVD→ESTABLISHED`, `CLOSED→SYN_SENT→ESTABLISHED`), HTTP request/response exchange, FIN/ACK teardown.
- `dns.ts` — UDP/53 queries answered from a static per-server zone; unknown names → NXDOMAIN note; clients learn addresses from responses.
- `icmp.ts` — echo requests answered with echo replies.
- `explain.ts` — **deterministic explanations**: pure functions from packet structure to teaching text. No AI, no network: the same packet always yields the same words (test-asserted).

---

## 8. Lab architecture (`labs/`)

```
LabDefinition { id, title, protocols[], objective, topology,
                script: LabScriptEntry[], steps[], task }
LabScriptEntry = atMs + send-arp | send-dns | send-ping | send-http | note
LabStep { id, title, narration, watchEventTypes[] }
```

- A lab is **pure data**; `runner.ts` is the only interpreter, and it drives the *same* engine (`engine.run`). Topologies in `topologies.ts` fix every MAC, IP, prefix and latency — determinism is load-bearing for teaching.
- Steps bind narration to `watchEventTypes`, so the UI can mark which beats the student has actually seen.
- **Extending:** new protocol lab = topology + script + steps. New scripted action = one union member + one `case` in the runner. Labs never contain protocol behavior — only its scheduling.

---

## 9. Visualization state & inspector architecture

- **Visualization layer** (`visualization/layout.ts`): pure functions — `buildTopologyView` (nodes/links/bounds from topology), `packetPosition(packet, topology, simMs)` (hop interpolation), `activePackets`. It knows geometry, not protocols. `components/TopologyCanvas.tsx` renders SVG from these results; clicking a moving dot selects the packet by id.
- **Store** (`state/store.ts`): holds the last `NetworkState` plus UI-only concerns — selected packet, expanded inspector layers, playback flags, cursor time. Actions (`loadLab`, `run`, `step`, `reset`) call the engine/runner and store the returned state. React never re-simulates.
- **Inspector** (`components/PacketInspector.tsx`): derives *sections* from the canonical packet (`buildSections`) — ETHERNET always; ARP/IPv4/TCP/UDP/DNS/HTTP/ICMP only when present. Three views over the same packet: **Layers** (structured fields, per-layer expand/collapse with `aria-expanded`), **Raw** (pretty JSON + copy), **Explain** (deterministic sections from `simulation/explain`). Plus per-packet path highlight and copy-to-clipboard. Field-level "only what exists" rendering is the architecture paying off: no parallel model can drift from the real packet.

---

## 10. Test architecture (`tests/`)

Layered to mirror the dependency rule — each layer's tests mock nothing above it:

1. **`models.test.ts`** — MAC parse/reject/normalize; IPv4 validation, CIDR, masks, uint32 round-trip; routing longest-prefix, metric ties, no-default.
2. **`engine.test.ts`** — topology validation; ARP exchange events + cache learning; **determinism** (two engines ⇒ identical logs); **serialization** (JSON round-trip equality); **reset** (run-twice equality).
3. **`protocols.test.ts`** — every lab runs against a real engine: ARP broadcast/unicast + cache, TTL-zero drops with exact reasons, DNS query/response + resolution, HTTP-in-TCP request/response, TCP transitions to `ESTABLISHED`, visualization geometry from canonical state; parameterized all-labs smoke test.
4. **`components.test.tsx`** — Testing Library: inspector empty state, conditional layers (ARP shows no TCP fields), `aria-expanded` toggling, Raw/Explain switching.
5. **`e2e/app.spec.ts`** — Playwright against the *production build* via `vite preview`: first paint with zero console errors, Run populates timeline/chips, inspector opens on selection, lab nav switches.

`npm test` / `npm run e2e` / `npm run lint` / `npm run typecheck` / `npm run build` gate CI; the Pages workflow runs them all before publishing `dist/`.

---

## 11. Deployment shape (GitHub Pages)

Static, subpath-correct: Vite `base: '/Network-Protocol-Visual-Lab/'`, build → `dist/`, published by `.github/workflows/deploy.yml` (`upload-pages-artifact` + `deploy-pages`). No secrets, no services — the artifact *is* the app, and it issues no network requests at runtime.

---

## 12. Extension playbook (why this stays open)

| Want to add… | You touch |
|---|---|
| A new protocol (e.g. DHCP, NAT) | model type + payload union member; one `simulation/<proto>.ts` handler; one `case` in `stack.ts` |
| A new scripted action | one `LabScriptEntry` member + one runner `case` |
| A new visualization | a pure function in `visualization/` consuming `NetworkState` |
| A new lab | topology + `LabDefinition` (picked up automatically) |
| New inspector fields | nothing — sections derive from the canonical packet |

The UI learns about new protocols automatically because it renders *what the packet is*, never *what the UI assumed*.

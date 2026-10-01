# Network Protocol Visual Lab

An interactive, browser-based laboratory for learning how computer networks really work. Watch Ethernet frames, ARP requests, DNS queries, TCP handshakes and HTTP exchanges move across a simulated network — then click any packet to see and understand every protocol layer inside it.

> **🎓 Open the lab in your browser — no installation needed:**
>
> ## [Launch the Network Protocol Visual Lab →](https://nadeem-majeedch.github.io/Network-Protocol-Visual-Lab/)
>
> https://nadeem-majeedch.github.io/Network-Protocol-Visual-Lab/

[![Deploy to GitHub Pages](https://github.com/nadeem-majeedch/Network-Protocol-Visual-Lab/actions/workflows/deploy.yml/badge.svg)](https://github.com/nadeem-majeedch/Network-Protocol-Visual-Lab/actions/workflows/deploy.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

---

## 1. Overview

Network Protocol Visual Lab is a **teaching tool first**. Every packet you see moving on the canvas is produced by a real, deterministic protocol engine — the same engine that powers the packet inspector and the timeline. Nothing is faked for the animation: if the switch floods a frame, that is what the engine decided.

Pick one of **45 guided labs**, press **Run**, and watch the story of a network conversation unfold event by event. Pause at any moment, scrub the timeline, select any packet, and inspect it layer by layer — from the Ethernet frame on the wire down to the HTTP message inside.

Everything runs client-side in your browser. There is no backend, no account, and no data collection.

## 2. Why this project exists

Textbooks draw protocol stacks as stacked boxes and call it a day. But real understanding comes from watching *when* and *why* each layer does its job:

- Why does a computer **broadcast** an ARP request but **unicast** the reply?
- Why does TTL exist, and what exactly happens when it hits zero?
- Why does DNS use UDP while HTTP uses TCP?
- What does a router *actually* change about your packet — and what does it leave alone?

This lab answers those questions by making the invisible visible. Each scenario is scripted like a guided experiment: the narration tells you what to watch for, the animation shows it happening, and the inspector lets you prove it to yourself by reading the actual fields.

## 3. What students can learn

- **Link layer** — MAC addresses, Ethernet frames, hubs vs. switches, MAC learning and flooding
- **ARP** — why IP-to-MAC resolution must happen before any frame is sent, and how caches make it cheap
- **IP & routing** — subnetting, connected vs. static routes, default gateways, longest-prefix match, next-hop forwarding, TTL
- **DNS** — queries and responses, record types (A, CNAME), caching, TTL expiry, resolvers and authoritative servers
- **TCP** — the three-way handshake, sequence/acknowledgment numbers, flow-control window, connection teardown, TIME_WAIT
- **HTTP** — request/response structure, headers, status codes, and how HTTP rides inside TCP
- **Encapsulation** — how all of the above nest into one frame, and what routers rewrite versus preserve
- **Debugging intuition** — reading a packet like an engineer: what happened, why, which protocol decided it

## 4. Supported protocols

| Protocol | What the simulation models |
| --- | --- |
| **Ethernet** | Frames with source/destination MAC and EtherType; broadcast (`ff:ff:ff:ff:ff:ff`) and unicast delivery |
| **ARP** | RFC 826-style requests/replies; per-node ARP caches with learned bindings |
| **IPv4** | Addressing, TTL decrement, accept/forward/drop decisions |
| **Routing** | Connected and static routes, longest-prefix match, next-hop selection, route tables |
| **UDP** | Connectionless datagrams (carries DNS) |
| **DNS** | Queries over UDP/53, A and CNAME records, caching with TTL expiry, resolver → authoritative flow |
| **TCP** | Handshake, sequence/ACK bookkeeping, window, FIN teardown, a visible state machine |
| **HTTP** | HTTP/1.1 request/response exchange (GET requests with headers; responses with status line, headers and body) |
| **ICMP** | Echo request/reply (ping) |

## 5. Interactive features

- **Animated topology canvas** — packets fly along links between hosts, switches, routers and servers; device icons are color-coded by kind
- **Packet path highlighting** — select a packet and every link it travels lights up
- **Playback controls** — Run, Pause/Play, step forward/backward one event, single engine step, Reset, and speed from 0.25× to 4×
- **Scrubbable timeline** — every simulated event listed in order; drag to any moment and see exactly which packets are in flight
- **Packet Inspector** — structured protocol layers, raw JSON, and a plain-language explanation for any packet
- **Live cache panels** — ARP caches, switch MAC tables, DNS caches (with TTL countdown), TCP state machines, routing tables
- **"How did the router decide?"** — a panel that shows the matching routes, the prefix lengths, and the winner
- **Journey view** (flagship lab) — eight narrated stages from "typed a URL" to "page rendered"
- **Protocol stack view** — HTTP → TCP → IPv4 → Ethernet nesting with the router's frame rewrite shown
- **Topology editor** — draw your own network, wire it up, and run it
- **Lab progress** — completed labs are marked ✓ in the sidebar (stored locally in your browser)
- **Light and dark themes**, keyboard shortcuts (`Space` = play/pause, `←`/`→` = step), and screen-reader-friendly labels

## 6. Protocol stack

The simulator implements a simplified but faithful stack. Each layer wraps the one above it:

```
┌───────────────────────────────────────────────┐
│  HTTP   GET /index.html … / 200 OK (body)     │  what the application says
├───────────────────────────────────────────────┤
│  TCP    ports, sequence numbers, flags        │  makes it reliable
├───────────────────────────────────────────────┤
│  UDP    ports (used by DNS)                   │  makes it lightweight
├───────────────────────────────────────────────┤
│  IPv4   source/destination IP, TTL, protocol  │  routes it end to end
├───────────────────────────────────────────────┤
│  ARP    "who has this IP?" → MAC answers      │  resolves IPs to MACs
├───────────────────────────────────────────────┤
│  Ether  source/destination MAC, EtherType     │  puts it on the wire
└───────────────────────────────────────────────┘
```

Every packet in the lab is a single canonical object containing exactly the layers it carries — an ARP packet has no IP header, a DNS packet has UDP not TCP — and the inspector shows **only the layers that exist**.

## 7. Labs

The catalog has **45 labs** in three groups.

**Flagship journey**

- **Open a Web Page — the complete journey**: type a URL and watch DNS, ARP, routing, the TCP handshake, the GET, the 200 OK, data exchange, and teardown — across a real router.

**Guided curriculum (Labs 01–18)**

| # | Lab | Protocols |
| --- | --- | --- |
| 01 | Ethernet Frames | Ethernet · MAC · ARP |
| 02 | MAC Addresses | MAC · Ethernet · ARP |
| 03 | ARP Request and Reply | ARP · Ethernet · MAC |
| 04 | ARP Cache | ARP · Ethernet · HTTP · TCP · DNS |
| 05 | IPv4 Addressing | IPv4 · Routing · Ethernet · ARP |
| 06 | Default Gateway | ARP · Ethernet · IPv4 |
| 07 | Routing Table Lookup | IPv4 · Routing · ARP |
| 08 | Longest Prefix Matching | IPv4 · Routing |
| 09 | Multi-Router Routing | IPv4 · Routing · ARP |
| 10 | DNS Resolution | DNS · UDP · IPv4 · ARP |
| 11 | DNS Caching | DNS · UDP · IPv4 · Routing |
| 12 | TCP Three-Way Handshake | TCP |
| 13 | TCP Sequence and ACK | TCP |
| 14 | TCP Connection Termination | TCP |
| 15 | HTTP GET | HTTP · TCP · DNS · ARP |
| 16 | HTTP Response | HTTP · TCP |
| 17 | Protocol Encapsulation | HTTP · TCP · IPv4 · Ethernet · DNS · ARP |
| 18 | Complete Web Request | HTTP · DNS · ARP · TCP · IPv4 · Routing · Ethernet |

**Reference labs (26)** — shorter topical scenarios carried over from the original catalog:

- **ARP** — discovering the default gateway; finding a MAC address
- **Routing** — local delivery; through the default gateway; static routes; two routers hop-by-hop; longest-prefix match
- **Ethernet** — hubs, switches and MAC learning
- **IPv4** — crossing subnets
- **DNS** — resolving a hostname; A records; observing caching; CNAME records; cached vs. uncached lookup
- **TCP** — the three-way handshake (two topologies); data transfer; acknowledgement; connection termination
- **HTTP** — one page load through the full stack; sending a GET; inspecting TCP underneath; IP underneath TCP; Ethernet underneath IP; complete encapsulation
- **TTL** — why routing loops cannot last

Each lab states its objective, learning goals, prerequisites, the controls to exercise, what to watch for, hints, a full explanation, and a completion criterion that the engine checks automatically.

## 8. Packet Inspector

Select any packet — click a moving dot on the canvas or a chip in the timeline — and the inspector opens with three views:

- **Layers** — the packet rendered as protocol sections (ETHERNET, ARP, IPv4, TCP, UDP, DNS, HTTP, ICMP). Each section shows exactly the fields that exist for that packet: an ARP request shows Operation, Sender IP/MAC, Target IP (and Target MAC on replies); a DNS response shows Transaction ID, Query, Record type, Response and TTL. Sections expand and collapse independently.
- **Raw** — the complete packet as copyable JSON, exactly as the engine recorded it.
- **Explain** — a plain-language, educational walkthrough of what the packet is doing and why. Explanations are **generated deterministically from packet state** — no AI, no network calls — so the same packet always produces the same explanation.

Also built in: **copy-to-clipboard** for the JSON and the explanation, and a **hop-by-hop path listing** with timings, mirrored on the canvas by highlighting the links the packet travels.

## 9. Routing visualization

Routing labs make the *decision* visible:

- Every device's **routing table** is inspectable — connected routes and static routes with prefix lengths
- `ROUTE_LOOKUP` events show **all candidate routes** for a destination and mark the **longest-prefix winner**
- You watch TTL decrement at every router, see the "TTL exceeded" drop at zero, and compare the frame's MAC addresses (rewritten hop by hop) against the IP addresses (never changed)
- Multi-router labs demonstrate next-hop selection across several hops, and the static-routes lab shows the same router choosing different interfaces for different destinations

## 10. DNS visualization

DNS labs trace resolution end to end:

- **Query and response packets** over UDP/53, with transaction IDs, question name/type, and answer records
- A **DNS flow panel** showing the resolution path: cache lookup → miss → resolver asks the authoritative server → response → cache write → answer returned
- A **DNS cache panel** listing every cached record per node with its remaining TTL — expired entries are struck through
- CNAME chains and cached-versus-uncached comparisons in dedicated labs

## 11. TCP visualization

TCP labs make reliability tangible:

- The **three-way handshake** segment by segment (SYN → SYN+ACK → ACK), with sequence and acknowledgment numbers visible in the inspector
- A **TCP state inspector** showing both endpoints' states (`SYN_SENT`, `SYN_RCVD`, `ESTABLISHED`, `FIN_WAIT_1`, `TIME_WAIT`, …) and the transition that just happened
- **Data and acknowledgements** — every byte counted, ACK = SEQ + length
- **Graceful teardown** — FIN/ACK exchange and the TIME_WAIT pause before the final state

## 12. HTTP visualization

HTTP labs show the application layer riding on TCP:

- The **GET request** — method, path, `Host` header and user-agent — inside a TCP segment with PSH+ACK flags
- The **200 response** — status line, `Content-Type`, and the HTML body the "browser" receives
- An **HTTP inspector** panel summarizing the selected exchange: request line, status line, headers, body
- In the flagship lab, the **protocol stack view** peels the layers apart live and shows the router rewriting only the Ethernet header while the IP header stays untouched

## 13. Technology stack

- **[Vite](https://vitejs.dev)** — dev server and production build
- **[React 18](https://react.dev)** — component-based UI
- **[TypeScript](https://www.typescriptlang.org)** (strict mode, including `exactOptionalPropertyTypes` and `noUncheckedIndexedAccess`)
- **[Zustand](https://github.com/pmndrs/zustand)** — minimal UI state (selection, playback); protocol state stays in the engine
- **[Vitest](https://vitest.dev)** + **[Testing Library](https://testing-library.com)** — unit, integration and component tests
- **[Playwright](https://playwright.dev)** — end-to-end tests against the production build
- **[ESLint](https://eslint.org)** — linting with typescript-eslint and react-hooks rules

No backend, no database, no external APIs. The deployed site is fully static.

## 14. Architecture

The codebase is organized around one rule: **all protocol truth lives in the engine; the UI only renders it.**

```
components/   React presentation — no protocol logic
state/        Zustand UI store (selection, playback cursor)
visualization/  canonical state → geometry (pure functions)
labs/         lab definitions + runner (data, not code paths)
simulation/   protocol handlers (arp, ip, tcp, dns, icmp, http)
engine/       scheduler, wire, ticks, dispatch — owns time
models/       canonical, serializable data structures
```

Key properties:

- **Deterministic** — the same topology + script always produce the same event log (enforced by a byte-identical-log test)
- **Serializable** — `NetworkState` is plain JSON; playback is a cursor over recorded events, never a re-run
- **One packet model** — the canvas, timeline and inspector all read the same `Packet` structure

Deeper reading:

- [docs/architecture.md](docs/architecture.md) — layers, engine internals, extensibility
- [docs/architecture-spec.md](docs/architecture-spec.md) — the original design specification

## 15. Testing

The suite mirrors the architecture — pure-model tests at the bottom, end-to-end tests at the top:

| Layer | What it verifies |
| --- | --- |
| Model tests | MAC/IPv4 parsing, CIDR math, longest-prefix match |
| Engine tests | Determinism (identical logs from identical inputs), serialization, reset behavior |
| Protocol integration | Every lab runs against a real engine; ARP, DNS, TCP, HTTP, TTL behaviors asserted |
| Component tests | Inspector layers, view switching, lab framework UI |
| End-to-end | Full app in Chromium against the production build: run, select, inspect, complete labs |

Current totals: **498 unit/integration/component tests** across 15 files, plus **12 Playwright end-to-end tests**. CI (see below) runs typecheck, lint and the full unit suite on every push before deployment.

```bash
npm test          # Vitest suite
npm run e2e       # Playwright (build first: npm run build)
npm run typecheck
npm run lint
```

See [docs/testing.md](docs/testing.md) for the full testing guide.

## 16. GitHub Pages

The lab is published at **https://nadeem-majeedch.github.io/Network-Protocol-Visual-Lab/** via GitHub Actions: every push to `main` runs typecheck → lint → unit tests → build, and only a green build is deployed to Pages (workflow: [.github/workflows/deploy.yml](.github/workflows/deploy.yml)). A failing test blocks deployment.

To run it locally instead:

```bash
npm install
npm run dev       # http://localhost:5173
```

## 17. Educational use

- **Classroom demos** — project a lab, press Run, narrate the animation
- **Guided labs** — students follow the objectives, watch the scripted stages, and answer the "your task" questions
- **Self-study** — hints and full explanations are collapsible, so the answer is available without spoiling the observation
- **Assessment-friendly** — completion is checked by the engine itself (e.g. "a TCP connection reached ESTABLISHED"), and progress is stored locally in the browser
- **Deterministic by design** — every student sees the same packet sequence, so "look at packet #6" means the same thing for everyone

The simulation is intentionally simplified (fixed latencies, small topologies, HTTP/1.1 GET exchanges) to keep cause and effect legible — it teaches the concepts, not vendor-specific packet formats.

## 18. Project structure

```
├── index.html                  App entry point
├── src/
│   ├── main.tsx                React bootstrap
│   ├── App.tsx                 Shell: header, nav, stage, inspector
│   ├── engine/                 Deterministic engine (scheduler, wire, ticks)
│   ├── simulation/             Protocol handlers (arp, ip, tcp, udp, dns, icmp)
│   ├── models/                 Canonical serializable types (packet, frame, …)
│   ├── labs/                   45 lab definitions, runner, framework helpers
│   ├── components/             React UI (canvas, timeline, inspectors, panels)
│   ├── visualization/          State → layout/geometry (pure)
│   ├── state/                  Zustand stores (UI, progress, theme)
│   └── styles/                 Design system (global.css)
├── tests/                      Vitest suites + Playwright e2e specs
├── docs/                       Architecture & model documentation
└── .github/workflows/          CI + GitHub Pages deployment
```

## 19. Contributing

Contributions are welcome — new labs are especially valuable!

- **Propose a lab**: open an issue describing the concept, target protocols, and what a student should observe. A lab is data (topology + script + narration), so adding one usually touches no engine code.
- **Fix or extend**: check the architecture docs first — protocol behavior belongs in `simulation/`, rendering in `components/`.
- **Before opening a PR**, please run:

```bash
npm test
npm run typecheck
npm run lint
npm run build
npm run e2e
```

The determinism guarantee is the product: if your change alters the event log for an existing lab, that's a semantic change and should be called out in the PR description.

## 20. License

Released under the [MIT License](LICENSE) — free to use, modify, and share, including in classrooms.

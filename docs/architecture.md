# Architecture

Network Protocol Visual Lab is an educational, fully client-side application. This document describes the architecture and the boundaries that keep it maintainable.

## Design principles

1. **One canonical simulation engine.** All packet movement, timing and protocol behavior flows through `NetworkEngine`. There is no second code path for labs, demos, or the UI.
2. **React UI contains no protocol logic.** Components render canonical state; they never decide what a packet means.
3. **Deterministic behavior.** The same topology and script always produce the same event log — enforced by tests.
4. **Serializable state.** `NetworkState` is plain JSON. No functions, classes, Maps or randomness cross the engine boundary.
5. **Visualizations consume canonical state.** Every pixel on screen derives from `NetworkState` via the `visualization/` layer.
6. **One packet model.** The inspector, canvas, and timeline all read the same `Packet` structure.
7. **Labs use the same engine.** A lab is data (topology + script + narration) executed by `NetworkEngine` through the lab runner.

## Layer boundaries

```
┌─────────────────────────────────────────────┐
│  components/  (React presentation)          │  ← no protocol logic
│  state/       (Zustand UI store)            │
├─────────────────────────────────────────────┤
│  visualization/ (state → geometry)          │  ← pure functions
├─────────────────────────────────────────────┤
│  labs/        (definitions + runner)        │  ← data + scripting
├─────────────────────────────────────────────┤
│  simulation/  (protocol handlers)           │  ← behavior
│  engine/      (scheduler, wire, ticks)      │  ← movement + time
├─────────────────────────────────────────────┤
│  models/      (canonical serializable data) │  ← types only
└─────────────────────────────────────────────┘
```

Dependency direction is strictly downward: `components → state → visualization → labs → simulation → engine → models`. No module imports upward; `models` imports nothing from the app.

## The engine

`src/engine/network-engine.ts` owns:

- **Time.** Simulated milliseconds; advanced only by popping the scheduler.
- **The scheduler.** A deterministic, order-stable priority queue of callbacks (`scheduler.ts`).
- **The wire.** Transmitting a frame schedules an arrival at `now + link.latencyMs` (`wire.ts`).
- **Dispatch.** On delivery, the frame goes to the protocol stack with the receiving node/interface attached.
- **Derived state.** Routing tables (connected + static) and TCP connection snapshots.

Hubs flood every frame out all other ports; switches learn source MAC → port and forward (flood when unknown); end hosts accept frames addressed to their MAC or to broadcast and hand them to the protocol stack.

## The protocol stack

`src/simulation/stack.ts` dispatches inbound frames by payload type to handlers:

- `arp.ts` — RFC 826 behavior: learn sender binding, answer requests for our IP, emit replies.
- `ip.ts` — accept-if-mine / forward / drop, TTL decrement, longest-prefix route lookup, next-hop MAC resolution via the ARP cache.
- `tcp.ts` — SYN/SYN+ACK/ACK handshake, HTTP request/response exchange, FIN teardown, state events.
- `dns.ts` — UDP/53 queries answered from a static zone; clients learn addresses from responses.
- `icmp.ts` — echo requests answered with echo replies.
- `explain.ts` — deterministic, state-generated explanations for the inspector's "Explain this packet" view.

Handlers receive a `HandlerContext` (now, emit, transmit, after, routingTable, arpGet/arpSet, setTcpState) and own no state themselves; all mutation happens through the engine.

## Extensibility

Adding a protocol touches three places, all inside the simulation/engine boundary:

1. A model in `src/models/` (serializable payload type, added to the payload union).
2. A handler module in `src/simulation/` with an `*Inbound(packet, ctx, node)` function.
3. A `case` in `stack.ts` dispatch (and, if it is a new EtherType, the frame model).

The UI picks up new layers automatically because the inspector renders whichever sections the canonical packet actually contains.

## State flow

```
lab script ──▶ NetworkEngine.run() ──▶ NetworkState (JSON)
                                           │
                    ┌──────────────────────┼──────────────────┐
                    ▼                      ▼                  ▼
              Timeline                TopologyCanvas     PacketInspector
              (events)               (visualization/)    (packet model)
```

The store keeps the last `NetworkState` plus UI concerns (selection, expansion, playback). Re-rendering never re-runs the simulation.

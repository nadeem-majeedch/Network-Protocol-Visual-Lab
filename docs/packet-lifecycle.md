# Packet Lifecycle

From creation to terminal state, every packet follows the same path through the engine.

## States

```
        transmit()                deliver()              handler
queued ───────────▶ in-flight ───────────▶ received ───────────▶ delivered
                        │                                       
                        └──── TTL 0 / no route ─▶ dropped      
```

- **`queued`** — created by a builder, not yet on a wire. (Internal; scripts transmit immediately.)
- **`in-flight`** — traversing a link; arrival scheduled at `departMs + latencyMs`.
- **`delivered`** — accepted by the destination node's handler path.
- **`dropped`** — a handler (or the wire) refused it; `dropReason` says why.
- **`expired`** — TTL reached zero at a router.

## Hop by hop

1. **Script or handler calls `ctx.transmit(frame, nodeId, ifaceId)`.**
   The engine creates the `Packet` (deterministic id/serial), records a `tx` event, and appends the first `PacketHop`.
2. **The wire.** Arrival is scheduled at `now + link.latencyMs`. Nothing can change the frame in transit — the snapshot is immutable.
3. **Delivery.** An `rx` event is recorded. Then:
   - **Hub** (repeater): the engine copies the frame out every other port.
   - **Switch**: learns `source MAC → ingress port`, then forwards to the known port or floods; each forward emits a `forward` event and a new hop.
   - **Host/server/router**: the protocol stack runs.
4. **Protocol decision.** ARP answers or learns; IPv4 accepts/forwards/drops with TTL accounting; TCP advances its state machine; DNS answers from the zone; ICMP replies to pings. Any of these may `transmit` again, starting the cycle for a *new* packet (replies) — the incoming packet's own lifecycle ends here.

## Example: an HTTP page load

```
#1 ARP request  (broadcast)   client → switch → DNS/web servers
#2 ARP reply   (unicast)      back to client
#3 TCP SYN                    client → web server
#4 TCP SYN+ACK                web server → client
#5 TCP ACK                    client → web server
#6 HTTP GET (in TCP)          client → web server
#7 HTTP 200 (in TCP)          web server → client
```

Each numbered packet is independently inspectable at every layer it contains, at any point in its lifecycle — including after it has been delivered or dropped.

## Where drops come from

| Stage | Reason string |
|---|---|
| IPv4 at a host | "Destination IP is not mine" |
| IPv4 at a router | "No route to host" |
| IPv4 at a router | "TTL expired in transit" |
| UDP at a non-server | "UDP/53 not open here" |

Drops are ordinary events, rendered in the timeline like everything else — students are meant to see and question them.

/**
 * ProtocolStackView: the flagship layer view for the selected packet —
 * HTTP → TCP → IPv4 → Ethernet as nested cards, each naming the header
 * fields that layer added. For packets that crossed the router, a
 * dedicated banner shows the two frames: same IP destination, different
 * Ethernet addresses — the encapsulation lesson at its clearest.
 */

import { useApp } from '../state/store';
import type { Packet } from '../models/packet';

interface LayerCard {
  readonly name: string;
  readonly added: readonly (readonly [string, string])[];
}

export function ProtocolStackView() {
  const state = useApp((s) => s.state);
  const selectedPacketId = useApp((s) => s.selectedPacketId);
  const lab = useApp((s) => s.lab);
  if (state === null || lab?.id !== 'open-web-page') return null;

  const packet: Packet | undefined = state.packets.find((p) => p.id === selectedPacketId);
  if (packet === undefined || packet.frame.payload.kind !== 'ip') {
    return (
      <section className="cache-panel" aria-label="Protocol stack">
        <h3>Protocol stack</h3>
        <p className="muted panel-hint">Select a packet to see its layers: HTTP → TCP → IPv4 → Ethernet.</p>
      </section>
    );
  }

  const ip = packet.frame.payload.ip;
  const layers: LayerCard[] = [
    {
      name: 'Ethernet',
      added: [
        ['Destination MAC', packet.frame.destination],
        ['Source MAC', packet.frame.source],
        ['EtherType', `0x${packet.frame.etherType.toString(16).padStart(4, '0')}`]
      ]
    },
    {
      name: 'IPv4',
      added: [
        ['Source IP', ip.source],
        ['Destination IP', ip.destination],
        ['TTL', String(ip.ttl)],
        ['Protocol', ip.payload.kind.toUpperCase()]
      ]
    }
  ];
  if (ip.payload.kind === 'tcp') {
    const segment = ip.payload;
    layers.push({
      name: 'TCP',
      added: [
        ['Ports', `${segment.sourcePort} → ${segment.destinationPort}`],
        ['SEQ', String(segment.sequence)],
        ['ACK', String(segment.acknowledgment)],
        ['Flags', flagsLabel(segment.flags)]
      ]
    });
    if (segment.payload !== undefined && (segment.payload.kind === 'request' || segment.payload.kind === 'response')) {
      layers.unshift(httpLayer(segment.payload));
    }
  }

  const crossedRouter = crossedRouterFrames(state, packet);

  return (
    <section className="cache-panel" aria-label="Protocol stack">
      <h3>Protocol stack</h3>
      <div className="stack-layers">
        {layers.map((layer) => (
          <div key={layer.name} className={`stack-layer stack-${layer.name.toLowerCase()}`}>
            <span className="stack-name">{layer.name}</span>
            <table className="route-table">
              <tbody>
                {layer.added.map(([field, value]) => (
                  <tr key={field}>
                    <th scope="row">{field}</th>
                    <td className="mono">{value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>
      {crossedRouter !== undefined && (
        <div className="frame-rewrite">
          <h4>The frame changed — the IP destination did not</h4>
          <table className="route-table">
            <thead>
              <tr>
                <th scope="col">Leg</th>
                <th scope="col">Frame src → dst (Ethernet)</th>
                <th scope="col">IP destination</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Browser → Router</td>
                <td className="mono">{crossedRouter.first}</td>
                <td className="mono">{crossedRouter.ipDst}</td>
              </tr>
              <tr>
                <td>Router → Server</td>
                <td className="mono">{crossedRouter.second}</td>
                <td className="mono">{crossedRouter.ipDst}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function httpLayer(payload: import('../models/http').HttpMessage): LayerCard {
  if (payload.kind === 'request') {
    return {
      name: 'HTTP',
      added: [
        ['Request line', `${payload.method} ${payload.path} ${payload.version}`],
        ['Host', payload.headers['Host'] ?? '']
      ]
    };
  }
  return {
    name: 'HTTP',
    added: [
      ['Status line', `${payload.version} ${payload.status} ${payload.reason}`],
      ['Content-Type', payload.headers['Content-Type'] ?? '']
    ]
  };
}

function flagsLabel(flags: { syn: boolean; ack: boolean; fin: boolean; rst: boolean; psh: boolean }): string {
  return [flags.syn && 'SYN', flags.ack && 'ACK', flags.fin && 'FIN', flags.rst && 'RST', flags.psh && 'PSH']
    .filter(Boolean)
    .join('+');
}

/**
 * Finds the packet's two L2 hops across the router anywhere in its path:
 * consecutive hops where one ends on a router interface and the next
 * starts on one. Same packet, two frames.
 */
function crossedRouterFrames(
  state: NonNullable<ReturnType<typeof useApp.getState>['state']>,
  packet: Packet
): { first: string; second: string; ipDst: string } | undefined {
  if (packet.frame.payload.kind !== 'ip') return undefined;
  const ifaceNode = (ifaceId: string): string | undefined =>
    state.topology.nodes.find((n) => n.interfaces.some((i) => i.id === ifaceId))?.id;
  for (let i = 0; i + 1 < packet.hops.length; i++) {
    const a = packet.hops[i];
    const b = packet.hops[i + 1];
    if (a === undefined || b === undefined) continue;
    if (ifaceNode(a.toInterface) === 'web-router' && ifaceNode(b.fromInterface) === 'web-router') {
      const macOf = (ifaceId: string): string =>
        state.topology.nodes.flatMap((n) => n.interfaces).find((i) => i.id === ifaceId)?.mac ?? '?';
      return {
        first: `${macOf(a.fromInterface)} → ${macOf(a.toInterface)}`,
        second: `${macOf(b.fromInterface)} → ${macOf(b.toInterface)}`,
        ipDst: packet.frame.payload.ip.destination
      };
    }
  }
  return undefined;
}

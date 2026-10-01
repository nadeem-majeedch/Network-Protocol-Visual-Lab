/**
 * TopologyCanvas: renders the topology and packets as SVG.
 *
 * Consumes only canonical NetworkState via visualization helpers —
 * zero protocol logic lives here. Devices draw as monochrome vector
 * glyphs tinted by the device kind (host=NETWORK blue, router=ROUTING
 * amber, server=data green, switch/hub neutral infrastructure), and
 * packets carry a soft motion aura while in flight. Packet dots are
 * keyboard-focusable and Enter/Space selects them.
 */

import { useMemo } from 'react';
import type { NetworkState } from '../models/network-state';
import type { Topology } from '../models/topology';
import { buildTopologyView, packetPosition } from '../visualization/layout';
import type { Node } from '../models/topology';

type NodeKind = Node['kind'];
import { packetSummary, packetProtocolLabel } from '../models/packet';

function packetSummaryLabel(packet: import('../models/packet').Packet): string {
  return `#${packet.serial} ${packetProtocolLabel(packet.frame)} — ${packetSummary(packet.frame)}`;
}

/**
 * Vector device icons, drawn in a 24×24 box centered on (0,0).
 * Monochrome line art so the CSS stroke hue communicates the kind;
 * every icon stays legible at the 26px node radius.
 */
function DeviceGlyph({ kind }: { readonly kind: NodeKind }) {
  switch (kind) {
    case 'host':
      return (
        <g className="device-glyph">
          {/* monitor + stand */}
          <rect x="-8" y="-8" width="16" height="11" rx="1.5" />
          <line x1="0" y1="3" x2="0" y2="7" />
          <line x1="-5" y1="7" x2="5" y2="7" />
        </g>
      );
    case 'router':
      return (
        <g className="device-glyph">
          {/* capsule with opposing arrows: the routing decision */}
          <rect x="-10" y="-5.5" width="20" height="11" rx="5.5" />
          <path d="M -6 -1.8 L -2 -1.8 M -3.4 -3.4 L -2 -1.8 L -3.4 -0.2" />
          <path d="M 6 1.8 L 2 1.8 M 3.4 0.2 L 2 1.8 L 3.4 3.4" />
        </g>
      );
    case 'server':
      return (
        <g className="device-glyph">
          {/* rack: stacked units with a status LED each */}
          <rect x="-7.5" y="-9" width="15" height="7" rx="1.2" />
          <rect x="-7.5" y="1" width="15" height="7" rx="1.2" />
          <circle cx="-4.5" cy="-5.5" r="1" />
          <circle cx="-4.5" cy="4.5" r="1" />
        </g>
      );
    case 'switch':
      return (
        <g className="device-glyph">
          {/* crossed flows: frames in, frames out */}
          <rect x="-10" y="-6" width="20" height="12" rx="2" />
          <path d="M -6 -2.5 L 6 -2.5 M 3.5 -5 L 6 -2.5 L 3.5 0" />
          <path d="M 6 2.5 L -6 2.5 M -3.5 0 L -6 2.5 L -3.5 5" />
        </g>
      );
    case 'hub':
      return (
        <g className="device-glyph">
          {/* a hub repeats: one port, fan-out to every direction */}
          <circle cx="0" cy="0" r="3" />
          <line x1="0" y1="-3" x2="0" y2="-9" />
          <line x1="0" y1="3" x2="0" y2="9" />
          <line x1="-3" y1="0" x2="-9" y2="0" />
          <line x1="3" y1="0" x2="9" y2="0" />
        </g>
      );
  }
}

export interface TopologyCanvasProps {
  readonly topology: Topology;
  readonly state: NetworkState | null;
  readonly cursorMs: number;
  readonly selectedPacketId: string | null;
  readonly onSelectPacket: (id: string) => void;
  /** Editor mode: clicking nodes selects them instead of packets. */
  readonly editorMode?: boolean;
  readonly selectedNodeId?: string | null;
  readonly pendingLinkFrom?: string | null;
  readonly onSelectNode?: (id: string) => void;
}

export function TopologyCanvas({
  topology,
  state,
  cursorMs,
  selectedPacketId,
  onSelectPacket,
  editorMode = false,
  selectedNodeId = null,
  pendingLinkFrom = null,
  onSelectNode
}: TopologyCanvasProps) {
  const view = useMemo(() => buildTopologyView(topology), [topology]);
  // Links traversed by the selected packet: rendered as an emphasized path.
  const pathLinkIds = useMemo(() => {
    if (state === null || selectedPacketId === null) return new Set<string>();
    const selected = state.packets.find((p) => p.id === selectedPacketId);
    return new Set(selected === undefined ? [] : selected.hops.map((h) => h.linkId));
  }, [state, selectedPacketId]);
  // Packets visible at the cursor: created, and not yet beyond their last hop.
  const packets = (state === null ? [] : state.packets).filter((p) => {
    const born = p.hops[0]?.startMs ?? p.bornMs;
    const last = p.hops[p.hops.length - 1];
    return born <= cursorMs && (last === undefined || cursorMs <= last.endMs + 400);
  });

  return (
    <svg
      viewBox={`0 0 ${view.bounds.width} ${view.bounds.height}`}
      className="topology-canvas"
      role="img"
      aria-label={`Topology: ${topology.name}`}
    >
      {view.links.map((link) => (
        <polyline
          key={link.id}
          points={[link.from, ...link.waypoints, link.to].map((p) => `${p.x},${p.y}`).join(' ')}
          className={`topology-link${pathLinkIds.has(link.id) ? ' path-active' : ''}`}
        />
      ))}

      {packets.map((packet) => {
        const { point, active } = packetPosition(packet, topology, cursorMs);
        const selected = packet.id === selectedPacketId;
        return (
          <g
            key={packet.id}
            transform={`translate(${point.x}, ${point.y})`}
            className={`packet-dot${selected ? ' selected' : ''}${active ? '' : ' settled'}`}
            tabIndex={0}
            role="button"
            aria-label={`Select packet #${packet.serial}: ${packetSummary(packet.frame)}`}
            onClick={() => onSelectPacket(packet.id)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onSelectPacket(packet.id);
              }
            }}
          >
            {/* Motion aura: a wider soft ring only while in flight. */}
            {active && <circle className="packet-trail" r="13" />}
            <circle r="9" />
            <text y="4" textAnchor="middle">
              {packet.serial}
            </text>
            <title>{packetSummaryLabel(packet)}</title>
          </g>
        );
      })}

      {view.nodes.map(({ node, position, label }) => (
        <g
          key={node.id}
          transform={`translate(${position.x}, ${position.y})`}
          className={`topology-node kind-${node.kind}${editorMode ? ' clickable' : ''}${selectedNodeId === node.id ? ' node-selected' : ''}${pendingLinkFrom === node.id ? ' node-linking' : ''}${!node.enabled ? ' node-off' : ''}`}
          onClick={editorMode && onSelectNode !== undefined ? () => onSelectNode(node.id) : undefined}
        >
          <circle r="26" className="node-shape" />
          <DeviceGlyph kind={node.kind} />
          <text className="node-label" y="46" textAnchor="middle">
            {label}
          </text>
          {node.interfaces[0]?.ip !== undefined && (
            <text className="node-sublabel" y="62" textAnchor="middle">
              {node.interfaces[0].ip}
            </text>
          )}
          {!node.enabled && (
            <text className="node-off-mark" y="-30" textAnchor="middle">
              ⏻ off
            </text>
          )}
        </g>
      ))}
    </svg>
  );
}

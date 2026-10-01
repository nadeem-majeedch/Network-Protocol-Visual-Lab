/**
 * Visualization layer: pure geometry derived from canonical state.
 *
 * Nothing here knows about protocol semantics — it maps NetworkState onto
 * pixel space so React and SVG can render without simulation knowledge.
 */

import type { NetworkState } from '../models/network-state';
import type { Packet } from '../models/packet';
import type { Point } from '../models/layout';
import type { Topology, Node } from '../models/topology';

export interface NodeView {
  readonly node: Node;
  readonly position: Point;
  readonly label: string;
}

export interface LinkView {
  readonly id: string;
  readonly from: Point;
  readonly to: Point;
  readonly waypoints: readonly Point[];
}

export interface TopologyView {
  readonly nodes: readonly NodeView[];
  readonly links: readonly LinkView[];
  readonly bounds: { readonly width: number; readonly height: number };
}

export function buildTopologyView(topology: Topology): TopologyView {
  const pos = (ifaceId: string): Point | undefined => {
    const iface = topology.nodes.flatMap((n) => n.interfaces).find((i) => i.id === ifaceId);
    const node = iface !== undefined ? topology.nodes.find((n) => n.id === iface.nodeId) : undefined;
    return node !== undefined ? topology.layout.nodes[node.id] : undefined;
  };

  const links: LinkView[] = [];
  for (const link of topology.links) {
    const a = pos(link.endpoints[0] as string);
    const b = pos(link.endpoints[1] as string);
    if (a === undefined || b === undefined) continue;
    links.push({
      id: link.id,
      from: a,
      to: b,
      waypoints: topology.layout.links[link.id] ?? []
    });
  }

  const nodes: NodeView[] = topology.nodes
    .map((node) => {
      const position = topology.layout.nodes[node.id] ?? { x: 0, y: 0 };
      return { node, position, label: node.name };
    })
    .filter((nv) => topology.layout.nodes[nv.node.id] !== undefined);

  const width = Math.max(...nodes.map((n) => n.position.x), 100) + 120;
  const height = Math.max(...nodes.map((n) => n.position.y), 100) + 120;

  return { nodes, links, bounds: { width, height } };
}

/** Position of a packet along its hops at time t (sim-ms). */
export function packetPosition(
  packet: Packet,
  topology: Topology,
  simMs: number
): { readonly point: Point; readonly active: boolean } {
  const hops = packet.hops;
  if (hops.length === 0) return { point: originNode(packet, topology), active: false };

  for (const hop of hops) {
    if (simMs >= hop.startMs && simMs <= hop.endMs) {
      const a = endpointPoint(topology, hop.fromInterface);
      const b = endpointPoint(topology, hop.toInterface);
      if (a === undefined || b === undefined) return { point: a ?? b ?? { x: 0, y: 0 }, active: true };
      const span = Math.max(hop.endMs - hop.startMs, 1);
      const t = Math.min(Math.max((simMs - hop.startMs) / span, 0), 1);
      return { point: lerp(a, b, t), active: true };
    }
  }

  const last = hops[hops.length - 1];
  if (last !== undefined && simMs > last.endMs) {
    return { point: endpointPoint(topology, last.toInterface) ?? { x: 0, y: 0 }, active: false };
  }
  return { point: endpointPoint(topology, hops[0]!.fromInterface) ?? { x: 0, y: 0 }, active: false };
}

function originNode(packet: Packet, topology: Topology): Point {
  const mac = packet.frame.source;
  const node = topology.nodes.find((n) => n.interfaces.some((i) => i.mac === mac));
  return node !== undefined ? topology.layout.nodes[node.id] ?? { x: 0, y: 0 } : { x: 0, y: 0 };
}

function endpointPoint(topology: Topology, ifaceId: string): Point | undefined {
  for (const node of topology.nodes) {
    if (node.interfaces.some((i) => i.id === ifaceId)) {
      return topology.layout.nodes[node.id];
    }
  }
  return undefined;
}

function lerp(a: Point, b: Point, t: number): Point {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

/** Packets visible at a given sim time (created and not yet expired). */
export function activePackets(state: NetworkState, simMs: number): readonly Packet[] {
  return state.packets.filter((p) => p.bornMs <= simMs);
}

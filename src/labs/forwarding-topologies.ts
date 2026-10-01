/**
 * Forwarding-lab topologies: fixed addresses, MACs and latencies so every
 * routing scenario is deterministic. These mirror the classic textbook
 * chain — PC1 → Router1 → Router2 → Server — plus a three-router branch
 * for static-route and longest-prefix-match lessons.
 *
 * Address plan:
 *   LAN A   192.168.1.0/24   (PC1, Router1 LAN)
 *   WAN 1   10.0.0.0/30      (Router1 ↔ Router2 point-to-point)
 *   LAN B   192.168.2.0/24   (Router2 LAN, Server)
 *   Branch  10.50.0.0/30, 10.60.0.0/30 (Router1 ↔ Router2b/Router3)
 *           192.168.40.0/24 (Server A), 192.168.60.0/24 (Server B)
 */

import type { Topology, Link, Node, RoutingEntry } from '../models/topology';
import type { Point } from '../models/layout';
import { mac } from '../models/mac';
import { ipv4 } from '../models/ipv4';

interface IfaceDef {
  readonly id: string;
  readonly nodeId: string;
  readonly macHex: string;
  readonly label: string;
  readonly ip?: string;
  readonly prefix?: number;
}

function iface(def: IfaceDef) {
  return {
    id: def.id,
    nodeId: def.nodeId,
    mac: mac(def.macHex),
    ...(def.ip !== undefined ? { ip: ipv4(def.ip) } : {}),
    ...(def.prefix !== undefined ? { prefix: def.prefix } : {}),
    enabled: true,
    label: def.label
  };
}

function link(id: string, a: string, b: string, latencyMs = 4): Link {
  return { id, endpoints: [a, b], latencyMs, enabled: true };
}

function switchNode(id: string, name: string, ports: readonly string[], macBase: string): Node {
  // macBase must end with ':' after five groups (e.g. '02:00:00:0c:00:');
  // each port appends exactly two hex digits.
  return {
    id,
    kind: 'switch',
    name,
    enabled: true,
    description: 'Forwards frames by MAC; no IP layer',
    interfaces: ports.map((p, i) =>
      iface({ id: `${id}-${p}`, nodeId: id, macHex: `${macBase}${String(i + 1).padStart(2, '0')}`, label: p })
    )
  };
}

function layoutOf(positions: Record<string, Point>): Topology['layout'] {
  return { nodes: positions, links: {} };
}

/* ------------------------------------------------------------------ */
/* Lab: local delivery — one subnet, no router at all                  */
/* ------------------------------------------------------------------ */

export const localDeliveryTopology: Topology = {
  id: 'local-delivery-lab',
  name: 'One subnet, zero routers',
  nodes: [
    {
      id: 'ld-pc1',
      kind: 'host',
      name: 'PC1',
      enabled: true,
      description: 'Same subnet as the server — no gateway configured',
      interfaces: [iface({ id: 'ld-pc1-eth0', nodeId: 'ld-pc1', macHex: '02:00:00:0c:00:11', label: 'eth0', ip: '192.168.1.10', prefix: 24 })]
    },
    switchNode('ld-switch', 'Switch', ['p1', 'p2'], '02:00:00:0c:00:'),
    {
      id: 'ld-server',
      kind: 'server',
      name: 'Server',
      enabled: true,
      description: '192.168.1.20 — on-link with PC1',
      interfaces: [iface({ id: 'ld-server-eth0', nodeId: 'ld-server', macHex: '02:00:00:0c:00:21', label: 'eth0', ip: '192.168.1.20', prefix: 24 })]
    }
  ],
  links: [
    link('l-ld-1', 'ld-pc1-eth0', 'ld-switch-p1'),
    link('l-ld-2', 'ld-switch-p2', 'ld-server-eth0')
  ],
  layout: layoutOf({
    'ld-pc1': { x: 120, y: 330 },
    'ld-switch': { x: 430, y: 330 },
    'ld-server': { x: 740, y: 330 }
  })
};

/* ------------------------------------------------------------------ */
/* Lab: the canonical chain — PC1 → Router1 → Router2 → Server         */
/* ------------------------------------------------------------------ */

function forwardingNodes(r1Routes: readonly RoutingEntry[]): readonly Node[] {
  return [
    {
      id: 'fwd-pc1',
      kind: 'host',
      name: 'PC1',
      enabled: true,
      description: '192.168.1.10 — wants to reach 192.168.2.20',
      gateway: ipv4('192.168.1.1'),
      interfaces: [iface({ id: 'fwd-pc1-eth0', nodeId: 'fwd-pc1', macHex: '02:00:00:0b:00:01', label: 'eth0', ip: '192.168.1.10', prefix: 24 })]
    },
    switchNode('fwd-sw-lan', 'LAN Switch', ['p1', 'p2'], '02:00:00:0b:01:'),
    {
      id: 'fwd-r1',
      kind: 'router',
      name: 'Router1',
      enabled: true,
      description: '192.168.1.1 on the LAN, 10.0.0.1 on the WAN link',
      routes: r1Routes,
      interfaces: [
        iface({ id: 'fwd-r1-eth0', nodeId: 'fwd-r1', macHex: '02:00:00:0b:00:11', label: 'lan', ip: '192.168.1.1', prefix: 24 }),
        iface({ id: 'fwd-r1-eth1', nodeId: 'fwd-r1', macHex: '02:00:00:0b:00:12', label: 'wan', ip: '10.0.0.1', prefix: 30 })
      ]
    },
    {
      id: 'fwd-r2',
      kind: 'router',
      name: 'Router2',
      enabled: true,
      description: '10.0.0.2 on the WAN link, 192.168.2.1 on the server LAN',
      routes: [{ destination: '192.168.1.0', prefix: 24, nextHop: ipv4('10.0.0.1'), interfaceId: 'fwd-r2-eth0', metric: 10 }],
      interfaces: [
        iface({ id: 'fwd-r2-eth0', nodeId: 'fwd-r2', macHex: '02:00:00:0b:00:21', label: 'wan', ip: '10.0.0.2', prefix: 30 }),
        iface({ id: 'fwd-r2-eth1', nodeId: 'fwd-r2', macHex: '02:00:00:0b:00:22', label: 'lan', ip: '192.168.2.1', prefix: 24 })
      ]
    },
    switchNode('fwd-sw-dmz', 'Server Switch', ['p1', 'p2'], '02:00:00:0b:02:'),
    {
      id: 'fwd-server',
      kind: 'server',
      name: 'Server',
      enabled: true,
      description: '192.168.2.20 — two router hops away',
      gateway: ipv4('192.168.2.1'),
      interfaces: [iface({ id: 'fwd-server-eth0', nodeId: 'fwd-server', macHex: '02:00:00:0b:00:41', label: 'eth0', ip: '192.168.2.20', prefix: 24 })]
    }
  ];
}

/** The example topology: PC1 → Router1 → Router2 → Server. */
export const forwardingTopology: Topology = {
  id: 'forwarding-lab',
  name: 'Two routers between PC1 and the server',
  nodes: forwardingNodes([
    { destination: '192.168.2.0', prefix: 24, nextHop: ipv4('10.0.0.2'), interfaceId: 'fwd-r1-eth1', metric: 10 }
  ]),
  links: [
    link('l-fw-1', 'fwd-pc1-eth0', 'fwd-sw-lan-p1'),
    link('l-fw-2', 'fwd-sw-lan-p2', 'fwd-r1-eth0'),
    link('l-fw-3', 'fwd-r1-eth1', 'fwd-r2-eth0', 3),
    link('l-fw-4', 'fwd-r2-eth1', 'fwd-sw-dmz-p1'),
    link('l-fw-5', 'fwd-sw-dmz-p2', 'fwd-server-eth0')
  ],
  layout: layoutOf({
    'fwd-pc1': { x: 100, y: 340 },
    'fwd-sw-lan': { x: 300, y: 340 },
    'fwd-r1': { x: 500, y: 340 },
    'fwd-r2': { x: 720, y: 340 },
    'fwd-sw-dmz': { x: 920, y: 340 },
    'fwd-server': { x: 1120, y: 340 }
  })
};

/* ------------------------------------------------------------------ */
/* Labs: static routes + longest-prefix match — one router, two paths  */
/* ------------------------------------------------------------------ */

function branchedTopology(r1Routes: readonly RoutingEntry[], id: string, name: string): Topology {
  return {
    id,
    name,
    nodes: [
      {
        id: 'br-pc1',
        kind: 'host',
        name: 'PC1',
        enabled: true,
        description: 'Sends to both 192.168.40.20 and 192.168.60.20',
        gateway: ipv4('172.16.5.1'),
        interfaces: [iface({ id: 'br-pc1-eth0', nodeId: 'br-pc1', macHex: '02:00:00:0d:00:01', label: 'eth0', ip: '172.16.5.10', prefix: 24 })]
      },
      switchNode('br-sw', 'Access Switch', ['p1', 'p2'], '02:00:00:0d:01:'),
      {
        id: 'br-r1',
        kind: 'router',
        name: 'Router1',
        enabled: true,
        description: 'Chooses between two downstream routers per route',
        routes: r1Routes,
        interfaces: [
          iface({ id: 'br-r1-eth0', nodeId: 'br-r1', macHex: '02:00:00:0d:00:11', label: 'lan', ip: '172.16.5.1', prefix: 24 }),
          iface({ id: 'br-r1-eth1', nodeId: 'br-r1', macHex: '02:00:00:0d:00:12', label: 'to-r2', ip: '10.50.0.1', prefix: 30 }),
          iface({ id: 'br-r1-eth2', nodeId: 'br-r1', macHex: '02:00:00:0d:00:13', label: 'to-r3', ip: '10.60.0.1', prefix: 30 })
        ]
      },
      {
        id: 'br-r2',
        kind: 'router',
        name: 'Router2',
        enabled: true,
        description: 'Serves 192.168.40.0/24',
        routes: [
          { destination: '172.16.5.0', prefix: 24, nextHop: ipv4('10.50.0.1'), interfaceId: 'br-r2-eth0', metric: 10 }
        ],
        interfaces: [
          iface({ id: 'br-r2-eth0', nodeId: 'br-r2', macHex: '02:00:00:0d:00:21', label: 'to-r1', ip: '10.50.0.2', prefix: 30 }),
          iface({ id: 'br-r2-eth1', nodeId: 'br-r2', macHex: '02:00:00:0d:00:22', label: 'lan', ip: '192.168.40.1', prefix: 24 })
        ]
      },
      {
        id: 'br-r3',
        kind: 'router',
        name: 'Router3',
        enabled: true,
        description: 'Serves 192.168.60.0/24',
        routes: [
          { destination: '172.16.5.0', prefix: 24, nextHop: ipv4('10.60.0.1'), interfaceId: 'br-r3-eth0', metric: 10 }
        ],
        interfaces: [
          iface({ id: 'br-r3-eth0', nodeId: 'br-r3', macHex: '02:00:00:0d:00:31', label: 'to-r1', ip: '10.60.0.2', prefix: 30 }),
          iface({ id: 'br-r3-eth1', nodeId: 'br-r3', macHex: '02:00:00:0d:00:32', label: 'lan', ip: '192.168.60.1', prefix: 24 })
        ]
      },
      {
        id: 'br-server-a',
        kind: 'server',
        name: 'Server A',
        enabled: true,
        description: '192.168.40.20 behind Router2',
        gateway: ipv4('192.168.40.1'),
        interfaces: [iface({ id: 'br-server-a-eth0', nodeId: 'br-server-a', macHex: '02:00:00:0d:00:41', label: 'eth0', ip: '192.168.40.20', prefix: 24 })]
      },
      {
        id: 'br-server-b',
        kind: 'server',
        name: 'Server B',
        enabled: true,
        description: '192.168.60.20 behind Router3',
        gateway: ipv4('192.168.60.1'),
        interfaces: [iface({ id: 'br-server-b-eth0', nodeId: 'br-server-b', macHex: '02:00:00:0d:00:51', label: 'eth0', ip: '192.168.60.20', prefix: 24 })]
      }
    ],
    links: [
      link('l-br-1', 'br-pc1-eth0', 'br-sw-p1'),
      link('l-br-2', 'br-sw-p2', 'br-r1-eth0'),
      link('l-br-3', 'br-r1-eth1', 'br-r2-eth0', 3),
      link('l-br-4', 'br-r1-eth2', 'br-r3-eth0', 3),
      link('l-br-5', 'br-r2-eth1', 'br-server-a-eth0'),
      link('l-br-6', 'br-r3-eth1', 'br-server-b-eth0')
    ],
    layout: layoutOf({
      'br-pc1': { x: 100, y: 340 },
      'br-sw': { x: 290, y: 340 },
      'br-r1': { x: 480, y: 340 },
      'br-r2': { x: 720, y: 180 },
      'br-r3': { x: 720, y: 500 },
      'br-server-a': { x: 960, y: 180 },
      'br-server-b': { x: 960, y: 500 }
    })
  };
}

/** Static-routing lab: one specific static route per destination. */
export const staticRoutesTopology: Topology = branchedTopology(
  [
    { destination: '192.168.40.0', prefix: 24, nextHop: ipv4('10.50.0.2'), interfaceId: 'br-r1-eth1', metric: 10 },
    { destination: '192.168.60.0', prefix: 24, nextHop: ipv4('10.60.0.2'), interfaceId: 'br-r1-eth2', metric: 10 }
  ],
  'static-routes-lab',
  'One static route per destination'
);

/** Longest-prefix lab: a default route AND a specific /24 compete. */
export const longestPrefixTopology: Topology = branchedTopology(
  [
    { destination: '192.168.40.0', prefix: 24, nextHop: ipv4('10.50.0.2'), interfaceId: 'br-r1-eth1', metric: 10 },
    { destination: '0.0.0.0', prefix: 0, nextHop: ipv4('10.60.0.2'), interfaceId: 'br-r1-eth2', metric: 20 }
  ],
  'longest-prefix-lab',
  'Default route vs. specific route'
);

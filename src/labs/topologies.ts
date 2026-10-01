/**
 * Reusable lab topologies. Every address, MAC and link latency is fixed
 * so simulations are fully deterministic across runs and machines.
 */

import type { Topology, Node, Link, RoutingEntry } from '../models/topology';

type RoutingEntryDef = RoutingEntry;
import type { Point } from '../models/layout';
import { mac } from '../models/mac';
import { ipv4 } from '../models/ipv4';

function iface(
  id: string,
  nodeId: string,
  macHex: string,
  label: string,
  ip?: string,
  prefix?: number,
  enabled = true
) {
  return {
    id,
    nodeId,
    mac: mac(macHex),
    ...(ip !== undefined ? { ip: ipv4(ip) } : {}),
    ...(prefix !== undefined ? { prefix } : {}),
    enabled,
    label
  };
}

function node(
  input: (
    | { id: string; kind: 'host' | 'server' | 'switch'; name: string; ifaces: ReturnType<typeof iface>[]; gateway?: string; service?: 'dns' | 'web'; description?: string }
    | { id: string; kind: 'hub'; name: string; ifaces: ReturnType<typeof iface>[]; description?: string }
    | { id: string; kind: 'router'; name: string; ifaces: ReturnType<typeof iface>[]; routes?: RoutingEntryDef[]; description?: string }
  )
): Node {
  const base = {
    id: input.id,
    name: input.name,
    enabled: true,
    interfaces: input.ifaces,
    ...(input.description !== undefined ? { description: input.description } : {})
  };
  switch (input.kind) {
    case 'hub':
      return { ...base, kind: 'hub' as const, isRepeater: true as const };
    case 'router':
      return {
        ...base,
        kind: 'router',
        ...(input.routes !== undefined ? { routes: input.routes } : {})
      };
    default:
      return {
        ...base,
        kind: input.kind,
        ...(input.gateway !== undefined ? { gateway: ipv4(input.gateway) } : {})
      };
  }
}

function link(id: string, a: string, b: string, latencyMs = 4): Link {
  return { id, endpoints: [a, b], latencyMs, enabled: true };
}

function layout(positions: Record<string, Point>, waypoints: Record<string, Point[]> = {}) {
  return { nodes: positions, links: waypoints };
}

/* ---------------- Lab 1: Ethernet + MAC ---------------- */

export const ethernetTopology: Topology = {
  id: 'ethernet-lab',
  name: 'Hub domain vs switch domain',
  nodes: [
    node({ id: 'pc-a', kind: 'host', name: 'PC A', description: 'Hub segment sender', ifaces: [iface('pc-a-eth0', 'pc-a', '02:00:00:00:00:01', 'eth0', '10.0.0.1', 24)] }),
    node({ id: 'pc-b', kind: 'host', name: 'PC B', ifaces: [iface('pc-b-eth0', 'pc-b', '02:00:00:00:00:02', 'eth0', '10.0.0.2', 24)] }),
    node({ id: 'pc-c', kind: 'host', name: 'PC C', description: 'Switch segment sender', ifaces: [iface('pc-c-eth0', 'pc-c', '02:00:00:00:00:03', 'eth0', '10.0.0.3', 24)] }),
    node({ id: 'pc-d', kind: 'host', name: 'PC D', ifaces: [iface('pc-d-eth0', 'pc-d', '02:00:00:00:00:04', 'eth0', '10.0.0.4', 24)] }),
    node({
      id: 'hub-1',
      kind: 'hub',
      name: 'Hub',
      description: 'Repeats every signal out of every port',
      ifaces: [
        iface('hub-1-p1', 'hub-1', '02:00:00:00:00:11', 'p1'),
        iface('hub-1-p2', 'hub-1', '02:00:00:00:00:12', 'p2')
      ]
    }),
    node({
      id: 'switch-1',
      kind: 'switch',
      name: 'Switch',
      description: 'Learns MAC addresses, forwards unicast',
      ifaces: [
        iface('switch-1-p1', 'switch-1', '02:00:00:00:00:21', 'p1'),
        iface('switch-1-p2', 'switch-1', '02:00:00:00:00:22', 'p2')
      ]
    })
  ],
  links: [
    link('l-hub-a', 'hub-1-p1', 'pc-a-eth0'),
    link('l-hub-b', 'hub-1-p2', 'pc-b-eth0'),
    link('l-sw-c', 'switch-1-p1', 'pc-c-eth0'),
    link('l-sw-d', 'switch-1-p2', 'pc-d-eth0')
  ],
  layout: layout({
    'pc-a': { x: 110, y: 150 },
    'hub-1': { x: 380, y: 150 },
    'pc-b': { x: 650, y: 150 },
    'pc-c': { x: 110, y: 460 },
    'switch-1': { x: 380, y: 460 },
    'pc-d': { x: 650, y: 460 }
  })
};

/* ---------------- Lab 2: ARP ---------------- */

export const arpTopology: Topology = {
  id: 'arp-lab',
  name: 'ARP on a single subnet',
  nodes: [
    node({ id: 'host-1', kind: 'host', name: 'Host 1', ifaces: [iface('host-1-eth0', 'host-1', '02:00:00:00:01:01', 'eth0', '10.0.0.11', 24)] }),
    node({ id: 'host-2', kind: 'host', name: 'Host 2', ifaces: [iface('host-2-eth0', 'host-2', '02:00:00:00:01:02', 'eth0', '10.0.0.12', 24)] }),
    node({ id: 'host-3', kind: 'host', name: 'Host 3', ifaces: [iface('host-3-eth0', 'host-3', '02:00:00:00:01:03', 'eth0', '10.0.0.13', 24)] }),
    node({
      id: 'arp-switch',
      kind: 'switch',
      name: 'Switch',
      ifaces: [
        iface('arp-switch-p1', 'arp-switch', '02:00:00:00:01:21', 'p1'),
        iface('arp-switch-p2', 'arp-switch', '02:00:00:00:01:22', 'p2'),
        iface('arp-switch-p3', 'arp-switch', '02:00:00:00:01:23', 'p3')
      ]
    })
  ],
  links: [
    link('l-arp-1', 'host-1-eth0', 'arp-switch-p1'),
    link('l-arp-2', 'host-2-eth0', 'arp-switch-p2'),
    link('l-arp-3', 'host-3-eth0', 'arp-switch-p3')
  ],
  layout: layout({
    'host-1': { x: 120, y: 140 },
    'host-2': { x: 120, y: 330 },
    'host-3': { x: 120, y: 520 },
    'arp-switch': { x: 480, y: 330 }
  })
};

/* ---------------- Lab 3: IPv4 + Routing ---------------- */

export const routingTopology: Topology = {
  id: 'routing-lab',
  name: 'Two subnets joined by a router',
  nodes: [
    node({ id: 'src-host', kind: 'host', name: 'Workstation', ifaces: [iface('src-host-eth0', 'src-host', '02:00:00:00:02:01', 'eth0', '192.168.1.10', 24)], gateway: '192.168.1.1' }),
    node({
      id: 'router-1',
      kind: 'router',
      name: 'Router',
      ifaces: [
        iface('router-1-eth0', 'router-1', '02:00:00:00:02:11', 'lan', '192.168.1.1', 24),
        iface('router-1-eth1', 'router-1', '02:00:00:00:02:12', 'wan', '10.20.0.1', 16)
      ]
    }),
    node({ id: 'dst-host', kind: 'host', name: 'File server', ifaces: [iface('dst-host-eth0', 'dst-host', '02:00:00:00:02:31', 'eth0', '10.20.5.8', 16)], gateway: '10.20.0.1' }),
    node({
      id: 'routing-switch',
      kind: 'switch',
      name: 'LAN switch',
      ifaces: [
        iface('routing-switch-p1', 'routing-switch', '02:00:00:00:02:41', 'p1'),
        iface('routing-switch-p2', 'routing-switch', '02:00:00:00:02:42', 'p2')
      ]
    })
  ],
  links: [
    link('l-rt-1', 'src-host-eth0', 'routing-switch-p1'),
    link('l-rt-2', 'routing-switch-p2', 'router-1-eth0'),
    link('l-rt-3', 'router-1-eth1', 'dst-host-eth0', 9)
  ],
  layout: layout(
    {
      'src-host': { x: 110, y: 200 },
      'routing-switch': { x: 350, y: 200 },
      'router-1': { x: 590, y: 200 },
      'dst-host': { x: 850, y: 200 }
    },
    { 'l-rt-3': [{ x: 730, y: 130 }] }
  )
};

/* ---------------- Lab 4: DNS ---------------- */

export const dnsTopology: Topology = {
  id: 'dns-lab',
  name: 'Resolving a name on the local network',
  nodes: [
    node({ id: 'dns-client', kind: 'host', name: 'Laptop', ifaces: [iface('dns-client-eth0', 'dns-client', '02:00:00:00:03:01', 'eth0', '192.168.7.20', 24)] }),
    node({ id: 'dns-server', kind: 'server', name: 'DNS server', ifaces: [iface('dns-server-eth0', 'dns-server', '02:00:00:00:03:02', 'eth0', '192.168.7.53', 24)] }),
    node({
      id: 'dns-switch',
      kind: 'switch',
      name: 'Switch',
      ifaces: [
        iface('dns-switch-p1', 'dns-switch', '02:00:00:00:03:11', 'p1'),
        iface('dns-switch-p2', 'dns-switch', '02:00:00:00:03:12', 'p2')
      ]
    })
  ],
  links: [
    link('l-dns-1', 'dns-client-eth0', 'dns-switch-p1'),
    link('l-dns-2', 'dns-switch-p2', 'dns-server-eth0')
  ],
  layout: layout({
    'dns-client': { x: 130, y: 330 },
    'dns-switch': { x: 420, y: 330 },
    'dns-server': { x: 720, y: 330 }
  })
};

/* ---------------- Lab 5: TCP handshake ---------------- */

export const tcpTopology: Topology = {
  id: 'tcp-lab',
  name: 'Three-way handshake in isolation',
  nodes: [
    node({ id: 'tcp-client', kind: 'host', name: 'Client', ifaces: [iface('tcp-client-eth0', 'tcp-client', '02:00:00:00:04:01', 'eth0', '172.16.0.10', 24)] }),
    node({ id: 'tcp-server', kind: 'server', name: 'Web server', ifaces: [iface('tcp-server-eth0', 'tcp-server', '02:00:00:00:04:02', 'eth0', '172.16.0.80', 24)] })
  ],
  links: [link('l-tcp-1', 'tcp-client-eth0', 'tcp-server-eth0', 6)],
  layout: layout({
    'tcp-client': { x: 160, y: 330 },
    'tcp-server': { x: 700, y: 330 }
  })
};

/* ---------------- Lab 6: HTTP ---------------- */

export const httpTopology: Topology = {
  id: 'http-lab',
  name: 'Full stack: DNS, TCP and HTTP',
  nodes: [
    node({ id: 'http-client', kind: 'host', name: 'Browser host', ifaces: [iface('http-client-eth0', 'http-client', '02:00:00:00:05:01', 'eth0', '192.168.9.10', 24)] }),
    node({ id: 'http-dns', kind: 'server', name: 'DNS server', ifaces: [iface('http-dns-eth0', 'http-dns', '02:00:00:00:05:02', 'eth0', '192.168.9.53', 24)] }),
    node({ id: 'web-server', kind: 'server', name: 'Web server', ifaces: [iface('web-server-eth0', 'web-server', '02:00:00:00:05:03', 'eth0', '192.168.9.80', 24)], service: 'web' }),
    node({
      id: 'http-switch',
      kind: 'switch',
      name: 'Switch',
      ifaces: [
        iface('http-switch-p1', 'http-switch', '02:00:00:00:05:11', 'p1'),
        iface('http-switch-p2', 'http-switch', '02:00:00:00:05:12', 'p2'),
        iface('http-switch-p3', 'http-switch', '02:00:00:00:05:13', 'p3')
      ]
    })
  ],
  links: [
    link('l-http-1', 'http-client-eth0', 'http-switch-p1'),
    link('l-http-2', 'http-switch-p2', 'http-dns-eth0'),
    link('l-http-3', 'http-switch-p3', 'web-server-eth0', 7)
  ],
  layout: layout({
    'http-client': { x: 120, y: 330 },
    'http-switch': { x: 400, y: 330 },
    'http-dns': { x: 680, y: 160 },
    'web-server': { x: 680, y: 500 }
  })
};

/* ---------------- Lab 7: TTL / routing failure ---------------- */

export const ttlTopology: Topology = {
  id: 'ttl-lab',
  name: 'TTL exhaustion across routers',
  nodes: [
    node({ id: 'ttl-src', kind: 'host', name: 'Source', ifaces: [iface('ttl-src-eth0', 'ttl-src', '02:00:00:00:06:01', 'eth0', '10.1.0.10', 24)], gateway: '10.1.0.1' }),
    node({
      id: 'ttl-r1',
      kind: 'router',
      name: 'Router 1',
      ifaces: [
        iface('ttl-r1-eth0', 'ttl-r1', '02:00:00:00:06:11', 'to-src', '10.1.0.1', 24),
        iface('ttl-r1-eth1', 'ttl-r1', '02:00:00:00:06:12', 'to-r2', '10.2.0.1', 24)
      ],
      routes: [{ destination: '10.3.0.0', prefix: 24, nextHop: ipv4('10.2.0.2'), interfaceId: 'ttl-r1-eth1', metric: 10 }]
    }),
    node({
      id: 'ttl-r2',
      kind: 'router',
      name: 'Router 2',
      ifaces: [
        iface('ttl-r2-eth0', 'ttl-r2', '02:00:00:00:06:21', 'to-r1', '10.2.0.2', 24),
        iface('ttl-r2-eth1', 'ttl-r2', '02:00:00:00:06:22', 'to-dst', '10.3.0.1', 24)
      ]
    }),
    node({ id: 'ttl-dst', kind: 'host', name: 'Destination', ifaces: [iface('ttl-dst-eth0', 'ttl-dst', '02:00:00:00:06:31', 'eth0', '10.3.0.10', 24)], gateway: '10.3.0.1' })
  ],
  links: [
    link('l-ttl-1', 'ttl-src-eth0', 'ttl-r1-eth0'),
    link('l-ttl-2', 'ttl-r1-eth1', 'ttl-r2-eth0'),
    link('l-ttl-3', 'ttl-r2-eth1', 'ttl-dst-eth0')
  ],
  layout: layout({
    'ttl-src': { x: 100, y: 330 },
    'ttl-r1': { x: 380, y: 330 },
    'ttl-r2': { x: 660, y: 330 },
    'ttl-dst': { x: 940, y: 330 }
  })
};

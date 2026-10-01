/**
 * Flagship "Open a Web Page" topology: Browser → LAN Switch → Router →
 * Web Server, with the DNS resolver on the client's LAN — so the journey
 * genuinely crosses a router (frame rewrite visible) while DNS stays
 * local. All addresses, MACs and latencies are fixed.
 *
 *   LAN   172.20.0.0/24   (Browser 172.20.0.10, DNS 172.20.0.53, Router .1)
 *   WEB   172.30.0.0/24   (Router .1, Web Server .20)
 */

import type { Topology, Link, RoutingEntry } from '../models/topology';
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

export const webTopology: Topology = {
  id: 'web-page-lab',
  name: 'Open a web page — across the router',
  nodes: [
    {
      id: 'web-browser',
      kind: 'host',
      name: 'Browser',
      enabled: true,
      description: 'The student’s machine — opens http://example.local/index.html',
      gateway: ipv4('172.20.0.1'),
      interfaces: [iface({ id: 'web-browser-eth0', nodeId: 'web-browser', macHex: '02:00:00:10:00:01', label: 'eth0', ip: '172.20.0.10', prefix: 24 })]
    },
    {
      id: 'web-lanswitch',
      kind: 'switch',
      name: 'LAN Switch',
      enabled: true,
      description: 'L2 only — learns MACs, forwards frames',
      interfaces: [
        iface({ id: 'web-lanswitch-p1', nodeId: 'web-lanswitch', macHex: '02:00:00:10:00:11', label: 'p1' }),
        iface({ id: 'web-lanswitch-p2', nodeId: 'web-lanswitch', macHex: '02:00:00:10:00:12', label: 'p2' }),
        iface({ id: 'web-lanswitch-p3', nodeId: 'web-lanswitch', macHex: '02:00:00:10:00:13', label: 'p3' })
      ]
    },
    {
      id: 'web-dns',
      kind: 'server',
      name: 'DNS',
      enabled: true,
      description: 'Authoritative for example.local — on the client LAN',
      service: 'dns',
      interfaces: [iface({ id: 'web-dns-eth0', nodeId: 'web-dns', macHex: '02:00:00:10:00:21', label: 'eth0', ip: '172.20.0.53', prefix: 24 })]
    },
    {
      id: 'web-router',
      kind: 'router',
      name: 'Router',
      enabled: true,
      description: 'Rewrites Ethernet frames while the IP destination stays the same',
      routes: [
        { destination: '172.30.0.0', prefix: 24, nextHop: ipv4('172.30.0.1'), interfaceId: 'web-router-eth1', metric: 10 }
      ] as readonly RoutingEntry[],
      interfaces: [
        iface({ id: 'web-router-eth0', nodeId: 'web-router', macHex: '02:00:00:10:00:31', label: 'lan', ip: '172.20.0.1', prefix: 24 }),
        iface({ id: 'web-router-eth1', nodeId: 'web-router', macHex: '02:00:00:10:00:32', label: 'web', ip: '172.30.0.1', prefix: 24 })
      ]
    },
    {
      id: 'web-server',
      kind: 'server',
      name: 'Web Server',
      enabled: true,
      description: 'Serves http://example.local/index.html',
      service: 'web',
      gateway: ipv4('172.30.0.1'),
      interfaces: [iface({ id: 'web-server-eth0', nodeId: 'web-server', macHex: '02:00:00:10:00:41', label: 'eth0', ip: '172.30.0.20', prefix: 24 })]
    }
  ],
  links: [
    link('l-web-1', 'web-browser-eth0', 'web-lanswitch-p1'),
    link('l-web-2', 'web-lanswitch-p2', 'web-dns-eth0'),
    link('l-web-3', 'web-lanswitch-p3', 'web-router-eth0'),
    link('l-web-4', 'web-router-eth1', 'web-server-eth0', 5)
  ],
  layout: {
    nodes: {
      'web-browser': { x: 100, y: 360 } as Point,
      'web-lanswitch': { x: 300, y: 360 } as Point,
      'web-dns': { x: 300, y: 150 } as Point,
      'web-router': { x: 560, y: 360 } as Point,
      'web-server': { x: 820, y: 360 } as Point
    },
    links: {}
  }
};

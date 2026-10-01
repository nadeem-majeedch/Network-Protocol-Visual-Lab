/**
 * Recursive-DNS lab topology: Client → Switch → Resolver → Router →
 * Authoritative server, across two subnets so the recursion is a real
 * routed UDP round trip. All addresses, MACs and latencies are fixed.
 *
 *   LAN    192.168.8.0/24   (client, resolver, router LAN interface)
 *   DNS    203.0.113.0/24   (router DNS interface, authoritative server)
 */

import type { Topology, Link } from '../models/topology';
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

function layoutOf(positions: Record<string, Point>): Topology['layout'] {
  return { nodes: positions, links: {} };
}

export const recursiveDnsTopology: Topology = {
  id: 'dns-recursive-lab',
  name: 'Client, recursive resolver, authoritative server',
  nodes: [
    {
      id: 'dns-client',
      kind: 'host',
      name: 'Client',
      enabled: true,
      description: 'Learns addresses and caches them locally',
      gateway: ipv4('192.168.8.1'),
      interfaces: [iface({ id: 'dns-client-eth0', nodeId: 'dns-client', macHex: '02:00:00:0e:00:01', label: 'eth0', ip: '192.168.8.10', prefix: 24 })]
    },
    {
      id: 'dns-switch',
      kind: 'switch',
      name: 'Switch',
      enabled: true,
      description: 'LAN forwarding only — no DNS role',
      interfaces: [
        iface({ id: 'dns-switch-p1', nodeId: 'dns-switch', macHex: '02:00:00:0e:00:11', label: 'p1' }),
        iface({ id: 'dns-switch-p2', nodeId: 'dns-switch', macHex: '02:00:00:0e:00:12', label: 'p2' }),
        iface({ id: 'dns-switch-p3', nodeId: 'dns-switch', macHex: '02:00:00:0e:00:13', label: 'p3' }),
        iface({ id: 'dns-switch-p4', nodeId: 'dns-switch', macHex: '02:00:00:0e:00:14', label: 'p4' })
      ]
    },
    {
      id: 'dns-client2',
      kind: 'host',
      name: 'Client 2',
      enabled: true,
      description: 'Asks the same names later — hits the resolver\'s cache',
      gateway: ipv4('192.168.8.1'),
      interfaces: [iface({ id: 'dns-client2-eth0', nodeId: 'dns-client2', macHex: '02:00:00:0e:00:02', label: 'eth0', ip: '192.168.8.11', prefix: 24 })]
    },
    {
      id: 'dns-resolver',
      kind: 'server',
      name: 'Resolver',
      enabled: true,
      description: 'Recursive resolver — caches, then asks the authority',
      service: 'dns-resolver',
      gateway: ipv4('192.168.8.1'),
      interfaces: [iface({ id: 'dns-resolver-eth0', nodeId: 'dns-resolver', macHex: '02:00:00:0e:00:21', label: 'eth0', ip: '192.168.8.53', prefix: 24 })]
    },
    {
      id: 'dns-router',
      kind: 'router',
      name: 'Router',
      enabled: true,
      description: 'Joins the client LAN to the DNS subnet',
      interfaces: [
        iface({ id: 'dns-router-eth0', nodeId: 'dns-router', macHex: '02:00:00:0e:00:31', label: 'lan', ip: '192.168.8.1', prefix: 24 }),
        iface({ id: 'dns-router-eth1', nodeId: 'dns-router', macHex: '02:00:00:0e:00:32', label: 'dnsnet', ip: '203.0.113.1', prefix: 24 })
      ]
    },
    {
      id: 'dns-auth',
      kind: 'server',
      name: 'Authoritative',
      enabled: true,
      description: 'Owns example.com — answers from its zone only',
      gateway: ipv4('203.0.113.1'),
      interfaces: [iface({ id: 'dns-auth-eth0', nodeId: 'dns-auth', macHex: '02:00:00:0e:00:41', label: 'eth0', ip: '203.0.113.53', prefix: 24 })]
    }
  ],
  links: [
    link('l-rdns-1', 'dns-client-eth0', 'dns-switch-p1'),
    link('l-rdns-2', 'dns-switch-p2', 'dns-resolver-eth0'),
    link('l-rdns-3', 'dns-switch-p3', 'dns-router-eth0'),
    link('l-rdns-4', 'dns-router-eth1', 'dns-auth-eth0', 6),
    link('l-rdns-5', 'dns-client2-eth0', 'dns-switch-p4')
  ],
  layout: layoutOf({
    'dns-client': { x: 100, y: 420 },
    'dns-client2': { x: 100, y: 200 },
    'dns-switch': { x: 290, y: 340 },
    'dns-resolver': { x: 290, y: 120 },
    'dns-router': { x: 540, y: 340 },
    'dns-auth': { x: 800, y: 340 }
  })
};

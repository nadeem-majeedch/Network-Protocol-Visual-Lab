/**
 * "Discover the Default Gateway" lab topology — the canonical textbook
 * example: PC1 (192.168.1.10) → Switch → Router (192.168.1.1).
 * Every address and MAC is fixed for deterministic runs.
 */

import type { Topology, Link, RoutingEntry } from '../models/topology';
import type { Point } from '../models/layout';
import { mac } from '../models/mac';
import { ipv4 } from '../models/ipv4';

function iface(
  id: string,
  nodeId: string,
  macHex: string,
  label: string,
  ip?: string,
  prefix?: number
) {
  return {
    id,
    nodeId,
    mac: mac(macHex),
    ...(ip !== undefined ? { ip: ipv4(ip) } : {}),
    ...(prefix !== undefined ? { prefix } : {}),
    enabled: true,
    label
  };
}

export const gatewayTopology: Topology = {
  id: 'gateway-lab',
  name: 'Discovering the default gateway',
  nodes: [
    {
      id: 'pc1',
      kind: 'host',
      name: 'PC1',
      enabled: true,
      description: 'Wants to reach the router at 192.168.1.1',
      gateway: ipv4('192.168.1.1'),
      interfaces: [iface('pc1-eth0', 'pc1', '02:00:00:0a:00:01', 'eth0', '192.168.1.10', 24)]
    },
    {
      id: 'gateway-switch',
      kind: 'switch',
      name: 'Switch',
      enabled: true,
      description: 'Forwards frames between PC1 and the router',
      interfaces: [iface('gateway-switch-p1', 'gateway-switch', '02:00:00:0a:00:11', 'p1'), iface('gateway-switch-p2', 'gateway-switch', '02:00:00:0a:00:12', 'p2')]
    },
    {
      id: 'gateway-router',
      kind: 'router',
      name: 'Router',
      enabled: true,
      description: 'Default gateway — answers ARP for 192.168.1.1',
      interfaces: [iface('gateway-router-g0', 'gateway-router', '02:00:00:0a:00:21', 'lan', '192.168.1.1', 24)],
      routes: [] as readonly RoutingEntry[]
    }
  ],
  links: [
    { id: 'l-gw-1', endpoints: ['pc1-eth0', 'gateway-switch-p1'], latencyMs: 4, enabled: true },
    { id: 'l-gw-2', endpoints: ['gateway-switch-p2', 'gateway-router-g0'], latencyMs: 4, enabled: true }
  ] satisfies readonly Link[],
  subnets: [
    { id: 'gw-lan', name: 'LAN 192.168.1.0/24', network: ipv4('192.168.1.0'), prefix: 24, color: '#7ee787' }
  ],
  layout: {
    nodes: {
      pc1: { x: 120, y: 330 } as Point,
      'gateway-switch': { x: 430, y: 330 } as Point,
      'gateway-router': { x: 740, y: 330 } as Point
    },
    links: {}
  }
};

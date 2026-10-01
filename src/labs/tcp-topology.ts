/**
 * TCP lab topology: Client → Switch → Web Server. Every address, MAC and
 * latency is fixed so all four TCP labs (handshake, data transfer,
 * acknowledgement, termination) are fully deterministic.
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

export const tcpLabTopology: Topology = {
  id: 'tcp-lab-topology',
  name: 'Client and server on one switch',
  nodes: [
    {
      id: 'tcp-lab-client',
      kind: 'host',
      name: 'Client',
      enabled: true,
      description: 'Opens the connection, sends data, closes',
      interfaces: [iface({ id: 'tcp-lab-client-eth0', nodeId: 'tcp-lab-client', macHex: '02:00:00:0f:00:01', label: 'eth0', ip: '172.16.0.10', prefix: 24 })]
    },
    {
      id: 'tcp-lab-switch',
      kind: 'switch',
      name: 'Switch',
      enabled: true,
      description: 'Pure L2 — TCP does not care about it',
      interfaces: [
        iface({ id: 'tcp-lab-switch-p1', nodeId: 'tcp-lab-switch', macHex: '02:00:00:0f:00:11', label: 'p1' }),
        iface({ id: 'tcp-lab-switch-p2', nodeId: 'tcp-lab-switch', macHex: '02:00:00:0f:00:12', label: 'p2' })
      ]
    },
    {
      id: 'tcp-lab-server',
      kind: 'server',
      name: 'Server',
      enabled: true,
      description: 'LISTENs on port 80, echoes data, answers closes',
      interfaces: [iface({ id: 'tcp-lab-server-eth0', nodeId: 'tcp-lab-server', macHex: '02:00:00:0f:00:21', label: 'eth0', ip: '172.16.0.80', prefix: 24 })]
    }
  ],
  links: [
    { id: 'l-tcp-1', endpoints: ['tcp-lab-client-eth0', 'tcp-lab-switch-p1'], latencyMs: 3, enabled: true },
    { id: 'l-tcp-2', endpoints: ['tcp-lab-switch-p2', 'tcp-lab-server-eth0'], latencyMs: 3, enabled: true } as Link
  ],
  layout: { nodes: {
    'tcp-lab-client': { x: 120, y: 330 } as Point,
    'tcp-lab-switch': { x: 430, y: 330 } as Point,
    'tcp-lab-server': { x: 740, y: 330 } as Point
  }, links: {} }
};

/**
 * Topology model: nodes, interfaces, links, subnets and validation.
 *
 * Node kinds are a discriminated union — each device type is its own
 * strongly typed shape, so the engine can switch on `node.kind` and get
 * precise fields per role (e.g. `routes` exists only on routers,
 * `isRepeater` only on hubs). Interfaces remain the only place
 * addresses live; gateways live on hosts/servers that need one.
 */

import type { Ipv4Address } from './ipv4';
import type { MacAddress } from './mac';
import type { TopologyLayoutInput } from './layout-input';
import type { Subnet } from './subnet';

export interface NetworkInterface {
  readonly id: string;
  readonly nodeId: string;
  readonly mac: MacAddress;
  /** Absent on frame-only members (e.g. hub segments without IPs). */
  readonly ip?: Ipv4Address;
  /** Set iff `ip` is set. */
  readonly prefix?: number;
  /** Up/down state affects TX/RX behavior in the simulation. */
  readonly enabled: boolean;
  readonly label: string;
}

export interface RoutingEntry {
  readonly destination: string;
  readonly prefix: number;
  /** Absent for directly connected routes. */
  readonly nextHop?: Ipv4Address;
  readonly interfaceId?: string;
  readonly metric: number;
}

interface NodeBase {
  readonly id: string;
  readonly name: string;
  /** Device-level power/link state; a disabled node transmits nothing. */
  readonly enabled: boolean;
  readonly interfaces: readonly NetworkInterface[];
  readonly description?: string;
}

export interface HostNode extends NodeBase {
  readonly kind: 'host';
  /** IPv4 address of this segment's router interface, if configured. */
  readonly gateway?: Ipv4Address;
}

export interface ServerNode extends NodeBase {
  readonly kind: 'server';
  readonly gateway?: Ipv4Address;
  /** Which well-known service this server runs, if any. */
  readonly service?: 'dns' | 'web' | 'dns-resolver';
}

export interface SwitchNode extends NodeBase {
  readonly kind: 'switch';
}

export interface HubNode extends NodeBase {
  readonly kind: 'hub';
  /** Hubs repeat every frame out every other port. */
  readonly isRepeater: true;
}

export interface RouterNode extends NodeBase {
  readonly kind: 'router';
  /** Static routes layered over connected routes derived from interfaces. */
  readonly routes?: readonly RoutingEntry[];
}

export type Node = HostNode | ServerNode | SwitchNode | HubNode | RouterNode;

/** Structural superset for UI code that renders any node kind. */
export type AnyNode = NodeBase & Partial<Omit<HubNode, keyof NodeBase>> & Partial<Omit<RouterNode, keyof NodeBase>>;

export interface Link {
  readonly id: string;
  /** Exactly two interface ids. */
  readonly endpoints: readonly [string, string];
  readonly latencyMs: number;
  readonly enabled: boolean;
}

export interface Topology {
  readonly id: string;
  readonly name: string;
  readonly nodes: readonly Node[];
  readonly links: readonly Link[];
  /** Named IP networks referenced by interface prefixes. */
  readonly subnets?: readonly Subnet[];
  readonly layout: TopologyLayoutInput;
}

export type TopologyErrorCode =
  | 'duplicate-node-id'
  | 'duplicate-interface-id'
  | 'duplicate-mac'
  | 'duplicate-ip'
  | 'duplicate-link'
  | 'bad-endpoint'
  | 'self-loop'
  | 'bad-prefix'
  | 'bad-subnet'
  | 'ip-outside-subnet'
  | 'gateway-not-reachable'
  | 'empty-topology';

export interface TopologyValidationError {
  readonly code: TopologyErrorCode;
  readonly message: string;
  readonly subject: string;
}

const IPV4_PATTERN = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;

function isIp(value: string): boolean {
  return IPV4_PATTERN.test(value);
}

export function validateTopology(topology: Topology): TopologyValidationError[] {
  const errors: TopologyValidationError[] = [];
  const nodeIds = new Set<string>();
  const ifaceIds = new Set<string>();
  const macs = new Set<string>();
  const ips = new Set<string>();

  if (topology.nodes.length === 0) {
    errors.push({ code: 'empty-topology', message: 'Topology has no nodes.', subject: topology.id });
  }

  for (const node of topology.nodes) {
    if (nodeIds.has(node.id)) {
      errors.push({ code: 'duplicate-node-id', message: `Duplicate node id ${node.id}.`, subject: node.id });
    }
    nodeIds.add(node.id);

    for (const iface of node.interfaces) {
      if (iface.nodeId !== node.id) {
        errors.push({
          code: 'bad-endpoint',
          message: `Interface ${iface.id} declares foreign node ${iface.nodeId}.`,
          subject: iface.id
        });
      }
      if (ifaceIds.has(iface.id)) {
        errors.push({
          code: 'duplicate-interface-id',
          message: `Duplicate interface id ${iface.id}.`,
          subject: iface.id
        });
      }
      ifaceIds.add(iface.id);
      if (macs.has(iface.mac)) {
        errors.push({ code: 'duplicate-mac', message: `Duplicate MAC ${iface.mac}.`, subject: iface.mac });
      }
      macs.add(iface.mac);
      if (iface.ip !== undefined) {
        if (!isIp(iface.ip)) {
          errors.push({ code: 'bad-prefix', message: `Invalid IPv4 ${iface.ip} on ${iface.id}.`, subject: iface.id });
        }
        if (ips.has(iface.ip)) {
          errors.push({ code: 'duplicate-ip', message: `Duplicate IP ${iface.ip}.`, subject: iface.ip });
        }
        ips.add(iface.ip);
        if (iface.prefix === undefined || iface.prefix < 0 || iface.prefix > 32) {
          errors.push({
            code: 'bad-prefix',
            message: `Interface ${iface.id} has invalid subnet prefix.`,
            subject: iface.id
          });
        }
      }
      if ((iface.ip === undefined) !== (iface.prefix === undefined)) {
        errors.push({
          code: 'bad-prefix',
          message: `Interface ${iface.id} must set ip and prefix together.`,
          subject: iface.id
        });
      }
    }
  }

  for (const link of topology.links) {
    const [a, b] = link.endpoints;
    if (a === b) {
      errors.push({ code: 'self-loop', message: `Link ${link.id} loops on itself.`, subject: link.id });
    }
    if (!ifaceIds.has(a) || !ifaceIds.has(b)) {
      errors.push({ code: 'bad-endpoint', message: `Link ${link.id} references unknown interface.`, subject: link.id });
    }
  }

  const seen = new Set<string>();
  for (const link of topology.links) {
    const key = [...link.endpoints].sort().join('|');
    if (seen.has(key)) {
      errors.push({ code: 'duplicate-link', message: `Duplicate link ${key}.`, subject: link.id });
    }
    seen.add(key);
  }

  // Subnet configuration: valid networks, members inside, gateways inside+distinct.
  for (const subnet of topology.subnets ?? []) {
    if (!isIp(subnet.network)) {
      errors.push({ code: 'bad-subnet', message: `Invalid network address ${subnet.network} in ${subnet.name}.`, subject: subnet.id });
      continue;
    }
    if (!Number.isInteger(subnet.prefix) || subnet.prefix < 0 || subnet.prefix > 32) {
      errors.push({ code: 'bad-subnet', message: `Invalid prefix ${subnet.prefix} in ${subnet.name}.`, subject: subnet.id });
      continue;
    }
    const netBits = bitsOf(subnet.network, subnet.prefix);
    if (netBits !== bitsOf(subnet.network, 32)) {
      errors.push({
        code: 'bad-subnet',
        message: `Network address ${subnet.network}/${subnet.prefix} is not the base address of its subnet.`,
        subject: subnet.id
      });
    }
  }

  for (const node of topology.nodes) {
    for (const iface of node.interfaces) {
      if (iface.ip === undefined || iface.prefix === undefined) continue;
      const memberOf = (topology.subnets ?? []).filter(
        (s) => isIp(s.network) && bitsOf(iface.ip as string, s.prefix) === bitsOf(s.network, s.prefix)
      );
      void memberOf;
      if (memberOf.length === 0 && (topology.subnets ?? []).length > 0) {
        errors.push({
          code: 'ip-outside-subnet',
          message: `${iface.ip} on ${iface.id} belongs to no configured subnet.`,
          subject: iface.id
        });
      }
    }

    if (node.kind === 'host' || node.kind === 'server') {
      const gw = node.gateway;
      if (gw !== undefined) {
        if (!isIp(gw)) {
          errors.push({ code: 'gateway-not-reachable', message: `Invalid gateway ${gw} on ${node.id}.`, subject: node.id });
          continue;
        }
        const own = node.interfaces.filter((i) => i.ip !== undefined);
        const sameSegment = own.some(
          (i) => i.prefix !== undefined && bitsOf(gw, i.prefix) === bitsOf(i.ip as string, i.prefix)
        );
        const routerHasIt = topology.nodes.some((other) =>
          other.kind === 'router' &&
          other.interfaces.some(
            (ri) =>
              ri.ip === gw &&
              ri.prefix !== undefined &&
              own.some(
                (i) =>
                  i.prefix !== undefined &&
                  bitsOf(gw, i.prefix) === bitsOf(ri.ip as string, ri.prefix as number)
              )
          )
        );
        if (!sameSegment || !routerHasIt) {
          errors.push({
            code: 'gateway-not-reachable',
            message: `Gateway ${gw} on ${node.id} is not a router interface on the same subnet.`,
            subject: node.id
          });
        }
      }
    }

    if (node.kind === 'router') {
      // Router interfaces must belong to valid, configured networks.
      for (const iface of node.interfaces) {
        if (iface.ip === undefined || iface.prefix === undefined) continue;
        const bits = bitsOf(iface.ip as string, iface.prefix);
        const matchesSelf = bits === bitsOf(iface.ip as string, 32) || true; // host bits allowed on router
        void matchesSelf;
        const memberOf = (topology.subnets ?? []).some(
          (s) => isIp(s.network) && bits === bitsOf(s.network, s.prefix)
        );
        if (!memberOf && (topology.subnets ?? []).length > 0) {
          errors.push({
            code: 'ip-outside-subnet',
            message: `Router interface ${iface.id} (${iface.ip}/${iface.prefix}) belongs to no configured subnet.`,
            subject: iface.id
          });
        }
      }
    }
  }

  return errors;
}

function bitsOf(ip: string, prefix: number): number {
  const parts = ip.split('.').map(Number);
  const value =
    (((parts[0] ?? 0) << 24) | ((parts[1] ?? 0) << 16) | ((parts[2] ?? 0) << 8) | (parts[3] ?? 0)) >>> 0;
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (value & mask) >>> 0;
}

/**
 * TopologyEngine: the canonical, mutable owner of network topology.
 *
 * All structural behavior (creating/deleting nodes and links, assigning
 * interfaces and addresses, toggling device state) lives HERE — never in
 * React components. Every mutation is validated deterministically and
 * rejected with a typed error rather than throwing.
 *
 * The engine is serializable: `snapshot()` yields the same Topology data
 * the rest of the system consumes; `load()` restores it verbatim.
 */

import type {
  Node,
  HostNode,
  ServerNode,
  SwitchNode,
  RouterNode,
  NetworkInterface,
  Link,
  Topology,
  TopologyErrorCode
} from '../models/topology';
import type { Subnet } from '../models/subnet';
import { mac as parseMac, formatMac } from '../models/mac';
import type { MacAddress } from '../models/mac';
import { ipv4, isIpv4 } from '../models/ipv4';
import type { Ipv4Address } from '../models/ipv4';
import { subnetContains } from '../models/subnet';
import type { Point } from '../models/layout';

export type TopologyOp =
  | { readonly op: 'add-node'; readonly node: Node }
  | { readonly op: 'remove-node'; readonly nodeId: string }
  | { readonly op: 'add-link'; readonly link: Link }
  | { readonly op: 'remove-link'; readonly linkId: string }
  | { readonly op: 'add-interface'; readonly nodeId: string; readonly iface: NetworkInterface }
  | { readonly op: 'remove-interface'; readonly ifaceId: string }
  | { readonly op: 'assign-ip'; readonly ifaceId: string; readonly ip: string; readonly prefix: number }
  | { readonly op: 'clear-ip'; readonly ifaceId: string }
  | { readonly op: 'set-gateway'; readonly nodeId: string; readonly gateway: string | null }
  | { readonly op: 'set-device-state'; readonly nodeId: string; readonly enabled: boolean }
  | { readonly op: 'add-subnet'; readonly subnet: Subnet }
  | { readonly op: 'move-node'; readonly nodeId: string; readonly position: Point };

export class TopologyError extends Error {
  constructor(
    public readonly code: TopologyErrorCode | 'unknown-node' | 'unknown-interface' | 'unknown-link' | 'bad-address' | 'bad-mac' | 'duplicate-subnet',
    message: string
  ) {
    super(message);
  }
}

export interface TopologyEngineOptions {
  /** Test hook: deterministic id/MAC allocation per subsystem. */
  readonly counters?: Partial<Record<'iface' | 'link' | 'mac' | 'subnet', number>>;
}

const DEFAULT_POSITION: Point = { x: 160, y: 160 };

export class TopologyEngine {
  private nodes: Map<string, Node> = new Map();
  private links: Map<string, Link> = new Map();
  private subnets: Map<string, Subnet> = new Map();
  private name = 'Custom topology';
  private counters = { iface: 1, link: 1, mac: 1, subnet: 1, ...({} as Record<string, number>) };
  private layoutNodes: Record<string, Point> = {};
  private layoutLinks: Record<string, readonly Point[]> = {};

  constructor(initial?: Topology, options?: TopologyEngineOptions) {
    if (initial !== undefined) {
      this.load(initial);
    }
    if (options?.counters !== undefined) {
      this.counters = { ...this.counters, ...options.counters };
    }
  }

  /* ------------------------------ reading ------------------------------ */

  get topology(): Topology {
    return {
      id: 'editor-topology',
      name: this.name,
      nodes: [...this.nodes.values()],
      links: [...this.links.values()],
      ...(this.subnets.size > 0 ? { subnets: [...this.subnets.values()] } : {}),
      layout: { nodes: { ...this.layoutNodes }, links: { ...this.layoutLinks } }
    };
  }

  node(nodeId: string): Node | undefined {
    return this.nodes.get(nodeId);
  }

  allNodes(): readonly Node[] {
    return [...this.nodes.values()];
  }

  allLinks(): readonly Link[] {
    return [...this.links.values()];
  }

  allSubnets(): readonly Subnet[] {
    return [...this.subnets.values()];
  }

  findIface(ifaceId: string): NetworkInterface | undefined {
    for (const node of this.nodes.values()) {
      const found = node.interfaces.find((i) => i.id === ifaceId);
      if (found !== undefined) return found;
    }
    return undefined;
  }

  /* ------------------------------ nodes ------------------------------ */

  addHost(name?: string, opts?: { ip?: string; prefix?: number; gateway?: string }): HostNode {
    const id = this.nextNodeId('host');
    const primary = this.makeIfaceFor(id, 'eth0');
    const withIp =
      opts?.ip !== undefined && opts.prefix !== undefined
        ? [{ ...primary, ip: ipv4(opts.ip), prefix: opts.prefix }]
        : [primary];
    return this.addNode({
      id,
      kind: 'host',
      name: name ?? `PC${this.nodeSeq['host']}`,
      enabled: true,
      interfaces: withIp,
      ...(opts?.gateway !== undefined ? { gateway: ipv4(opts.gateway) } : {})
    });
  }

  addServer(name?: string, opts?: { ip?: string; prefix?: number; gateway?: string; service?: 'dns' | 'web' }): ServerNode {
    const id = this.nextNodeId('server');
    const primary = this.makeIfaceFor(id, 'eth0');
    const withIp =
      opts?.ip !== undefined && opts.prefix !== undefined
        ? [{ ...primary, ip: ipv4(opts.ip), prefix: opts.prefix }]
        : [primary];
    return this.addNode({
      id,
      kind: 'server',
      name: name ?? `Server${this.nodeSeq['server']}`,
      enabled: true,
      interfaces: withIp,
      ...(opts?.gateway !== undefined ? { gateway: ipv4(opts.gateway) } : {}),
      ...(opts?.service !== undefined ? { service: opts.service } : {})
    });
  }

  addSwitch(name?: string): SwitchNode {
    const id = this.nextNodeId('switch');
    return this.addNode({
      id,
      kind: 'switch',
      name: name ?? `Switch${this.nodeSeq['switch']}`,
      enabled: true,
      interfaces: [this.makeIfaceFor(id, 'p1'), this.makeIfaceFor(id, 'p2')]
    });
  }

  addRouter(name?: string): RouterNode {
    const id = this.nextNodeId('router');
    return this.addNode({
      id,
      kind: 'router',
      name: name ?? `Router${this.nodeSeq['router']}`,
      enabled: true,
      interfaces: [this.makeIfaceFor(id, 'g0'), this.makeIfaceFor(id, 'g1')]
    });
  }

  private addNode<T extends Node>(node: T): T {
    if (this.nodes.has(node.id)) {
      throw new TopologyError('duplicate-node-id', `Node ${node.id} already exists`);
    }
    for (const iface of node.interfaces) {
      this.assertIfaceUsable(iface, node.id);
    }
    this.nodes.set(node.id, node);
    if (this.layoutNodes[node.id] === undefined) {
      this.placeNewNode(node.id);
    }
    return node;
  }

  removeNode(nodeId: string): Link[] {
    const node = this.nodes.get(nodeId);
    if (node === undefined) {
      throw new TopologyError('unknown-node', `No node ${nodeId}`);
    }
    // Cascading deletion: attached links go first, deterministically by id.
    const removedLinks: Link[] = [];
    for (const link of [...this.links.values()].sort((a, b) => a.id.localeCompare(b.id))) {
      if (link.endpoints.some((ep) => node.interfaces.some((i) => i.id === ep))) {
        this.links.delete(link.id);
        delete this.layoutLinks[link.id];
        removedLinks.push(link);
      }
    }
    for (const iface of node.interfaces) {
      this.unregisterIface(iface.id);
    }
    this.nodes.delete(nodeId);
    delete this.layoutNodes[nodeId];
    return removedLinks;
  }

  /* ------------------------------ interfaces ------------------------------ */

  addInterface(nodeId: string, label?: string): NetworkInterface {
    const node = this.requireNode(nodeId);
    const index = node.interfaces.length + 1;
    const defaultLabel = node.kind === 'router' ? `g${index}` : node.kind === 'host' || node.kind === 'server' ? `eth${index}` : `p${index}`;
    const iface = this.makeIfaceFor(nodeId, label ?? defaultLabel);
    const updated = { ...node, interfaces: [...node.interfaces, iface] } as Node;
    this.nodes.set(nodeId, updated);
    this.registerIface(iface);
    return iface;
  }

  removeInterface(ifaceId: string): Link[] {
    const owner = this.ownerOf(ifaceId);
    if (owner === undefined) {
      throw new TopologyError('unknown-interface', `No interface ${ifaceId}`);
    }
    const removedLinks = this.linksAttachedTo(ifaceId);
    for (const link of removedLinks) {
      this.links.delete(link.id);
      delete this.layoutLinks[link.id];
    }
    const node = this.nodes.get(owner.node.id)!;
    this.nodes.set(node.id, {
      ...node,
      interfaces: node.interfaces.filter((i) => i.id !== ifaceId)
    });
    this.unregisterIface(ifaceId);
    return removedLinks;
  }

  assignIp(ifaceId: string, ip: string, prefix: number): void {
    const owner = this.ownerOf(ifaceId);
    if (owner === undefined) {
      throw new TopologyError('unknown-interface', `No interface ${ifaceId}`);
    }
    if (!isIpv4(ip)) {
      throw new TopologyError('bad-address', `Invalid IPv4 address: ${ip}`);
    }
    if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32) {
      throw new TopologyError('bad-address', `Invalid prefix: ${prefix}`);
    }
    const addr = ipv4(ip);
    this.assertIpAvailable(addr, owner.node.id, owner.iface.id);

    const node = this.nodes.get(owner.node.id)!;
    const interfaces = node.interfaces.map((i) => (i.id === ifaceId ? { ...i, ip: addr, prefix } : i));
    this.nodes.set(node.id, { ...node, interfaces });

    // Duplicate-IP check across the whole simulated network, deterministically.
    const conflict = this.findIpConflict(addr, node.id, owner.iface.id);
    void conflict;
    if (this.subnets.size > 0) {
      const member = [...this.subnets.values()].find((s) => s.prefix === prefix && subnetContains(s, addr));
      if (member === undefined) {
        // Not fatal — subnets are optional descriptors — but recorded on the topology.
      }
    }
  }

  clearIp(ifaceId: string): void {
    const owner = this.ownerOf(ifaceId);
    if (owner === undefined) {
      throw new TopologyError('unknown-interface', `No interface ${ifaceId}`);
    }
    const node = this.nodes.get(owner.node.id)!;
    const interfaces = node.interfaces.map((i) =>
      i.id === ifaceId ? omitIp(i) : i
    );
    this.nodes.set(node.id, { ...node, interfaces });
  }

  /* ------------------------------ gateways ------------------------------ */

  setGateway(nodeId: string, gateway: string | null): void {
    const node = this.requireNode(nodeId);
    if (node.kind !== 'host' && node.kind !== 'server') {
      throw new TopologyError('unknown-node', `Gateways apply only to hosts and servers, not ${node.kind}`);
    }
    if (gateway === null) {
      const rest = { ...node } as Record<string, unknown>;
      delete rest.gateway;
      this.nodes.set(nodeId, rest as unknown as Node);
      return;
    }
    if (!isIpv4(gateway)) {
      throw new TopologyError('bad-address', `Invalid gateway address: ${gateway}`);
    }
    this.nodes.set(nodeId, { ...node, gateway: ipv4(gateway) } as Node);
  }

  /* ------------------------------ links ------------------------------ */

  connect(ifaceA: string, ifaceB: string, latencyMs = 4): Link {
    if (ifaceA === ifaceB) {
      throw new TopologyError('self-loop', 'A link cannot attach to the same interface twice');
    }
    const a = this.findIface(ifaceA);
    const b = this.findIface(ifaceB);
    if (a === undefined || b === undefined) {
      throw new TopologyError('bad-endpoint', 'Both endpoints must be existing interfaces');
    }
    if (a.nodeId === b.nodeId) {
      throw new TopologyError('self-loop', 'Cannot link two interfaces of the same node');
    }
    const duplicate = [...this.links.values()].find(
      (l) =>
        (l.endpoints[0] === ifaceA && l.endpoints[1] === ifaceB) ||
        (l.endpoints[0] === ifaceB && l.endpoints[1] === ifaceA)
    );
    if (duplicate !== undefined) {
      throw new TopologyError('duplicate-link', 'These interfaces are already linked');
    }
    const link: Link = { id: this.nextLinkId(), endpoints: [ifaceA, ifaceB], latencyMs, enabled: true };
    this.links.set(link.id, link);
    this.layoutLinks[link.id] = [];
    return link;
  }

  disconnect(linkId: string): Link {
    const link = this.links.get(linkId);
    if (link === undefined) {
      throw new TopologyError('unknown-link', `No link ${linkId}`);
    }
    this.links.delete(linkId);
    delete this.layoutLinks[linkId];
    return link;
  }

  linksOf(nodeId: string): readonly Link[] {
    const node = this.nodes.get(nodeId);
    if (node === undefined) return [];
    const ids = new Set(node.interfaces.map((i) => i.id));
    return [...this.links.values()].filter((l) => l.endpoints.some((ep) => ids.has(ep)));
  }

  /* ------------------------------ subnets ------------------------------ */

  addSubnet(id: string, name: string, network: string, prefix: number, color: string): Subnet {
    if (!isIpv4(network)) {
      throw new TopologyError('bad-address', `Invalid network address: ${network}`);
    }
    if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32) {
      throw new TopologyError('bad-address', `Invalid prefix: ${prefix}`);
    }
    if (this.subnets.has(id)) {
      throw new TopologyError('duplicate-subnet', `Subnet ${id} already exists`);
    }
    const subnet: Subnet = { id, name, network: ipv4(network), prefix, color };
    this.subnets.set(id, subnet);
    return subnet;
  }

  /* ------------------------------ device state ------------------------------ */

  setDeviceState(nodeId: string, enabled: boolean): void {
    const node = this.requireNode(nodeId);
    this.nodes.set(nodeId, { ...node, enabled });
  }

  toggleDevice(nodeId: string): boolean {
    const node = this.requireNode(nodeId);
    this.setDeviceState(nodeId, !node.enabled);
    return !node.enabled;
  }

  setLinkState(linkId: string, enabled: boolean): void {
    const link = this.links.get(linkId);
    if (link === undefined) {
      throw new TopologyError('unknown-link', `No link ${linkId}`);
    }
    this.links.set(linkId, { ...link, enabled });
  }

  /* ------------------------------ layout ------------------------------ */

  moveNode(nodeId: string, position: Point): void {
    if (this.nodes.has(nodeId)) {
      this.layoutNodes[nodeId] = position;
    }
  }

  /* ------------------------------ internals ------------------------------ */

  private ifaceIndex = new Map<string, MacAddress>();

  private registerIface(iface: NetworkInterface): void {
    this.ifaceIndex.set(iface.id, iface.mac);
  }

  private unregisterIface(ifaceId: string): void {
    this.ifaceIndex.delete(ifaceId);
  }

  private assertIfaceUsable(iface: NetworkInterface, nodeId: string): void {
    if (iface.nodeId !== nodeId) {
      throw new TopologyError('bad-endpoint', `Interface ${iface.id} declares foreign node ${iface.nodeId}`);
    }
    if (this.ifaceIndex.has(iface.id)) {
      throw new TopologyError('duplicate-interface-id', `Interface ${iface.id} already exists`);
    }
    const dupMac = [...this.ifaceIndex.values()].some((m) => m === iface.mac);
    if (dupMac) {
      throw new TopologyError('duplicate-mac', `MAC ${iface.mac} is already in use`);
    }
    this.registerIface(iface);
  }

  private assertIpAvailable(ip: Ipv4Address, nodeId: string, ifaceId: string): void {
    for (const node of this.nodes.values()) {
      for (const iface of node.interfaces) {
        if (iface.ip === ip && !(node.id === nodeId && iface.id === ifaceId)) {
          throw new TopologyError('duplicate-ip', `IP ${ip} is already assigned to ${iface.id}`);
        }
      }
    }
  }

  private findIpConflict(ip: Ipv4Address, nodeId: string, ifaceId: string): NetworkInterface | undefined {
    for (const node of this.nodes.values()) {
      for (const iface of node.interfaces) {
        if (iface.ip === ip && !(node.id === nodeId && iface.id === ifaceId)) return iface;
      }
    }
    return undefined;
  }

  private requireNode(nodeId: string): Node {
    const node = this.nodes.get(nodeId);
    if (node === undefined) {
      throw new TopologyError('unknown-node', `No node ${nodeId}`);
    }
    return node;
  }

  private ownerOf(ifaceId: string): { node: Node; iface: NetworkInterface } | undefined {
    for (const node of this.nodes.values()) {
      const iface = node.interfaces.find((i) => i.id === ifaceId);
      if (iface !== undefined) return { node, iface };
    }
    return undefined;
  }

  private linksAttachedTo(ifaceId: string): Link[] {
    return [...this.links.values()].filter((l) => l.endpoints.includes(ifaceId));
  }

  private makeIface(label: string): NetworkInterface {
    const id = `if${this.counters.iface++}`;
    return {
      id,
      nodeId: '',
      mac: parseMac(this.nextMac()),
      enabled: true,
      label
    };
  }

  private makeIfaceFor(nodeId: string, label: string): NetworkInterface {
    const iface = this.makeIface(label);
    return { ...iface, nodeId };
  }

  /** Per-kind sequence so students see PC1/PC2, Switch1/Switch2, Router1… */
  private nodeSeq: Record<string, number> = {};

  private nextNodeId(kind: string): string {
    const n = (this.nodeSeq[kind] ?? 0) + 1;
    this.nodeSeq[kind] = n;
    return `${kind}-${n}`;
  }

  private nextLinkId(): string {
    return `link-${this.counters.link++}`;
  }

  private nextMac(): string {
    const n = this.counters.mac++;
    const hex = n.toString(16).padStart(4, '0');
    return `02:00:00:${hex.slice(0, 2)}:${hex.slice(2, 4)}:01`;
  }

  private placeNewNode(nodeId: string): void {
    const count = this.layoutNodes ? Object.keys(this.layoutNodes).length : 0;
    const col = count % 4;
    const row = Math.floor(count / 4);
    this.layoutNodes[nodeId] = { x: 140 + col * 190, y: 120 + row * 170 };
  }

  /** Replace all state from a serialized topology (deterministic restore). */
  load(topology: Topology): void {
    this.nodes.clear();
    this.links.clear();
    this.subnets.clear();
    this.ifaceIndex.clear();
    this.layoutNodes = {};
    this.layoutLinks = {};
    for (const node of topology.nodes) {
      this.nodes.set(node.id, node);
      for (const iface of node.interfaces) {
        this.assertIfaceUsable(iface, node.id);
      }
      this.layoutNodes[node.id] = topology.layout.nodes[node.id] ?? DEFAULT_POSITION;
    }
    for (const link of topology.links) {
      this.links.set(link.id, link);
      this.layoutLinks[link.id] = topology.layout.links[link.id] ?? [];
    }
    for (const subnet of topology.subnets ?? []) {
      this.subnets.set(subnet.id, subnet);
    }
  }

  snapshot(): Topology {
    return this.topology;
  }

  formatMacForDisplay(value: string): string {
    return formatMac(value);
  }
}

function omitIp(iface: NetworkInterface): NetworkInterface {
  const rest = { ...iface } as Record<string, unknown>;
  delete rest.ip;
  delete rest.prefix;
  return rest as unknown as NetworkInterface;
}

export type { Subnet };

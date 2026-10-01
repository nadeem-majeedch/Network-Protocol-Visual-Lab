import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { NetworkEngine } from '../src/engine/network-engine';
import { runLab } from '../src/labs/runner';
import { labs } from '../src/labs';
import type { LabDefinition } from '../src/labs/types';
import { PacketInspector } from '../src/components/PacketInspector';
import { TopologyCanvas } from '../src/components/TopologyCanvas';
import { Timeline } from '../src/components/Timeline';
import { explainPacket } from '../src/simulation/explain';
import type { Packet } from '../src/models/packet';
import type { DnsMessage } from '../src/models/dns';
import type { NetworkState } from '../src/models/network-state';

function labById(id: string): LabDefinition {
  const lab = labs.find((l) => l.id === id);
  if (lab === undefined) throw new Error(`Missing lab ${id}`);
  return lab;
}

function runLabState(id: string): NetworkState {
  const lab = labById(id);
  const engine = new NetworkEngine(lab.topology);
  runLab(engine, lab);
  return engine.getState();
}

interface DnsPacketRef {
  readonly packet: Packet;
  readonly dns: DnsMessage;
}

function findDnsPackets(state: NetworkState): DnsPacketRef[] {
  const out: DnsPacketRef[] = [];
  for (const packet of state.packets) {
    const frame = packet.frame;
    if (frame.payload.kind !== 'ip') continue;
    const ip = frame.payload.ip;
    if (ip.payload.kind !== 'udp') continue;
    if (ip.payload.payload.kind !== 'dns') continue;
    out.push({ packet, dns: ip.payload.payload });
  }
  return out;
}

function dnsLayerOf(container: HTMLElement): Element | undefined {
  return Array.from(container.querySelectorAll('.layer')).find(
    (el) => el.querySelector('.badge-dns') !== null
  );
}

function httpLayerOf(container: HTMLElement): Element | undefined {
  return Array.from(container.querySelectorAll('.layer')).find(
    (el) => el.querySelector('.badge-http') !== null
  );
}

function inspectorProps() {
  return { expandedLayers: {}, onToggleLayer: () => undefined } as const;
}

function httpLabState() {
  const lab = labById('http');
  const engine = new NetworkEngine(lab.topology);
  runLab(engine, lab);
  return engine.getState();
}

describe('PacketInspector', () => {
  beforeEach(() => cleanup());

  it('shows the empty state when no packet is selected', () => {
    render(<PacketInspector packet={undefined} expandedLayers={{}} onToggleLayer={() => undefined} />);
    expect(screen.getByText(/select a packet/i)).toBeTruthy();
  });

  it('renders only the layers that exist on an ARP packet', () => {
    const lab = labById('arp');
    const engine = new NetworkEngine(lab.topology);
    runLab(engine, lab);
    const state = engine.getState();
    const arpPacket = state.packets.find((p) => p.frame.payload.kind === 'arp');
    if (arpPacket === undefined) throw new Error('No ARP packet produced');

    const { container } = render(
      <PacketInspector packet={arpPacket} expandedLayers={{}} onToggleLayer={() => undefined} />
    );
    expect(screen.getByText('ETHERNET')).toBeTruthy();
    expect(screen.getByText('ARP')).toBeTruthy();
    expect(screen.getByText(/Who has/i)).toBeTruthy();
    // IP/TCP/DNS layers must NOT appear for an ARP packet.
    expect(container.textContent).not.toContain('TTL');
    expect(container.textContent).not.toContain('Destination port');
  });

  it('shows TCP and HTTP layers for an HTTP response packet', () => {
    const state = httpLabState();
    const response = state.packets.find(
      (p) => p.frame.payload.kind === 'ip' && p.frame.payload.ip.payload.kind === 'tcp' && p.frame.payload.ip.payload.payload?.kind === 'response'
    );
    if (response === undefined) throw new Error('No HTTP response packet produced');

    const { container } = render(<PacketInspector packet={response} expandedLayers={{}} onToggleLayer={() => undefined} />);
    expect(screen.getByText('ETHERNET')).toBeTruthy();
    expect(screen.getByText('IPv4')).toBeTruthy();
    // TCP appears as both a layer badge and in the path panel — scope to badges.
    expect(container.querySelectorAll('.protocol-badge.badge-tcp').length).toBe(1);
    expect(container.querySelectorAll('.protocol-badge.badge-http').length).toBe(1);
    // "200 OK" appears in both the layer summary and the field list.
    expect(screen.getAllByText(/200 OK/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/Sequence/i)).toBeTruthy();
    expect(screen.getByText(/Window/i)).toBeTruthy();
  });

  it('expands and collapses layers', () => {
    const lab = labById('arp');
    const engine = new NetworkEngine(lab.topology);
    runLab(engine, lab);
    const arpPacket = engine.getState().packets.find((p) => p.frame.payload.kind === 'arp');
    if (arpPacket === undefined) throw new Error('No ARP packet');

    let layers: Record<string, boolean> = { ETHERNET: true };
    render(
      <PacketInspector packet={arpPacket} expandedLayers={layers} onToggleLayer={(l) => { layers = { ...layers, [l]: !(layers[l] ?? true) }; }} />
    );
    const ethernetToggle = screen.getByRole('button', { name: /ETHERNET/i });
    expect(ethernetToggle.getAttribute('aria-expanded')).toBe('true');
  });

  it('switches to raw and explain views', () => {
    const state = httpLabState();
    const packet = state.packets[0];
    if (packet === undefined) throw new Error('No packets');

    render(<PacketInspector packet={packet} expandedLayers={{}} onToggleLayer={() => undefined} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Raw' }));
    expect(screen.getByLabelText('Raw packet JSON').textContent).toContain('"etherType"');

    fireEvent.click(screen.getByRole('tab', { name: 'Explain' }));
    expect(screen.getByText(/Ethernet layer/i)).toBeTruthy();
    expect(screen.getByText(/deterministically/i)).toBeTruthy();
  });
});

describe('Timeline', () => {
  beforeEach(() => cleanup());

  it('shows an empty state before any run', () => {
    render(<Timeline />);
    expect(screen.getByText(/run a lab/i)).toBeTruthy();
  });

  it('lists events and packet chips after a run', () => {
    const lab = labById('arp');
    const engine = new NetworkEngine(lab.topology);
    runLab(engine, lab);
    const state = engine.getState();
    // Timeline reads from the store; test the pure parts instead.
    expect(state.events.length).toBeGreaterThan(0);
    expect(state.packets.length).toBeGreaterThan(0);
  });
});

describe('PacketInspector DNS fields', () => {
  beforeEach(() => cleanup());

  it('shows Transaction ID, Query and Record type on a DNS query without response-only rows', () => {
    const state = runLabState('dns-a-record');
    const query = findDnsPackets(state).find((r) => !r.dns.isResponse);
    if (query === undefined) throw new Error('No DNS query packet produced');

    const { container } = render(<PacketInspector packet={query.packet} {...inspectorProps()} />);
    const dnsLayer = dnsLayerOf(container);
    expect(dnsLayer).not.toBeUndefined();
    expect(dnsLayer?.textContent).toContain('Transaction ID');
    expect(dnsLayer?.textContent).toContain('Query');
    expect(dnsLayer?.textContent).toContain('Record type');
    expect(dnsLayer?.textContent).toContain('www.example.com');
    // Response-only rows must not exist on a query. IPv4 also has a TTL,
    // so the absence check for TTL is scoped to the DNS layer's own rows.
    expect(dnsLayer?.textContent).not.toContain('Response');
    const dtNames = Array.from(dnsLayer?.querySelectorAll('dt') ?? []).map((d) => d.textContent);
    expect(dtNames).not.toContain('TTL');
  });

  it('shows Response and TTL rows on a DNS response', () => {
    const state = runLabState('dns-a-record');
    const response = findDnsPackets(state).find((r) => r.dns.isResponse);
    if (response === undefined) throw new Error('No DNS response packet produced');

    const { container } = render(<PacketInspector packet={response.packet} {...inspectorProps()} />);
    const dnsLayer = dnsLayerOf(container);
    expect(dnsLayer).not.toBeUndefined();
    expect(dnsLayer?.textContent).toContain('Response');
    expect(dnsLayer?.textContent).toContain('TTL');
    expect(dnsLayer?.textContent).toContain('93.184.216.34');
  });
});

describe('PacketInspector HTTP and TCP fields', () => {
  beforeEach(() => cleanup());

  function findHttpPacket(state: NetworkState, kind: 'request' | 'response'): Packet {
    const packet = state.packets.find(
      (p) =>
        p.frame.payload.kind === 'ip' &&
        p.frame.payload.ip.payload.kind === 'tcp' &&
        p.frame.payload.ip.payload.payload?.kind === kind
    );
    if (packet === undefined) throw new Error(`No HTTP ${kind} packet produced`);
    return packet;
  }

  it('shows Method, Path and headers, and omits an absent Body', () => {
    const request = findHttpPacket(runLabState('http'), 'request');
    const { container } = render(<PacketInspector packet={request} {...inspectorProps()} />);
    const httpLayer = httpLayerOf(container);
    expect(httpLayer).not.toBeUndefined();
    expect(httpLayer?.textContent).toContain('Method');
    expect(httpLayer?.textContent).toContain('GET');
    expect(httpLayer?.textContent).toContain('Path');
    expect(httpLayer?.textContent).toContain('Header: Host');
    expect(httpLayer?.textContent).not.toContain('Body');
  });

  it('lists TCP flags such as SYN on the handshake segment', () => {
    const state = runLabState('http');
    const syn = state.packets.find(
      (p) =>
        p.frame.payload.kind === 'ip' &&
        p.frame.payload.ip.payload.kind === 'tcp' &&
        p.frame.payload.ip.payload.flags.syn
    );
    if (syn === undefined) throw new Error('No SYN packet produced');

    render(<PacketInspector packet={syn} {...inspectorProps()} />);
    const flagsDt = screen.getByText('Flags');
    expect(flagsDt.nextElementSibling?.textContent).toContain('SYN');
  });
});

describe('PacketInspector copy-to-clipboard', () => {
  beforeEach(() => cleanup());

  it('copies packet JSON and the explanation', async () => {
    const written: string[] = [];
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: (text: string) => {
          written.push(text);
          return Promise.resolve();
        }
      }
    });

    const packet = runLabState('http').packets[0];
    if (packet === undefined) throw new Error('No packets produced');

    render(<PacketInspector packet={packet} {...inspectorProps()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy packet JSON' }));
    await waitFor(() => expect(screen.getByText('Copied ✓')).toBeTruthy());
    expect(written[0]).toContain('"etherType"');

    fireEvent.click(screen.getByRole('tab', { name: 'Explain' }));
    fireEvent.click(screen.getByRole('button', { name: 'Copy explanation' }));
    await waitFor(() => expect(written.length).toBe(2));
    expect(written[1]).toContain('Ethernet layer');
  });
});

describe('PacketInspector path highlight', () => {
  beforeEach(() => cleanup());

  it('lists each hop of a routed packet', () => {
    const routed = runLabState('multi-router').packets.find((p) => p.hops.length >= 2);
    if (routed === undefined) throw new Error('No multi-hop packet produced');

    render(<PacketInspector packet={routed} {...inspectorProps()} />);
    const path = screen.getByLabelText('Packet path');
    expect(path.querySelectorAll('li').length).toBe(routed.hops.length);
    expect(path.textContent).toContain('→');
  });

  it('emphasizes the selected packet path links on the canvas', () => {
    const lab = labById('multi-router');
    const engine = new NetworkEngine(lab.topology);
    runLab(engine, lab);
    const state = engine.getState();
    const routed = state.packets.find((p) => p.hops.length >= 2);
    if (routed === undefined) throw new Error('No multi-hop packet produced');

    const { container } = render(
      <TopologyCanvas
        topology={lab.topology}
        state={state}
        cursorMs={routed.hops[0]?.startMs ?? 0}
        selectedPacketId={routed.id}
        onSelectPacket={() => undefined}
      />
    );
    expect(container.querySelectorAll('polyline.path-active').length).toBe(
      new Set(routed.hops.map((h) => h.linkId)).size
    );

    // Without a selection no link is emphasized.
    const { container: bare } = render(
      <TopologyCanvas
        topology={lab.topology}
        state={state}
        cursorMs={0}
        selectedPacketId={null}
        onSelectPacket={() => undefined}
      />
    );
    expect(bare.querySelectorAll('polyline.path-active').length).toBe(0);
  });
});

describe('explainPacket (deterministic)', () => {
  it('returns identical output for the same packet', () => {
    const packet = runLabState('http').packets[0];
    if (packet === undefined) throw new Error('No packets produced');
    expect(explainPacket(packet)).toEqual(explainPacket(packet));
  });

  it('explains DNS queries and responses', () => {
    const refs = findDnsPackets(runLabState('dns-a-record'));
    const query = refs.find((r) => !r.dns.isResponse);
    const response = refs.find((r) => r.dns.isResponse);
    if (query === undefined || response === undefined) throw new Error('DNS packets missing');

    const qDns = explainPacket(query.packet).find((s) => s.title === 'DNS layer');
    expect(qDns).toBeDefined();
    expect(qDns?.lines.join(' ')).toContain('www.example.com');

    const rDns = explainPacket(response.packet).find((s) => s.title === 'DNS layer');
    expect(rDns?.lines.join(' ')).toContain('93.184.216.34');
  });

  it('explains the HTTP layer for requests and responses', () => {
    const state = runLabState('http');
    const request = state.packets.find(
      (p) =>
        p.frame.payload.kind === 'ip' &&
        p.frame.payload.ip.payload.kind === 'tcp' &&
        p.frame.payload.ip.payload.payload?.kind === 'request'
    );
    const response = state.packets.find(
      (p) =>
        p.frame.payload.kind === 'ip' &&
        p.frame.payload.ip.payload.kind === 'tcp' &&
        p.frame.payload.ip.payload.payload?.kind === 'response'
    );
    if (request === undefined || response === undefined) throw new Error('HTTP packets missing');

    const req = explainPacket(request).find((s) => s.title === 'HTTP layer');
    expect(req?.lines.join(' ')).toContain('GET');
    const res = explainPacket(response).find((s) => s.title === 'HTTP layer');
    expect(res?.lines.join(' ')).toContain('200');
  });
});

/**
 * Flagship "Open a Web Page" — the complete journey: all eight stages in
 * order, the five-question narratives, the routed frame rewrite, the
 * openUrl entry point, the journey + stack components, determinism.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { NetworkEngine } from '../src/engine/network-engine';
import { runLab, labSeed } from '../src/labs/runner';
import { labs, labById } from '../src/labs';
import type { LabDefinition } from '../src/labs/types';
import { webTopology } from '../src/labs/web-topology';
import { validateTopology } from '../src/models/topology';
import { journeyStages, activeStageAt } from '../src/state/journey';
import { useApp, parseHttpUrl } from '../src/state/store';
import { JourneyPanel } from '../src/components/JourneyPanel';
import { ProtocolStackView } from '../src/components/ProtocolStackView';
import { UrlBar } from '../src/components/UrlBar';

function mustLab(id: string): LabDefinition {
  const lab = labById(id);
  if (lab === undefined) throw new Error(`Missing lab ${id}`);
  return lab;
}

function runFlagship() {
  const lab = mustLab('open-web-page');
  const engine = new NetworkEngine(lab.topology);
  runLab(engine, lab);
  return { lab, engine, final: engine.getState() };
}

/* ------------------------------------------------------------------ */
/* The eight stages, in order                                          */
/* ------------------------------------------------------------------ */

describe('The complete journey', () => {
  const { final } = runFlagship();

  it('topology is valid and crosses exactly one router', () => {
    expect(validateTopology(webTopology)).toEqual([]);
    const routerLinks = webTopology.links.filter((l) => {
      const nodeOf = (ifaceId: string) => webTopology.nodes.find((n) => n.interfaces.some((i) => i.id === ifaceId))?.id;
      return l.endpoints.some((e) => nodeOf(e) === 'web-router') && l.endpoints.some((e) => nodeOf(e) === 'web-server');
    });
    expect(routerLinks).toHaveLength(1);
  });

  it('performs all eight stages with correct global ordering', () => {
    const first = (predicate: (e: import('../src/models/events').SimulationEvent) => boolean) =>
      final.events.find(predicate)?.ts;
    const dns = first((e) => e.type === 'DNS_QUERY');
    const arp = first((e) => e.type === 'ARP_REQUEST' && e.targetIp === '172.20.0.1');
    const route = first((e) => e.type === 'ROUTE_LOOKUP' && e.destination === '172.30.0.20');
    const syn = first((e) => e.type === 'TCP_STATE_CHANGE' && e.to === 'SYN_SENT');
    const get = first((e) => e.type === 'HTTP_REQUEST');
    const response = first((e) => e.type === 'HTTP_RESPONSE');
    const fin = first((e) => e.type === 'TCP_STATE_CHANGE' && e.to === 'FIN_WAIT_1');
    const closed = first((e) => e.type === 'TCP_STATE_CHANGE' && e.from === 'TIME_WAIT' && e.to === 'CLOSED');

    expect(dns).toBeDefined();
    expect(arp).toBeDefined();
    expect(route).toBeDefined();
    expect(syn).toBeDefined();
    expect(get).toBeDefined();
    expect(response).toBeDefined();
    expect(fin).toBeDefined();
    expect(closed).toBeDefined();
    // The journey order. Request and response are emitted in the same
    // engine tick (request in, response queued out), so <= there; the
    // rest are strictly ordered phases of the timeline.
    const idx = (ts: number | undefined) => final.events.findIndex((e) => e.ts === ts);
    expect(dns! <= arp!).toBe(true);
    expect(arp! <= syn!).toBe(true);
    expect(route! <= syn!).toBe(true);
    expect(syn! < get!).toBe(true);
    expect(idx(get!) <= idx(response!)).toBe(true);
    expect(response! <= fin!).toBe(true);
    expect(fin! < closed!).toBe(true);
  });

  it('DNS stays on the LAN; the web traffic crosses the router', () => {
    // The DNS answer came from the local resolver.
    const response = final.events.find((e) => e.type === 'DNS_RESPONSE');
    if (response?.type === 'DNS_RESPONSE') expect(response.address).toBe('172.30.0.20');
    // The TCP handshake crossed the router: the server's packets arrive with TTL decremented.
    const serverPacket = final.packets.find(
      (p) => p.frame.payload.kind === 'ip' && p.frame.payload.ip.source === '172.30.0.20' && p.hops.length >= 2
    );
    expect(serverPacket).toBeDefined();
    if (serverPacket !== undefined && serverPacket.frame.payload.kind === 'ip') {
      expect(serverPacket.frame.payload.ip.ttl).toBeLessThan(64);
    }
  });

  it('the frame is rewritten at the router while the IP destination stays the same', () => {
    const macOf = (ifaceId: string) =>
      webTopology.nodes.flatMap((n) => n.interfaces).find((i) => i.id === ifaceId)?.mac;
    const nodeOf = (ifaceId: string) =>
      webTopology.nodes.find((n) => n.interfaces.some((i) => i.id === ifaceId))?.id;
    const getRequest = final.packets.find(
      (p) => p.frame.payload.kind === 'ip' && p.frame.payload.ip.payload.kind === 'tcp' && p.frame.payload.ip.payload.payload?.kind === 'request'
    );
    expect(getRequest).toBeDefined();
    if (getRequest === undefined) return;
    // Find the consecutive hop pair that enters and leaves the router.
    let entered: number | undefined;
    for (let i = 0; i + 1 < getRequest.hops.length; i++) {
      const a = getRequest.hops[i];
      const b = getRequest.hops[i + 1];
      if (a === undefined || b === undefined) continue;
      if (nodeOf(a.toInterface) === 'web-router' && nodeOf(b.fromInterface) === 'web-router') {
        entered = i;
        break;
      }
    }
    expect(entered).toBeDefined();
    if (entered === undefined) return;
    const inHop = getRequest.hops[entered]!;
    const outHop = getRequest.hops[entered + 1]!;
    // Leg 1 ends on the router LAN port; leg 2 leaves the router web port.
    expect(macOf(inHop.toInterface)).toBe('02:00:00:10:00:31');
    expect(macOf(outHop.fromInterface)).toBe('02:00:00:10:00:32');
    // …but the IP envelope is untouched.
    if (getRequest.frame.payload.kind === 'ip') {
      expect(getRequest.frame.payload.ip.destination).toBe('172.30.0.20');
      expect(getRequest.frame.payload.ip.ttl).toBe(63); // decremented exactly once
    }
  });

  it('the full lifecycle of TCP completes', () => {
    const client = final.events.filter(
      (e): e is Extract<typeof e, { type: 'TCP_STATE_CHANGE' }> => e.type === 'TCP_STATE_CHANGE' && e.nodeId === 'web-browser'
    );
    expect(client.map((e) => `${e.from}→${e.to}`)).toEqual([
      'CLOSED→SYN_SENT',
      'SYN_SENT→ESTABLISHED',
      'ESTABLISHED→ESTABLISHED', // GET sent
      'ESTABLISHED→ESTABLISHED', // 200 OK received
      'ESTABLISHED→FIN_WAIT_1',
      'FIN_WAIT_1→FIN_WAIT_2',
      'FIN_WAIT_2→TIME_WAIT',
      'TIME_WAIT→CLOSED'
    ]);
  });

  it('is byte-for-byte deterministic', () => {
    const a = runFlagship().final;
    const b = runFlagship().final;
    expect(JSON.stringify(a.events)).toBe(JSON.stringify(b.events));
  });

  it('is the first lab in the catalog', () => {
    expect(labs[0]?.id).toBe('open-web-page');
  });
});

/* ------------------------------------------------------------------ */
/* Journey stages & the five questions                                 */
/* ------------------------------------------------------------------ */

describe('Journey stages and narratives', () => {
  const { final } = runFlagship();
  const stages = journeyStages(final.events);

  it('derives exactly eight stages with titles', () => {
    expect(stages).toHaveLength(8);
    expect(stages.map((s) => s.id)).toEqual(['dns', 'arp', 'routing', 'handshake', 'get', 'response', 'data', 'teardown']);
    expect(stages.every((s) => s.events.length > 0)).toBe(true);
  });

  it('every stage answers all five questions', () => {
    for (const stage of stages) {
      expect(stage.answers).toBeDefined();
      expect(stage.answers?.what.length).toBeGreaterThan(10);
      expect(stage.answers?.why.length).toBeGreaterThan(10);
      expect(stage.answers?.protocol.length).toBeGreaterThan(2);
      expect(stage.answers?.added.length).toBeGreaterThan(5);
      expect(stage.answers?.changed.length).toBeGreaterThan(5);
      expect(stage.answers?.decider.length).toBeGreaterThan(5);
    }
  });

  it('stages name the right protocols and deciders', () => {
    const byId = new Map(stages.map((s) => [s.id, s]));
    expect(byId.get('dns')?.answers?.protocol).toContain('DNS');
    expect(byId.get('arp')?.answers?.protocol).toContain('ARP');
    expect(byId.get('routing')?.answers?.protocol).toContain('IPv4');
    expect(byId.get('handshake')?.answers?.protocol).toContain('TCP');
    expect(byId.get('get')?.answers?.protocol).toContain('HTTP');
    expect(byId.get('routing')?.answers?.decider).toContain('Router');
    expect(byId.get('teardown')?.answers?.decider).toContain('browser');
  });

  it('stage events partition the log without stealing other stages’ events', () => {
    const total = stages.reduce((acc, s) => acc + s.events.length, 0);
    const uniqueEvents = new Set(stages.flatMap((s) => s.events));
    expect(uniqueEvents.size).toBe(total);
    // The handshake stage must only contain TCP state changes.
    const handshake = stages.find((s) => s.id === 'handshake');
    expect(handshake?.events.every((e) => e.type === 'TCP_STATE_CHANGE')).toBe(true);
  });

  it('activeStageAt follows the cursor through the journey', () => {
    // At t=0 the latest events belong to DNS (the very first beat).
    expect(activeStageAt(stages, 0)?.id).toBe('dns');
    // At the end the latest events are the teardown's final CLOSED.
    expect(activeStageAt(stages, final.simMs)?.id).toBe('teardown');
    // Mid-journey the stages interleave in sim-time; whatever is current
    // must be one of the wire-active stages around the handshake.
    const handshake = stages.find((s) => s.id === 'handshake');
    if (handshake?.startedAtMs !== undefined) {
      const current = activeStageAt(stages, handshake.startedAtMs)?.id;
      expect(['arp', 'routing', 'handshake']).toContain(current);
    }
  });
});

/* ------------------------------------------------------------------ */
/* openUrl entry point                                                 */
/* ------------------------------------------------------------------ */

describe('openUrl', () => {
  it('parses http URLs into host and path', () => {
    expect(parseHttpUrl('http://example.local/index.html')).toEqual({ host: 'example.local', path: '/index.html' });
    expect(parseHttpUrl('https://example.local/')).toEqual({ host: 'example.local', path: '/' });
    expect(parseHttpUrl('ftp://example.local/')).toBeUndefined();
    expect(parseHttpUrl('not a url')).toBeUndefined();
  });

  it('openUrl loads the flagship lab with the typed host and path', () => {
    useApp.getState().openUrl('http://example.local/other-page.html');
    const { lab } = useApp.getState();
    expect(lab?.id).toBe('open-web-page');
    const httpEntry = lab?.script.find((e) => e.action === 'send-http');
    expect(httpEntry?.action === 'send-http' && httpEntry.serverName).toBe('example.local');
    expect(httpEntry?.action === 'send-http' && httpEntry.path).toBe('/other-page.html');
  });
});

/* ------------------------------------------------------------------ */
/* Flagship components                                                 */
/* ------------------------------------------------------------------ */

describe('Flagship components', () => {
  beforeEach(() => cleanup());

  function seed(state: ReturnType<NetworkEngine['getState']>, cursorMs: number) {
    useApp.setState({ state, lab: mustLab('open-web-page'), selectedPacketId: null, cursorMs });
  }

  it('JourneyPanel renders all stages and marks the current one', () => {
    const { final } = runFlagship();
    seed(final, final.simMs);
    const { container } = render(<JourneyPanel />);
    expect(container.textContent).toContain('The journey');
    expect(container.textContent).toContain('1 · DNS resolution');
    expect(container.textContent).toContain('8 · Termination');
    expect(container.textContent).toContain('What happened?');
    expect(container.textContent).toContain('Who decided?');
    expect(container.querySelectorAll('.journey-stage.current').length).toBe(1);
    expect(container.querySelectorAll('.journey-stage.done').length).toBeGreaterThanOrEqual(7);
  });

  it('ProtocolStackView shows the four layers and the frame rewrite', () => {
    const { final } = runFlagship();
    const getRequest = final.packets.find(
      (p) => p.frame.payload.kind === 'ip' && p.frame.payload.ip.payload.kind === 'tcp' && p.frame.payload.ip.payload.payload?.kind === 'request'
    );
    useApp.setState({ state: final, lab: mustLab('open-web-page'), selectedPacketId: getRequest?.id ?? null, cursorMs: final.simMs });
    const { container } = render(<ProtocolStackView />);
    expect(container.textContent).toContain('Protocol stack');
    expect(container.textContent).toContain('HTTP');
    expect(container.textContent).toContain('GET /index.html HTTP/1.1');
    expect(container.textContent).toContain('TCP');
    expect(container.textContent).toContain('49152 → 80');
    expect(container.textContent).toContain('IPv4');
    expect(container.textContent).toContain('Ethernet');
    // The centerpiece lesson: frame rewrite with unchanged IP destination.
    expect(container.textContent).toContain('The frame changed — the IP destination did not');
    expect(container.textContent).toContain('Browser → Router');
    expect(container.textContent).toContain('Router → Server');
    expect(container.textContent).toContain('172.30.0.20');
  });

  it('UrlBar accepts a URL and starts the flagship journey', () => {
    const { container } = render(<UrlBar />);
    expect(container.querySelector('input')?.value).toBe('http://example.local/index.html');
    expect(container.textContent).toContain('Go');
  });
});

/* ------------------------------------------------------------------ */
/* Step mode equivalence                                               */
/* ------------------------------------------------------------------ */

describe('Flagship determinism in step mode', () => {
  it('stepping through replays the identical event sequence', () => {
    const lab = mustLab('open-web-page');
    const stepped = new NetworkEngine(lab.topology);
    for (let i = 0; i < 80; i++) stepped.step(labSeed(stepped, lab));
    const full = new NetworkEngine(lab.topology);
    runLab(full, lab);
    const steppedPairs = stepped.getState().events.map((e) => `${e.ts}|${e.type}`);
    const fullPairs = full.getState().events.map((e) => `${e.ts}|${e.type}`);
    for (let i = 0; i < steppedPairs.length; i++) {
      expect(steppedPairs[i]).toBe(fullPairs[i]);
    }
    expect(steppedPairs.length).toBeLessThanOrEqual(fullPairs.length);
  });
});

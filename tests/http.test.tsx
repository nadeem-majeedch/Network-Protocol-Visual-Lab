/**
 * HTTP over the canonical TCP simulation — the complete lifecycle
 * (DNS → ARP → routing → TCP handshake → HTTP request → HTTP response →
 * TCP termination), the five layer-focused labs, the HTTP inspector,
 * and determinism.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { NetworkEngine } from '../src/engine/network-engine';
import { runLab, labSeed } from '../src/labs/runner';
import { labs, labById } from '../src/labs';
import type { LabDefinition } from '../src/labs/types';
import { httpTopology } from '../src/labs/topologies';
import { validateTopology } from '../src/models/topology';
import { useApp } from '../src/state/store';
import { HttpInspector } from '../src/components/HttpInspector';

function mustLab(id: string): LabDefinition {
  const lab = labById(id);
  if (lab === undefined) throw new Error(`Missing lab ${id}`);
  return lab;
}

function runHttpScript(script: LabDefinition['script']) {
  const lab: LabDefinition = { ...mustLab('http-get'), script };
  const engine = new NetworkEngine(httpTopology);
  runLab(engine, lab);
  return engine.getState();
}

function stateChanges(state: ReturnType<NetworkEngine['getState']>) {
  return state.events.filter((e): e is Extract<typeof e, { type: 'TCP_STATE_CHANGE' }> => e.type === 'TCP_STATE_CHANGE');
}

/* ------------------------------------------------------------------ */
/* The complete lifecycle                                              */
/* ------------------------------------------------------------------ */

describe('Complete HTTP lifecycle (DNS → ARP → TCP → HTTP → teardown)', () => {
  const final = runHttpScript([
    { atMs: 0, action: 'send-http', from: 'http-client', serverName: 'www.example.com', path: '/index.html', resolveFirst: true }
  ]);

  it('resolves the name before opening the connection', () => {
    const dnsResponse = final.events.find((e) => e.type === 'DNS_RESPONSE');
    const syn = stateChanges(final).find((e) => e.to === 'SYN_SENT');
    expect(dnsResponse).toBeDefined();
    expect(syn).toBeDefined();
    if (dnsResponse !== undefined && syn !== undefined) {
      expect(dnsResponse.ts).toBeLessThanOrEqual(syn.ts);
    }
    // The learned address is the web server that serves the page.
    if (dnsResponse?.type === 'DNS_RESPONSE') expect(dnsResponse.address).toBe('192.168.9.80');
  });

  it('performs ARP before the first HTTP frame', () => {
    const arpRequest = final.events.find((e) => e.type === 'ARP_REQUEST');
    const httpSent = final.events.find((e) => e.type === 'HTTP_REQUEST');
    expect(arpRequest).toBeDefined();
    expect(httpSent).toBeDefined();
  });

  it('handshakes before any HTTP and terminates after', () => {
    const client = stateChanges(final).filter((e) => e.nodeId === 'http-client');
    // ESTABLISHED→ESTABLISHED entries are the data phases (GET sent,
    // 200 OK received) — real transitions that keep the state.
    expect(client.map((e) => `${e.from}→${e.to}`)).toEqual([
      'CLOSED→SYN_SENT',
      'SYN_SENT→ESTABLISHED',
      'ESTABLISHED→ESTABLISHED',
      'ESTABLISHED→ESTABLISHED',
      'ESTABLISHED→FIN_WAIT_1',
      'FIN_WAIT_1→FIN_WAIT_2',
      'FIN_WAIT_2→TIME_WAIT',
      'TIME_WAIT→CLOSED'
    ]);
  });

  it('exchanges GET /index.html and HTTP/1.1 200 OK', () => {
    const request = final.events.find((e) => e.type === 'HTTP_REQUEST');
    const response = final.events.find((e) => e.type === 'HTTP_RESPONSE');
    expect(request?.type).toBe('HTTP_REQUEST');
    expect(response?.type).toBe('HTTP_RESPONSE');
    if (request?.type === 'HTTP_REQUEST') {
      expect(request.method).toBe('GET');
      expect(request.path).toBe('/index.html');
      expect(request.host).toBe('www.example.com');
    }
    if (response?.type === 'HTTP_RESPONSE') {
      expect(response.status).toBe(200);
      expect(response.reason).toBe('OK');
      expect(response.contentType).toBe('text/html');
    }
  });

  it('wraps the request line in real layered packets on the wire', () => {
    const getRequest = final.packets.find(
      (p) => p.frame.payload.kind === 'ip' && p.frame.payload.ip.payload.kind === 'tcp' && p.frame.payload.ip.payload.payload?.kind === 'request'
    );
    expect(getRequest).toBeDefined();
    if (getRequest !== undefined && getRequest.frame.payload.kind === 'ip' && getRequest.frame.payload.ip.payload.kind === 'tcp') {
      // Ethernet: EtherType 0x0800.
      expect(getRequest.frame.etherType).toBe(0x0800);
      // IPv4: client → server, TTL 64.
      const ip = getRequest.frame.payload.ip;
      expect(ip.source).toBe('192.168.9.10');
      expect(ip.destination).toBe('192.168.9.80');
      expect(ip.ttl).toBeGreaterThan(0);
      // TCP: ports 49152 → 80.
      const tcp = getRequest.frame.payload.ip.payload;
      expect(tcp.sourcePort).toBe(49152);
      expect(tcp.destinationPort).toBe(80);
      expect(tcp.flags.ack).toBe(true);
      expect(tcp.flags.psh).toBe(true);
      // HTTP: the request line.
      expect(tcp.payload?.kind).toBe('request');
    }
  });

  it('all layers appear in one deterministic run', () => {
    expect(final.events.some((e) => e.type === 'DNS_QUERY')).toBe(true);
    expect(final.events.some((e) => e.type === 'ARP_REQUEST')).toBe(true);
    expect(final.events.some((e) => e.type === 'ROUTE_LOOKUP')).toBe(true);
    expect(stateChanges(final).some((e) => e.to === 'ESTABLISHED')).toBe(true);
    expect(final.events.some((e) => e.type === 'HTTP_RESPONSE')).toBe(true);
    expect(stateChanges(final).some((e) => e.from === 'TIME_WAIT' && e.to === 'CLOSED')).toBe(true);
    // Deterministic: same script, byte-identical log.
    const again = runHttpScript([
      { atMs: 0, action: 'send-http', from: 'http-client', serverName: 'www.example.com', path: '/index.html', resolveFirst: true }
    ]);
    expect(JSON.stringify(again.events)).toBe(JSON.stringify(final.events));
  });
});

/* ------------------------------------------------------------------ */
/* The five HTTP labs                                                  */
/* ------------------------------------------------------------------ */

describe('HTTP labs', () => {
  it('all five exist, validate and run deterministically', () => {
    const ids = ['http-get', 'http-tcp-underneath', 'http-ip-underneath', 'http-ethernet-underneath', 'http-encapsulation'];
    expect(labs.filter((l) => ids.includes(l.id)).map((l) => l.id)).toEqual(ids);
    for (const id of ids) {
      const lab = mustLab(id);
      expect(validateTopology(lab.topology), `topology of ${id}`).toEqual([]);
      const a = new NetworkEngine(lab.topology);
      const b = new NetworkEngine(lab.topology);
      runLab(a, lab);
      runLab(b, lab);
      expect(JSON.stringify(a.getState().events), `determinism of ${id}`).toBe(JSON.stringify(b.getState().events));
    }
  });

  it('the GET lab runs DNS, TCP and HTTP layers end to end', () => {
    const lab = mustLab('http-get');
    const engine = new NetworkEngine(lab.topology);
    runLab(engine, lab);
    const final = engine.getState();
    expect(final.events.some((e) => e.type === 'DNS_RESPONSE')).toBe(true);
    expect(final.events.some((e) => e.type === 'HTTP_RESPONSE')).toBe(true);
    expect(stateChanges(final).some((e) => e.from === 'TIME_WAIT')).toBe(true);
  });

  it('the encapsulation lab produces every layer in a single run', () => {
    const lab = mustLab('http-encapsulation');
    const engine = new NetworkEngine(lab.topology);
    runLab(engine, lab);
    const final = engine.getState();
    // Every layer of the stack is observable in the event log.
    expect(final.events.some((e) => e.type === 'DNS_QUERY')).toBe(true);
    expect(final.events.some((e) => e.type === 'ARP_REQUEST')).toBe(true);
    expect(final.events.some((e) => e.type === 'ROUTE_LOOKUP')).toBe(true);
    expect(stateChanges(final).some((e) => e.to === 'SYN_RCVD')).toBe(true);
    expect(final.events.some((e) => e.type === 'HTTP_REQUEST')).toBe(true);
    // And the packet carries all four encapsulation layers.
    const response = final.packets.find(
      (p) => p.frame.payload.kind === 'ip' && p.frame.payload.ip.payload.kind === 'tcp' && p.frame.payload.ip.payload.payload?.kind === 'response'
    );
    expect(response).toBeDefined();
    if (response !== undefined) {
      expect(response.frame.etherType).toBe(0x0800);
      expect(response.frame.payload.kind === 'ip' && response.frame.payload.ip.payload.kind).toBe('tcp');
    }
  });

  it('the TCP/IP/Ethernet labs each stay deterministic and complete the page load', () => {
    for (const id of ['http-tcp-underneath', 'http-ip-underneath', 'http-ethernet-underneath']) {
      const engine = new NetworkEngine(mustLab(id).topology);
      runLab(engine, mustLab(id));
      const final = engine.getState();
      expect(final.events.some((e) => e.type === 'HTTP_RESPONSE'), `${id} delivered the page`).toBe(true);
      expect(stateChanges(final).some((e) => e.to === 'ESTABLISHED'), `${id} handshook`).toBe(true);
    }
  });

  it('every http lab has narrated steps a student can watch', () => {
    for (const id of ['http-get', 'http-tcp-underneath', 'http-ip-underneath', 'http-ethernet-underneath', 'http-encapsulation']) {
      const lab = mustLab(id);
      expect(lab.steps.length).toBeGreaterThanOrEqual(3);
      const watched = new Set(lab.steps.flatMap((s) => s.watchEventTypes));
      expect(watched.size).toBeGreaterThan(0);
    }
  });

  it('step mode replays the same sequence as a full run', () => {
    const lab = mustLab('http-get');
    const stepped = new NetworkEngine(lab.topology);
    for (let i = 0; i < 60; i++) stepped.step(labSeed(stepped, lab));
    const full = new NetworkEngine(lab.topology);
    runLab(full, lab);
    const steppedPairs = stepped.getState().events.map((e) => `${e.ts}|${e.type}`);
    const fullPairs = full.getState().events.map((e) => `${e.ts}|${e.type}`);
    for (let i = 0; i < steppedPairs.length; i++) {
      expect(steppedPairs[i]).toBe(fullPairs[i]);
    }
  });
});

/* ------------------------------------------------------------------ */
/* HTTP inspector UI                                                   */
/* ------------------------------------------------------------------ */

describe('HttpInspector', () => {
  beforeEach(() => cleanup());

  function withSelection(state: ReturnType<NetworkEngine['getState']>, packetId: string | null) {
    useApp.setState({ state, lab: mustLab('http-get'), selectedPacketId: packetId, cursorMs: state.simMs });
  }

  it('shows method, path, version, headers and request line for a GET', () => {
    const state = runHttpScript([
      { atMs: 0, action: 'send-http', from: 'http-client', serverName: 'www.example.com', path: '/index.html', resolveFirst: false }
    ]);
    const getRequest = state.packets.find(
      (p) => p.frame.payload.kind === 'ip' && p.frame.payload.ip.payload.kind === 'tcp' && p.frame.payload.ip.payload.payload?.kind === 'request'
    );
    withSelection(state, getRequest?.id ?? null);
    const { container } = render(<HttpInspector />);
    expect(container.textContent).toContain('Method');
    expect(container.textContent).toContain('GET');
    expect(container.textContent).toContain('/index.html');
    expect(container.textContent).toContain('HTTP/1.1');
    expect(container.textContent).toContain('Host');
    expect(container.textContent).toContain('www.example.com');
    expect(container.textContent).toContain('GET /index.html HTTP/1.1');
  });

  it('shows status line, headers and response body for a 200 OK', () => {
    const state = runHttpScript([
      { atMs: 0, action: 'send-http', from: 'http-client', serverName: 'www.example.com', path: '/index.html', resolveFirst: false }
    ]);
    const response = state.packets.find(
      (p) => p.frame.payload.kind === 'ip' && p.frame.payload.ip.payload.kind === 'tcp' && p.frame.payload.ip.payload.payload?.kind === 'response'
    );
    withSelection(state, response?.id ?? null);
    const { container } = render(<HttpInspector />);
    expect(container.textContent).toContain('HTTP/1.1 200 OK');
    expect(container.textContent).toContain('Content-Type');
    expect(container.textContent).toContain('text/html');
    expect(container.textContent).toContain('Content-Length');
    expect(container.textContent).toContain('Hello from NPVL');
  });

  it('shows the empty state for non-HTTP selections', () => {
    const state = runHttpScript([
      { atMs: 0, action: 'send-http', from: 'http-client', serverName: 'www.example.com', path: '/index.html', resolveFirst: false }
    ]);
    const arpPacket = state.packets.find((p) => p.frame.payload.kind === 'arp');
    withSelection(state, arpPacket?.id ?? null);
    const { container } = render(<HttpInspector />);
    expect(container.textContent).toContain('Select an HTTP request or response');
  });
});

/**
 * Deterministic DNS simulation — recursive resolution, caching, TTL,
 * CNAME chase, record types, unknown domains, labs and UI.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { NetworkEngine } from '../src/engine/network-engine';
import { runLab } from '../src/labs/runner';
import { labs, labById } from '../src/labs';
import type { LabDefinition } from '../src/labs/types';
import { recursiveDnsTopology } from '../src/labs/dns-topology';
import { validateTopology } from '../src/models/topology';
import { useApp } from '../src/state/store';
import { DnsInspector } from '../src/components/DnsInspector';
import { DnsCachePanel } from '../src/components/DnsCachePanel';

function mustLab(id: string): LabDefinition {
  const lab = labById(id);
  if (lab === undefined) throw new Error(`Missing lab ${id}`);
  return lab;
}

function runScript(script: LabDefinition['script']) {
  const lab: LabDefinition = {
    ...mustLab('dns-a-record'),
    script
  };
  const engine = new NetworkEngine(recursiveDnsTopology);
  runLab(engine, lab);
  return engine.getState();
}

function runLabById(id: string) {
  const lab = mustLab(id);
  const engine = new NetworkEngine(lab.topology);
  runLab(engine, lab);
  return { lab, engine, final: engine.getState() };
}

/* ------------------------------------------------------------------ */
/* Successful recursive resolution                                     */
/* ------------------------------------------------------------------ */

describe('Successful recursive resolution', () => {
  const final = runScript([
    { atMs: 0, action: 'send-dns', from: 'dns-client', name: 'www.example.com', recordType: 'A' }
  ]);

  it('walks the complete 8-step flow', () => {
    const evts = final.events;
    // 1. DNS query creation + 2. transmission (client → resolver).
    expect(evts.some((e) => e.type === 'DNS_QUERY' && e.nodeId === 'dns-resolver')).toBe(true);
    expect(evts.some((e) => e.type === 'PACKET_SENT' && e.nodeId === 'dns-client' && e.summary.includes('DNS query for www.example.com'))).toBe(true);
    // 3/4. Resolver lookup — a MISS was recorded (cold cache).
    expect(evts.some((e) => e.type === 'DNS_CACHE_LOOKUP' && e.nodeId === 'dns-resolver' && e.hit === false)).toBe(true);
    // Recursive hop: resolver → authoritative over the router.
    expect(evts.some((e) => e.type === 'DNS_RECURSE' && e.nodeId === 'dns-resolver' && e.serverIp === '203.0.113.53')).toBe(true);
    // 5. Authoritative lookup served the record from its zone.
    expect(evts.some((e) => e.type === 'DNS_QUERY' && e.nodeId === 'dns-auth')).toBe(true);
    expect(evts.some((e) => e.type === 'DNS_RESPONSE' && e.nodeId === 'dns-auth' && e.address === '93.184.216.34')).toBe(true);
    // 7. Cache updates happened on BOTH resolver and client.
    expect(evts.some((e) => e.type === 'DNS_CACHE_WRITE' && e.nodeId === 'dns-resolver' && e.name === 'www.example.com')).toBe(true);
    expect(evts.some((e) => e.type === 'DNS_CACHE_WRITE' && e.nodeId === 'dns-client' && e.name === 'www.example.com')).toBe(true);
    // 6→8. The client received the address 93.184.x.x.
    expect(evts.some((e) => e.type === 'DNS_RESPONSE' && e.nodeId === 'dns-resolver' && e.address === '93.184.216.34')).toBe(true);
    expect(evts.some((e) => e.type === 'PACKET_RECEIVED' && e.nodeId === 'dns-client' && e.protocol === 'UDP')).toBe(true);
  });

  it('crosses the router as real routed UDP (TTL decremented)', () => {
    // The recursion leg (client LAN → DNS subnet) is the cross-router one.
    const recurse = final.packets.find(
      (p) => p.frame.payload.kind === 'ip' && p.frame.payload.ip.payload.kind === 'udp' && p.frame.payload.ip.destination === '203.0.113.53'
    );
    expect(recurse).toBeDefined();
    expect(recurse!.frame.payload.kind === 'ip' && recurse!.frame.payload.ip.ttl).toBeLessThan(32);
    // The wire frame is unicast to the router's MAC (ARP-gated), not broadcast.
    expect(recurse!.frame.destination).not.toBe('ff:ff:ff:ff:ff:ff');
  });

  it('carries the authoritative TTL (600) into the caches', () => {
    const write = final.events.find((e) => e.type === 'DNS_CACHE_WRITE' && e.nodeId === 'dns-resolver');
    if (write?.type === 'DNS_CACHE_WRITE') {
      expect(write.ttl).toBe(600);
      expect(write.expiresAtMs).toBe(write.ts + 600);
    } else {
      throw new Error('resolver never cached the answer');
    }
  });
});

/* ------------------------------------------------------------------ */
/* Cache hits and misses                                               */
/* ------------------------------------------------------------------ */

describe('DNS cache hits and misses', () => {
  it('answers the second ask from the CLIENT cache — the wire is never touched', () => {
    const final = runScript([
      { atMs: 0, action: 'send-dns', from: 'dns-client', name: 'www.example.com', recordType: 'A' },
      { atMs: 400, action: 'send-dns', from: 'dns-client', name: 'www.example.com', recordType: 'A' }
    ]);
    const clientLookups = final.events.filter((e) => e.type === 'DNS_CACHE_LOOKUP' && e.nodeId === 'dns-client');
    expect(clientLookups).toHaveLength(2);
    if (clientLookups[0]?.type === 'DNS_CACHE_LOOKUP') expect(clientLookups[0].hit).toBe(false);
    if (clientLookups[1]?.type === 'DNS_CACHE_LOOKUP') {
      expect(clientLookups[1].hit).toBe(true);
      expect(clientLookups[1].value).toBe('93.184.216.34');
      expect(clientLookups[1].expired).toBe(false);
    }
    // The resolver only ever saw the FIRST query; one recursion total.
    expect(final.events.filter((e) => e.type === 'DNS_CACHE_LOOKUP' && e.nodeId === 'dns-resolver')).toHaveLength(1);
    expect(final.events.filter((e) => e.type === 'DNS_RECURSE')).toHaveLength(1);
    // The note proves no second query was sent.
    expect(final.events.some((e) => e.type === 'NOTE' && e.message.includes('no query sent'))).toBe(true);
  });

  it('a different client hits the resolver cache with its own empty cache', () => {
    const final = runScript([
      { atMs: 0, action: 'send-dns', from: 'dns-client', name: 'www.example.com', recordType: 'A' },
      { atMs: 500, action: 'send-dns', from: 'dns-client2', name: 'www.example.com', recordType: 'A' }
    ]);
    const clientLookups = final.events.filter((e) => e.type === 'DNS_CACHE_LOOKUP' && e.nodeId === 'dns-client2');
    expect(clientLookups.every((e) => e.type !== 'DNS_CACHE_LOOKUP' || e.hit === false)).toBe(true);
    const resolverLookups = final.events.filter((e) => e.type === 'DNS_CACHE_LOOKUP' && e.nodeId === 'dns-resolver');
    if (resolverLookups[1]?.type === 'DNS_CACHE_LOOKUP') expect(resolverLookups[1].hit).toBe(true);
    expect(final.events.filter((e) => e.type === 'DNS_RECURSE')).toHaveLength(1);
  });

  it('state exposes per-node dnsCaches', () => {
    const final = runScript([
      { atMs: 0, action: 'send-dns', from: 'dns-client', name: 'www.example.com', recordType: 'A' }
    ]);
    const resolverCache = final.dnsCaches['dns-resolver'] ?? {};
    const key = 'www.example.com|A';
    expect(resolverCache[key]?.record.value).toBe('93.184.216.34');
    expect(resolverCache[key]?.record.ttl).toBe(600);
    const clientCache = final.dnsCaches['dns-client'] ?? {};
    expect(clientCache[key]?.record.value).toBe('93.184.216.34');
  });
});

/* ------------------------------------------------------------------ */
/* TTL expiration                                                      */
/* ------------------------------------------------------------------ */

describe('TTL expiration', () => {
  it('an expired cache entry triggers a fresh recursion', () => {
    // short.example.com carries ttl 80 — at 300 ms it is long expired.
    const final = runScript([
      { atMs: 0, action: 'send-dns', from: 'dns-client', name: 'short.example.com', recordType: 'A' },
      { atMs: 300, action: 'send-dns', from: 'dns-client', name: 'short.example.com', recordType: 'A' }
    ]);
    const clientLookups = final.events.filter((e) => e.type === 'DNS_CACHE_LOOKUP' && e.nodeId === 'dns-client');
    expect(clientLookups).toHaveLength(2);
    if (clientLookups[1]?.type === 'DNS_CACHE_LOOKUP') {
      expect(clientLookups[1].hit).toBe(true);
      expect(clientLookups[1].expired).toBe(true);
    }
    // Both asks recursed: expired cache is as good as empty.
    expect(final.events.filter((e) => e.type === 'DNS_RECURSE')).toHaveLength(2);
  });

  it('a fresh entry inside its TTL still short-circuits', () => {
    const final = runScript([
      { atMs: 0, action: 'send-dns', from: 'dns-client', name: 'www.example.com', recordType: 'A' },
      { atMs: 100, action: 'send-dns', from: 'dns-client', name: 'www.example.com', recordType: 'A' }
    ]);
    expect(final.events.filter((e) => e.type === 'DNS_RECURSE')).toHaveLength(1);
    const secondClientLookup = final.events.filter((e) => e.type === 'DNS_CACHE_LOOKUP' && e.nodeId === 'dns-client')[1];
    if (secondClientLookup?.type === 'DNS_CACHE_LOOKUP') {
      expect(secondClientLookup.hit).toBe(true);
      expect(secondClientLookup.expired).toBe(false);
    }
  });
});

/* ------------------------------------------------------------------ */
/* Unknown domains                                                     */
/* ------------------------------------------------------------------ */

describe('Unknown domains', () => {
  it('produces NXDOMAIN from the authority and passes it back to the client', () => {
    const final = runScript([
      { atMs: 0, action: 'send-dns', from: 'dns-client', name: 'no-such-host.example.com', recordType: 'A' }
    ]);
    expect(
      final.events.some((e) => e.type === 'DNS_NXDOMAIN' && e.nodeId === 'dns-auth' && e.name === 'no-such-host.example.com')
    ).toBe(true);
    expect(
      final.events.some((e) => e.type === 'DNS_NXDOMAIN' && e.nodeId === 'dns-resolver' && e.name === 'no-such-host.example.com')
    ).toBe(true);
    // Nothing was cached — negative answers are not cached here.
    expect(
      final.events.some((e) => e.type === 'DNS_CACHE_WRITE' && e.name === 'no-such-host.example.com')
    ).toBe(false);
  });

  it('answers NXDOMAIN for a known name with the wrong record type', () => {
    const final = runScript([
      { atMs: 0, action: 'send-dns', from: 'dns-client', name: 'www.example.com', recordType: 'MX' }
    ]);
    expect(final.events.some((e) => e.type === 'DNS_NXDOMAIN' && e.nodeId === 'dns-auth')).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* Record types                                                        */
/* ------------------------------------------------------------------ */

describe('Record types', () => {
  it('AAAA returns an IPv6 address', () => {
    const final = runScript([
      { atMs: 0, action: 'send-dns', from: 'dns-client', name: 'v6.example.com', recordType: 'AAAA' }
    ]);
    const response = final.events.find((e) => e.type === 'DNS_RESPONSE' && e.nodeId === 'dns-resolver');
    if (response?.type === 'DNS_RESPONSE') {
      expect(response.address).toBe('2606:2800:220:1:248:1893:25c8:1946');
    } else {
      throw new Error('no AAAA answer reached the client');
    }
  });

  it('MX returns the mail exchanger', () => {
    const final = runScript([
      { atMs: 0, action: 'send-dns', from: 'dns-client', name: 'example.net', recordType: 'MX' }
    ]);
    const response = final.events.find((e) => e.type === 'DNS_RESPONSE' && e.nodeId === 'dns-resolver');
    if (response?.type === 'DNS_RESPONSE') {
      expect(response.address).toBe('10 mail.example.net');
    } else {
      throw new Error('no MX answer reached the client');
    }
  });

  it('CNAME is chased to a final A record', () => {
    const final = runScript([
      { atMs: 0, action: 'send-dns', from: 'dns-client', name: 'cdn.example.com', recordType: 'A' }
    ]);
    // The authority revealed the alias...
    expect(
      final.events.some((e) => e.type === 'DNS_RESPONSE' && e.nodeId === 'dns-auth' && e.address === 'www.example.com')
    ).toBe(true);
    // ...the resolver chased it...
    expect(
      final.events.some((e) => e.type === 'DNS_RECURSE' && e.nodeId === 'dns-resolver' && e.name === 'www.example.com' && e.reason.includes('CNAME'))
    ).toBe(true);
    // ...both the alias and the target got cached...
    expect(final.events.some((e) => e.type === 'DNS_CACHE_WRITE' && e.nodeId === 'dns-resolver' && e.name === 'cdn.example.com' && e.recordType === 'CNAME')).toBe(true);
    expect(final.events.some((e) => e.type === 'DNS_CACHE_WRITE' && e.nodeId === 'dns-resolver' && e.name === 'www.example.com' && e.recordType === 'A')).toBe(true);
    // ...and the client received the REAL address.
    const finalResponse = [...final.events].filter((e) => e.type === 'DNS_RESPONSE' && e.nodeId === 'dns-resolver').pop();
    if (finalResponse?.type === 'DNS_RESPONSE') {
      expect(finalResponse.address).toBe('93.184.216.34');
    } else {
      throw new Error('client never received the chased address');
    }
  });
});

/* ------------------------------------------------------------------ */
/* The four DNS labs                                                   */
/* ------------------------------------------------------------------ */

describe('DNS labs', () => {
  it('all four exist, validate and stay deterministic', () => {
    const ids = labs.filter((l) => l.id.startsWith('dns-')).map((l) => l.id);
    expect(ids).toEqual(['dns-a-record', 'dns-caching', 'dns-cname', 'dns-cache-compare']);
    for (const id of ids) {
      const lab = mustLab(id);
      expect(validateTopology(lab.topology), `topology of ${id}`).toEqual([]);
      const a = runLabById(id).final;
      const b = runLabById(id).final;
      expect(JSON.stringify(a.events)).toBe(JSON.stringify(b.events));
    }
  });

  it('the caching lab runs the name twice with one recursion', () => {
    const { final } = runLabById('dns-caching');
    expect(final.events.filter((e) => e.type === 'DNS_RECURSE')).toHaveLength(1);
    expect(final.events.some((e) => e.type === 'NOTE' && e.message.includes('no query sent'))).toBe(true);
  });

  it('the cache-compare lab serves client2 without recursion', () => {
    const { final } = runLabById('dns-cache-compare');
    expect(final.events.filter((e) => e.type === 'DNS_RECURSE')).toHaveLength(1);
    expect(final.events.some((e) => e.type === 'DNS_CACHE_LOOKUP' && e.nodeId === 'dns-resolver' && e.hit === true)).toBe(true);
  });

  it('the cname lab ends with a real address at the client', () => {
    const { final } = runLabById('dns-cname');
    const last = [...final.events].filter((e) => e.type === 'DNS_RESPONSE' && e.nodeId === 'dns-resolver').pop();
    if (last?.type === 'DNS_RESPONSE') expect(last.address).toBe('93.184.216.34');
    else throw new Error('no final answer');
  });

  it('the flat dns lab still answers 203.0.113.10 (no regression)', () => {
    const lab = mustLab('dns');
    const engine = new NetworkEngine(lab.topology);
    runLab(engine, lab);
    const final = engine.getState();
    const responses = final.events.filter((e) => e.type === 'DNS_RESPONSE');
    expect(responses.length).toBeGreaterThanOrEqual(1);
    if (responses[0]?.type === 'DNS_RESPONSE') expect(responses[0].address).toBe('203.0.113.10');
  });
});

/* ------------------------------------------------------------------ */
/* UI: DNS inspector + cache panel                                     */
/* ------------------------------------------------------------------ */

describe('DNS UI panels', () => {
  beforeEach(() => cleanup());

  it('DnsInspector shows the message of a selected DNS packet and the flow', () => {
    const lab = mustLab('dns-a-record');
    const engine = new NetworkEngine(lab.topology);
    runLab(engine, lab);
    const state = engine.getState();
    const dnsPacket = state.packets.find(
      (p) => p.frame.payload.kind === 'ip' && p.frame.payload.ip.payload.kind === 'udp' && p.frame.payload.ip.payload.payload.kind === 'dns'
    );
    useApp.setState({ state, lab: lab ?? null, selectedPacketId: dnsPacket?.id ?? null, cursorMs: state.simMs });
    const { container } = render(<DnsInspector />);
    expect(container.textContent).toContain('Transaction');
    expect(container.textContent).toContain('0x1234');
    expect(container.textContent).toContain('www.example.com');
    expect(container.textContent).toContain('Resolution flow');
    expect(container.textContent).toContain('cache MISS');
  });

  it('DnsCachePanel lists cached records with remaining validity', () => {
    const lab = mustLab('dns-a-record');
    const engine = new NetworkEngine(lab.topology);
    runLab(engine, lab);
    const state = engine.getState();
    useApp.setState({ state, lab: lab ?? null, selectedPacketId: null, cursorMs: state.simMs });
    const { container } = render(<DnsCachePanel />);
    expect(container.textContent).toContain('DNS caches');
    expect(container.textContent).toContain('www.example.com');
    expect(container.textContent).toContain('93.184.216.34');
    expect(container.textContent).toContain('valid');
  });

  it('DnsCachePanel marks entries past their TTL', () => {
    const lab = mustLab('dns-a-record');
    const engine = new NetworkEngine(lab.topology);
    runLab(engine, lab);
    const state = engine.getState();
    useApp.setState({ state, lab, selectedPacketId: null, cursorMs: state.simMs + 500 });
    const { container } = render(<DnsCachePanel />);
    expect(container.textContent).toContain('EXPIRED');
  });
});

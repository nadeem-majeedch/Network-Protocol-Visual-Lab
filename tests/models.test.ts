import { describe, it, expect } from 'vitest';
import { mac, formatMac, BROADCAST_MAC, isBroadcast } from '../src/models/mac';
import { ipv4, parseCidr, networkAddress, toUint32, fromUint32, sameSubnet, maskFor } from '../src/models/ipv4';
import { lookupRoute } from '../src/models/routing';
import type { RoutingTable } from '../src/models/routing';

describe('MAC model', () => {
  it('parses common MAC formats into normalized form', () => {
    expect(mac('AA:BB:CC:00:00:01')).toBe('aa:bb:cc:00:00:01');
    expect(mac('aa-bb-cc-00-00-02')).toBe('aa:bb:cc:00:00:02');
    expect(mac('aabb.cc00.0003')).toBe('aa:bb:cc:00:00:03');
  });

  it('rejects malformed MACs', () => {
    expect(() => mac('nope')).toThrow();
    expect(() => mac('aa:bb:cc:00:00')).toThrow();
    expect(() => mac('zz:bb:cc:00:00:01')).toThrow();
  });

  it('identifies broadcast addresses', () => {
    expect(isBroadcast(BROADCAST_MAC)).toBe(true);
    expect(isBroadcast(mac('02:00:00:00:00:01'))).toBe(false);
    expect(formatMac('aa:bb:cc:00:00:01')).toBe('AA:BB:CC:00:00:01');
  });
});

describe('IPv4 model', () => {
  it('validates and normalizes addresses', () => {
    expect(ipv4('10.0.0.1')).toBe('10.0.0.1');
    expect(() => ipv4('999.0.0.1')).toThrow();
    expect(() => ipv4('abc')).toThrow();
  });

  it('parses CIDR notation', () => {
    const { address, prefix } = parseCidr('192.168.1.5/24');
    expect(address).toBe('192.168.1.5');
    expect(prefix).toBe(24);
    expect(() => parseCidr('10.0.0.0/33')).toThrow();
  });

  it('computes masks and network addresses', () => {
    expect(maskFor(24)).toBe(0xffffff00);
    expect(networkAddress(ipv4('192.168.1.130'), 24)).toBe('192.168.1.0');
    expect(networkAddress(ipv4('10.20.5.8'), 16)).toBe('10.20.0.0');
  });

  it('round-trips through uint32', () => {
    const addr = ipv4('203.0.113.10');
    expect(fromUint32(toUint32(addr))).toBe(addr);
  });

  it('decides subnet membership', () => {
    expect(sameSubnet(ipv4('192.168.1.10'), ipv4('192.168.1.200'), 24)).toBe(true);
    expect(sameSubnet(ipv4('192.168.1.10'), ipv4('10.0.0.1'), 24)).toBe(false);
  });
});

describe('Routing table (longest prefix match)', () => {
  const table: RoutingTable = [
    { id: 'r0', destination: ipv4('0.0.0.0'), prefix: 0, nextHop: ipv4('10.0.0.1'), interfaceId: 'eth0', metric: 10, origin: 'static' },
    { id: 'r1', destination: ipv4('10.0.0.0'), prefix: 8, interfaceId: 'eth1', metric: 0, origin: 'connected' },
    { id: 'r2', destination: ipv4('10.1.0.0'), prefix: 16, interfaceId: 'eth2', metric: 0, origin: 'connected' }
  ];
  it('prefers the most specific match', () => {
    expect(lookupRoute(table, ipv4('10.1.2.3'))?.entry.id).toBe('r2');
    expect(lookupRoute(table, ipv4('10.9.9.9'))?.entry.id).toBe('r1');
    expect(lookupRoute(table, ipv4('203.0.113.5'))?.entry.id).toBe('r0');
  });

  it('returns undefined with no default route', () => {
    const noDefault: RoutingTable = table.slice(1);
    expect(lookupRoute(noDefault, ipv4('203.0.113.5'))).toBeUndefined();
  });

  it('breaks prefix ties by metric', () => {
    const tied: RoutingTable = [
      { id: 'low', destination: ipv4('10.0.0.0'), prefix: 16, interfaceId: 'a', metric: 5, origin: 'static' },
      { id: 'high', destination: ipv4('10.0.0.0'), prefix: 16, interfaceId: 'b', metric: 1, origin: 'static' }
    ];
    expect(lookupRoute(tied, ipv4('10.0.0.1'))?.entry.id).toBe('high');
  });
});

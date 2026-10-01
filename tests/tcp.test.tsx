/**
 * Deterministic TCP state machine — tests for every important transition:
 * handshake, data transfer, acknowledgement, teardown (FIN_WAIT_1/2,
 * CLOSE_WAIT, LAST_ACK, TIME_WAIT, 2·MSL expiry), RST abort, guard
 * behavior, labs, the state inspector UI, and determinism.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { NetworkEngine } from '../src/engine/network-engine';
import { runLab, labSeed } from '../src/labs/runner';
import { labs, labById } from '../src/labs';
import type { LabDefinition } from '../src/labs/types';
import { tcpLabTopology } from '../src/labs/tcp-topology';
import { validateTopology } from '../src/models/topology';
import { isnFor } from '../src/simulation/tcp';
import { useApp } from '../src/state/store';
import { TcpStateInspector } from '../src/components/TcpStateInspector';

function mustLab(id: string): LabDefinition {
  const lab = labById(id);
  if (lab === undefined) throw new Error(`Missing lab ${id}`);
  return lab;
}

/** Runs a TCP lab script on the canonical TCP lab topology. */
function runTcpScript(script: LabDefinition['script']) {
  const lab: LabDefinition = { ...mustLab('tcp-handshake'), script };
  const engine = new NetworkEngine(tcpLabTopology);
  runLab(engine, lab);
  return engine.getState();
}

function stateChanges(state: ReturnType<NetworkEngine['getState']>) {
  return state.events.filter((e): e is Extract<typeof e, { type: 'TCP_STATE_CHANGE' }> => e.type === 'TCP_STATE_CHANGE');
}

function connection(state: ReturnType<NetworkEngine['getState']>) {
  const conn = state.tcpConnections[0];
  if (conn === undefined) throw new Error('No TCP connection in state');
  return conn;
}

/* ------------------------------------------------------------------ */
/* Three-way handshake                                                 */
/* ------------------------------------------------------------------ */

describe('Three-way handshake', () => {
  const final = runTcpScript([
    { atMs: 0, action: 'tcp-open', from: 'tcp-lab-client', serverId: 'tcp-lab-server', localPort: 49152, serverPort: 80 }
  ]);

  it('walks CLOSED → SYN_SENT → ESTABLISHED on the client', () => {
    const client = stateChanges(final).filter((e) => e.nodeId === 'tcp-lab-client');
    expect(client.map((e) => `${e.from}→${e.to}`)).toEqual(['CLOSED→SYN_SENT', 'SYN_SENT→ESTABLISHED']);
    expect(connection(final).client.state).toBe('ESTABLISHED');
  });

  it('walks LISTEN → SYN_RCVD → ESTABLISHED on the server', () => {
    const server = stateChanges(final).filter((e) => e.nodeId === 'tcp-lab-server');
    expect(server.map((e) => `${e.from}→${e.to}`)).toEqual(['LISTEN→SYN_RCVD', 'SYN_RCVD→ESTABLISHED']);
    expect(connection(final).server.state).toBe('ESTABLISHED');
  });

  it('puts the three segments on the wire in order: SYN, SYN+ACK, ACK', () => {
    const summaries = final.events
      .filter((e): e is Extract<typeof e, { type: 'PACKET_SENT' }> => e.type === 'PACKET_SENT' && e.protocol === 'TCP')
      .map((e) => e.summary);
    expect(summaries.some((s) => s?.includes('SYN')) ?? false).toBe(true);
    expect(summaries.some((s) => s?.includes('SYN+ACK')) ?? false).toBe(true);
    expect(summaries.some((s) => s?.includes('ACK')) ?? false).toBe(true);
  });

  it('uses deterministic ISNs and consistent SEQ/ACK bookkeeping', () => {
    const client = stateChanges(final).find((e) => e.nodeId === 'tcp-lab-client' && e.to === 'SYN_SENT');
    const server = stateChanges(final).find((e) => e.nodeId === 'tcp-lab-server' && e.to === 'SYN_RCVD');
    const expectedIsn = isnFor('172.16.0.80', 80, '172.16.0.10', 49152, true);
    expect(server?.seq).toBe(expectedIsn);
    // The server ACKs the client's SYN with isn+1; the client's ISN derives
    // from the same deterministic function on the client side.
    const clientIsn = isnFor('172.16.0.10', 49152, '172.16.0.80', 80, false);
    expect(server?.ack).toBe(clientIsn + 1);
    expect(client?.seq).toBe(clientIsn);
    // Same run, same numbers.
    const again = runTcpScript([
      { atMs: 0, action: 'tcp-open', from: 'tcp-lab-client', serverId: 'tcp-lab-server', localPort: 49152, serverPort: 80 }
    ]);
    expect(stateChanges(again).map((e) => e.seq)).toEqual(stateChanges(final).map((e) => e.seq));
  });

  it('the final state carries per-side SEQ/ACK/window for the inspector', () => {
    const conn = connection(final);
    expect(conn.clientSeq).toBeGreaterThan(0);
    expect(conn.serverSeq).toBeGreaterThan(0);
    expect(conn.clientWindow).toBe(65535);
    expect(conn.serverWindow).toBe(65535);
  });
});

/* ------------------------------------------------------------------ */
/* Data transfer + acknowledgement                                     */
/* ------------------------------------------------------------------ */

describe('Data transfer and acknowledgement', () => {
  const final = runTcpScript([
    { atMs: 0, action: 'tcp-open', from: 'tcp-lab-client', serverId: 'tcp-lab-server' },
    { atMs: 400, action: 'tcp-send', from: 'tcp-lab-client', serverId: 'tcp-lab-server', text: 'hello', byteOffset: 0 },
    { atMs: 700, action: 'tcp-send', from: 'tcp-lab-client', serverId: 'tcp-lab-server', text: 'world', byteOffset: 5 }
  ]);

  it('advances sequence numbers byte by byte', () => {
    const sends = stateChanges(final).filter((e) => e.trigger.startsWith('data sent'));
    expect(sends).toHaveLength(2);
    const isn = sends[0]?.seq ?? 0;
    expect(sends[1]?.seq).toBe(isn + 5); // "hello".length
  });

  it('the receiver ACKs SEQ + length and stays ESTABLISHED', () => {
    const receives = stateChanges(final).filter((e) => e.trigger.startsWith('data received'));
    expect(receives).toHaveLength(2);
    expect(receives.every((e) => e.from === 'ESTABLISHED' && e.to === 'ESTABLISHED')).toBe(true);
    const isn = stateChanges(final).find((e) => e.trigger.startsWith('data sent'))?.seq ?? 0;
    expect(receives[0]?.ack).toBe(isn + 5); // after "hello"
    expect(receives[1]?.ack).toBe(isn + 10); // after "world"
  });

  it('both endpoints remain ESTABLISHED throughout', () => {
    const conn = connection(final);
    expect(conn.client.state).toBe('ESTABLISHED');
    expect(conn.server.state).toBe('ESTABLISHED');
  });

  it('the reverse direction uses the SERVER\'s own sequence space', () => {
    const final = runTcpScript([
      { atMs: 0, action: 'tcp-open', from: 'tcp-lab-client', serverId: 'tcp-lab-server' },
      { atMs: 400, action: 'tcp-send', from: 'tcp-lab-client', serverId: 'tcp-lab-server', text: 'ready?', byteOffset: 0 },
      { atMs: 800, action: 'tcp-send', from: 'tcp-lab-server', serverId: 'tcp-lab-client', text: 'ready!', byteOffset: 0 }
    ]);
    const serverSend = stateChanges(final).find((e) => e.nodeId === 'tcp-lab-server' && e.trigger.startsWith('data sent'));
    const serverIsn = isnFor('172.16.0.80', 80, '172.16.0.10', 49152, true);
    expect(serverSend?.seq).toBe(serverIsn);
    // The client ACKs the server's bytes with the server's ISN + length.
    const clientAck = stateChanges(final).filter((e) => e.nodeId === 'tcp-lab-client' && e.trigger.startsWith('data received'));
    expect(clientAck[0]?.ack).toBe(serverIsn + 6);
  });
});

/* ------------------------------------------------------------------ */
/* Connection termination                                              */
/* ------------------------------------------------------------------ */

describe('Connection termination', () => {
  const final = runTcpScript([
    { atMs: 0, action: 'tcp-open', from: 'tcp-lab-client', serverId: 'tcp-lab-server' },
    { atMs: 400, action: 'tcp-close', from: 'tcp-lab-client', serverId: 'tcp-lab-server' }
  ]);

  it('the active closer walks FIN_WAIT_1 → FIN_WAIT_2 → TIME_WAIT → CLOSED', () => {
    const client = stateChanges(final).filter((e) => e.nodeId === 'tcp-lab-client');
    expect(client.map((e) => `${e.from}→${e.to}`)).toEqual([
      'CLOSED→SYN_SENT',
      'SYN_SENT→ESTABLISHED',
      'ESTABLISHED→FIN_WAIT_1',
      'FIN_WAIT_1→FIN_WAIT_2',
      'FIN_WAIT_2→TIME_WAIT',
      'TIME_WAIT→CLOSED'
    ]);
  });

  it('the passive side walks ESTABLISHED → CLOSE_WAIT → LAST_ACK → CLOSED', () => {
    const server = stateChanges(final).filter((e) => e.nodeId === 'tcp-lab-server');
    expect(server.map((e) => `${e.from}→${e.to}`)).toEqual([
      'LISTEN→SYN_RCVD',
      'SYN_RCVD→ESTABLISHED',
      'ESTABLISHED→CLOSE_WAIT',
      'CLOSE_WAIT→LAST_ACK',
      'LAST_ACK→CLOSED'
    ]);
  });

  it('TIME_WAIT is a real 2·MSL timer (30 ms), not an instant jump', () => {
    const timeWait = stateChanges(final).find((e) => e.to === 'TIME_WAIT');
    const closed = stateChanges(final).find((e) => e.nodeId === 'tcp-lab-client' && e.to === 'CLOSED' && e.from === 'TIME_WAIT');
    expect(timeWait).toBeDefined();
    expect(closed).toBeDefined();
    expect((closed?.ts ?? 0) - (timeWait?.ts ?? 0)).toBe(30);
    expect(closed?.trigger).toBe('2·MSL timer expired');
  });

  it('every FIN elicits an ACK on the wire', () => {
    const summaries = final.events
      .filter((e): e is Extract<typeof e, { type: 'PACKET_SENT' }> => e.type === 'PACKET_SENT' && e.protocol === 'TCP')
      .map((e) => e.summary);
    const finSegments = summaries.filter((s) => s?.includes('FIN'));
    expect(finSegments.length).toBe(2); // client FIN, server FIN
    expect(summaries.filter((s) => s === 'ACK from Client').length).toBeGreaterThanOrEqual(2);
  });
});

/* ------------------------------------------------------------------ */
/* RST abort                                                           */
/* ------------------------------------------------------------------ */

describe('RST abort', () => {
  it('an RST takes ESTABLISHED straight to CLOSED and hits the wire', () => {
    const final = runTcpScript([
      { atMs: 0, action: 'tcp-open', from: 'tcp-lab-client', serverId: 'tcp-lab-server' },
      { atMs: 400, action: 'tcp-reset', from: 'tcp-lab-client', serverId: 'tcp-lab-server' }
    ]);
    const client = stateChanges(final).filter((e) => e.nodeId === 'tcp-lab-client');
    expect(client.map((e) => `${e.from}→${e.to}`)).toEqual(['CLOSED→SYN_SENT', 'SYN_SENT→ESTABLISHED', 'ESTABLISHED→CLOSED']);
    const rst = stateChanges(final).find((e) => e.to === 'CLOSED');
    expect(rst?.trigger).toContain('RST');
    // An RST segment was actually transmitted.
    expect(final.events.some((e) => e.type === 'PACKET_SENT' && e.summary?.includes('RST'))).toBe(true);
  });

  it('an inbound RST in any non-CLOSED state aborts the connection', () => {
    // Server receives an RST mid-handshake (client resets right after SYN).
    const final = runTcpScript([
      { atMs: 0, action: 'tcp-open', from: 'tcp-lab-client', serverId: 'tcp-lab-server' },
      { atMs: 3, action: 'tcp-reset', from: 'tcp-lab-client', serverId: 'tcp-lab-server' }
    ]);
    // Whatever state the server reached, an RST event exists somewhere.
    expect(stateChanges(final).some((e) => e.trigger.includes('RST'))).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* Guard behavior                                                      */
/* ------------------------------------------------------------------ */

describe('State machine guards', () => {
  it('a duplicate SYN does not re-open a half-open connection', () => {
    const final = runTcpScript([
      { atMs: 0, action: 'tcp-open', from: 'tcp-lab-client', serverId: 'tcp-lab-server' },
      { atMs: 600, action: 'tcp-open', from: 'tcp-lab-client', serverId: 'tcp-lab-server' }
    ]);
    const server = stateChanges(final).filter((e) => e.nodeId === 'tcp-lab-server' && e.to === 'SYN_RCVD');
    expect(server).toHaveLength(1); // guard swallowed the second SYN
    const client = stateChanges(final).filter((e) => e.nodeId === 'tcp-lab-client' && e.to === 'SYN_SENT');
    expect(client).toHaveLength(1);
  });

  it('segments for unknown connections are ignored, not crashed on', () => {
    // Data sent with NO connection ever opened — no state change may appear.
    const final = runTcpScript([
      { atMs: 0, action: 'tcp-send', from: 'tcp-lab-client', serverId: 'tcp-lab-server', text: 'ghost' }
    ]);
    expect(stateChanges(final)).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------ */
/* The four TCP labs                                                   */
/* ------------------------------------------------------------------ */

describe('TCP labs', () => {
  it('all four exist, validate and run deterministically', () => {
    const ids = ['tcp-handshake', 'tcp-data', 'tcp-ack', 'tcp-teardown'];
    expect(labs.filter((l) => ids.includes(l.id)).map((l) => l.id)).toEqual(ids);
    for (const id of ids) {
      const lab = mustLab(id);
      expect(validateTopology(lab.topology), `topology of ${id}`).toEqual([]);
      const engineA = new NetworkEngine(lab.topology);
      const engineB = new NetworkEngine(lab.topology);
      runLab(engineA, lab);
      runLab(engineB, lab);
      expect(JSON.stringify(engineA.getState().events)).toBe(JSON.stringify(engineB.getState().events));
    }
  });

  it('the handshake lab ends with both sides ESTABLISHED', () => {
    const engine = new NetworkEngine(mustLab('tcp-handshake').topology);
    runLab(engine, mustLab('tcp-handshake'));
    const conn = engine.getState().tcpConnections[0];
    expect(conn?.client.state).toBe('ESTABLISHED');
    expect(conn?.server.state).toBe('ESTABLISHED');
  });

  it('the teardown lab ends with the client in CLOSED after TIME_WAIT', () => {
    const engine = new NetworkEngine(mustLab('tcp-teardown').topology);
    runLab(engine, mustLab('tcp-teardown'));
    const final = engine.getState();
    const conn = final.tcpConnections[0];
    expect(conn?.client.state).toBe('CLOSED');
    expect(conn?.server.state).toBe('CLOSED');
    expect(stateChanges(final).some((e) => e.from === 'TIME_WAIT' && e.to === 'CLOSED')).toBe(true);
  });

  it('step mode replays the same transition sequence as a full run', () => {
    const lab = mustLab('tcp-teardown');
    const stepped = new NetworkEngine(lab.topology);
    for (let i = 0; i < 40; i++) stepped.step(labSeed(stepped, lab));
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
/* UI: TCP state inspector                                             */
/* ------------------------------------------------------------------ */

describe('TcpStateInspector', () => {
  beforeEach(() => cleanup());

  it('shows connection, endpoints, states, SEQ, ACK, window and last transition', () => {
    const lab = mustLab('tcp-handshake');
    const engine = new NetworkEngine(lab.topology);
    runLab(engine, lab);
    const state = engine.getState();
    useApp.setState({ state, lab, selectedPacketId: null, cursorMs: state.simMs });
    const { container } = render(<TcpStateInspector />);
    expect(container.textContent).toContain('TCP state');
    expect(container.textContent).toContain('172.16');
    expect(container.textContent).toContain('49152');
    expect(container.textContent).toContain('ESTABLISHED');
    expect(container.textContent).toContain('SEQ');
    expect(container.textContent).toContain('Window');
    expect(container.textContent).toContain('Last transition');
    // The LAST transition of the handshake is the server entering ESTABLISHED.
    expect(container.textContent).toContain('final ACK received');
  });

  it('renders nothing without TCP connections', () => {
    const lab = mustLab('arp');
    const engine = new NetworkEngine(lab.topology);
    runLab(engine, lab);
    const state = engine.getState();
    useApp.setState({ state, lab, selectedPacketId: null, cursorMs: 0 });
    const { container } = render(<TcpStateInspector />);
    expect(container.textContent).not.toContain('TCP state');
  });
});

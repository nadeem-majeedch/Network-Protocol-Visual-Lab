/**
 * DnsInspector: the DNS view of the selected packet — transaction id,
 * question, record type, answers with TTL — plus a feed of recent DNS
 * events so the recursive flow (query → cache → recurse → answer) reads
 * top-to-bottom. Pure projection of the canonical event log.
 */

import { useApp } from '../state/store';
import type { Packet } from '../models/packet';
import type { SimulationEvent } from '../models/events';
import { describeEvent } from '../models/events';

type DnsFlowEvent = Extract<
  SimulationEvent,
  { type: 'DNS_QUERY' | 'DNS_RESPONSE' | 'DNS_CACHE_LOOKUP' | 'DNS_CACHE_WRITE' | 'DNS_RECURSE' | 'DNS_NXDOMAIN' }
>;

const DNS_EVENT_TYPES: readonly DnsFlowEvent['type'][] = [
  'DNS_QUERY',
  'DNS_RESPONSE',
  'DNS_CACHE_LOOKUP',
  'DNS_CACHE_WRITE',
  'DNS_RECURSE',
  'DNS_NXDOMAIN'
];

export function DnsInspector() {
  const state = useApp((s) => s.state);
  const selectedPacketId = useApp((s) => s.selectedPacketId);

  if (state === null) return null;

  const packet: Packet | undefined = state.packets.find((p) => p.id === selectedPacketId);
  const udpPayload =
    packet?.frame.payload.kind === 'ip' && packet.frame.payload.ip.payload.kind === 'udp'
      ? packet.frame.payload.ip.payload.payload
      : undefined;
  const dns = udpPayload !== undefined && udpPayload.kind === 'dns' ? udpPayload : undefined;

  const flow = state.events.filter((e): e is DnsFlowEvent => DNS_EVENT_TYPES.includes(e.type as DnsFlowEvent['type']));

  return (
    <section className="cache-panel" aria-label="DNS inspector">
      <h3>DNS inspector</h3>
      {dns !== undefined ? (
        <table className="route-table">
          <tbody>
            <tr>
              <th scope="row">Transaction</th>
              <td className="mono">0x{dns.transactionId.toString(16).padStart(4, '0')}</td>
            </tr>
            <tr>
              <th scope="row">Direction</th>
              <td>{dns.isResponse ? 'response' : 'query'}</td>
            </tr>
            <tr>
              <th scope="row">Question</th>
              <td className="mono">
                {dns.questions.map((q) => `${q.name}/${q.type}`).join(', ') || '—'}
              </td>
            </tr>
            {dns.isResponse && (
              <tr>
                <th scope="row">Answers</th>
                <td>
                  {dns.answers === undefined || dns.answers.length === 0 ? (
                    <span className="muted">NXDOMAIN — name does not exist</span>
                  ) : (
                    <ul className="cache-list">
                      {dns.answers.map((a) => (
                        <li key={`${a.name}|${a.type}|${a.value}`}>
                          <span className="mono">{a.name}</span> ({a.type}) → <span className="mono">{a.value}</span>
                          <span className="muted cache-ts"> ttl {a.ttl}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      ) : (
        <p className="muted panel-hint">Select a DNS packet to inspect its message.</p>
      )}

      <h4>Resolution flow</h4>
      <ol className="dns-flow">
        {flow.slice(-8).map((e, i) => (
          <li key={`${e.ts}-${i}`} className={`dns-flow-${eventClass(e)}`}>
            <span className="mono">{Math.round(e.ts)} ms</span> {describeEvent(e)}
          </li>
        ))}
      </ol>
      {flow.length === 0 && <p className="muted">No DNS activity yet — run a DNS lab.</p>}
    </section>
  );
}

function eventClass(e: DnsFlowEvent): string {
  switch (e.type) {
    case 'DNS_CACHE_LOOKUP':
      return e.hit ? 'hit' : 'miss';
    case 'DNS_NXDOMAIN':
      return 'fail';
    default:
      return 'info';
  }
}

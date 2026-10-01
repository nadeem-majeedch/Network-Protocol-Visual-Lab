/**
 * PacketInspector: renders the canonical packet as protocol layers.
 *
 * Shows only fields that exist on the selected packet. Includes the raw
 * structured view, a deterministic explanation, expand/collapse per
 * layer, copy-to-clipboard, and packet path highlighting.
 */

import { useMemo, useState } from 'react';
import type { Packet } from '../models/packet';
import type { EthernetFrame } from '../models/ethernet';
import { explainPacket } from '../simulation/explain';
import { formatMac } from '../models/mac';

export interface PacketInspectorProps {
  readonly packet: Packet | undefined;
  readonly expandedLayers: Readonly<Record<string, boolean>>;
  readonly onToggleLayer: (layer: string) => void;
}

const LAYERS = ['ETHERNET', 'ARP', 'IPv4', 'TCP', 'UDP', 'DNS', 'HTTP', 'ICMP'] as const;

export function PacketInspector({ packet, expandedLayers, onToggleLayer }: PacketInspectorProps) {
  const [mode, setMode] = useState<'structured' | 'raw' | 'explain'>('structured');

  const sections = useMemo(() => buildSections(packet), [packet]);
  const explanation = useMemo(() => (packet === undefined ? [] : explainPacket(packet)), [packet]);
  const rawJson = useMemo(() => (packet === undefined ? '' : JSON.stringify(packet.frame, null, 2)), [packet]);
  const explanationText = useMemo(
    () =>
      explanation
        .map((section) => `${section.title}\n${section.lines.map((line) => `- ${line}`).join('\n')}`)
        .join('\n\n'),
    [explanation]
  );

  if (packet === undefined) {
    return (
      <div className="inspector empty-state" role="status">
        <h3>Packet inspector</h3>
        <p>Select a packet in the timeline or click a moving dot on the canvas.</p>
      </div>
    );
  }

  const visible = new Set(sections.map((s) => s.layer));

  return (
    <div className="inspector" aria-label="Packet inspector">
      <header className="inspector-header">
        <h3>
          Packet #{packet.serial} <span className={`badge state-${packet.state}`}>{packet.state}</span>
        </h3>
        <div className="segmented" role="tablist" aria-label="Inspector view">
          <button role="tab" aria-selected={mode === 'structured'} className={mode === 'structured' ? 'active' : ''} onClick={() => setMode('structured')}>
            Layers
          </button>
          <button role="tab" aria-selected={mode === 'raw'} className={mode === 'raw' ? 'active' : ''} onClick={() => setMode('raw')}>
            Raw
          </button>
          <button role="tab" aria-selected={mode === 'explain'} className={mode === 'explain' ? 'active' : ''} onClick={() => setMode('explain')}>
            Explain
          </button>
        </div>
      </header>

      {mode === 'raw' && (
        <div className="raw-view">
          <CopyButton text={rawJson} label="Copy JSON" />
          <pre aria-label="Raw packet JSON">{rawJson}</pre>
        </div>
      )}

      {mode === 'explain' && (
        <div className="explain-view">
          <div className="explain-head">
            <h4>Explain this packet</h4>
            <CopyButton text={explanationText} label="Copy explanation" />
          </div>
          <p className="explain-intro">
            Generated deterministically from packet state — no AI, no network calls.
          </p>
          {explanation.map((section) => (
            <section key={section.title}>
              <h4>{section.title}</h4>
              <ul>
                {section.lines.map((line, i) => (
                  <li key={i}>{line}</li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      {mode === 'structured' && (
        <div className="layers">
          {LAYERS.filter((l) => visible.has(l)).map((layer) => {
            const open = expandedLayers[layer] ?? true;
            const section = sections.find((s) => s.layer === layer)!;
            return (
              <section key={layer} className="layer">
                <button className="layer-toggle" aria-expanded={open} onClick={() => onToggleLayer(layer)}>
                  <span className={`protocol-badge badge-${layer.toLowerCase()}`}>{layer}</span>
                  <span className="layer-summary">{section.summary}</span>
                  <span aria-hidden="true">{open ? '▾' : '▸'}</span>
                </button>
                {open && <FieldList fields={section.fields} />}
              </section>
            );
          })}
          <CopyButton text={rawJson} label="Copy packet JSON" />
          <PathHighlight packet={packet} />
        </div>
      )}
    </div>
  );
}

interface Field {
  readonly name: string;
  readonly value: string;
}

interface Section {
  readonly layer: string;
  readonly summary: string;
  readonly fields: readonly Field[];
}

function buildSections(packet: Packet | undefined): Section[] {
  if (packet === undefined) return [];
  const frame = packet.frame;
  const sections: Section[] = [ethernetSection(frame)];
  const payload = frame.payload;

  if (payload.kind === 'arp') {
    sections.push({
      layer: 'ARP',
      summary: payload.arp.operation === 'request' ? 'Who has?' : 'Is-at reply',
      fields: [
        { name: 'Operation', value: payload.arp.operation },
        { name: 'Sender IP', value: payload.arp.senderIp },
        { name: 'Sender MAC', value: formatMac(payload.arp.senderMac) },
        { name: 'Target IP', value: payload.arp.targetIp },
        ...(payload.arp.targetMac !== undefined ? [{ name: 'Target MAC', value: formatMac(payload.arp.targetMac) }] : [])
      ]
    });
  }

  if (payload.kind === 'ip') {
    const ip = payload.ip;
    sections.push({
      layer: 'IPv4',
      summary: `${ip.source} → ${ip.destination}`,
      fields: [
        { name: 'Source IP', value: ip.source },
        { name: 'Destination IP', value: ip.destination },
        { name: 'TTL', value: String(ip.ttl) },
        { name: 'Protocol', value: ip.protocol.toUpperCase() }
      ]
    });
    if (ip.payload.kind === 'tcp') {
      sections.push(tcpSection(ip.payload));
      const appPayload = ip.payload.payload;
      if (appPayload !== undefined && (appPayload.kind === 'request' || appPayload.kind === 'response')) {
        sections.push(httpSection(appPayload));
      }
    }
    if (ip.payload.kind === 'udp') {
      sections.push({
        layer: 'UDP',
        summary: `port ${ip.payload.sourcePort} → ${ip.payload.destinationPort}`,
        fields: [
          { name: 'Source port', value: String(ip.payload.sourcePort) },
          { name: 'Destination port', value: String(ip.payload.destinationPort) }
        ]
      });
      if (ip.payload.payload.kind === 'dns') sections.push(dnsSection(ip.payload.payload));
      if (ip.payload.payload.kind === 'request' || ip.payload.payload.kind === 'response') {
        sections.push(httpSection(ip.payload.payload));
      }
    }
    if (ip.payload.kind === 'icmp') {
      sections.push({
        layer: 'ICMP',
        summary: ip.payload.type,
        fields: [
          { name: 'Type', value: ip.payload.type },
          ...(ip.payload.code !== undefined ? [{ name: 'Code', value: ip.payload.code }] : [])
        ]
      });
    }
  }

  return sections;
}

function ethernetSection(frame: EthernetFrame): Section {
  const ethertype = frame.etherType === 0x0806 ? 'ARP (0x0806)' : 'IPv4 (0x0800)';
  return {
    layer: 'ETHERNET',
    summary: `${frame.source} → ${frame.destination}`,
    fields: [
      { name: 'Source MAC', value: formatMac(frame.source) },
      { name: 'Destination MAC', value: formatMac(frame.destination) },
      { name: 'EtherType', value: ethertype }
    ]
  };
}

function tcpSection(seg: import('../models/tcp').TcpSegment): Section {
  const flags = [
    seg.flags.syn && 'SYN',
    seg.flags.ack && 'ACK',
    seg.flags.fin && 'FIN',
    seg.flags.rst && 'RST',
    seg.flags.psh && 'PSH'
  ]
    .filter(Boolean)
    .join(' ');
  return {
    layer: 'TCP',
    summary: `port ${seg.sourcePort} → ${seg.destinationPort}`,
    fields: [
      { name: 'Source port', value: String(seg.sourcePort) },
      { name: 'Destination port', value: String(seg.destinationPort) },
      { name: 'Sequence', value: String(seg.sequence) },
      { name: 'Acknowledgment', value: String(seg.acknowledgment) },
      { name: 'Flags', value: flags },
      { name: 'Window', value: String(seg.window) }
    ]
  };
}

function dnsSection(dns: import('../models/dns').DnsMessage): Section {
  return {
    layer: 'DNS',
    summary: dns.isResponse ? 'response' : 'query',
    fields: [
      { name: 'Transaction ID', value: `0x${dns.transactionId.toString(16).padStart(4, '0')}` },
      { name: 'Query', value: dns.questions.map((q) => q.name).join(', ') },
      { name: 'Record type', value: dns.questions[0]?.type ?? 'A' },
      ...(dns.isResponse
        ? [
            { name: 'Response', value: dns.answers?.map((a) => `${a.name} → ${a.value}`).join('; ') ?? 'none' },
            { name: 'TTL', value: String(dns.answers?.[0]?.ttl ?? '-') }
          ]
        : [])
    ]
  };
}

function httpSection(msg: import('../models/http').HttpMessage): Section {
  return msg.kind === 'request'
    ? {
        layer: 'HTTP',
        summary: `${msg.method} ${msg.path}`,
        fields: [
          { name: 'Method', value: msg.method },
          { name: 'Path', value: msg.path },
          { name: 'Version', value: msg.version },
          ...Object.entries(msg.headers).map(([name, value]) => ({ name: `Header: ${name}`, value })),
          ...(msg.body !== undefined ? [{ name: 'Body', value: msg.body }] : [])
        ]
      }
    : {
        layer: 'HTTP',
        summary: `${msg.status} ${msg.reason}`,
        fields: [
          { name: 'Status', value: `${msg.status} ${msg.reason}` },
          { name: 'Version', value: msg.version },
          ...Object.entries(msg.headers).map(([name, value]) => ({ name: `Header: ${name}`, value })),
          ...(msg.body !== undefined ? [{ name: 'Body', value: msg.body }] : [])
        ]
      };
}

function FieldList({ fields }: { readonly fields: readonly Field[] }) {
  return (
    <dl className="field-list">
      {fields.map((f) => (
        <div key={f.name} className="field">
          <dt>{f.name}</dt>
          <dd>{f.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function CopyButton({ text, label }: { readonly text: string; readonly label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="copy-btn"
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1500);
        });
      }}
    >
      {copied ? 'Copied ✓' : label}
    </button>
  );
}

function PathHighlight({ packet }: { readonly packet: Packet }) {
  if (packet.hops.length === 0) return null;
  return (
    <div className="path-highlight" aria-label="Packet path">
      <h4>Path</h4>
      <ol>
        {packet.hops.map((hop, i) => (
          <li key={i}>
            {hop.fromInterface} → {hop.toInterface} <span className="hop-times">({hop.startMs}–{hop.endMs} ms)</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

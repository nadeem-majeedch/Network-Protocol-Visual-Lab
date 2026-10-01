/**
 * TopologyEditor: the editing panel shown in editor mode.
 *
 * Pure UI over TopologyEngine actions — palette buttons, connect mode,
 * IP/gateway configuration forms, device state toggles and the live
 * validation list. No topology behavior exists in this component.
 */

import { useState } from 'react';
import { useEditor, selectedNode } from '../state/editor-store';
import type { Node } from '../models/topology';

export function TopologyEditor() {
  const addHost = useEditor((s) => s.addHost);
  const addSwitch = useEditor((s) => s.addSwitch);
  const addRouter = useEditor((s) => s.addRouter);
  const addServer = useEditor((s) => s.addServer);
  const addServerFn = addServer;
  const validation = useEditor((s) => s.validation);
  const errors = useEditor((s) => s.errors);

  return (
    <div className="editor-panel" aria-label="Topology editor">
      <h3>Build topology</h3>
      <div className="palette" role="group" aria-label="Add devices">
        <button className="btn" onClick={addHost}>+ PC</button>
        <button className="btn" onClick={addSwitch}>+ Switch</button>
        <button className="btn" onClick={addRouter}>+ Router</button>
        <button className="btn" onClick={() => addServerFn('web')}>+ Web server</button>
        <button className="btn" onClick={() => addServerFn('dns')}>+ DNS server</button>
      </div>

      {errors.length > 0 && (
        <div className="editor-errors" role="alert">
          {errors.map((e, i) => (
            <p key={i} className="error-line">
              <strong>{e.code}</strong> {e.message}
            </p>
          ))}
        </div>
      )}

      {validation.length > 0 && (
        <div className="editor-validation" role="status">
          <h4>Validation</h4>
          {validation.map((v, i) => (
            <p key={i} className="error-line">
              <strong>{v.code}</strong> {v.message}
            </p>
          ))}
        </div>
      )}
      {validation.length === 0 && errors.length === 0 && (
        <p className="muted editor-ok">Topology valid ✓</p>
      )}

      <DeviceProperties />
    </div>
  );
}

function DeviceProperties() {
  const topology = useEditor((s) => s.topology);
  const selectedNodeId = useEditor((s) => s.selectedNodeId);
  const pendingLinkFrom = useEditor((s) => s.pendingLinkFrom);
  const connectSelected = useEditor((s) => s.connectSelected);
  const deleteNode = useEditor((s) => s.deleteNode);
  const toggleDevice = useEditor((s) => s.toggleDevice);
  const addInterface = useEditor((s) => s.addInterface);
  const assignIp = useEditor((s) => s.assignIp);
  const setGateway = useEditor((s) => s.setGateway);

  const node = selectedNode(topology, selectedNodeId);
  const [ip, setIp] = useState('');
  const [prefix, setPrefix] = useState('24');
  const [gateway, setGatewayText] = useState('');

  if (node === undefined) {
    return (
      <div className="device-props empty-state">
        <p>Select a device to inspect and configure it.</p>
        {pendingLinkFrom !== null && <p className="muted">Link pending — select the second device.</p>}
      </div>
    );
  }

  return (
    <div className="device-props" aria-label={`Properties of ${node.name}`}>
      <h4>
        {node.name} <span className="badge">{node.kind}</span>
        {!node.enabled && <span className="badge state-dropped">off</span>}
      </h4>

      <div className="prop-actions">
        {pendingLinkFrom !== null && pendingLinkFrom !== node.id ? (
          <button className="btn primary" onClick={connectSelected}>Connect here</button>
        ) : (
          <LinkToggleButton nodeId={node.id} />
        )}
        <button className="btn" onClick={() => toggleDevice(node.id)}>
          {node.enabled ? '⏻ Power off' : '⏻ Power on'}
        </button>
        <button className="btn" onClick={() => addInterface(node.id)}>+ Port</button>
        <button className="btn danger" onClick={() => deleteNode(node.id)}>Delete</button>
      </div>

      <InterfaceTable node={node} onAssign={assignIp} />

      <form
        className="ip-form"
        onSubmit={(e) => {
          e.preventDefault();
          const first = node.interfaces[0];
          if (first !== undefined && ip.trim() !== '') {
            assignIp(first.id, ip.trim(), Number(prefix));
            setIp('');
          }
        }}
      >
        <h5>Assign IP (primary interface)</h5>
        <input
          aria-label="IPv4 address"
          placeholder="192.168.1.10"
          value={ip}
          onChange={(e) => setIp(e.target.value)}
        />
        <select aria-label="Prefix length" value={prefix} onChange={(e) => setPrefix(e.target.value)}>
          {['8', '16', '24', '30'].map((p) => (
            <option key={p} value={p}>/{p}</option>
          ))}
        </select>
        <button className="btn" type="submit">Apply</button>
      </form>

      {(node.kind === 'host' || node.kind === 'server') && (
        <form
          className="ip-form"
          onSubmit={(e) => {
            e.preventDefault();
            setGateway(node.id, gateway.trim() === '' ? null : gateway.trim());
            setGatewayText('');
          }}
        >
          <h5>Default gateway</h5>
          <input
            aria-label="Gateway address"
            placeholder={node.gateway ?? '192.168.1.1'}
            value={gateway}
            onChange={(e) => setGatewayText(e.target.value)}
          />
          <button className="btn" type="submit">Set</button>
        </form>
      )}
    </div>
  );
}

function LinkToggleButton({ nodeId }: { readonly nodeId: string }) {
  const pendingLinkFrom = useEditor((s) => s.pendingLinkFrom);
  const togglePendingLink = useEditor((s) => s.togglePendingLink);
  return (
    <button
      className={`btn${pendingLinkFrom === nodeId ? ' primary' : ''}`}
      onClick={() => togglePendingLink(nodeId)}
    >
      {pendingLinkFrom === nodeId ? 'Linking… (pick 2nd)' : '⛓ Link'}
    </button>
  );
}

function InterfaceTable({
  node,
  onAssign
}: {
  readonly node: Node;
  readonly onAssign: (ifaceId: string, ip: string, prefix: number) => void;
}) {
  return (
    <table className="iface-table">
      <caption className="sr-only">Interfaces of {node.name}</caption>
      <thead>
        <tr>
          <th scope="col">Port</th>
          <th scope="col">MAC</th>
          <th scope="col">IP</th>
        </tr>
      </thead>
      <tbody>
        {node.interfaces.map((iface) => (
          <tr key={iface.id}>
            <td>{iface.label}</td>
            <td className="mono">{iface.mac}</td>
            <td className="mono">{iface.ip === undefined ? '—' : `${iface.ip}/${iface.prefix ?? ''}`}</td>
            <td>
              {iface.ip === undefined && (
                <button
                  className="btn tiny"
                  onClick={() => onAssign(iface.id, promptIp(node), 24)}
                  aria-label={`Assign default IP to ${iface.label}`}
                >
                  + IP
                </button>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function promptIp(node: Node): string {
  // Deterministic starter address derived from node count position.
  return node.kind === 'router' ? '10.0.0.1' : '10.0.0.10';
}

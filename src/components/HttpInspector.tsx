/**
 * HttpInspector: the application-layer view of the selected packet —
 * request method + path + headers, or response status + reason + headers
 * + body. Pure projection of the packet's TCP payload; no protocol logic.
 */

import { useApp } from '../state/store';
import type { Packet } from '../models/packet';
import type { HttpRequest, HttpResponse } from '../models/http';

export function HttpInspector() {
  const state = useApp((s) => s.state);
  const selectedPacketId = useApp((s) => s.selectedPacketId);
  if (state === null) return null;

  const packet: Packet | undefined = state.packets.find((p) => p.id === selectedPacketId);
  const tcpPayload =
    packet?.frame.payload.kind === 'ip' && packet.frame.payload.ip.payload.kind === 'tcp'
      ? packet.frame.payload.ip.payload.payload
      : undefined;
  const request = tcpPayload?.kind === 'request' ? tcpPayload : undefined;
  const response = tcpPayload?.kind === 'response' ? tcpPayload : undefined;

  if (request === undefined && response === undefined) {
    return (
      <section className="cache-panel" aria-label="HTTP inspector">
        <h3>HTTP</h3>
        <p className="muted panel-hint">Select an HTTP request or response packet to inspect it.</p>
      </section>
    );
  }

  return (
    <section className="cache-panel" aria-label="HTTP inspector">
      <h3>HTTP</h3>
      {request !== undefined && <RequestView request={request} />}
      {response !== undefined && <ResponseView response={response} />}
    </section>
  );
}

function RequestView({ request }: { readonly request: HttpRequest }) {
  return (
    <table className="route-table">
      <tbody>
        <tr>
          <th scope="row">Method</th>
          <td className="mono">{request.method}</td>
        </tr>
        <tr>
          <th scope="row">Path</th>
          <td className="mono">{request.path}</td>
        </tr>
        <tr>
          <th scope="row">Version</th>
          <td className="mono">{request.version}</td>
        </tr>
        <HeadersRow headers={request.headers} />
        {request.body !== undefined && (
          <tr>
            <th scope="row">Body</th>
            <td className="mono">{request.body}</td>
          </tr>
        )}
        <tr>
          <th scope="row">Request line</th>
          <td className="mono">{`${request.method} ${request.path} ${request.version}`}</td>
        </tr>
      </tbody>
    </table>
  );
}

function ResponseView({ response }: { readonly response: HttpResponse }) {
  return (
    <table className="route-table">
      <tbody>
        <tr>
          <th scope="row">Status</th>
          <td className="mono">{`${response.version} ${response.status} ${response.reason}`}</td>
        </tr>
        <HeadersRow headers={response.headers} />
        {response.body !== undefined && (
          <tr>
            <th scope="row">Body</th>
            <td>
              <pre className="http-body">{response.body}</pre>
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}

function HeadersRow({ headers }: { readonly headers: Readonly<Record<string, string>> }) {
  const entries = Object.entries(headers);
  if (entries.length === 0) return null;
  return (
    <tr>
      <th scope="row">Headers</th>
      <td>
        <ul className="cache-list">
          {entries.map(([name, value]) => (
            <li key={name}>
              <span className="mono">{name}</span>: <span className="mono">{value}</span>
            </li>
          ))}
        </ul>
      </td>
    </tr>
  );
}

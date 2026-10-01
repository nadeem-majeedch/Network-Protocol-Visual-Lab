/**
 * TCP endpoint state: one side of a connection, tracked by the engine.
 */

import type { TcpStateName } from './events';

export interface TcpEndpoint {
  readonly connectionId: string;
  readonly nodeId: string;
  readonly state: TcpStateName;
  readonly localPort: number;
  readonly remotePort: number;
  readonly nextSeq: number;
  readonly expectedAck: number;
}

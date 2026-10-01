/**
 * Lab architecture: a lab is pure data (topology + scripted transmissions + +
 * narration). Labs execute against the same NetworkEngine as the free-form
 * simulator, guaranteeing identical protocol semantics.
 */

import type { Topology } from '../models/topology';

export interface LabStep {
  readonly id: string;
  readonly title: string;
  readonly narration: string;
  /** Ids of events that mark this step as observed. */
  readonly watchEventTypes: readonly string[];
}

/**
 * Completion criteria: a pure predicate over NetworkState plus a student-
 * facing description. Checked after a full run (and live as state updates);
 * the predicate must be deterministic and must become true for the lab's
 * own script, which the test suite enforces for every lab.
 */
export interface LabCompletion {
  readonly description: string;
  readonly check: (state: import('../models/network-state').NetworkState) => boolean;
}

export interface LabDefinition {
  readonly id: string;
  readonly title: string;
  readonly protocols: readonly string[];
  readonly objective: string;
  readonly topology: Topology;
  /** Executed by the engine in order at their scheduled times. */
  readonly script: LabScriptEntry[];
  readonly steps: readonly LabStep[];
  readonly task: string;
  /* ---- Laboratory-framework fields (all optional for backward compat) ---- */
  /** What the student should be able to explain after the lab. */
  readonly objectives?: readonly string[];
  /** Lab ids (or topic names) the student should master first. */
  readonly prerequisites?: readonly string[];
  /** Concrete events/values the student is expected to spot in the run. */
  readonly expectedObservations?: readonly string[];
  /** Progressive hints, cheapest first. */
  readonly hints?: readonly string[];
  /** Deeper explanation shown after completion or on demand. */
  readonly explanation?: string;
  /** The lab is satisfied when this predicate holds over the final state. */
  readonly completion?: LabCompletion;
  /** Simulation controls the student should exercise in this lab. */
  readonly controls?: readonly string[];
}

type DnsRecordType = import('../models/dns').DnsRecordType;

export type LabScriptEntry =
  | { readonly atMs: number; readonly action: 'send-http'; readonly from: string; readonly serverName: string; readonly path: string; readonly resolveFirst: boolean }
  | { readonly atMs: number; readonly action: 'send-dns'; readonly from: string; readonly name: string; readonly recordType?: DnsRecordType }
  | { readonly atMs: number; readonly action: 'send-arp'; readonly from: string; readonly targetIp: string }
  | { readonly atMs: number; readonly action: 'send-ping'; readonly from: string; readonly toIp: string; readonly ttl: number; /** Send unicast to this node's MAC instead of L2 broadcast. */ readonly destMacOf?: string }
  | { readonly atMs: number; readonly action: 'tcp-open'; readonly from: string; readonly serverId: string; readonly serverPort?: number; readonly localPort?: number }
  | { readonly atMs: number; readonly action: 'tcp-send'; readonly from: string; readonly serverId: string; readonly text: string; readonly byteOffset?: number }
  | { readonly atMs: number; readonly action: 'tcp-close'; readonly from: string; readonly serverId: string }
  | { readonly atMs: number; readonly action: 'tcp-reset'; readonly from: string; readonly serverId: string }
  | { readonly atMs: number; readonly action: 'note'; readonly nodeId: string; readonly message: string };

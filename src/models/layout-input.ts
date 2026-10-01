/**
 * Topology layout input: positions and optional polyline waypoints.
 * Kept separate from visualization layout so topology data stays serializable.
 */

import type { Point } from './layout';

export interface TopologyLayoutInput {
  readonly nodes: Readonly<Record<string, Point>>;
  readonly links: Readonly<Record<string, readonly Point[]>>;
}

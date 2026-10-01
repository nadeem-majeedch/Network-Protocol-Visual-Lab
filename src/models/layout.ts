/**
 * Layout coordinates for visualizing a network topology.
 * Pure data: carries no protocol semantics.
 */

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface NodeLayout {
  /** Canvas-space position of the node's center. */
  readonly position: Point;
}

export interface LinkLayout {
  /** Optional waypoint routing so links can dodge other devices. */
  readonly waypoints?: readonly Point[];
}

export interface TopologyLayout {
  readonly nodes: Readonly<Record<string, NodeLayout>>;
  readonly links: Readonly<Record<string, LinkLayout>>;
}

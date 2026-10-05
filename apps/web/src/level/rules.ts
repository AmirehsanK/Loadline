import { NODE_TYPES } from '@loadline/engine';
import type { NodeType } from '@loadline/engine';
import type { Scenario } from '@loadline/scenarios';

// What a level lets the player change. The scoring in @loadline/scenarios is the judge: a design
// that breaks a rule cannot pass. These functions let the editor refuse the change in the first
// place, so that nobody finds out at the end of a run.
//
// `level` is null in the sandbox, where everything is allowed.

/** Whether a part was in the level's starting design, as opposed to added by the player. */
function isOriginal(level: Scenario, id: string): boolean {
  return level.starter.nodes.some((node) => node.id === id) || level.starter.edges.some((edge) => edge.id === id);
}

/** The settings of a part the player may not change: dotted paths, or `'*'` for all of them. */
export function lockedPaths(level: Scenario | null, id: string, type?: NodeType): string[] | '*' {
  if (!level) return [];
  if (isOriginal(level, id)) return level.locked[id] ?? [];
  // A part the player added keeps the settings the level gives its kind.
  return type === undefined ? [] : Object.keys(level.added?.[type] ?? {});
}

/** Whether the setting at `path` is locked. Locking `autoscale` locks `autoscale.min` as well. */
export function isLocked(level: Scenario | null, id: string, path: string, type?: NodeType): boolean {
  const paths = lockedPaths(level, id, type);
  if (paths === '*') return true;
  return paths.some((locked) => path === locked || path.startsWith(`${locked}.`) || locked.startsWith(`${path}.`));
}

/** Whether a part or connection may be taken out. */
export function canRemove(level: Scenario | null, id: string): boolean {
  if (!level || !isOriginal(level, id)) return true;
  return !(id in level.locked) || (level.removable?.includes(id) ?? false);
}

/** Whether a connection may be taken out: by itself, or because a part at one end of it may be. */
export function canRemoveEdge(level: Scenario | null, edge: { id: string; source: string; target: string }): boolean {
  if (canRemove(level, edge.id)) return true;
  const goes = (id: string) => level?.removable?.includes(id) ?? false;
  return goes(edge.source) || goes(edge.target);
}

/** The kinds of part the player may add, in the order the palette shows them. */
export function allowedParts(level: Scenario | null): readonly NodeType[] {
  return level ? NODE_TYPES.filter((type) => level.palette.includes(type)) : NODE_TYPES;
}

/** The settings a new part of a kind must have, by dotted path. */
export function forcedSettings(level: Scenario | null, type: NodeType): Record<string, unknown> {
  return level?.added?.[type] ?? {};
}

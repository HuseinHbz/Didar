export interface CategoryNode {
  id: string;
  parentId: string | null;
}

/**
 * Pure tree math over an already-loaded `{id, parentId}[]` snapshot — no
 * repository dependency, unlike identity's `RoleRepositoryPort
 * .wouldCreateCycle` (which walks the tree in SQL). Loading the (typically
 * small) full category set once and reasoning about it in memory here is
 * both simpler to unit-test and cheap enough for the tree sizes a catalog
 * admin UI actually produces — see docs/adr/ADR-005-catalog-architecture.md.
 */
export class CategoryHierarchyService {
  /**
   * True if setting `categoryId`'s parent to `candidateParentId` would
   * create a cycle — i.e. `candidateParentId` is `categoryId` itself or one
   * of its current descendants.
   */
  static wouldCreateCycle(
    categories: readonly CategoryNode[],
    categoryId: string,
    candidateParentId: string,
  ): boolean {
    if (categoryId === candidateParentId) return true;

    const byParent = new Map<string, string[]>();
    for (const node of categories) {
      if (node.parentId === null) continue;
      const siblings = byParent.get(node.parentId) ?? [];
      siblings.push(node.id);
      byParent.set(node.parentId, siblings);
    }

    // BFS the descendant set of categoryId; a cycle exists iff
    // candidateParentId is reachable from categoryId going downward.
    const queue = [...(byParent.get(categoryId) ?? [])];
    const visited = new Set<string>();
    while (queue.length > 0) {
      const current = queue.shift();
      if (current === undefined || visited.has(current)) continue;
      visited.add(current);
      if (current === candidateParentId) return true;
      queue.push(...(byParent.get(current) ?? []));
    }
    return false;
  }

  /** Depth of `categoryId` in the tree (root = 0). Throws on a dangling parentId. */
  static depthOf(categories: readonly CategoryNode[], categoryId: string): number {
    const byId = new Map(categories.map((c) => [c.id, c] as const));
    let depth = 0;
    let current = byId.get(categoryId);
    if (!current) {
      throw new Error(`Unknown category: ${categoryId}`);
    }
    const seen = new Set<string>();
    while (current.parentId !== null) {
      if (seen.has(current.id)) {
        throw new Error(`Cycle detected while computing depth of ${categoryId}`);
      }
      seen.add(current.id);
      const parent = byId.get(current.parentId);
      if (!parent) {
        throw new Error(`Dangling parentId: ${current.parentId}`);
      }
      current = parent;
      depth += 1;
    }
    return depth;
  }
}

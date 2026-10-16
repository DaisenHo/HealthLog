import type { IllnessEpisodeDTO } from "./types";

export interface GroupedEpisodes {
  activeParents: IllnessEpisodeDTO[];
  resolvedParents: IllnessEpisodeDTO[];
  /** Episodes shown inside a top-level card, keyed by that card's id. */
  childrenByParent: Map<string, IllnessEpisodeDTO[]>;
}

const isActive = (e: IllnessEpisodeDTO) => e.resolvedAt === null;

/**
 * Split the journal into active and resolved, nesting each flare or recurring
 * bout inside the card of the condition it belongs to.
 *
 * Every episode lands in exactly one place: as a card of its own, or inside a
 * card that is itself shown. An episode nests under the highest ancestor that
 * shares its status, so a bout of a bout still reaches a visible card; one
 * whose parent sits in the other group (an active flare of a resolved
 * condition, or an ended recurring bout of a still-running one) is a card of
 * its own in its own group. Nesting only under the direct parent lost the
 * grandchild of a nested parent, because a nested card does not render its
 * own children.
 */
export function groupEpisodes(list: IllnessEpisodeDTO[]): GroupedEpisodes {
  const byId = new Map(list.map((e) => [e.id, e]));
  const activeParents: IllnessEpisodeDTO[] = [];
  const resolvedParents: IllnessEpisodeDTO[] = [];
  const childrenByParent = new Map<string, IllnessEpisodeDTO[]>();

  const parentOf = (e: IllnessEpisodeDTO) =>
    e.parentConditionId ? byId.get(e.parentConditionId) : undefined;

  for (const e of list) {
    let root = e;
    const seen = new Set<string>([e.id]);
    let parent = parentOf(e);
    while (parent !== undefined && isActive(parent) === isActive(e)) {
      if (seen.has(parent.id)) {
        // A parent chain that loops has no top; every member stays a card
        // of its own rather than all of them nesting out of sight.
        root = e;
        break;
      }
      seen.add(parent.id);
      root = parent;
      parent = parentOf(parent);
    }

    if (root !== e) {
      const bucket = childrenByParent.get(root.id) ?? [];
      bucket.push(e);
      childrenByParent.set(root.id, bucket);
    } else if (isActive(e)) {
      activeParents.push(e);
    } else {
      resolvedParents.push(e);
    }
  }

  return { activeParents, resolvedParents, childrenByParent };
}

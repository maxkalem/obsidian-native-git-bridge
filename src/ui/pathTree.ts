/**
 * Folder tree built from repo-relative paths, for the tree layout of the
 * status and history panels. Pure and UI-free, so it is unit-testable.
 */

export interface PathTreeNode<T> {
  /** Folder segment name (one level). */
  name: string;
  /** Full folder path, no trailing slash. */
  path: string;
  children: PathTreeNode<T>[];
  /** Items whose file sits DIRECTLY in this folder. */
  items: T[];
  /** Total number of items anywhere under this node. */
  count: number;
}

export interface PathTree<T> {
  /** Items at the repository root. */
  rootItems: T[];
  /** Top-level folders, sorted by name; each level sorted recursively. */
  folders: PathTreeNode<T>[];
}

/**
 * Group items by their directory path. Paths with a trailing slash (git's
 * untracked-directory entries) are treated as items OF their parent folder,
 * keeping them visible as a leaf when nothing lists their contents.
 */
export function buildPathTree<T>(items: readonly T[], getPath: (t: T) => string): PathTree<T> {
  interface MutNode {
    name: string;
    path: string;
    children: Map<string, MutNode>;
    items: T[];
  }
  const top = new Map<string, MutNode>();
  const rootItems: T[] = [];
  const nodeFor = (segments: string[]): MutNode => {
    let map = top;
    let node: MutNode | undefined;
    let path = "";
    for (const seg of segments) {
      path = path === "" ? seg : `${path}/${seg}`;
      let next = map.get(seg);
      if (!next) {
        next = { name: seg, path, children: new Map(), items: [] };
        map.set(seg, next);
      }
      node = next;
      map = next.children;
    }
    return node!;
  };
  for (const it of items) {
    const raw = getPath(it);
    const p = raw.endsWith("/") ? raw.slice(0, -1) : raw;
    const segs = p.split("/");
    if (segs.length <= 1) {
      rootItems.push(it);
      continue;
    }
    nodeFor(segs.slice(0, -1)).items.push(it);
  }
  const freeze = (n: MutNode): PathTreeNode<T> => {
    const children = [...n.children.values()].map(freeze).sort((a, b) => a.name.localeCompare(b.name));
    const count = n.items.length + children.reduce((s, c) => s + c.count, 0);
    return { name: n.name, path: n.path, children, items: n.items, count };
  };
  return {
    rootItems,
    folders: [...top.values()].map(freeze).sort((a, b) => a.name.localeCompare(b.name)),
  };
}

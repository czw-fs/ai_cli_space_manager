import { reorderDirectories } from "../src/directoryOrder";
import type { DirectoryItem } from "../src/types";

function assertOrder(actual: DirectoryItem[], expected: string[], message: string) {
  const ids = actual.map((item) => item.id);
  if (JSON.stringify(ids) !== JSON.stringify(expected)) {
    throw new Error(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(ids)}`);
  }
}

const directories: DirectoryItem[] = [
  { id: "a", name: "A", path: "A", groupId: "" },
  { id: "b", name: "B", path: "B", groupId: "" },
  { id: "c", name: "C", path: "C", groupId: "" },
  { id: "d", name: "D", path: "D", groupId: "" },
];

assertOrder(
  reorderDirectories(directories, "c", "a"),
  ["c", "a", "b", "d"],
  "dragging upward inserts before the target row",
);

assertOrder(
  reorderDirectories(directories, "a", "c"),
  ["b", "c", "a", "d"],
  "dragging downward inserts after the target row",
);

assertOrder(
  reorderDirectories(directories, "a", "missing"),
  ["a", "b", "c", "d"],
  "unknown target leaves order unchanged",
);

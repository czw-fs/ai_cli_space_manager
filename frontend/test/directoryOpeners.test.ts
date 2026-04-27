import {
  availableOpeners,
  pinOpener,
  reorderPinnedOpener,
  unpinOpener,
  visibleOpeners,
} from "../src/directoryOpeners";
import type { CustomOpener, DirectoryItem } from "../src/types";

function assertEqual(actual: unknown, expected: unknown, message: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

const openers: CustomOpener[] = [
  { id: "idea", name: "idea", commandTemplate: "\"idea.exe\"" },
  { id: "code", name: "code", commandTemplate: "\"code.exe\"" },
  { id: "cursor", name: "cursor", commandTemplate: "\"cursor.exe\"" },
];

const directory: DirectoryItem = {
  id: "dir-1",
  name: "workspace",
  path: "C:\\workspace",
  groupId: "",
  openerIds: ["code", "missing", "idea"],
};

assertEqual(
  visibleOpeners(directory, openers).map((item) => item.id),
  ["code", "idea"],
  "visibleOpeners should keep configured order and ignore deleted openers",
);

assertEqual(
  availableOpeners(directory, openers).map((item) => item.id),
  ["cursor"],
  "availableOpeners should hide already pinned openers",
);

assertEqual(
  pinOpener(directory, "cursor").openerIds,
  ["code", "missing", "idea", "cursor"],
  "pinOpener should append a new opener",
);

assertEqual(
  pinOpener(directory, "idea").openerIds,
  ["code", "missing", "idea"],
  "pinOpener should not duplicate existing opener ids",
);

assertEqual(
  unpinOpener(directory, "code").openerIds,
  ["missing", "idea"],
  "unpinOpener should remove only the selected opener",
);

assertEqual(
  reorderPinnedOpener(directory, "idea", "code").openerIds,
  ["idea", "code", "missing"],
  "reorderPinnedOpener should move dragged opener before target opener",
);

assertEqual(
  unpinOpener({ ...directory, openerIds: undefined }, "code", openers).openerIds,
  ["idea"],
  "unpinOpener should initialize old directories from the default pinned opener",
);

assertEqual(
  visibleOpeners({ ...directory, openerIds: undefined }, openers).map((item) => item.id),
  ["idea"],
  "visibleOpeners should pin only the first custom opener for old directories",
);

assertEqual(
  availableOpeners({ ...directory, openerIds: undefined }, openers).map((item) => item.id),
  ["code", "cursor"],
  "availableOpeners should place remaining custom openers in more tools for old directories",
);

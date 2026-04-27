import { shouldCopyTerminalSelection } from "../src/terminalInput";

type Shortcut = {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
};

const shortcut = (overrides: Partial<Shortcut>): Shortcut => ({
  key: "",
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  altKey: false,
  ...overrides,
});

function assertEqual(actual: boolean, expected: boolean, message: string) {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${expected}, got ${actual}`);
  }
}

assertEqual(
  shouldCopyTerminalSelection(shortcut({ key: "c", ctrlKey: true }), true),
  true,
  "Ctrl+C copies when the terminal has selected text",
);

assertEqual(
  shouldCopyTerminalSelection(shortcut({ key: "c", ctrlKey: true }), false),
  false,
  "Ctrl+C falls through when the terminal has no selected text",
);

assertEqual(
  shouldCopyTerminalSelection(shortcut({ key: "v", ctrlKey: true }), true),
  false,
  "Ctrl+V is not treated as a copy shortcut",
);

assertEqual(
  shouldCopyTerminalSelection(shortcut({ key: "c", ctrlKey: true, altKey: true }), true),
  false,
  "modified Ctrl+C combinations fall through",
);

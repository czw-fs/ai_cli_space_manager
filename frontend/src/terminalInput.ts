export type TerminalKeyShortcut = {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
};

export function shouldCopyTerminalSelection(event: TerminalKeyShortcut, hasSelection: boolean) {
  return (
    hasSelection &&
    event.key.toLowerCase() === "c" &&
    event.ctrlKey &&
    !event.metaKey &&
    !event.shiftKey &&
    !event.altKey
  );
}

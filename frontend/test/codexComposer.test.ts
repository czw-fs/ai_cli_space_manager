import {
  buildCodexInteractiveWrites,
  buildCodexPrompt,
  buildComposerWrites,
  CODEX_INTERACTIVE_SUBMIT_DELAY_MS,
  CODEX_EXECUTE_SEQUENCE,
  shouldSendComposerOnEnter,
  TERMINAL_ENTER,
} from "../src/codexComposer";
import type { AttachmentFile } from "../src/types";

function assertEqual(actual: unknown, expected: unknown, message: string) {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assertArrayEqual(actual: unknown[], expected: unknown[], message: string) {
  assertEqual(JSON.stringify(actual), JSON.stringify(expected), message);
}

const attachment: AttachmentFile = {
  id: "img",
  name: "image.png",
  path: "C:\\tmp\\image.png",
  mimeType: "image/png",
  size: 12,
};

assertEqual(
  buildCodexPrompt("  修复布局  ", [attachment]),
  "修复布局\n\n附件图片：\nC:\\tmp\\image.png",
  "composer prompt includes attachment paths",
);

assertArrayEqual(
  buildComposerWrites("执行任务", [], false),
  ["\x1b[200~执行任务\x1b[201~"],
  "paste mode writes only bracketed paste",
);

assertArrayEqual(
  buildComposerWrites("执行任务", [], true),
  ["\x1b[200~执行任务\x1b[201~", TERMINAL_ENTER],
  "execute mode writes paste and a separate enter",
);

assertArrayEqual(
  buildCodexInteractiveWrites("执行任务", []),
  ["\x1b[200~执行任务\x1b[201~", CODEX_EXECUTE_SEQUENCE],
  "codex interactive writes paste then codex execute sequence",
);

if (CODEX_INTERACTIVE_SUBMIT_DELAY_MS < 150) {
  throw new Error(
    `codex submit delay should outlive Codex TUI paste-burst newline suppression, got ${CODEX_INTERACTIVE_SUBMIT_DELAY_MS}`,
  );
}

assertEqual(
  shouldSendComposerOnEnter({ key: "Enter", shiftKey: false, ctrlKey: false, metaKey: false }, "send"),
  true,
  "Enter sends immediately in send mode",
);

assertEqual(
  shouldSendComposerOnEnter({ key: "Enter", shiftKey: false, ctrlKey: false, metaKey: false }, "newline"),
  false,
  "Enter creates a newline in newline mode",
);

assertEqual(
  shouldSendComposerOnEnter({ key: "Enter", shiftKey: false, ctrlKey: true, metaKey: false }, "newline"),
  true,
  "Ctrl+Enter sends in newline mode",
);

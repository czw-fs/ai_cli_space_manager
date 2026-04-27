import type { AttachmentFile } from "./types";

export const BRACKETED_PASTE_START = "\x1b[200~";
export const BRACKETED_PASTE_END = "\x1b[201~";
export const TERMINAL_ENTER = "\r";

export type EnterKeyMode = "send" | "newline";

export type ComposerEnterShortcut = {
  key: string;
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
};

export function buildCodexPrompt(text: string, attachments: AttachmentFile[]) {
  const lines = [text.trim()];
  if (attachments.length > 0) {
    lines.push("");
    lines.push("附件图片：");
    for (const attachment of attachments) {
      lines.push(attachment.path);
    }
  }
  return lines.filter((line, index) => line !== "" || index > 0).join("\n");
}

export function bracketedPaste(text: string) {
  return `${BRACKETED_PASTE_START}${text}${BRACKETED_PASTE_END}`;
}

export function buildComposerWrites(text: string, attachments: AttachmentFile[], execute: boolean) {
  const writes = [bracketedPaste(buildCodexPrompt(text, attachments))];
  if (execute) {
    writes.push(TERMINAL_ENTER);
  }
  return writes;
}

export function shouldSendComposerOnEnter(event: ComposerEnterShortcut, mode: EnterKeyMode) {
  if (event.key !== "Enter" || event.shiftKey) {
    return false;
  }
  if (mode === "send") {
    return true;
  }
  return event.ctrlKey || event.metaKey;
}

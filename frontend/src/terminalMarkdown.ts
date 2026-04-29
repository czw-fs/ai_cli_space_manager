const MAX_MARKDOWN_OUTPUT_CHARS = 120000;

export function stripTerminalControlSequences(value: string) {
  return value
    .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "")
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\x1b[PX^_].*?\x1b\\/g, "")
    .replace(/\x1b[@-Z\\-_]/g, "");
}

export function terminalOutputToMarkdownText(value: string) {
  return stripTerminalControlSequences(value)
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\x08/g, "")
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "");
}

export function appendTerminalMarkdownOutput(current: string, chunk: string) {
  const next = `${current}${terminalOutputToMarkdownText(chunk)}`;
  if (next.length <= MAX_MARKDOWN_OUTPUT_CHARS) {
    return next;
  }
  return next.slice(next.length - MAX_MARKDOWN_OUTPUT_CHARS);
}

export function terminalOutputToCodexReplyText(value: string, activePrompt = "") {
  const text = terminalOutputToMarkdownText(value);
  const promptLines = new Set(
    activePrompt
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean),
  );
  return text
    .split("\n")
    .filter((line) => !isCodexTerminalChromeLine(line, promptLines))
    .join("\n")
    .replace(/\n{4,}/g, "\n\n\n");
}

export function terminalOutputHasCodexInputPrompt(value: string) {
  return terminalOutputToMarkdownText(value)
    .split("\n")
    .some((line) => /^\s*[>›]\s*$/.test(line));
}

function isCodexTerminalChromeLine(line: string, activePromptLines: Set<string>) {
  const trimmed = line.trim();
  if (!trimmed) {
    return false;
  }
  if (activePromptLines.has(trimmed)) {
    return true;
  }
  if (/^[>›]\s*/.test(trimmed)) {
    return true;
  }
  if (/^gpt-[\w.-]+(?:\s+\w+)?\s*·\s*[A-Za-z]:[\\/]/i.test(trimmed)) {
    return true;
  }
  if (/^[A-Za-z]:[\\/].+/.test(trimmed)) {
    return true;
  }
  return false;
}

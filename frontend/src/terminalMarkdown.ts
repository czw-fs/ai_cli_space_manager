const MAX_MARKDOWN_OUTPUT_CHARS = 120000;
const MAX_CODEX_TERMINAL_ROWS = 1200;
const CODEX_STATUS_PREFIX_PATTERN = "[•·*◦○●-]?";

type CursorState = {
  row: number;
  col: number;
  savedRow: number;
  savedCol: number;
  pendingCarriageReturn: boolean;
};

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
  const text = terminalOutputToScreenText(value);
  const promptLines = makePromptLineSet(activePrompt);
  const lines = text.split("\n");
  const hasStatusNoise = lines.some((line) => isCodexStatusLine(line));
  return lines
    .filter((line) => !isCodexTerminalChromeLine(line, promptLines, hasStatusNoise))
    .map(stripCodexMessagePrefix)
    .join("\n")
    .replace(/\n{4,}/g, "\n\n\n");
}

export function terminalOutputToCodexLiveText(value: string, activePrompt = "") {
  const promptLines = makePromptLineSet(activePrompt);
  return trimBlankEdges(
    terminalOutputToScreenText(value)
      .split("\n")
      .filter((line) => !isCodexLiveChromeLine(line, promptLines))
      .join("\n"),
  );
}

export function terminalOutputToCodexTurnLiveText(value: string, activePrompt = "") {
  const promptLines = makePromptLineSet(activePrompt);
  const screenLines = terminalOutputToScreenText(value).split("\n");
  const currentTurnLines = sliceCodexCurrentTurnLines(screenLines, activePrompt, true);
  const boundedLines = truncateAtNextCodexInputPrompt(currentTurnLines, promptLines);
  return trimBlankEdges(
    boundedLines
      .filter((line) => !isCodexLiveChromeLine(line, promptLines))
      .join("\n"),
  );
}

export function mergeCodexTurnLiveText(current: string, nextSnapshot: string) {
  const currentText = trimBlankEdges(current);
  const nextText = trimBlankEdges(nextSnapshot);
  if (!nextText) {
    return currentText;
  }
  if (!currentText) {
    return nextText;
  }
  const currentOnlyStatusReplaced = replaceOnlyStatusWithExpandedSnapshot(currentText, nextText);
  if (currentOnlyStatusReplaced) {
    return currentOnlyStatusReplaced;
  }
  const currentStatusUpdated = replaceTrailingStatusLine(currentText, nextText);
  if (currentStatusUpdated) {
    return currentStatusUpdated;
  }
  const nextContainsCurrentAt = nextText.indexOf(currentText);
  if (nextContainsCurrentAt === 0) {
    return nextText;
  }
  if (nextContainsCurrentAt > 0) {
    return nextText.slice(nextContainsCurrentAt);
  }
  if (currentText.includes(nextText)) {
    if (containsOnlyBusyStatusAndSnapshotContent(currentText, nextText)) {
      return nextText;
    }
    return currentText;
  }
  return mergeByLineOverlap(currentText, nextText);
}

export function terminalOutputHasCodexInputPrompt(value: string) {
  return terminalOutputToMarkdownText(value)
    .split("\n")
    .some((line) => isCodexIdleInputPromptLine(line.trim()));
}

export function terminalOutputHasCodexTurnEndPrompt(value: string, activePrompt = "") {
  const promptLines = makePromptLineSet(activePrompt);
  const currentTurnLines = sliceCodexCurrentTurnLines(terminalOutputToScreenText(value).split("\n"), activePrompt, true);
  let hasMappedContent = false;
  let lastMappedLineWasBusyStatus = false;
  for (const line of currentTurnLines) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    if (hasMappedContent && isCodexPostTurnInputPromptLine(trimmed, promptLines)) {
      return !lastMappedLineWasBusyStatus;
    }
    if (!isCodexLiveChromeLine(line, promptLines)) {
      hasMappedContent = true;
      lastMappedLineWasBusyStatus = isCodexBusyStatusLine(line);
    }
  }
  return false;
}

function makePromptLineSet(activePrompt: string) {
  return new Set(
    activePrompt
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean),
  );
}

function terminalOutputToScreenText(value: string) {
  const lines: string[][] = [[]];
  const cursor: CursorState = {
    row: 0,
    col: 0,
    savedRow: 0,
    savedCol: 0,
    pendingCarriageReturn: false,
  };

  const ensureRow = (row: number) => {
    while (lines.length <= row) {
      lines.push([]);
    }
  };

  const clampCursor = () => {
    cursor.row = Math.max(0, cursor.row);
    cursor.col = Math.max(0, cursor.col);
    ensureRow(cursor.row);
    if (lines.length > MAX_CODEX_TERMINAL_ROWS) {
      const removed = lines.length - MAX_CODEX_TERMINAL_ROWS;
      lines.splice(0, removed);
      cursor.row = Math.max(0, cursor.row - removed);
      cursor.savedRow = Math.max(0, cursor.savedRow - removed);
    }
  };

  const clearLine = (mode: number) => {
    ensureRow(cursor.row);
    if (mode === 2) {
      lines[cursor.row] = [];
      return;
    }
    if (mode === 1) {
      const line = lines[cursor.row];
      for (let index = 0; index <= cursor.col && index < line.length; index += 1) {
        line[index] = " ";
      }
      return;
    }
    lines[cursor.row] = lines[cursor.row].slice(0, cursor.col);
  };

  const clearScreen = (mode: number) => {
    if (mode === 2 || mode === 3) {
      lines.splice(0, lines.length, []);
      cursor.row = 0;
      cursor.col = 0;
      return;
    }
    if (mode === 0) {
      clearLine(0);
      lines.splice(cursor.row + 1);
      return;
    }
    if (mode === 1) {
      lines.splice(0, cursor.row);
      cursor.row = 0;
      clearLine(1);
    }
  };

  const writeCharacter = (character: string) => {
    ensureRow(cursor.row);
    if (cursor.pendingCarriageReturn) {
      lines[cursor.row] = [];
      cursor.pendingCarriageReturn = false;
    }
    const line = lines[cursor.row];
    while (line.length < cursor.col) {
      line.push(" ");
    }
    line[cursor.col] = character;
    cursor.col += 1;
  };

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (character === "\x1b") {
      index = consumeEscapeSequence(value, index, cursor, clearLine, clearScreen, clampCursor);
      continue;
    }
    if (character === "\r") {
      cursor.col = 0;
      cursor.pendingCarriageReturn = true;
      continue;
    }
    if (character === "\n") {
      cursor.row += 1;
      cursor.col = 0;
      cursor.pendingCarriageReturn = false;
      clampCursor();
      continue;
    }
    if (character === "\x08") {
      cursor.col = Math.max(0, cursor.col - 1);
      cursor.pendingCarriageReturn = false;
      continue;
    }
    if (character === "\t") {
      const nextTabStop = cursor.col + (4 - (cursor.col % 4 || 4));
      while (cursor.col <= nextTabStop) {
        writeCharacter(" ");
      }
      continue;
    }
    if (character < " " || character === "\x7f") {
      continue;
    }
    writeCharacter(character);
  }

  return lines
    .map((line) => line.join("").replace(/[ \t]+$/g, ""))
    .join("\n")
    .replace(/\n+$/g, "");
}

function sliceCodexCurrentTurnLines(lines: string[], activePrompt: string, requireAnchor = false) {
  const anchorEndIndex = findCurrentPromptAnchorEndIndex(lines, activePrompt);
  if (anchorEndIndex < 0) {
    if (requireAnchor && normalizePromptCompact(activePrompt)) {
      return [];
    }
    return lines;
  }
  return lines.slice(anchorEndIndex + 1);
}

function findCurrentPromptAnchorEndIndex(lines: string[], activePrompt: string) {
  const target = normalizePromptCompact(activePrompt);
  if (!target) {
    return -1;
  }
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const trimmed = lines[index].trim();
    if (!/^[>›]\s*/.test(trimmed)) {
      continue;
    }
    const endIndex = findPromptAnchorEndFrom(lines, index, target);
    if (endIndex >= 0) {
      return endIndex;
    }
  }
  return -1;
}

function findPromptAnchorEndFrom(lines: string[], startIndex: number, target: string) {
  let candidate = "";
  const maxLines = Math.min(lines.length, startIndex + 8);
  for (let index = startIndex; index < maxLines; index += 1) {
    const rawLine = lines[index].trim();
    const text = index === startIndex ? rawLine.replace(/^[>›]\s*/, "") : rawLine;
    if (!text) {
      break;
    }
    if (index > startIndex && /^[>›]\s*/.test(rawLine)) {
      break;
    }
    candidate += text;
    const normalizedCandidate = normalizePromptCompact(candidate);
    if (normalizedCandidate === target) {
      return index;
    }
    if (!target.startsWith(normalizedCandidate)) {
      break;
    }
  }
  return -1;
}

function truncateAtNextCodexInputPrompt(lines: string[], activePromptLines: Set<string>) {
  let hasMappedContent = false;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    if (hasMappedContent && isCodexPostTurnInputPromptLine(trimmed, activePromptLines)) {
      return lines.slice(0, index);
    }
    if (!isCodexLiveChromeLine(line, activePromptLines)) {
      hasMappedContent = true;
    }
  }
  return lines;
}

function consumeEscapeSequence(
  value: string,
  startIndex: number,
  cursor: CursorState,
  clearLine: (mode: number) => void,
  clearScreen: (mode: number) => void,
  clampCursor: () => void,
) {
  const next = value[startIndex + 1];
  if (!next) {
    return startIndex;
  }
  if (next === "[") {
    let endIndex = startIndex + 2;
    while (endIndex < value.length && !/[@-~]/.test(value[endIndex])) {
      endIndex += 1;
    }
    if (endIndex >= value.length) {
      return value.length - 1;
    }
    applyCsiSequence(value.slice(startIndex + 2, endIndex + 1), cursor, clearLine, clearScreen);
    clampCursor();
    return endIndex;
  }
  if (next === "]") {
    return consumeUntilStringTerminator(value, startIndex + 2);
  }
  if (next === "P" || next === "X" || next === "^" || next === "_") {
    return consumeUntilStringTerminator(value, startIndex + 2);
  }
  if (next === "7") {
    cursor.savedRow = cursor.row;
    cursor.savedCol = cursor.col;
  } else if (next === "8") {
    cursor.row = cursor.savedRow;
    cursor.col = cursor.savedCol;
    clampCursor();
  }
  cursor.pendingCarriageReturn = false;
  return startIndex + 1;
}

function consumeUntilStringTerminator(value: string, startIndex: number) {
  for (let index = startIndex; index < value.length; index += 1) {
    if (value[index] === "\x07") {
      return index;
    }
    if (value[index] === "\x1b" && value[index + 1] === "\\") {
      return index + 1;
    }
  }
  return value.length - 1;
}

function applyCsiSequence(
  sequence: string,
  cursor: CursorState,
  clearLine: (mode: number) => void,
  clearScreen: (mode: number) => void,
) {
  const final = sequence[sequence.length - 1];
  const body = sequence.slice(0, -1).replace(/[?=><]/g, "");
  const params = body
    .split(/[;:]/)
    .filter((part) => part !== "")
    .map((part) => Number.parseInt(part, 10))
    .map((part) => (Number.isFinite(part) ? part : 0));
  const valueAt = (index: number, fallback: number) => {
    const value = params[index];
    return value && value > 0 ? value : fallback;
  };

  cursor.pendingCarriageReturn = false;
  if (final === "A") {
    cursor.row -= valueAt(0, 1);
  } else if (final === "B") {
    cursor.row += valueAt(0, 1);
  } else if (final === "C") {
    cursor.col += valueAt(0, 1);
  } else if (final === "D") {
    cursor.col -= valueAt(0, 1);
  } else if (final === "E") {
    cursor.row += valueAt(0, 1);
    cursor.col = 0;
  } else if (final === "F") {
    cursor.row -= valueAt(0, 1);
    cursor.col = 0;
  } else if (final === "G") {
    cursor.col = valueAt(0, 1) - 1;
  } else if (final === "H" || final === "f") {
    cursor.row = valueAt(0, 1) - 1;
    cursor.col = valueAt(1, 1) - 1;
  } else if (final === "d") {
    cursor.row = valueAt(0, 1) - 1;
  } else if (final === "J") {
    clearScreen(params[0] ?? 0);
  } else if (final === "K") {
    clearLine(params[0] ?? 0);
  } else if (final === "s") {
    cursor.savedRow = cursor.row;
    cursor.savedCol = cursor.col;
  } else if (final === "u") {
    cursor.row = cursor.savedRow;
    cursor.col = cursor.savedCol;
  }
}

function isCodexTerminalChromeLine(line: string, activePromptLines: Set<string>, hasStatusNoise: boolean) {
  const trimmed = line.trim();
  if (!trimmed) {
    return false;
  }
  if (activePromptLines.has(trimmed)) {
    return true;
  }
  if (/^[>›]\s*$/.test(trimmed)) {
    return true;
  }
  const promptText = trimmed.replace(/^[>›]\s*/, "").trim();
  if (activePromptLines.has(promptText)) {
    return true;
  }
  if (isCodexStatusLine(trimmed)) {
    return true;
  }
  if (hasStatusNoise && isCodexStatusFragment(trimmed)) {
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

function isCodexLiveChromeLine(line: string, activePromptLines: Set<string>) {
  const trimmed = line.trim();
  if (!trimmed) {
    return false;
  }
  if (activePromptLines.has(trimmed)) {
    return true;
  }
  if (isCodexInputPromptLine(trimmed, activePromptLines)) {
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

function isCodexInputPromptLine(trimmed: string, activePromptLines: Set<string>) {
  if (/^[>›]\s*$/.test(trimmed)) {
    return true;
  }
  const promptText = trimmed.replace(/^[>›]\s*/, "").trim();
  if (activePromptLines.has(promptText)) {
    return true;
  }
  if (/^[>›]\s*Implement\s+\{feature\}\s*$/i.test(trimmed)) {
    return true;
  }
  return false;
}

function isCodexPostTurnInputPromptLine(trimmed: string, activePromptLines: Set<string>) {
  if (isCodexInputPromptLine(trimmed, activePromptLines)) {
    return true;
  }
  if (/^[>›]\s+\S/.test(trimmed)) {
    return true;
  }
  return false;
}

function isCodexIdleInputPromptLine(trimmed: string) {
  if (/^[>›]\s*$/.test(trimmed)) {
    return true;
  }
  if (/^[>›]\s*Implement\s+\{feature\}\s*$/i.test(trimmed)) {
    return true;
  }
  return false;
}

function isCodexStatusLine(line: string) {
  const trimmed = line.trim();
  if (!trimmed) {
    return false;
  }
  if (/\besc to interrupt\b/i.test(trimmed)) {
    return true;
  }
  if (new RegExp(`^${CODEX_STATUS_PREFIX_PATTERN}\\s*(?:working|thinking|running|reading|writing|searching|applying|planning)\\b`, "i").test(trimmed)) {
    return true;
  }
  if (/^(?:working|thinking|running|reading|writing|searching|applying|planning)(?:\s*\(\d+s|\s*\.{1,3}|…)?$/i.test(trimmed)) {
    return true;
  }
  if (/^(?:ctrl-c|enter|shift\+enter)\b/i.test(trimmed)) {
    return true;
  }
  return false;
}

function isCodexBusyStatusLine(line: string) {
  const trimmed = line.trim();
  if (/\besc to interrupt\b/i.test(trimmed)) {
    return true;
  }
  return new RegExp(`^${CODEX_STATUS_PREFIX_PATTERN}\\s*(?:working|thinking|running|reading|writing|searching|applying|planning)\\b`, "i").test(trimmed);
}

function statusLineKind(line: string) {
  const match = line
    .trim()
    .match(new RegExp(`^${CODEX_STATUS_PREFIX_PATTERN}\\s*(working|thinking|running|reading|writing|searching|applying|planning)\\b`, "i"));
  return match ? match[1].toLowerCase() : "";
}

function replaceTrailingStatusLine(current: string, nextSnapshot: string) {
  const currentLines = current.split("\n");
  const nextLines = nextSnapshot.split("\n").filter((line) => line.trim());
  if (currentLines.length === 0 || nextLines.length === 0) {
    return "";
  }
  if (nextLines.some((line) => !isCodexBusyStatusLine(line))) {
    return "";
  }
  const currentLastIndex = findLastNonBlankLineIndex(currentLines);
  const nextStatusLine = nextLines.find((line) => isCodexBusyStatusLine(line));
  if (currentLastIndex < 0 || !nextStatusLine || !isCodexBusyStatusLine(currentLines[currentLastIndex])) {
    return "";
  }
  if (statusLineKind(currentLines[currentLastIndex]) !== statusLineKind(nextStatusLine)) {
    return "";
  }
  currentLines[currentLastIndex] = nextStatusLine;
  return trimBlankEdges(currentLines.join("\n"));
}

function replaceOnlyStatusWithExpandedSnapshot(current: string, nextSnapshot: string) {
  const currentLines = current.split("\n").filter((line) => line.trim());
  const nextLines = nextSnapshot.split("\n").filter((line) => line.trim());
  if (currentLines.length !== 1 || nextLines.length < 2) {
    return "";
  }
  const currentStatus = currentLines[0];
  const nextFirstLine = nextLines[0];
  if (!isCodexBusyStatusLine(currentStatus) || !isCodexBusyStatusLine(nextFirstLine)) {
    return "";
  }
  if (statusLineKind(currentStatus) !== statusLineKind(nextFirstLine)) {
    return "";
  }
  return trimBlankEdges(nextSnapshot);
}

function containsOnlyBusyStatusAndSnapshotContent(current: string, nextSnapshot: string) {
  const currentLines = current.split("\n").filter((line) => line.trim());
  if (currentLines.length < 2) {
    return false;
  }
  const withoutBusy = currentLines.filter((line) => !isCodexBusyStatusLine(line)).join("\n").trim();
  return Boolean(withoutBusy) && withoutBusy === nextSnapshot.trim();
}

function findLastNonBlankLineIndex(lines: string[]) {
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (lines[index].trim()) {
      return index;
    }
  }
  return -1;
}

function mergeByLineOverlap(current: string, nextSnapshot: string) {
  const currentLines = current.split("\n");
  const nextLines = nextSnapshot.split("\n");
  const maxOverlap = Math.min(currentLines.length, nextLines.length);
  for (let size = maxOverlap; size > 0; size -= 1) {
    if (currentLines.slice(currentLines.length - size).join("\n") === nextLines.slice(0, size).join("\n")) {
      return trimBlankEdges([...currentLines, ...nextLines.slice(size)].join("\n"));
    }
  }
  return trimBlankEdges(`${current}\n${nextSnapshot}`);
}

function isCodexStatusFragment(line: string) {
  const normalized = line.replace(/^[•·*.\s]+/, "").trim().toLowerCase();
  if (!normalized) {
    return true;
  }
  if (/^\d+$/.test(normalized)) {
    return normalized.length <= 2;
  }
  if (/^[。.,·•*]+$/.test(normalized)) {
    return true;
  }
  return new Set([
    "w",
    "wo",
    "wor",
    "work",
    "worki",
    "workin",
    "working",
    "o",
    "or",
    "r",
    "rk",
    "k",
    "ki",
    "i",
    "in",
    "n",
    "ng",
    "g",
    "wng",
    "wog",
  ]).has(normalized);
}

function stripCodexMessagePrefix(line: string) {
  return line.replace(/^\s*[•·]\s+/, "");
}

function trimBlankEdges(value: string) {
  const lines = value.split("\n");
  while (lines.length > 0 && !lines[0].trim()) {
    lines.shift();
  }
  while (lines.length > 0 && !lines[lines.length - 1].trim()) {
    lines.pop();
  }
  return lines.join("\n");
}

function normalizePromptCompact(value: string) {
  return value.replace(/\s+/g, "");
}

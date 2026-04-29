const MAX_MARKDOWN_OUTPUT_CHARS = 120000;
const MAX_CODEX_TERMINAL_ROWS = 1200;

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
  const promptLines = new Set(
    activePrompt
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean),
  );
  const lines = text.split("\n");
  const hasStatusNoise = lines.some((line) => isCodexStatusLine(line));
  return lines
    .filter((line) => !isCodexTerminalChromeLine(line, promptLines, hasStatusNoise))
    .map(stripCodexMessagePrefix)
    .join("\n")
    .replace(/\n{4,}/g, "\n\n\n");
}

export function terminalOutputHasCodexInputPrompt(value: string) {
  return terminalOutputToMarkdownText(value)
    .split("\n")
    .some((line) => /^\s*[>›]\s*$/.test(line));
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

function isCodexStatusLine(line: string) {
  const trimmed = line.trim();
  if (!trimmed) {
    return false;
  }
  if (/\besc to interrupt\b/i.test(trimmed)) {
    return true;
  }
  if (/^[•·*]\s*(?:working|thinking|running|reading|writing|searching|applying|planning)\b/i.test(trimmed)) {
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

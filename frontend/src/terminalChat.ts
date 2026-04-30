import type { AttachmentFile } from "./types";
import { terminalOutputToMarkdownText } from "./terminalMarkdown";

export type TerminalTurnKind = "powershell" | "codex" | "raw" | "system";
export type TerminalChatRole = "user" | "system";
export type TerminalChatStatus = "pending" | "running" | "completed" | "interrupted" | "failed";

export type TerminalChatMessage = {
  id: string;
  sessionId: string;
  turnId: string;
  role: TerminalChatRole;
  kind: TerminalTurnKind;
  content: string;
  attachments?: AttachmentFile[];
  status?: TerminalChatStatus;
  exitCode?: number;
  startedAt: number;
  endedAt?: number;
};

export type TerminalChatMode = "powershell" | "codex";

export type PowerShellTurnState = {
  turnId: string;
  raw: string;
  content: string;
  status: TerminalChatStatus;
  exitCode?: number;
};

export type PowerShellTurnPatch = {
  content: string;
  status: TerminalChatStatus;
  exitCode?: number;
};

const POWERSHELL_MARKER_OSC_PREFIX = "\x1b]633;";
const POWERSHELL_MARKER_OSC_SUFFIX = "\x07";
const POWERSHELL_MARKER_PATTERN = /OWPS_(START|END):([^:\r\n\x07]+)(?::(-?\d+))?/g;
const POWERSHELL_COMPLETE_OSC_MARKER_PATTERN = /\x1b\]633;(OWPS_(?:START|END):[^\x07\x1b]*)(?:\x07|\x1b\\)/g;

export function buildPowerShellManagedCommand(command: string, turnId: string) {
  const normalizedCommand = normalizePowerShellCommand(command);
  const escapedCommand = escapePowerShellSingleQuotedString(normalizedCommand);
  const escapedTurnId = escapePowerShellSingleQuotedString(turnId);
  return [
    "& {",
    "$__owps_esc = [char]27;",
    "$__owps_bel = [char]7;",
    "$__owps_ec = 0;",
    "$global:LASTEXITCODE = $null;",
    `Write-Host -NoNewline \"$__owps_esc]633;OWPS_START:${escapedTurnId}$__owps_bel\";`,
    "try {",
    `Invoke-Expression '${escapedCommand}';`,
    "if ($global:LASTEXITCODE -is [int]) { $__owps_ec = $global:LASTEXITCODE };",
    "} catch {",
    "$__owps_ec = 1;",
    "Write-Error $_;",
    "} finally {",
    `Write-Host -NoNewline \"$__owps_esc]633;OWPS_END:${escapedTurnId}:$__owps_ec$__owps_bel\";`,
    "}",
    "}",
    "\r",
  ].join(" ");
}

export function createPowerShellTurnState(turnId: string): PowerShellTurnState {
  return {
    turnId,
    raw: "",
    content: "",
    status: "running",
  };
}

export function consumePowerShellTurnOutput(state: PowerShellTurnState, chunk: string): PowerShellTurnPatch {
  const raw = `${state.raw}${chunk}`;
  const parsed = parsePowerShellMarkedOutput(raw, state.turnId);
  const status = parsed.completed ? (parsed.exitCode === 0 ? "completed" : "failed") : "running";
  state.raw = raw;
  state.content = parsed.content;
  state.status = status;
  state.exitCode = parsed.exitCode;
  return {
    content: parsed.content,
    status,
    exitCode: parsed.exitCode,
  };
}

export function parsePowerShellMarkedOutput(rawOutput: string, turnId: string) {
  const markdownText = terminalOutputToMarkdownText(exposeCompletePowerShellMarkers(rawOutput));
  const markers = findPowerShellMarkers(markdownText).filter((marker) => marker.turnId === turnId);
  const startMarker = markers.find((marker) => marker.kind === "START");
  const endMarker = markers.find((marker) => marker.kind === "END");
  if (!startMarker) {
    return {
      content: "",
      completed: false,
      exitCode: undefined as number | undefined,
    };
  }
  const outputStart = startMarker.endIndex;
  const outputEnd = endMarker ? endMarker.startIndex : markdownText.length;
  return {
    content: normalizePowerShellChatOutput(markdownText.slice(outputStart, outputEnd), turnId),
    completed: Boolean(endMarker),
    exitCode: endMarker?.exitCode,
  };
}

export function normalizePowerShellChatOutput(value: string, turnId = "") {
  const markerless = terminalOutputToMarkdownText(removePowerShellMarkerText(value, turnId));
  const lines = markerless.split("\n");
  while (lines.length > 0 && isIgnorablePowerShellBoundaryLine(lines[0])) {
    lines.shift();
  }
  while (lines.length > 0 && isIgnorablePowerShellBoundaryLine(lines[lines.length - 1])) {
    lines.pop();
  }
  return lines.join("\n").replace(/\n{4,}/g, "\n\n\n");
}

export function removePowerShellMarkerText(value: string, turnId = "") {
  const markerPattern = turnId
    ? new RegExp(`OWPS_(?:START|END):${escapeRegExp(turnId)}(?::-?\\d+)?`, "g")
    : POWERSHELL_MARKER_PATTERN;
  return value.replace(markerPattern, "").replace(POWERSHELL_MARKER_PATTERN, "");
}

function exposeCompletePowerShellMarkers(value: string) {
  const withoutIncompleteTail = removeIncompletePowerShellMarkerTail(value);
  return withoutIncompleteTail.replace(POWERSHELL_COMPLETE_OSC_MARKER_PATTERN, (_match, marker: string) =>
    marker.startsWith("OWPS_START:") ? `${marker}\n` : `\n${marker}`,
  );
}

function removeIncompletePowerShellMarkerTail(value: string) {
  const oscMarkerStart = value.lastIndexOf(POWERSHELL_MARKER_OSC_PREFIX);
  if (oscMarkerStart < 0) {
    return value;
  }
  const afterStart = value.slice(oscMarkerStart);
  if (afterStart.includes(POWERSHELL_MARKER_OSC_SUFFIX) || afterStart.includes("\x1b\\")) {
    return value;
  }
  return value.slice(0, oscMarkerStart);
}

function normalizePowerShellCommand(command: string) {
  return command.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
}

function escapePowerShellSingleQuotedString(value: string) {
  return value.replace(/'/g, "''");
}

function findPowerShellMarkers(value: string) {
  const markers: Array<{
    kind: "START" | "END";
    turnId: string;
    exitCode?: number;
    startIndex: number;
    endIndex: number;
  }> = [];
  POWERSHELL_MARKER_PATTERN.lastIndex = 0;
  let match = POWERSHELL_MARKER_PATTERN.exec(value);
  while (match) {
    const exitCode = match[3] === undefined ? undefined : Number.parseInt(match[3], 10);
    markers.push({
      kind: match[1] as "START" | "END",
      turnId: match[2],
      exitCode: Number.isFinite(exitCode) ? exitCode : undefined,
      startIndex: match.index,
      endIndex: match.index + match[0].length,
    });
    match = POWERSHELL_MARKER_PATTERN.exec(value);
  }
  return markers;
}

function isIgnorablePowerShellBoundaryLine(line: string) {
  const trimmed = line.trim();
  if (!trimmed) {
    return true;
  }
  if (/^PS\s+[A-Za-z]:[\\/].*>\s*$/i.test(trimmed)) {
    return true;
  }
  if (/^>\s*$/.test(trimmed)) {
    return true;
  }
  return false;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

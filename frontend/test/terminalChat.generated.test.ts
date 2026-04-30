import {
  buildPowerShellManagedCommand,
  consumePowerShellTurnOutput,
  createPowerShellTurnState,
  normalizePowerShellChatOutput,
  parsePowerShellMarkedOutput,
  removePowerShellMarkerText,
} from "../src/terminalChat";
import { spawnSync } from "node:child_process";

function assertEqual(actual: unknown, expected: unknown, message: string) {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assertIncludes(actual: string, expected: string, message: string) {
  if (!actual.includes(expected)) {
    throw new Error(`${message}: expected ${JSON.stringify(actual)} to include ${JSON.stringify(expected)}`);
  }
}

function assertNotIncludes(actual: string, unexpected: string, message: string) {
  if (actual.includes(unexpected)) {
    throw new Error(`${message}: expected ${JSON.stringify(actual)} not to include ${JSON.stringify(unexpected)}`);
  }
}

function markerOutput(turnId: string, content: string, exitCode = 0) {
  return `\x1b]633;OWPS_START:${turnId}\x07${content}\x1b]633;OWPS_END:${turnId}:${exitCode}\x07`;
}

function splitEvery(value: string, size: number) {
  const chunks: string[] = [];
  for (let index = 0; index < value.length; index += size) {
    chunks.push(value.slice(index, index + size));
  }
  return chunks;
}

const turnId = "ps-turn-fixed";

const command = buildPowerShellManagedCommand("Write-Output 'it works'", turnId);
assertIncludes(command, "Invoke-Expression 'Write-Output ''it works'''", "managed command quotes single quotes safely");
assertIncludes(command, "$__owps_esc = [char]27;", "managed command uses PowerShell 5 compatible ESC character");
assertIncludes(command, "$__owps_bel = [char]7;", "managed command uses PowerShell 5 compatible BEL character");
assertIncludes(command, "$__owps_ec = 0;", "managed command separates initialization statements");
assertIncludes(command, "Write-Host -NoNewline \"$__owps_esc]633;OWPS_START:ps-turn-fixed$__owps_bel\";", "managed command separates start marker statement");
assertIncludes(command, "$__owps_esc]633;OWPS_START:ps-turn-fixed$__owps_bel", "managed command emits start marker via char variables");
assertIncludes(command, "$__owps_esc]633;OWPS_END:ps-turn-fixed:$__owps_ec$__owps_bel", "managed command emits end marker with exit code");
assertIncludes(command, "$global:LASTEXITCODE = $null", "managed command clears stale native exit code before running");
assertEqual(command.endsWith("\r"), true, "managed command submits with carriage return");

const directParse = parsePowerShellMarkedOutput(markerOutput(turnId, "\r\nhello\r\n", 0), turnId);
assertEqual(directParse.content, "hello", "basic marked PowerShell output is trimmed");
assertEqual(directParse.completed, true, "basic marked PowerShell output completes");
assertEqual(directParse.exitCode, 0, "basic marked PowerShell output keeps exit code");

const failedParse = parsePowerShellMarkedOutput(markerOutput(turnId, "\r\nbad command\r\n", 37), turnId);
assertEqual(failedParse.content, "bad command", "failed command keeps stderr/stdout content");
assertEqual(failedParse.exitCode, 37, "failed command keeps non-zero exit code");

const pendingParse = parsePowerShellMarkedOutput(`noise\x1b]633;OWPS_START:${turnId}\x07line 1\r\nline 2`, turnId);
assertEqual(pendingParse.content, "line 1\nline 2", "pending command exposes content after start marker");
assertEqual(pendingParse.completed, false, "pending command waits for end marker");

const ignoredOtherTurn = parsePowerShellMarkedOutput(markerOutput("other-turn", "wrong", 0), turnId);
assertEqual(ignoredOtherTurn.content, "", "parser ignores markers for other turn");
assertEqual(ignoredOtherTurn.completed, false, "parser does not complete from other turn marker");

assertEqual(
  normalizePowerShellChatOutput("\r\nPS C:\\dev\\repo> \r\nreal output\r\nPS C:\\dev\\repo> \r\n"),
  "real output",
  "normalizer trims PowerShell boundary prompts",
);

assertEqual(
  removePowerShellMarkerText(`before OWPS_START:${turnId} mid OWPS_END:${turnId}:0 after`, turnId),
  "before  mid  after",
  "marker text removal strips matching start and end markers",
);

const realPowerShellCommand = buildPowerShellManagedCommand("Write-Output 'real marker ok'", "real-check").replace(/\r$/, "");
const realPowerShell = spawnSync("powershell.exe", ["-NoProfile", "-Command", realPowerShellCommand], {
  encoding: "buffer",
});
if (realPowerShell.error) {
  throw realPowerShell.error;
}
assertEqual(realPowerShell.status, 0, `real powershell managed command exits successfully: ${realPowerShell.stderr.toString("utf8")}`);
const realStdout = realPowerShell.stdout.toString("latin1");
assertIncludes(realStdout, "\x1b]633;OWPS_START:real-check\x07", "real powershell output contains OSC start marker bytes");
assertIncludes(realStdout, "real marker ok", "real powershell output contains command output");
assertIncludes(realStdout, "\x1b]633;OWPS_END:real-check:0\x07", "real powershell output contains OSC end marker bytes");

const contentCases = [
  ["plain output", "plain output"],
  ["\r\nplain output\r\n", "plain output"],
  ["line 1\r\nline 2\r\n", "line 1\nline 2"],
  ["中文输出\r\n第二行", "中文输出\n第二行"],
  ["emoji-like ascii :) stays", "emoji-like ascii :) stays"],
  ["path C:\\dev\\repo\\file.txt", "path C:\\dev\\repo\\file.txt"],
  ["spaces   are   preserved", "spaces   are   preserved"],
  ["tab\tvalue", "tab\tvalue"],
  ["\x1b[31mred\x1b[0m", "red"],
  ["progress 0%\rprogress 50%\rprogress 100%", "progress 0%\nprogress 50%\nprogress 100%"],
  ["\x1b[2Krewritten line", "rewritten line"],
  ["\x1b[?25lcursor hidden\x1b[?25h", "cursor hidden"],
  ["\x08backspace", "backspace"],
  ["first\n\n\n\nsecond", "first\n\n\nsecond"],
  ["PS C:\\dev\\repo> \nactual", "actual"],
  ["actual\nPS C:\\dev\\repo> ", "actual"],
  ["> \nactual", "actual"],
  ["actual\n> ", "actual"],
  ["ERROR: failed", "ERROR: failed"],
  ["WARNING: check this", "WARNING: check this"],
  ["Object\n----\nName", "Object\n----\nName"],
  ["a".repeat(2048), "a".repeat(2048)],
  ["before\x00after", "beforeafter"],
  ["\x1b]0;title\x07visible", "visible"],
  ["\x1b]633;OWPS_START:noise\x07visible", "visible"],
  ["visible\x1b]633;OWPS_END:noise:0\x07", "visible"],
];

for (const [index, [raw, expected]] of contentCases.entries()) {
  const parsed = parsePowerShellMarkedOutput(markerOutput(turnId, raw, 0), turnId);
  assertEqual(parsed.content, expected, `content normalization case ${index + 1}`);
  assertEqual(parsed.completed, true, `content normalization case ${index + 1} completes`);
}

const exitCodeCases = [0, 1, 2, 5, 127, 255, -1, 9009, 2147483647];
for (const exitCode of exitCodeCases) {
  const state = createPowerShellTurnState(turnId);
  const patch = consumePowerShellTurnOutput(state, markerOutput(turnId, `exit ${exitCode}`, exitCode));
  assertEqual(patch.exitCode, exitCode, `exit code ${exitCode} is preserved`);
  assertEqual(patch.status, exitCode === 0 ? "completed" : "failed", `exit code ${exitCode} maps to status`);
}

const splitSizes = [1, 2, 3, 4, 5, 7, 8, 11, 13, 17, 23, 31, 47, 64, 89, 128];
for (const splitSize of splitSizes) {
  const state = createPowerShellTurnState(turnId);
  const output = markerOutput(turnId, "chunked line 1\r\nchunked line 2\r\n", 0);
  let patch = { content: "", status: "running" as const, exitCode: undefined as number | undefined };
  for (const chunk of splitEvery(output, splitSize)) {
    patch = consumePowerShellTurnOutput(state, chunk);
    assertNotIncludes(patch.content, "OWPS_", `split size ${splitSize} never leaks marker text`);
  }
  assertEqual(patch.content, "chunked line 1\nchunked line 2", `split size ${splitSize} preserves content`);
  assertEqual(patch.status, "completed", `split size ${splitSize} completes`);
  assertEqual(patch.exitCode, 0, `split size ${splitSize} keeps exit code`);
}

const noisyScenarioCases = [
  ["leading shell noise", "PS C:\\dev\\repo> previous\r\n", "", "visible"],
  ["trailing prompt", "", "\r\nPS C:\\dev\\repo> ", "visible"],
  ["previous unrelated marker", markerOutput("old", "old", 0), "", "visible"],
  ["next unrelated marker", "", markerOutput("next", "next", 0), "visible"],
  ["codex banner noise before", "OpenAI Codex\r\n", "", "visible"],
  ["powershell error record", "", "", "Write-Error: broken\r\nAt line:1 char:1"],
  ["npm progress", "", "", "npm http fetch GET 200 https://registry.npmjs.org/pkg 120ms"],
  ["go test output", "", "", "?    example/module    [no test files]"],
  ["wails build output", "", "", "Building application for windows/amd64"],
  ["git output", "", "", " M frontend/src/App.tsx"],
  ["empty output", "", "", ""],
  ["only whitespace", "", "", "\r\n   \r\n"],
  ["table output", "", "", "Name     Length\r\n----     ------\r\nfile.txt 12"],
  ["json output", "", "", "{\r\n  \"ok\": true\r\n}"],
  ["multiline command echo", "", "", "Get-ChildItem\r\n\r\nDirectory: C:\\dev\\repo"],
  ["unicode path", "", "", "C:\\项目\\测试\\文件.txt"],
  ["carriage progress", "", "", "step 1\rstep 2\rstep 3"],
  ["ansi cursor moves", "", "", "\x1b[2J\x1b[Hfresh screen"],
  ["osc title", "", "", "\x1b]0;repo\x07listed files"],
  ["stderr prefix", "", "", "fatal: repository not found"],
  ["ctrl c text", "", "", "^C"],
  ["python traceback", "", "", "Traceback (most recent call last):\r\n  File \"a.py\", line 1"],
  ["long line", "", "", "x".repeat(4096)],
  ["long many lines", "", "", Array.from({ length: 80 }, (_, line) => `line-${line}`).join("\r\n")],
  ["brackets", "", "", "[INFO] [build] done"],
  ["ampersand chars", "", "", "a & b | c > d < e"],
  ["quote chars", "", "", "\"double\" and 'single'"],
  ["semi colon", "", "", "first; second"],
  ["powershell object", "", "", "@{Name=value; Count=1}"],
  ["native exe exit", "", "", "program wrote output before failing"],
];

for (const [index, [name, before, after, content]] of noisyScenarioCases.entries()) {
  const raw = `${before}${markerOutput(turnId, content, index % 3 === 0 ? 1 : 0)}${after}`;
  const parsed = parsePowerShellMarkedOutput(raw, turnId);
  const expected = normalizePowerShellChatOutput(content, turnId);
  assertEqual(parsed.content, expected, `noisy scenario ${index + 1} ${name}`);
  assertEqual(parsed.completed, true, `noisy scenario ${index + 1} completes`);
}

const generatedStressCases = Array.from({ length: 72 }, (_, index) => {
  const lineCount = (index % 9) + 1;
  const lines = Array.from({ length: lineCount }, (_, lineIndex) => {
    const prefix = index % 2 === 0 ? "stdout" : "stderr";
    return `${prefix}-${index + 1}-${lineIndex + 1} value ${".".repeat((index + lineIndex) % 12)}`;
  });
  const exitCode = index % 10 === 0 ? 1 : 0;
  const splitSize = (index % 19) + 1;
  return {
    name: `generated-stress-${index + 1}`,
    exitCode,
    splitSize,
    content: lines.join("\r\n"),
    expected: lines.join("\n"),
  };
});

for (const scenario of generatedStressCases) {
  const state = createPowerShellTurnState(turnId);
  let patch = { content: "", status: "running" as const, exitCode: undefined as number | undefined };
  for (const chunk of splitEvery(markerOutput(turnId, scenario.content, scenario.exitCode), scenario.splitSize)) {
    patch = consumePowerShellTurnOutput(state, chunk);
  }
  assertEqual(patch.content, scenario.expected, `${scenario.name} maps content`);
  assertEqual(patch.exitCode, scenario.exitCode, `${scenario.name} maps exit code`);
  assertEqual(patch.status, scenario.exitCode === 0 ? "completed" : "failed", `${scenario.name} maps status`);
}

const totalScenarioCount =
  4 +
  contentCases.length +
  exitCodeCases.length +
  splitSizes.length +
  noisyScenarioCases.length +
  generatedStressCases.length;

if (totalScenarioCount < 100) {
  throw new Error(`Expected at least 100 terminal chat scenarios, got ${totalScenarioCount}`);
}

console.log(`terminalChat.generated.test covered ${totalScenarioCount} scenarios`);

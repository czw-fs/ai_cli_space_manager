import {
  terminalOutputHasCodexScopedTurnEndPrompt,
  terminalOutputHasCodexTurnEndPrompt,
  terminalOutputToCodexScopedLiveText,
  terminalOutputToCodexTurnLiveText,
} from "../src/terminalMarkdown";

function assertEqual(actual: unknown, expected: unknown, message: string) {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

const prompt = "帮我看看这个仓库是干什么的";

const liveStatusCases = [
  "Considering file output issues (1m 06s • esc to interrupt)",
  "Waiting for tool result (3m 01s • esc to interrupt)",
  "Resolving repository metadata (45s · esc to interrupt)",
  "Reading long terminal output (2m 10s - esc to interrupt)",
  "Opening raw source file (12s • esc to interrupt)",
  "Checking whether README is enough (1m 00s • esc to interrupt)",
  "Following redirect chain (9s • esc to interrupt)",
  "正在分析仓库结构 (18s • esc to interrupt)",
  "等待网络请求返回 (2m 05s • esc to interrupt)",
  "整理最终回答 (58s • esc to interrupt)",
  "Inspecting documentation pages        36",
  "Comparing candidate files             4",
  "Loading source tree                   102",
  "Reading package metadata              7",
  "Summarizing repository purpose        12",
  "Resolving imports                     2",
  "Scanning README                       1",
  "Checking examples                     8",
  "Following references                  23",
  "Preparing final response              3",
  "Working...",
  "Thinking…",
  "Searching...",
  "Running tool...",
  "Reading output...",
  "Writing answer...",
  "Gathering context...",
  "Checking files...",
  "Analyzing result...",
  "Testing hypothesis...",
  "◦ Considering file output issues (1m 06s • esc to interrupt)",
  "• Waiting for tool result (3m 01s • esc to interrupt)",
  "· Resolving repository metadata (45s · esc to interrupt)",
  "* Reading long terminal output (2m 10s - esc to interrupt)",
  "- Opening raw source file (12s • esc to interrupt)",
  "◦ 正在分析仓库结构 (18s • esc to interrupt)",
  "• 等待网络请求返回 (2m 05s • esc to interrupt)",
  "· 整理最终回答 (58s • esc to interrupt)",
  "* Inspecting documentation pages        36",
  "- Comparing candidate files             4",
  "◦ Loading source tree                   102",
  "• Reading package metadata              7",
  "· Summarizing repository purpose        12",
  "* Resolving imports                     2",
  "- Scanning README                       1",
  "Using browser search (1m 12s • esc to interrupt)",
  "Waiting for command output (4m 00s • esc to interrupt)",
  "处理中 (1分 12秒 • esc to interrupt)",
  "等待工具输出 (55秒 • esc to interrupt)",
  "Reviewing terminal snapshot (1h 02m • esc to interrupt)",
  "Loading cached result (750ms • esc to interrupt)",
];

for (const [index, status] of liveStatusCases.entries()) {
  const snapshot = [
    "PS C:\\dev\\repo> codex",
    "OpenAI Codex (v0.125.0)",
    "",
    `> ${prompt}`,
    "",
    `• ${status.replace(/^[•·*◦○●-]\s*/, "")}`,
    "",
    "> Find and fix a bug in @filename",
    "gpt-5.5 xhigh · C:\\dev\\repo",
  ].join("\n");

  const mapped = terminalOutputToCodexTurnLiveText(snapshot, prompt);
  assertEqual(
    mapped,
    `• ${status.replace(/^[•·*◦○●-]\s*/, "")}`,
    `live status case ${index + 1} maps dynamic status without fixed-word dependency`,
  );
  assertEqual(
    terminalOutputHasCodexTurnEndPrompt(snapshot, prompt),
    false,
    `live status case ${index + 1} stays streaming while the last visible content is interruptible`,
  );
}

for (const [index, status] of liveStatusCases.entries()) {
  const finalSnapshot = [
    `> ${prompt}`,
    "",
    `• ${status.replace(/^[•·*◦○●-]\s*/, "")}`,
    "",
    "> Find and fix a bug in @filename",
    "gpt-5.5 xhigh · C:\\dev\\repo",
    "",
    "- 这个仓库是一个 IOCCC 作品。",
    "- 最终回答已经出现。",
    "",
    "> Implement {feature}",
    "gpt-5.5 xhigh · C:\\dev\\repo",
  ].join("\n");

  const expected = [
    `• ${status.replace(/^[•·*◦○●-]\s*/, "")}`,
    "",
    "- 这个仓库是一个 IOCCC 作品。",
    "- 最终回答已经出现。",
  ].join("\n");

  assertEqual(
    terminalOutputToCodexTurnLiveText(finalSnapshot, prompt),
    expected,
    `final answer case ${index + 1} keeps output that appears after a transient prompt`,
  );
  assertEqual(
    terminalOutputHasCodexTurnEndPrompt(finalSnapshot, prompt),
    true,
    `final answer case ${index + 1} finishes only after final content and the idle prompt`,
  );
}

const scopedRawWithoutPrompt = [
  "• Searching the web",
  "",
  "• Searched https://github.com/carlini/printf-tac-toe",
  "",
  "• Considering file output issues (1m 06s • esc to interrupt)",
  "",
  "> Find and fix a bug in @filename",
  "gpt-5.5 xhigh · C:\\dev\\repo",
  "",
  "- 这是一个双人井字棋程序。",
  "- 最终回答不应该因为 prompt 行消失而丢掉。",
  "",
  "> Implement {feature}",
  "gpt-5.5 xhigh · C:\\dev\\repo",
].join("\n");

assertEqual(
  terminalOutputToCodexScopedLiveText(scopedRawWithoutPrompt, prompt),
  [
    "• Searching the web",
    "",
    "• Searched https://github.com/carlini/printf-tac-toe",
    "",
    "• Considering file output issues (1m 06s • esc to interrupt)",
    "",
    "- 这是一个双人井字棋程序。",
    "- 最终回答不应该因为 prompt 行消失而丢掉。",
  ].join("\n"),
  "scoped active raw buffer maps fully even when the current prompt is no longer on screen",
);

assertEqual(
  terminalOutputHasCodexScopedTurnEndPrompt(scopedRawWithoutPrompt, prompt),
  true,
  "scoped active raw buffer can finalize after final content and idle prompt",
);

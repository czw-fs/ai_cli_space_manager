import {
  appendTerminalMarkdownOutput,
  stripTerminalControlSequences,
  terminalOutputHasCodexInputPrompt,
  terminalOutputToCodexReplyText,
  terminalOutputToMarkdownText,
} from "../src/terminalMarkdown";

function assertEqual(actual: unknown, expected: unknown, message: string) {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

assertEqual(
  stripTerminalControlSequences("\x1b[32m# 标题\x1b[0m"),
  "# 标题",
  "strips ANSI color sequences",
);

assertEqual(
  terminalOutputToMarkdownText("第一行\r\n第二行\r第三行\x08"),
  "第一行\n第二行\n第三行",
  "normalizes terminal newlines and backspaces",
);

assertEqual(
  appendTerminalMarkdownOutput("# 标题\n", "\x1b[31m\n- 列表项\x1b[0m"),
  "# 标题\n\n- 列表项",
  "appends clean markdown output",
);

assertEqual(
  terminalOutputToCodexReplyText(
    "> Explain this codebase\ngpt-5.5 xhigh · C:\\dev\\repo\n# 结果\n\n说明内容",
    "Explain this codebase",
  ),
  "# 结果\n\n说明内容",
  "removes codex terminal prompt and status lines",
);

assertEqual(
  terminalOutputToCodexReplyText("执行任务\n# 回复", "执行任务"),
  "# 回复",
  "removes echoed codex prompt lines",
);

assertEqual(
  terminalOutputToCodexReplyText(
    [
      "• Working (0s · esc to interrupt)",
      "g",
      "。",
      "1",
      "W",
      "Wo",
      "•or",
      "rk",
      "ki",
      "in",
      "Wng",
      "Wog",
      "or",
      "rk",
      "•ki",
      "in",
      "ng",
      "2",
      "g",
      "。",
      "• 你好。",
      "• Working (4s · esc to interrupt)",
    ].join("\n"),
  ),
  "你好。",
  "removes codex tui redraw fragments from assistant output",
);

assertEqual(
  terminalOutputToCodexReplyText("• Working (0s · esc to interrupt)\r• 你好。"),
  "你好。",
  "uses carriage-return overwrite semantics for codex output",
);

assertEqual(
  terminalOutputHasCodexInputPrompt("\n> "),
  true,
  "detects codex input prompt",
);

assertEqual(
  terminalOutputHasCodexInputPrompt("> Explain this codebase"),
  false,
  "does not treat echoed user input as an idle prompt",
);

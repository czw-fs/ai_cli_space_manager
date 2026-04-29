import {
  appendTerminalMarkdownOutput,
  mergeCodexTurnLiveText,
  stripTerminalControlSequences,
  terminalOutputHasCodexInputPrompt,
  terminalOutputHasCodexTurnEndPrompt,
  terminalOutputToCodexLiveText,
  terminalOutputToCodexReplyText,
  terminalOutputToCodexTurnLiveText,
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
  terminalOutputToCodexLiveText("你好，我在。请把要处理的任务或代码问题发给我。\n\n> Implement {feature}\n"),
  "你好，我在。请把要处理的任务或代码问题发给我。",
  "maps codex live output while hiding interactive input placeholder",
);

assertEqual(
  terminalOutputToCodexLiveText("• Working (2s · esc to interrupt)\n\n正在检查项目结构\n\n> 修复界面", "修复界面"),
  "• Working (2s · esc to interrupt)\n\n正在检查项目结构",
  "keeps codex live status output but hides echoed active prompt",
);

assertEqual(
  terminalOutputToCodexTurnLiveText(
    "上一轮回答\n\n> 当前问题\n• Working (1s · esc to interrupt)\n\n本轮回答",
    "当前问题",
  ),
  "• Working (1s · esc to interrupt)\n\n本轮回答",
  "maps only the current codex turn after the active prompt",
);

assertEqual(
  terminalOutputToCodexTurnLiveText(
    [
      "旧回答",
      "",
      "> 查找问题",
      "• Searching files",
      "• Running rg",
      "找到 terminalMarkdown.ts",
      "",
      "最终结论",
    ].join("\n"),
    "查找问题",
  ),
  "• Searching files\n• Running rg\n找到 terminalMarkdown.ts\n\n最终结论",
  "keeps codex thinking and tool status in the current turn",
);

assertEqual(
  terminalOutputToCodexTurnLiveText(
    "> 修复界面\n• Working (2s · esc to interrupt)\n\n正在处理\n\n> Implement {feature}",
    "修复界面",
  ),
  "• Working (2s · esc to interrupt)\n\n正在处理",
  "hides the next idle input placeholder after current turn output",
);

assertEqual(
  terminalOutputToCodexTurnLiveText(
    "> 第一行\n第二行\n• Thinking\n回答",
    "第一行\n第二行",
  ),
  "• Thinking\n回答",
  "supports multi-line active prompts as current turn anchors",
);

assertEqual(
  terminalOutputToCodexTurnLiveText(
    "> 修复问题\n旧回答\n\n> 修复问题\n新回答",
    "修复问题",
  ),
  "新回答",
  "uses the last matching active prompt as the current turn anchor",
);

assertEqual(
  terminalOutputToCodexTurnLiveText(
    "› 当前问题\n• Thinking\n回答",
    "当前问题",
  ),
  "• Thinking\n回答",
  "supports the codex prompt glyph as a current turn anchor",
);

assertEqual(
  terminalOutputToCodexTurnLiveText(
    [
      "OpenAI Codex (v0.125.0)",
      "model: gpt-5.5 xhigh",
      "",
      "> hi",
      "",
      "• 你好。",
      "",
      "> hi",
      "",
      "• 你好。有什么需要我处理的吗？",
      "",
      "> 本次问题",
      "• Working (0s · esc to interrupt)",
      "• Thinking",
      "",
      "这次回答正文",
      "",
      "> Implement {feature}",
      "gpt-5.5 xhigh · C:\\dev\\repo",
    ].join("\n"),
    "本次问题",
  ),
  "• Working (0s · esc to interrupt)\n• Thinking\n\n这次回答正文",
  "extracts the current codex turn from the full terminal session transcript",
);

assertEqual(
  terminalOutputToCodexTurnLiveText(
    "OpenAI Codex\n\n> hi\n\n• 历史回答\n\n> Implement {feature}",
    "还没出现在屏幕的问题",
  ),
  "",
  "does not show historical terminal content before the current prompt appears",
);

assertEqual(
  terminalOutputHasCodexTurnEndPrompt(
    "> 当前问题\n• Working\n回答\n\n> Implement {feature}",
    "当前问题",
  ),
  true,
  "detects current turn completion from the post-answer input placeholder",
);

assertEqual(
  terminalOutputHasCodexTurnEndPrompt(
    "> 当前问题\n• Working (1s · esc to interrupt)\n\n> Implement {feature}",
    "当前问题",
  ),
  false,
  "does not finish current turn while codex is still showing a busy status",
);

assertEqual(
  mergeCodexTurnLiveText("• Working (0s · esc to interrupt)", "• Working (1s · esc to interrupt)"),
  "• Working (1s · esc to interrupt)",
  "updates the live working timer in place",
);

assertEqual(
  mergeCodexTurnLiveText(
    "• Working (1s · esc to interrupt)",
    "• Thinking\n\n我会先检查项目结构。",
  ),
  "• Working (1s · esc to interrupt)\n• Thinking\n\n我会先检查项目结构。",
  "appends later codex thinking output after the live status",
);

assertEqual(
  mergeCodexTurnLiveText(
    "• Working (1s · esc to interrupt)",
    "• Working (1s · esc to interrupt)\n\n最终回答",
  ),
  "• Working (1s · esc to interrupt)\n\n最终回答",
  "does not drop answer text when a snapshot includes both busy status and content",
);

const firstFullSessionSnapshot = terminalOutputToCodexTurnLiveText(
  [
    "OpenAI Codex",
    "",
    "> hi",
    "",
    "• 历史回答",
    "",
    "> 本次问题",
    "• Working (0s · esc to interrupt)",
  ].join("\n"),
  "本次问题",
);
const secondFullSessionSnapshot = terminalOutputToCodexTurnLiveText(
  [
    "OpenAI Codex",
    "",
    "> hi",
    "",
    "• 历史回答",
    "",
    "> 本次问题",
    "• Working (1s · esc to interrupt)",
    "",
    "本次回答",
    "",
    "> Implement {feature}",
  ].join("\n"),
  "本次问题",
);

assertEqual(
  mergeCodexTurnLiveText(firstFullSessionSnapshot, secondFullSessionSnapshot),
  "• Working (1s · esc to interrupt)\n\n本次回答",
  "keeps live mapping when full terminal snapshots evolve from status to answer",
);

assertEqual(
  mergeCodexTurnLiveText(
    "• Working (1s · esc to interrupt)\n• Thinking\n\n我会先检查项目结构。",
    "我会先检查项目结构。\n\n最终回答",
  ),
  "• Working (1s · esc to interrupt)\n• Thinking\n\n我会先检查项目结构。\n\n最终回答",
  "merges overlapping final answer snapshots without duplicating text",
);

assertEqual(
  terminalOutputHasCodexInputPrompt("\n> "),
  true,
  "detects codex input prompt",
);

assertEqual(
  terminalOutputHasCodexInputPrompt("> Implement {feature}"),
  true,
  "detects codex placeholder prompt as idle input prompt",
);

assertEqual(
  terminalOutputHasCodexInputPrompt("> Explain this codebase"),
  false,
  "does not treat echoed user input as an idle prompt",
);

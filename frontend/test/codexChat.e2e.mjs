import http from "node:http";
import { createReadStream } from "node:fs";
import { extname, join, normalize } from "node:path";
import { chromium } from "@playwright/test";

const PORT = 4187;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const SESSION_ID = "terminal-7";

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function fetchIndex() {
  return new Promise((resolve, reject) => {
    const request = http.get(BASE_URL, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        body += chunk;
      });
      response.on("end", () => {
        resolve({ statusCode: response.statusCode, body });
      });
    });
    request.on("error", reject);
    request.setTimeout(1000, () => {
      request.destroy(new Error("timeout"));
    });
  });
}

function contentTypeFor(filePath) {
  const extension = extname(filePath).toLowerCase();
  if (extension === ".html") {
    return "text/html; charset=utf-8";
  }
  if (extension === ".js") {
    return "text/javascript; charset=utf-8";
  }
  if (extension === ".css") {
    return "text/css; charset=utf-8";
  }
  if (extension === ".svg") {
    return "image/svg+xml";
  }
  return "application/octet-stream";
}

function startStaticServer() {
  const distRoot = join(process.cwd(), "dist");
  const server = http.createServer((request, response) => {
    const rawPath = new URL(request.url ?? "/", BASE_URL).pathname;
    const requestPath = rawPath === "/" ? "/index.html" : rawPath;
    const filePath = normalize(join(distRoot, requestPath));
    if (!filePath.startsWith(distRoot)) {
      response.writeHead(403);
      response.end("Forbidden");
      return;
    }
    response.setHeader("Content-Type", contentTypeFor(filePath));
    const stream = createReadStream(filePath);
    stream.on("error", () => {
      response.writeHead(404);
      response.end("Not Found");
    });
    stream.pipe(response);
  });
  return new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(PORT, "127.0.0.1", () => resolve(server));
  });
}

async function waitForServer(server) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 30000) {
    try {
      const response = await fetchIndex();
      if (response.statusCode === 200 && response.body.includes("assets/index")) {
        return;
      }
    } catch {
      // Server is still starting.
    }
    await wait(250);
  }
  server.close();
  throw new Error("Static frontend server did not become ready");
}

async function setupWailsMocks(page) {
  await page.addInitScript(({ sessionId }) => {
    const listeners = new Map();
    const appState = {
      groups: [],
      directories: [
        {
          id: "dir-1",
          name: "aidefaultws",
          path: "C:\\dev\\testproject\\aidefaultws",
          groupId: "",
          openerIds: [],
        },
      ],
      customOpeners: [],
      ui: {
        columnWidths: {
          search: 180,
          name: 120,
          group: 90,
          path: 260,
          actions: 520,
          manage: 110,
        },
        powerShellLaunchMode: "tab",
        enterKeyMode: "newline",
        attachmentRootPath: "codex_attachments",
        theme: "light",
        sidebarWidth: 176,
        composerHeight: 66,
      },
      config: {
        configExists: false,
        configPath: "",
        configError: "",
        usingDefaults: true,
      },
    };
    const session = {
      id: sessionId,
      title: "terminal-7",
      directory: "C:\\dev\\testproject\\aidefaultws",
      running: true,
      createdAt: Date.now(),
    };
    const writes = [];
    const writeEvents = [];
    const emit = (eventName, payload) => {
      for (const callback of listeners.get(eventName) ?? []) {
        callback(payload);
      }
    };
    window.__codexE2E = {
      writes,
      writeEvents,
      emitTerminal(data) {
        emit("terminal:output", { sessionId, data, stream: "pty" });
      },
      listenerCount(eventName) {
        return (listeners.get(eventName) ?? []).length;
      },
    };
    window.runtime = {
      EventsOnMultiple(eventName, callback) {
        const callbacks = listeners.get(eventName) ?? [];
        callbacks.push(callback);
        listeners.set(eventName, callbacks);
        return () => {
          listeners.set(
            eventName,
            (listeners.get(eventName) ?? []).filter((item) => item !== callback),
          );
        };
      },
      WindowSetLightTheme() {},
      WindowSetDarkTheme() {},
    };
    window.go = {
      main: {
        App: {
          GetAppState: async () => appState,
          SaveAppState: async (nextState) => {
            Object.assign(appState, nextState);
          },
          GetTerminalSessions: async () => [session],
          StartEmbeddedTerminal: async () => session,
          WriteTerminalInput: async (_sessionId, input) => {
            writes.push(input);
            writeEvents.push({ input, at: Date.now() });
          },
          ResizeTerminal: async () => {},
          RenameTerminal: async () => session,
          StopTerminal: async () => {},
          OpenDirectory: async () => {},
          OpenPowerShellAdmin: async () => {},
          OpenWithCustomTool: async () => {},
          SelectDirectory: async () => "",
          SelectApplication: async () => "",
          ValidatePath: async () => true,
          ResolvePath: async (value) => value,
          SaveAttachment: async () => {
            throw new Error("attachments are not used in this test");
          },
          OpenAttachment: async () => {},
        },
      },
    };
  }, { sessionId: SESSION_ID });
}

async function run() {
  const server = await startStaticServer();
  let browser;
  try {
    await waitForServer(server);
    browser = await chromium.launch({ channel: "chromium", headless: true });
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await setupWailsMocks(page);
    await page.goto(BASE_URL);

    await page.getByRole("button", { name: "终端", exact: true }).click();
    await page.getByRole("button", { name: "Codex" }).click();
    await page.locator(".codex-chat-input textarea").fill("hello");
    await page.getByRole("button", { name: "发送" }).click();

    await page.waitForFunction(() => window.__codexE2E?.writes?.length >= 2);
    const firstSubmitGap = await page.evaluate(() => {
      const events = window.__codexE2E.writeEvents;
      return events[1].at - events[0].at;
    });
    if (firstSubmitGap < 150) {
      throw new Error(`Expected Codex submit to wait past paste-burst suppression, got ${firstSubmitGap}ms`);
    }
    await page.evaluate(() => {
      window.__codexE2E.emitTerminal(
        [
          "PS C:\\dev\\testproject\\aidefaultws> codex",
          "OpenAI Codex (v0.125.0)",
          "",
          "> hello",
          "",
          "◦ Working (0s · esc to interrupt)",
          "",
          "> Implement {feature}",
          "gpt-5.5 xhigh · C:\\dev\\testproject\\aidefaultws",
          "",
        ].join("\r\n"),
      );
    });
    await page.waitForSelector(".codex-message.assistant .codex-live-output", { state: "visible" });
    const workingText = await page.locator(".codex-message.assistant .codex-live-output").last().textContent();
    if (!workingText?.includes("Working")) {
      throw new Error(`Expected live Working status, got: ${workingText}`);
    }

    await page.evaluate(() => {
      window.__codexE2E.emitTerminal(
        `\x1b[2J\x1b[H${[
          "PS C:\\dev\\testproject\\aidefaultws> codex",
          "OpenAI Codex (v0.125.0)",
          "",
          "> hello",
          "",
          "• The user greeted me with a simple hello. I should answer directly.",
          "",
          "• 你好，我在。",
          "",
          "> Implement {feature}",
          "gpt-5.5 xhigh · C:\\dev\\testproject\\aidefaultws",
          "",
        ].join("\r\n")}`,
      );
    });

    try {
      await page.waitForFunction(() => {
        const outputs = [...document.querySelectorAll(".codex-message.assistant .codex-live-output")];
        return outputs.some((element) => element.textContent?.includes("你好，我在。"));
      }, undefined, { timeout: 5000 });
    } catch (error) {
      const debugText = await page.locator(".codex-message.assistant .codex-live-output").allTextContents();
      throw new Error(`Expected final answer after second terminal output. Current assistant outputs: ${JSON.stringify(debugText)}. ${error}`);
    }
    const finalText = await page.locator(".codex-message.assistant .codex-live-output").last().textContent();
    if (!finalText?.includes("你好，我在。")) {
      throw new Error(`Expected final Codex answer, got: ${finalText}`);
    }
    if (/Working/.test(finalText)) {
      throw new Error(`Expected stale Working status to be replaced, got: ${finalText}`);
    }

    await page.locator(".codex-chat-input textarea").fill("介绍一下这个仓库");
    await page.getByRole("button", { name: "发送" }).click();
    await page.waitForFunction(() => window.__codexE2E?.writes?.length >= 4);
    await page.evaluate(() => {
      window.__codexE2E.emitTerminal(
        `\x1b[2J\x1b[H${[
          "PS C:\\dev\\testproject\\aidefaultws> codex",
          "OpenAI Codex (v0.125.0)",
          "model: gpt-5.5 xhigh /model to change",
          "directory: C:\\dev\\testproject\\aidefaultws",
          "permissions: YOLO mode",
          "",
          "Tip: New Build faster with Codex.",
          "• Working (11s · esc to interrupt)",
          "• 我先打开仓库README，已读结构和启动方式。现在给你一个中文概览。",
          "",
          "• Searching the web",
          "",
          "• Searched https://github.com/czw-fs/ai_cli_space_manager",
          "",
          "• Working (12s · esc to interrupt)",
          "• 我先打开仓库README，已读结构和启动方式。现在给你一个中文概览。",
          "",
          "• Searching the web",
          "",
          "• Searched https://raw.githubusercontent.com/czw-fs/ai_cli_space_manager/master/go.mod",
          "",
        ].join("\r\n")}`,
      );
    });
    await wait(300);
    const pollutedTexts = await page.locator(".codex-message.assistant .codex-live-output").allTextContents();
    if (pollutedTexts.some((text) => /PS C:\\|OpenAI Codex|model:|directory:|permissions:/i.test(text))) {
      throw new Error(`Expected terminal chrome to stay out of Codex chat, got: ${JSON.stringify(pollutedTexts)}`);
    }

    await page.evaluate(() => {
      window.__codexE2E.emitTerminal(
        `\x1b[2J\x1b[H${[
          "PS C:\\dev\\testproject\\aidefaultws> codex",
          "OpenAI Codex (v0.125.0)",
          "",
          "> 介绍一下这个仓库",
          "",
          "◦ Searching the web",
          "",
          "• 这个仓库 czw-fs/ai_cli_space_manager 是一个 Windows 桌面工作区启动器。",
          "",
          "> Implement {feature}",
          "gpt-5.5 xhigh · C:\\dev\\testproject\\aidefaultws",
          "",
        ].join("\r\n")}`,
      );
    });
    await page.waitForFunction(() => {
      const outputs = [...document.querySelectorAll(".codex-message.assistant .codex-live-output")];
      return outputs.some((element) => element.textContent?.includes("Windows 桌面工作区启动器"));
    });
    await wait(300);
    await page.evaluate(() => {
      window.__codexE2E.emitTerminal(
        `\x1b[2J\x1b[H${[
          "PS C:\\dev\\testproject\\aidefaultws> codex",
          "OpenAI Codex (v0.125.0)",
          "",
          "> 介绍一下这个仓库",
          "",
          "• 这个仓库 czw-fs/ai_cli_space_manager 是一个 Windows 桌面工作区启动器，主要服务于 AI 编程工作流，尤其是配合 Codex CLI 使用。",
          "",
          "主要功能",
          "- 工作区管理：添加本机目录，支持搜索、编辑、删除、拖拽排序。",
          "- 快速打开：每个工作区可以一键用 IDE、VS Code、Typora 等工具打开。",
          "- Codex 输入增强：支持先编辑提示词，再发送到终端里的 Codex CLI。",
          "",
          "技术栈",
          "- 后端/桌面壳：Go + Wails v2",
          "- 前端：React + TypeScript + Vite",
          "",
          "> Implement {feature}",
          "gpt-5.5 xhigh · C:\\dev\\testproject\\aidefaultws",
          "",
        ].join("\r\n")}`,
      );
    });
    await page.waitForFunction(() => {
      const outputs = [...document.querySelectorAll(".codex-message.assistant .codex-live-output")];
      return outputs.some((element) => element.textContent?.includes("技术栈"));
    });
    const longFinalText = await page.locator(".codex-message.assistant .codex-live-output").last().textContent();
    if (!longFinalText?.includes("技术栈") || !longFinalText.includes("Go + Wails v2")) {
      throw new Error(`Expected delayed long answer completion, got: ${longFinalText}`);
    }
    if (/PS C:\\|OpenAI Codex|model:|directory:|permissions:/i.test(longFinalText)) {
      throw new Error(`Expected long Codex answer without terminal chrome, got: ${longFinalText}`);
    }

    await page.locator(".codex-chat-input textarea").fill("› https://github.com/carlini/printf-tac-toe\n帮我看看这个仓库是干什么的");
    await page.getByRole("button", { name: "发送" }).click();
    await page.waitForFunction(() => window.__codexE2E?.writes?.length >= 6);
    await page.evaluate(() => {
      window.__codexE2E.emitTerminal(
        `\x1b[2J\x1b[H${[
          "PS C:\\dev\\testproject\\aidefaultws> codex",
          "OpenAI Codex (v0.125.0)",
          "",
          "› https://github.com/carlini/printf-tac-toe",
          "  帮我看看这个仓库是干什么的",
          "",
          "• Working (0s · esc to interrupt)",
          "",
          "› Use /skills to list available skills",
          "gpt-5.5 xhigh · C:\\dev\\testproject\\aidefaultws",
          "",
        ].join("\r\n")}`,
      );
    });
    await page.waitForFunction(() => {
      const outputs = [...document.querySelectorAll(".codex-message.assistant .codex-live-output")];
      return outputs.some((element) => element.textContent?.includes("Working"));
    }, undefined, { timeout: 5000 });
    await page.keyboard.press("Control+C");
    await page.waitForFunction(() => window.__codexE2E?.writes?.includes("\u0003"));

    await page.locator(".codex-chat-input textarea").fill("复现滚动同步卡住");
    await page.getByRole("button", { name: "发送" }).click();
    await page.waitForFunction(() => window.__codexE2E?.writes?.length >= 9);
    await page.evaluate(() => {
      window.__codexE2E.emitTerminal(
        `\x1b[2J\x1b[H${[
          "PS C:\\dev\\testproject\\aidefaultws> codex",
          "OpenAI Codex (v0.125.0)",
          "",
          "> 复现滚动同步卡住",
          "",
          "• Inspecting documentation pages (1m 22s • esc to interrupt)",
          "",
          "> Run /review on my current changes",
          "gpt-5.5 xhigh · C:\\dev\\testproject\\aidefaultws",
          "",
        ].join("\r\n")}`,
      );
    });
    await page.waitForFunction(() => {
      const outputs = [...document.querySelectorAll(".codex-message.assistant .codex-live-output")];
      return outputs.some((element) => element.textContent?.includes("Inspecting documentation pages"));
    });
    const hiddenCursorDuringCodexSync = await page
      .locator(".terminal-host-hidden .xterm")
      .evaluate((element) => element.classList.contains("terminal-codex-busy"));
    if (!hiddenCursorDuringCodexSync) {
      throw new Error("Expected hidden xterm cursor to be suppressed while Codex is streaming");
    }

    await page.getByLabel("终端视图切换").getByRole("button", { name: "终端" }).click();
    await page.locator(".terminal-host .xterm").click({ position: { x: 30, y: 30 } });
    await page.mouse.wheel(0, -600);
    const cursorSuppressedDuringTerminalStreaming = await page
      .locator(".terminal-host .xterm")
      .evaluate((element) => element.classList.contains("terminal-codex-busy"));
    if (!cursorSuppressedDuringTerminalStreaming) {
      throw new Error("Expected visible terminal cursor to be suppressed while Codex is streaming");
    }
    await page.keyboard.press("ArrowUp");
    await page.keyboard.press("ArrowDown");
    await page.evaluate(() => {
      window.__codexE2E.emitTerminal("\r\n• Inspecting documentation pages        36\r\n");
    });
    const cursorHiddenDuringTerminalInput = await page
      .locator(".terminal-host .xterm")
      .evaluate((element) => element.classList.contains("terminal-output-active"));
    if (cursorHiddenDuringTerminalInput) {
      throw new Error("Expected terminal cursor to stay visible after arrow-key input during Codex output");
    }
    const busyCursorClassDuringTerminalInput = await page
      .locator(".terminal-host .xterm")
      .evaluate((element) => element.classList.contains("terminal-codex-busy"));
    if (busyCursorClassDuringTerminalInput) {
      throw new Error("Expected terminal-codex-busy class to clear when the user returns to the real terminal");
    }
    await page.mouse.wheel(0, 600);
    await page.getByRole("button", { name: "Codex" }).click();
    await wait(1500);

    await page.evaluate(() => {
      window.__codexE2E.emitTerminal(
        `\x1b[2J\x1b[H${[
          "PS C:\\dev\\testproject\\aidefaultws> codex",
          "OpenAI Codex (v0.125.0)",
          "",
          "> 复现滚动同步卡住",
          "",
          "• 我复现到了滚动和方向键期间的同步问题。",
          "",
          "最终回答：滚动后仍然继续同步。",
          "",
          "> Implement {feature}",
          "gpt-5.5 xhigh · C:\\dev\\testproject\\aidefaultws",
          "",
        ].join("\r\n")}`,
      );
    });
    try {
      await page.waitForFunction(() => {
        const outputs = [...document.querySelectorAll(".codex-message.assistant .codex-live-output")];
        return outputs.some((element) => element.textContent?.includes("最终回答：滚动后仍然继续同步。"));
      }, undefined, { timeout: 5000 });
    } catch (error) {
      const debugText = await page.locator(".codex-message.assistant .codex-live-output").allTextContents();
      throw new Error(`Expected Codex view to keep syncing after terminal scroll and arrow-key input. Current assistant outputs: ${JSON.stringify(debugText)}. ${error}`);
    }
  } finally {
    await browser?.close();
    server.close();
    await wait(300);
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});

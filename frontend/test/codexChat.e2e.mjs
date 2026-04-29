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
    const emit = (eventName, payload) => {
      for (const callback of listeners.get(eventName) ?? []) {
        callback(payload);
      }
    };
    window.__codexE2E = {
      writes,
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
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await setupWailsMocks(page);
    await page.goto(BASE_URL);

    await page.getByRole("button", { name: "终端", exact: true }).click();
    await page.getByRole("button", { name: "Codex" }).click();
    await page.locator(".codex-chat-input textarea").fill("hello");
    await page.getByRole("button", { name: "发送" }).click();

    await page.waitForFunction(() => window.__codexE2E?.writes?.length >= 2);
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

    await page.locator(".codex-chat-input textarea").fill("介绍这个仓库");
    await page.getByRole("button", { name: "发送" }).click();
    await page.waitForFunction(() => window.__codexE2E?.writes?.length >= 4);
    await page.evaluate(() => {
      window.__codexE2E.emitTerminal(
        `\x1b[2J\x1b[H${[
          "PS C:\\dev\\testproject\\aidefaultws> codex",
          "OpenAI Codex (v0.125.0)",
          "",
          "> 介绍这个仓库",
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
    await page.evaluate(() => {
      window.__codexE2E.emitTerminal(
        `\x1b[2J\x1b[H${[
          "PS C:\\dev\\testproject\\aidefaultws> codex",
          "OpenAI Codex (v0.125.0)",
          "",
          "> 介绍这个仓库",
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

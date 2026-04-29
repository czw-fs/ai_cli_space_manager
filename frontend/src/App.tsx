import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  ClipboardEvent as ReactClipboardEvent,
  CSSProperties,
  MouseEvent as ReactMouseEvent,
  MutableRefObject,
  SetStateAction,
} from "react";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { EventsOn, WindowSetDarkTheme, WindowSetLightTheme } from "../wailsjs/runtime/runtime";
import { api } from "./api";
import {
  buildCodexInteractiveWrites,
  buildCodexPrompt,
  buildComposerWrites,
  CODEX_INTERACTIVE_SUBMIT_DELAY_MS,
  shouldSendComposerOnEnter,
} from "./codexComposer";
import {
  availableOpeners,
  pinOpener,
  reorderPinnedOpener,
  unpinOpener,
  visibleOpeners,
} from "./directoryOpeners";
import { reorderDirectories } from "./directoryOrder";
import { commandTemplateForApplication, nameFromApplicationPath } from "./openerCommand";
import { shouldCopyTerminalSelection } from "./terminalInput";
import {
  mergeCodexTurnLiveText,
  terminalOutputHasCodexTurnEndPrompt,
  terminalOutputToCodexTurnLiveText,
} from "./terminalMarkdown";
import type {
  AppState,
  AttachmentFile,
  ColumnWidths,
  CustomOpener,
  DirectoryItem,
  TerminalOutputEvent,
  TerminalSession,
  UITheme,
} from "./types";
import { emptyState } from "./types";

type DialogMode = "directory" | "opener" | null;
type TerminalContextMenu = {
  sessionId: string;
  x: number;
  y: number;
} | null;
type TerminalView = "terminal" | "codex";

type TerminalHandle = {
  terminal: Terminal;
  fitAddon: FitAddon;
  cursorHidden?: boolean;
  outputQuietTimer?: number;
  lastCols?: number;
  lastRows?: number;
};

type ComposerState = {
  text: string;
  attachments: AttachmentFile[];
};

type CodexChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  attachments?: AttachmentFile[];
  streaming?: boolean;
};

const TERMINAL_HIDE_CURSOR = "\x1b[?25l";
const TERMINAL_SHOW_CURSOR = "\x1b[?25h";
const TERMINAL_OUTPUT_IDLE_MS = 1600;
const DEFAULT_SIDEBAR_WIDTH = 176;
const SIDEBAR_MIN_WIDTH = 128;
const SIDEBAR_MAX_WIDTH = 320;
const DEFAULT_COMPOSER_HEIGHT = 66;
const COMPOSER_MIN_HEIGHT = 48;
const COMPOSER_MAX_HEIGHT = 180;
const DEFAULT_SEARCH_WIDTH = 260;
const SEARCH_MIN_WIDTH = 180;
const SEARCH_MAX_WIDTH = 420;
const CODEX_REPLY_RAW_BUFFER_LIMIT = 240000;
const TERMINAL_SESSION_RAW_BUFFER_LIMIT = 800000;
const normalizeTheme = (theme: string | undefined): UITheme => (theme === "light" ? "light" : "dark");

const makeId = (prefix: string) =>
  `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

const clampNumber = (value: number, min: number, max: number) => Math.min(max, Math.max(min, Math.round(value)));

const isCanceledFileDialogError = (error: unknown) =>
  String(error).toLowerCase().includes("shellitem is nil");

const wait = (milliseconds: number) => new Promise((resolve) => window.setTimeout(resolve, milliseconds));

function App() {
  const [state, setState] = useState<AppState>(emptyState);
  const [query, setQuery] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [dialog, setDialog] = useState<DialogMode>(null);
  const [editingDirectory, setEditingDirectory] = useState<DirectoryItem | null>(null);
  const [editingOpener, setEditingOpener] = useState<CustomOpener | null>(null);
  const [message, setMessage] = useState("");
  const [terminalSessions, setTerminalSessions] = useState<TerminalSession[]>([]);
  const [activeTerminalId, setActiveTerminalId] = useState("");
  const [activeArea, setActiveArea] = useState<"directories" | "terminal">("directories");
  const [terminalContextMenu, setTerminalContextMenu] = useState<TerminalContextMenu>(null);
  const [renamingTerminalId, setRenamingTerminalId] = useState("");
  const [terminalRenameDraft, setTerminalRenameDraft] = useState("");
  const [composerBySession, setComposerBySession] = useState<Record<string, ComposerState>>({});
  const [codexComposerBySession, setCodexComposerBySession] = useState<Record<string, ComposerState>>({});
  const [codexMessagesBySession, setCodexMessagesBySession] = useState<Record<string, CodexChatMessage[]>>({});
  const [terminalView, setTerminalView] = useState<TerminalView>("terminal");
  const stateRef = useRef(state);
  const terminalRenameCanceled = useRef(false);
  const terminalInstances = useRef<Record<string, TerminalHandle>>({});
  const pendingTerminalOutput = useRef<Record<string, string>>({});
  const terminalRawBySession = useRef<Record<string, string>>({});
  const activeCodexReplyIdBySession = useRef<Record<string, string>>({});
  const activeCodexPromptBySession = useRef<Record<string, string>>({});
  const activeCodexReplyRawBySession = useRef<Record<string, string>>({});

  const applyState = (next: AppState) => {
    stateRef.current = next;
    setState(next);
  };

  const updateState = (updater: (current: AppState) => AppState) => {
    setState((current) => {
      const next = updater(current);
      stateRef.current = next;
      return next;
    });
  };

  const syncCodexReplyFromSource = useCallback(
    (sessionId: string, outputSource: string, sourceIsScreenSnapshot = false) => {
      const activeReplyId = activeCodexReplyIdBySession.current[sessionId];
      if (!activeReplyId) {
        return;
      }
      const prompt = activeCodexPromptBySession.current[sessionId] ?? "";
      const source = outputSource || activeCodexReplyRawBySession.current[sessionId] || "";
      const replyText = terminalOutputToCodexTurnLiveText(source, prompt);
      setCodexMessagesBySession((current) => {
        const messages = current[sessionId] ?? [];
        if (!messages.some((messageItem) => messageItem.id === activeReplyId)) {
          return current;
        }
        return {
          ...current,
          [sessionId]: messages.map((messageItem) =>
            messageItem.id === activeReplyId
              ? {
                  ...messageItem,
                  content:
                    sourceIsScreenSnapshot && replyText
                      ? replyText
                      : mergeCodexTurnLiveText(messageItem.content, replyText),
                }
              : messageItem,
          ),
        };
      });
      if (terminalOutputHasCodexTurnEndPrompt(source, prompt)) {
        setCodexMessagesBySession((current) => ({
          ...current,
          [sessionId]: (current[sessionId] ?? []).map((messageItem) =>
            messageItem.id === activeReplyId ? { ...messageItem, streaming: false } : messageItem,
          ),
        }));
        delete activeCodexReplyIdBySession.current[sessionId];
        delete activeCodexPromptBySession.current[sessionId];
        delete activeCodexReplyRawBySession.current[sessionId];
      }
    },
    [],
  );

  useEffect(() => {
    api.getAppState().then(applyState).catch((error) => setMessage(String(error)));
    api.getTerminalSessions().then(setTerminalSessions).catch((error) => setMessage(String(error)));
  }, []);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    const offOutput = EventsOn("terminal:output", (event: TerminalOutputEvent) => {
      const sessionRaw = `${terminalRawBySession.current[event.sessionId] ?? ""}${event.data}`;
      terminalRawBySession.current[event.sessionId] =
        sessionRaw.length > TERMINAL_SESSION_RAW_BUFFER_LIMIT
          ? sessionRaw.slice(sessionRaw.length - TERMINAL_SESSION_RAW_BUFFER_LIMIT)
          : sessionRaw;
      const activeReplyId = activeCodexReplyIdBySession.current[event.sessionId];
      if (activeReplyId) {
        const rawOutput = `${activeCodexReplyRawBySession.current[event.sessionId] ?? ""}${event.data}`;
        activeCodexReplyRawBySession.current[event.sessionId] =
          rawOutput.length > CODEX_REPLY_RAW_BUFFER_LIMIT
            ? rawOutput.slice(rawOutput.length - CODEX_REPLY_RAW_BUFFER_LIMIT)
            : rawOutput;
      }
      const handle = terminalInstances.current[event.sessionId];
      if (handle) {
        writeTerminalOutput(handle, event.data, () =>
          syncCodexReplyFromSource(event.sessionId, readTerminalBufferText(handle), true),
        );
      } else {
        pendingTerminalOutput.current[event.sessionId] = `${pendingTerminalOutput.current[event.sessionId] ?? ""}${event.data}`;
        syncCodexReplyFromSource(event.sessionId, terminalRawBySession.current[event.sessionId] ?? "");
      }
    });
    const offClosed = EventsOn("terminal:closed", (session: TerminalSession) => {
      setTerminalSessions((current) => current.map((item) => (item.id === session.id ? session : item)));
      disposeTerminalHandle(terminalInstances.current[session.id]);
      delete terminalInstances.current[session.id];
      delete pendingTerminalOutput.current[session.id];
      delete terminalRawBySession.current[session.id];
      delete activeCodexReplyIdBySession.current[session.id];
      delete activeCodexPromptBySession.current[session.id];
      delete activeCodexReplyRawBySession.current[session.id];
    });
    return () => {
      offOutput();
      offClosed();
    };
  }, [syncCodexReplyFromSource]);

  const filteredDirectories = useMemo(() => {
    const value = query.trim().toLowerCase();
    return state.directories.filter((directory) => {
      const matchesText =
        value === "" ||
        directory.name.toLowerCase().includes(value) ||
        directory.path.toLowerCase().includes(value);
      return matchesText;
    });
  }, [query, state.directories]);

  const persist = async (next: AppState) => {
    applyState(next);
    await api.saveAppState(next);
    const refreshed = await api.getAppState();
    applyState(refreshed);
  };

  const updateColumnWidths = (columnWidths: ColumnWidths) => {
    updateState((current) => ({ ...current, ui: { ...current.ui, columnWidths } }));
  };

  const persistColumnWidths = async (columnWidths: ColumnWidths) => {
    const next = { ...stateRef.current, ui: { ...stateRef.current.ui, columnWidths } };
    applyState(next);
    try {
      await api.saveAppState(next);
    } catch (error) {
      if (isCanceledFileDialogError(error)) {
        return;
      }
      setMessage(String(error));
    }
  };

  const setEnterKeyMode = async (enterKeyMode: AppState["ui"]["enterKeyMode"]) => {
    const next = { ...stateRef.current, ui: { ...stateRef.current.ui, enterKeyMode } };
    applyState(next);
    try {
      await api.saveAppState(next);
    } catch (error) {
      setMessage(String(error));
    }
  };

  const saveDirectoryOpeners = async (directory: DirectoryItem) => {
    const next = {
      ...stateRef.current,
      directories: stateRef.current.directories.map((item) => (item.id === directory.id ? directory : item)),
    };
    applyState(next);
    try {
      await api.saveAppState(next);
    } catch (error) {
      setMessage(String(error));
    }
  };

  const updateSearchWidth = (searchWidth: number) => {
    const value = clampNumber(searchWidth, SEARCH_MIN_WIDTH, SEARCH_MAX_WIDTH);
    updateState((current) => ({
      ...current,
      ui: { ...current.ui, columnWidths: { ...current.ui.columnWidths, search: value } },
    }));
  };

  const persistSearchWidth = async (searchWidth: number) => {
    const value = clampNumber(searchWidth, SEARCH_MIN_WIDTH, SEARCH_MAX_WIDTH);
    const next = {
      ...stateRef.current,
      ui: {
        ...stateRef.current.ui,
        columnWidths: { ...stateRef.current.ui.columnWidths, search: value },
      },
    };
    applyState(next);
    try {
      await api.saveAppState(next);
    } catch (error) {
      setMessage(String(error));
    }
  };

  const saveAttachmentRootPath = async (attachmentRootPath: string) => {
    const value = attachmentRootPath.trim() || "codex_attachments";
    const next = { ...stateRef.current, ui: { ...stateRef.current.ui, attachmentRootPath: value } };
    applyState(next);
    try {
      await api.saveAppState(next);
    } catch (error) {
      setMessage(String(error));
    }
  };

  const updateSidebarWidth = (sidebarWidth: number) => {
    const value = clampNumber(sidebarWidth, SIDEBAR_MIN_WIDTH, SIDEBAR_MAX_WIDTH);
    updateState((current) => ({ ...current, ui: { ...current.ui, sidebarWidth: value } }));
  };

  const persistSidebarWidth = async (sidebarWidth: number) => {
    const value = clampNumber(sidebarWidth, SIDEBAR_MIN_WIDTH, SIDEBAR_MAX_WIDTH);
    const next = { ...stateRef.current, ui: { ...stateRef.current.ui, sidebarWidth: value } };
    applyState(next);
    try {
      await api.saveAppState(next);
    } catch (error) {
      setMessage(String(error));
    }
  };

  const updateComposerHeight = (composerHeight: number) => {
    const value = clampNumber(composerHeight, COMPOSER_MIN_HEIGHT, COMPOSER_MAX_HEIGHT);
    updateState((current) => ({ ...current, ui: { ...current.ui, composerHeight: value } }));
  };

  const persistComposerHeight = async (composerHeight: number) => {
    const value = clampNumber(composerHeight, COMPOSER_MIN_HEIGHT, COMPOSER_MAX_HEIGHT);
    const next = { ...stateRef.current, ui: { ...stateRef.current.ui, composerHeight: value } };
    applyState(next);
    try {
      await api.saveAppState(next);
    } catch (error) {
      setMessage(String(error));
    }
  };

  const handleSidebarResizeMouseDown = (event: ReactMouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = stateRef.current.ui.sidebarWidth || DEFAULT_SIDEBAR_WIDTH;
    document.body.classList.add("resizing-sidebar");

    const handleMouseMove = (moveEvent: MouseEvent) => {
      updateSidebarWidth(startWidth + moveEvent.clientX - startX);
    };
    const handleMouseUp = (upEvent: MouseEvent) => {
      document.body.classList.remove("resizing-sidebar");
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
      persistSidebarWidth(startWidth + upEvent.clientX - startX);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
  };

  const saveDirectory = async (directory: DirectoryItem) => {
    const exists = state.directories.some((item) => item.id === directory.id);
    await persist({
      ...state,
      directories: exists
        ? state.directories.map((item) => (item.id === directory.id ? directory : item))
        : [...state.directories, directory],
    });
    closeDialog();
  };

  const saveOpener = async (opener: CustomOpener) => {
    const exists = state.customOpeners.some((item) => item.id === opener.id);
    await persist({
      ...state,
      customOpeners: exists
        ? state.customOpeners.map((item) => (item.id === opener.id ? opener : item))
        : [...state.customOpeners, opener],
    });
    closeDialog();
  };

  const removeDirectory = async (id: string) => {
    await persist({ ...state, directories: state.directories.filter((item) => item.id !== id) });
  };

  const removeOpener = async (id: string) => {
    await persist({ ...state, customOpeners: state.customOpeners.filter((item) => item.id !== id) });
  };

  const reorderDirectory = async (draggedId: string, targetId: string) => {
    const nextDirectories = reorderDirectories(stateRef.current.directories, draggedId, targetId);
    if (nextDirectories === stateRef.current.directories) {
      return;
    }
    const next = { ...stateRef.current, directories: nextDirectories };
    applyState(next);
    try {
      await api.saveAppState(next);
    } catch (error) {
      setMessage(String(error));
    }
  };

  const openAction = async (action: () => Promise<void>) => {
    try {
      await action();
    } catch (error) {
      setMessage(String(error));
    }
  };

  const addWorkspace = async () => {
    try {
      const selectedPath = (await api.selectDirectory()).trim();
      if (!selectedPath) {
        return;
      }
      const normalizedPath = selectedPath.replace(/[\\/]+$/, "");
      const name = normalizedPath.split(/[\\/]/).filter(Boolean).pop() || normalizedPath || selectedPath;
      const next = {
        ...stateRef.current,
        directories: [
          ...stateRef.current.directories,
          { id: makeId("dir"), name, path: selectedPath, groupId: "" },
        ],
      };
      await persist(next);
    } catch (error) {
      setMessage(String(error));
    }
  };

  const startEmbeddedTerminal = async (directory: DirectoryItem) => {
    try {
      const session = await api.startEmbeddedTerminal(directory.id);
      setTerminalSessions((current) => [...current.filter((item) => item.id !== session.id), session]);
      setActiveTerminalId(session.id);
      setActiveArea("terminal");
    } catch (error) {
      setMessage(String(error));
    }
  };

  const closeTerminal = async (sessionId: string) => {
    try {
      await api.stopTerminal(sessionId);
      setTerminalSessions((current) => {
        const next = current.filter((item) => item.id !== sessionId);
        if (activeTerminalId === sessionId) {
          setActiveTerminalId(next[next.length - 1]?.id ?? "");
        }
        return next;
      });
      setComposerBySession((current) => {
        const next = { ...current };
        delete next[sessionId];
        return next;
      });
      setCodexComposerBySession((current) => {
        const next = { ...current };
        delete next[sessionId];
        return next;
      });
      setCodexMessagesBySession((current) => {
        const next = { ...current };
        delete next[sessionId];
        return next;
      });
      delete activeCodexReplyIdBySession.current[sessionId];
      delete activeCodexPromptBySession.current[sessionId];
      delete activeCodexReplyRawBySession.current[sessionId];
      disposeTerminalHandle(terminalInstances.current[sessionId]);
      delete terminalInstances.current[sessionId];
      delete pendingTerminalOutput.current[sessionId];
      delete terminalRawBySession.current[sessionId];
    } catch (error) {
      setMessage(String(error));
    }
  };

  const openTerminalContextMenu = (event: ReactMouseEvent, session: TerminalSession) => {
    event.preventDefault();
    setActiveTerminalId(session.id);
    setActiveArea("terminal");
    setTerminalContextMenu({ sessionId: session.id, x: event.clientX, y: event.clientY });
  };

  const closeTerminalContextMenu = () => {
    setTerminalContextMenu(null);
  };

  const beginRenameTerminalSession = (sessionId: string) => {
    const session = terminalSessions.find((item) => item.id === sessionId);
    if (!session) {
      return;
    }
    terminalRenameCanceled.current = false;
    setTerminalRenameDraft(session.title);
    setRenamingTerminalId(sessionId);
  };

  const cancelRenameTerminalSession = () => {
    terminalRenameCanceled.current = true;
    setRenamingTerminalId("");
    setTerminalRenameDraft("");
  };

  const commitRenameTerminalSession = async (sessionId: string) => {
    if (terminalRenameCanceled.current) {
      terminalRenameCanceled.current = false;
      return;
    }
    const nextTitle = terminalRenameDraft.trim();
    const session = terminalSessions.find((item) => item.id === sessionId);
    setRenamingTerminalId("");
    setTerminalRenameDraft("");
    if (!session || !nextTitle || nextTitle === session.title) {
      return;
    }
    try {
      const renamed = await api.renameTerminal(sessionId, nextTitle);
      setTerminalSessions((current) =>
        current.map((item) => (item.id === sessionId ? renamed : item)),
      );
    } catch (error) {
      setMessage(String(error));
    }
  };

  const handleTerminalError = useCallback((error: unknown) => {
    setMessage(String(error));
  }, []);

  const closeDialog = () => {
    setDialog(null);
    setEditingDirectory(null);
    setEditingOpener(null);
  };

  const currentTheme = normalizeTheme(state.ui.theme);

  useEffect(() => {
    document.body.classList.toggle("theme-light-body", currentTheme === "light");
    document.body.classList.toggle("theme-dark-body", currentTheme === "dark");
    try {
      if (currentTheme === "light") {
        WindowSetLightTheme();
      } else {
        WindowSetDarkTheme();
      }
    } catch {
      // Wails runtime theme APIs are unavailable in plain browser previews.
    }
  }, [currentTheme]);

  const toggleTheme = async () => {
    const theme: UITheme = currentTheme === "dark" ? "light" : "dark";
    const next = { ...stateRef.current, ui: { ...stateRef.current.ui, theme } };
    applyState(next);
    try {
      await api.saveAppState(next);
    } catch (error) {
      setMessage(String(error));
    }
  };

  const sidebarWidth = clampNumber(
    state.ui.sidebarWidth || DEFAULT_SIDEBAR_WIDTH,
    SIDEBAR_MIN_WIDTH,
    SIDEBAR_MAX_WIDTH,
  );
  const workspaceStyle = { "--sidebar-width": `${sidebarWidth}px` } as CSSProperties & Record<"--sidebar-width", string>;

  return (
    <div className={`app-shell theme-${currentTheme} ${sidebarOpen ? "sidebar-open" : "sidebar-closed"}`}>
      <div className="workspace" style={workspaceStyle}>
        <aside className="sidebar">
          <div className="sidebar-head workspace-head collapsible-head">
            <button
              className={activeArea === "directories" ? "sidebar-title active" : "sidebar-title"}
              type="button"
              onClick={() => {
                setActiveArea("directories");
              }}
            >
              <span>工作区</span>
              <span className="sidebar-count">{state.directories.length}</span>
            </button>
          </div>
          <div className="sidebar-head terminal-head collapsible-head">
            <button
              className={activeArea === "terminal" ? "sidebar-title active" : "sidebar-title"}
              type="button"
              onClick={() => {
                setActiveTerminalId((current) => current || terminalSessions[terminalSessions.length - 1]?.id || "");
                setActiveArea("terminal");
              }}
            >
              终端
            </button>
          </div>
          <div className="sidebar-section">
            {terminalSessions.length === 0 && <div className="sidebar-empty">暂无终端</div>}
            {terminalSessions.map((session) => (
              <div className="terminal-nav-row" key={session.id}>
                {renamingTerminalId === session.id ? (
                  <div
                    className={activeArea === "terminal" && activeTerminalId === session.id ? "nav-item terminal-item active terminal-editing" : "nav-item terminal-item terminal-editing"}
                    onContextMenu={(event) => openTerminalContextMenu(event, session)}
                  >
                    <input
                      className="terminal-rename-input"
                      value={terminalRenameDraft}
                      autoFocus
                      onFocus={(event) => event.currentTarget.select()}
                      onChange={(event) => setTerminalRenameDraft(event.target.value)}
                      onBlur={() => commitRenameTerminalSession(session.id)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          event.currentTarget.blur();
                        } else if (event.key === "Escape") {
                          event.preventDefault();
                          cancelRenameTerminalSession();
                        }
                      }}
                    />
                    <span className={session.running ? "run-dot running" : "run-dot"} />
                  </div>
                ) : (
                  <button
                    className={activeArea === "terminal" && activeTerminalId === session.id ? "nav-item terminal-item active" : "nav-item terminal-item"}
                    onContextMenu={(event) => openTerminalContextMenu(event, session)}
                    onClick={() => {
                      closeTerminalContextMenu();
                      setActiveTerminalId(session.id);
                      setActiveArea("terminal");
                    }}
                  >
                    <span>{session.title}</span>
                    <span className={session.running ? "run-dot running" : "run-dot"} />
                  </button>
                )}
                <button
                  type="button"
                  className="terminal-nav-close"
                  title="关闭终端"
                  aria-label={`关闭终端 ${session.title}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    closeTerminal(session.id);
                  }}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
          {terminalContextMenu && (
            <div
              className="context-menu terminal-context-menu"
              style={{ left: terminalContextMenu.x, top: terminalContextMenu.y }}
              onMouseDown={(event) => event.stopPropagation()}
              onContextMenu={(event) => event.preventDefault()}
            >
              <button
                type="button"
                onClick={() => {
                  beginRenameTerminalSession(terminalContextMenu.sessionId);
                  closeTerminalContextMenu();
                }}
              >
                重命名
              </button>
            </div>
          )}
        </aside>

        <button
          className="sidebar-toggle"
          type="button"
          title={sidebarOpen ? "隐藏侧边栏" : "展开侧边栏"}
          aria-label={sidebarOpen ? "隐藏侧边栏" : "展开侧边栏"}
          onClick={() => setSidebarOpen((current) => !current)}
        >
          {sidebarOpen ? "‹" : "›"}
        </button>

        {sidebarOpen && (
          <button
            className="sidebar-resize-handle"
            type="button"
            aria-label="调整侧边栏宽度"
            title="拖动调整侧边栏宽度"
            onMouseDown={handleSidebarResizeMouseDown}
          />
        )}

        <main className="main-panel" onMouseDown={closeTerminalContextMenu}>
          {activeArea === "terminal" && (
            <section className="terminal-viewbar">
              <div className="segmented terminal-view-toggle" aria-label="终端视图切换">
                <button
                  type="button"
                  className={terminalView === "terminal" ? "active" : ""}
                  onClick={() => setTerminalView("terminal")}
                >
                  终端
                </button>
                <button
                  type="button"
                  className={terminalView === "codex" ? "active" : ""}
                  onClick={() => setTerminalView("codex")}
                >
                  Codex
                </button>
              </div>
            </section>
          )}

          {activeArea === "directories" && (
            <>
              <section className="toolbar">
                <ResizableSearchInput
                  value={query}
                  width={state.ui.columnWidths.search || DEFAULT_SEARCH_WIDTH}
                  onChange={setQuery}
                  onWidthChange={updateSearchWidth}
                  onWidthCommit={persistSearchWidth}
                />
                <button onClick={() => { setEditingOpener(null); setDialog("opener"); }}>管理打开方式</button>
                <button className="primary" onClick={addWorkspace}>新增工作区</button>
                <button
                  className="theme-toggle"
                  type="button"
                  title={currentTheme === "dark" ? "切换到白色主题" : "切换到深色主题"}
                  onClick={toggleTheme}
                >
                  {currentTheme === "dark" ? "白色主题" : "深色主题"}
                </button>
                <button
                  className="more-button"
                  type="button"
                  title="更多"
                  aria-label="更多操作"
                >...</button>
              </section>

              <section className="viewbar">
                <span>{filteredDirectories.length} 个工作区，{state.customOpeners.length} 个自定义打开方式</span>
              </section>
            </>
          )}

          {state.config.configError && <div className="alert">配置读取失败：{state.config.configError}</div>}
          {message && (
            <div className="status-message">
              <span>{message}</span>
              <button type="button" aria-label="关闭提示" title="关闭提示" onClick={() => setMessage("")}>×</button>
            </div>
          )}

          {activeArea === "directories" ? (
            <section className="table-wrap">
              <DirectoryTable
                title="工作区"
                directories={filteredDirectories}
                customOpeners={state.customOpeners}
                columnWidths={state.ui.columnWidths}
                onOpenAction={openAction}
                onStartEmbeddedTerminal={startEmbeddedTerminal}
                onEditDirectory={(directory) => { setEditingDirectory(directory); setDialog("directory"); }}
                onRemoveDirectory={removeDirectory}
                onReorderDirectory={reorderDirectory}
                onUpdateDirectoryOpeners={saveDirectoryOpeners}
                onColumnWidthsChange={updateColumnWidths}
                onColumnWidthsCommit={persistColumnWidths}
              />
            </section>
          ) : (
            <TerminalPanel
              sessions={terminalSessions}
              activeId={activeTerminalId}
              terminalRegistry={terminalInstances}
              onInputError={handleTerminalError}
              pendingOutput={pendingTerminalOutput}
              attachmentRootPath={state.ui.attachmentRootPath}
              onAttachmentRootPathChange={saveAttachmentRootPath}
              composerBySession={composerBySession}
              onComposerChange={setComposerBySession}
              composerHeight={state.ui.composerHeight || DEFAULT_COMPOSER_HEIGHT}
              enterKeyMode={state.ui.enterKeyMode || "send"}
              onEnterKeyModeChange={setEnterKeyMode}
              onComposerHeightChange={updateComposerHeight}
              onComposerHeightCommit={persistComposerHeight}
              view={terminalView}
              codexMessagesBySession={codexMessagesBySession}
              codexComposerBySession={codexComposerBySession}
              onCodexMessagesChange={setCodexMessagesBySession}
              onCodexComposerChange={setCodexComposerBySession}
              onCodexScreenSnapshot={(sessionId, screenText) => syncCodexReplyFromSource(sessionId, screenText, true)}
              onCodexReplyStart={(sessionId, replyId, prompt) => {
                activeCodexReplyIdBySession.current[sessionId] = replyId;
                activeCodexPromptBySession.current[sessionId] = prompt;
                activeCodexReplyRawBySession.current[sessionId] = "";
              }}
              onCodexMessagesClear={(sessionId) => {
                delete activeCodexReplyIdBySession.current[sessionId];
                delete activeCodexPromptBySession.current[sessionId];
                delete activeCodexReplyRawBySession.current[sessionId];
                setCodexMessagesBySession((current) => ({ ...current, [sessionId]: [] }));
              }}
            />
          )}
        </main>
      </div>

      {dialog === "directory" && (
        <DirectoryDialog
          directory={editingDirectory}
          onCancel={closeDialog}
          onSave={saveDirectory}
          onError={(error) => setMessage(String(error))}
        />
      )}
      {dialog === "opener" && (
        <OpenerDialog
          opener={editingOpener}
          openers={state.customOpeners}
          onCancel={closeDialog}
          onSave={saveOpener}
          onEdit={setEditingOpener}
          onRemove={removeOpener}
          onError={(error) => setMessage(String(error))}
        />
      )}
    </div>
  );
}

type TableProps = {
  title: string;
  directories: DirectoryItem[];
  customOpeners: CustomOpener[];
  columnWidths: ColumnWidths;
  onOpenAction: (action: () => Promise<void>) => void;
  onStartEmbeddedTerminal: (directory: DirectoryItem) => void;
  onEditDirectory: (directory: DirectoryItem) => void;
  onRemoveDirectory: (id: string) => void;
  onReorderDirectory: (draggedId: string, targetId: string) => void;
  onUpdateDirectoryOpeners: (directory: DirectoryItem) => void;
  onColumnWidthsChange: (columnWidths: ColumnWidths) => void;
  onColumnWidthsCommit: (columnWidths: ColumnWidths) => void;
};

function DirectoryTable(props: TableProps) {
  const gridTemplateColumns = `${props.columnWidths.name}px ${props.columnWidths.path}px ${props.columnWidths.actions}px ${props.columnWidths.manage}px`;

  const startResize = (key: keyof ColumnWidths, startEvent: ReactMouseEvent<HTMLButtonElement>) => {
    startEvent.preventDefault();
    const startX = startEvent.clientX;
    const startWidth = props.columnWidths[key];
    let latestWidths = props.columnWidths;
    const minByKey: Record<keyof ColumnWidths, number> = {
      search: SEARCH_MIN_WIDTH,
      name: 72,
      group: 72,
      path: 140,
      actions: 500,
      manage: 86,
    };
    const maxByKey: Record<keyof ColumnWidths, number> = {
      search: SEARCH_MAX_WIDTH,
      name: 360,
      group: 260,
      path: 640,
      actions: 760,
      manage: 220,
    };

    const onMove = (moveEvent: MouseEvent) => {
      const rawWidth = startWidth + moveEvent.clientX - startX;
      const nextWidth = Math.min(maxByKey[key], Math.max(minByKey[key], rawWidth));
      latestWidths = { ...props.columnWidths, [key]: Math.round(nextWidth) };
      props.onColumnWidthsChange(latestWidths);
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      props.onColumnWidthsCommit(latestWidths);
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

    return (
      <div className="directory-section">
        <div className="section-title">{props.title}</div>
        <div className="directory-grid" style={{ gridTemplateColumns }}>
          <div className="grid-head">名称<ResizeHandle onMouseDown={(event) => startResize("name", event)} /></div>
        <div className="grid-head">路径<ResizeHandle onMouseDown={(event) => startResize("path", event)} /></div>
        <div className="grid-head">打开方式<ResizeHandle onMouseDown={(event) => startResize("actions", event)} /></div>
        <div className="grid-head">操作<ResizeHandle onMouseDown={(event) => startResize("manage", event)} /></div>

        {props.directories.length === 0 && (
          <div className="empty-cell" style={{ gridColumn: "1 / -1" }}>暂无工作区</div>
        )}
        {props.directories.map((directory) => {
          const pinnedOpeners = visibleOpeners(directory, props.customOpeners);
          const hiddenOpeners = availableOpeners(directory, props.customOpeners);
          const openerDragType = "application/x-openworkspace-opener";

          return (
            <div className="grid-row" style={{ display: "contents" }} key={directory.id}>
              <div
                className="grid-cell strong draggable-cell"
                draggable
                onDragStart={(event) => {
                  event.dataTransfer.effectAllowed = "move";
                  event.dataTransfer.setData("text/plain", directory.id);
                }}
                onDragOver={(event) => {
                  event.preventDefault();
                  event.dataTransfer.dropEffect = "move";
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  const draggedId = event.dataTransfer.getData("text/plain");
                  if (draggedId) {
                    props.onReorderDirectory(draggedId, directory.id);
                  }
                }}
              >
                <span className="drag-handle" aria-hidden="true">⋮⋮</span>{directory.name}
              </div>
              <div
                className="grid-cell path-cell"
                onDragOver={(event) => {
                  event.preventDefault();
                  event.dataTransfer.dropEffect = "move";
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  const draggedId = event.dataTransfer.getData("text/plain");
                  if (draggedId) {
                    props.onReorderDirectory(draggedId, directory.id);
                  }
                }}
              >
                {directory.path}
              </div>
              <div className="grid-cell">
                <div className="row-actions">
                  <button onClick={() => props.onStartEmbeddedTerminal(directory)}>内嵌终端</button>
                  <button onClick={() => props.onOpenAction(() => api.openDirectory(directory.id))}>文件夹</button>
                  {pinnedOpeners.map((opener) => (
                    <button
                      key={opener.id}
                      draggable
                      title="拖动调整顺序"
                      onDragStart={(event) => {
                        event.dataTransfer.effectAllowed = "move";
                        event.dataTransfer.setData(openerDragType, opener.id);
                      }}
                      onDragOver={(event) => {
                        event.preventDefault();
                        event.dataTransfer.dropEffect = "move";
                      }}
                      onDrop={(event) => {
                        event.preventDefault();
                        const draggedId = event.dataTransfer.getData(openerDragType);
                        if (draggedId) {
                          props.onUpdateDirectoryOpeners(
                            reorderPinnedOpener(directory, draggedId, opener.id, props.customOpeners),
                          );
                        }
                      }}
                      onClick={() => props.onOpenAction(() => api.openWithCustomTool(directory.id, opener.id))}
                    >
                      {opener.name}
                    </button>
                  ))}
                  <select
                    aria-label="更多工具"
                    defaultValue=""
                    onDragOver={(event) => {
                      event.preventDefault();
                      event.dataTransfer.dropEffect = "move";
                    }}
                    onDrop={(event) => {
                      event.preventDefault();
                      const draggedId = event.dataTransfer.getData(openerDragType);
                      if (draggedId) {
                        props.onUpdateDirectoryOpeners(unpinOpener(directory, draggedId, props.customOpeners));
                      }
                    }}
                    onChange={(event) => {
                      const openerId = event.target.value;
                      event.currentTarget.value = "";
                      if (openerId) {
                        props.onUpdateDirectoryOpeners(pinOpener(directory, openerId, props.customOpeners));
                      }
                    }}
                  >
                    <option value="">更多工具</option>
                    {hiddenOpeners.map((opener) => (
                      <option key={opener.id} value={opener.id}>{opener.name}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="grid-cell">
                <div className="mini-actions">
                  <button onClick={() => props.onEditDirectory(directory)}>编辑</button>
                  <button onClick={() => props.onRemoveDirectory(directory.id)}>删除</button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ResizeHandle({ onMouseDown }: { onMouseDown: (event: ReactMouseEvent<HTMLButtonElement>) => void }) {
  return <button className="resize-handle" type="button" aria-label="调整列宽" onMouseDown={onMouseDown} />;
}

function ResizableSearchInput({
  value,
  width,
  onChange,
  onWidthChange,
  onWidthCommit,
}: {
  value: string;
  width: number;
  onChange: (value: string) => void;
  onWidthChange: (width: number) => void;
  onWidthCommit: (width: number) => void;
}) {
  const resolvedWidth = clampNumber(width || DEFAULT_SEARCH_WIDTH, SEARCH_MIN_WIDTH, SEARCH_MAX_WIDTH);

  const handleResizeMouseDown = (event: ReactMouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = resolvedWidth;

    const onMove = (moveEvent: MouseEvent) => {
      onWidthChange(startWidth + moveEvent.clientX - startX);
    };
    const onUp = (upEvent: MouseEvent) => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      onWidthCommit(startWidth + upEvent.clientX - startX);
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  return (
    <div className="search-resize" style={{ width: `${resolvedWidth}px` }}>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-label="搜索名称或路径"
        placeholder="搜索名称或路径"
      />
      <button
        className="resize-handle"
        type="button"
        aria-label="调整搜索框宽度"
        title="拖动调整搜索框宽度"
        onMouseDown={handleResizeMouseDown}
      />
    </div>
  );
}

function writeTerminalOutput(handle: TerminalHandle, data: string, onFlushed?: () => void) {
  hideTerminalCursor(handle);
  handle.terminal.write(data, () => {
    onFlushed?.();
    handle.terminal.write(TERMINAL_HIDE_CURSOR);
  });
  if (handle.outputQuietTimer) {
    window.clearTimeout(handle.outputQuietTimer);
  }
  handle.outputQuietTimer = window.setTimeout(() => {
    showTerminalCursor(handle);
  }, TERMINAL_OUTPUT_IDLE_MS);
}

function readTerminalBufferText(handle: TerminalHandle) {
  const buffer = handle.terminal.buffer.active;
  const lines: string[] = [];
  for (let index = 0; index < buffer.length; index += 1) {
    const line = buffer.getLine(index);
    if (!line) {
      continue;
    }
    const text = line.translateToString(true);
    if (line.isWrapped && lines.length > 0) {
      lines[lines.length - 1] = `${lines[lines.length - 1]}${text}`;
    } else {
      lines.push(text);
    }
  }
  return lines.join("\n");
}

function hideTerminalCursor(handle: TerminalHandle) {
  handle.terminal.element?.classList.add("terminal-output-active");
  if (handle.cursorHidden) {
    return;
  }
  handle.cursorHidden = true;
  handle.terminal.write(TERMINAL_HIDE_CURSOR);
}

function showTerminalCursor(handle: TerminalHandle | undefined) {
  if (!handle) {
    return;
  }
  if (handle.outputQuietTimer) {
    window.clearTimeout(handle.outputQuietTimer);
    handle.outputQuietTimer = undefined;
  }
  handle.terminal.element?.classList.remove("terminal-output-active");
  if (!handle.cursorHidden) {
    return;
  }
  handle.cursorHidden = false;
  handle.terminal.write(TERMINAL_SHOW_CURSOR);
}

function disposeTerminalHandle(handle: TerminalHandle | undefined) {
  if (!handle) {
    return;
  }
  if (handle.outputQuietTimer) {
    window.clearTimeout(handle.outputQuietTimer);
  }
  handle.terminal.dispose();
}

function TerminalPanel({
  sessions,
  activeId,
  terminalRegistry,
  pendingOutput,
  attachmentRootPath,
  composerHeight,
  enterKeyMode,
  onAttachmentRootPathChange,
  onEnterKeyModeChange,
  composerBySession,
  onInputError,
  onComposerChange,
  onComposerHeightChange,
  onComposerHeightCommit,
  view,
  codexMessagesBySession,
  codexComposerBySession,
  onCodexMessagesChange,
  onCodexComposerChange,
  onCodexScreenSnapshot,
  onCodexReplyStart,
  onCodexMessagesClear,
}: {
  sessions: TerminalSession[];
  activeId: string;
  terminalRegistry: MutableRefObject<Record<string, TerminalHandle>>;
  pendingOutput: MutableRefObject<Record<string, string>>;
  attachmentRootPath: string;
  composerHeight: number;
  enterKeyMode: AppState["ui"]["enterKeyMode"];
  onAttachmentRootPathChange: (value: string) => void;
  onEnterKeyModeChange: (value: AppState["ui"]["enterKeyMode"]) => void;
  composerBySession: Record<string, ComposerState>;
  onInputError: (error: unknown) => void;
  onComposerChange: (value: SetStateAction<Record<string, ComposerState>>) => void;
  onComposerHeightChange: (height: number) => void;
  onComposerHeightCommit: (height: number) => void;
  view: TerminalView;
  codexMessagesBySession: Record<string, CodexChatMessage[]>;
  codexComposerBySession: Record<string, ComposerState>;
  onCodexMessagesChange: (value: SetStateAction<Record<string, CodexChatMessage[]>>) => void;
  onCodexComposerChange: (value: SetStateAction<Record<string, ComposerState>>) => void;
  onCodexScreenSnapshot: (sessionId: string, screenText: string) => void;
  onCodexReplyStart: (sessionId: string, replyId: string, prompt: string) => void;
  onCodexMessagesClear: (sessionId: string) => void;
}) {
  const terminalHostRef = useRef<HTMLDivElement | null>(null);
  const onInputErrorRef = useRef(onInputError);
  const activeSession = sessions.find((session) => session.id === activeId) ?? sessions[sessions.length - 1];
  const composer = activeSession ? composerBySession[activeSession.id] ?? { text: "", attachments: [] } : { text: "", attachments: [] };
  const codexComposer = activeSession ? codexComposerBySession[activeSession.id] ?? { text: "", attachments: [] } : { text: "", attachments: [] };
  const codexMessages = activeSession ? codexMessagesBySession[activeSession.id] ?? [] : [];
  const [attachmentPathDraft, setAttachmentPathDraft] = useState(attachmentRootPath);
  const [attachmentPathEditing, setAttachmentPathEditing] = useState(false);

  useEffect(() => {
    onInputErrorRef.current = onInputError;
  }, [onInputError]);

  useEffect(() => {
    setAttachmentPathDraft(attachmentRootPath);
    setAttachmentPathEditing(false);
  }, [attachmentRootPath]);

  useEffect(() => {
    const host = terminalHostRef.current;
    if (!host || !activeSession) {
      return;
    }

    host.textContent = "";
    let handle = terminalRegistry.current[activeSession.id];
    if (!handle) {
      const terminal = new Terminal({
        convertEol: true,
        cursorBlink: true,
        cursorInactiveStyle: "none",
        fontFamily: 'Consolas, "Cascadia Mono", monospace',
        fontSize: 13,
        lineHeight: 1.2,
        scrollback: 5000,
        theme: {
          background: "#0f172a",
          foreground: "#dbeafe",
          cursor: "#bfdbfe",
          selectionBackground: "#334155",
        },
      });
      terminal.attachCustomKeyEventHandler((event) => {
        if (!shouldCopyTerminalSelection(event, terminal.hasSelection())) {
          return true;
        }
        const selection = terminal.getSelection();
        navigator.clipboard?.writeText(selection).catch(onInputErrorRef.current);
        event.preventDefault();
        return false;
      });
      terminal.onData((data) => {
        showTerminalCursor(terminalRegistry.current[activeSession.id]);
        api.writeTerminalInput(activeSession.id, data).catch(onInputErrorRef.current);
      });
      const fitAddon = new FitAddon();
      terminal.loadAddon(fitAddon);
      handle = { terminal, fitAddon };
      terminalRegistry.current[activeSession.id] = handle;
    }

    if (handle.terminal.element) {
      host.appendChild(handle.terminal.element);
    } else {
      handle.terminal.open(host);
    }

    const pending = pendingOutput.current[activeSession.id];
    if (pending) {
      writeTerminalOutput(handle, pending, () => onCodexScreenSnapshot(activeSession.id, readTerminalBufferText(handle)));
      delete pendingOutput.current[activeSession.id];
    }

    let animationFrame = 0;
    const fit = () => {
      try {
        if (!handle) {
          return;
        }
        handle.fitAddon.fit();
        if (handle.terminal.cols !== handle.lastCols || handle.terminal.rows !== handle.lastRows) {
          handle.lastCols = handle.terminal.cols;
          handle.lastRows = handle.terminal.rows;
          api.resizeTerminal(activeSession.id, handle.terminal.cols, handle.terminal.rows).catch(onInputErrorRef.current);
        }
      } catch (error) {
        onInputErrorRef.current(error);
      }
    };
    const scheduleFit = () => {
      window.cancelAnimationFrame(animationFrame);
      animationFrame = window.requestAnimationFrame(fit);
    };
    const resizeObserver = new ResizeObserver(scheduleFit);
    resizeObserver.observe(host);
    scheduleFit();
    window.setTimeout(scheduleFit, 80);
    if (view === "terminal") {
      handle.terminal.focus();
    }

    return () => {
      window.cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
    };
  }, [activeSession?.id, pendingOutput, terminalRegistry, view]);

  useEffect(() => {
    if (view === "terminal" && activeSession && terminalRegistry.current[activeSession.id]) {
      window.setTimeout(() => {
        const handle = terminalRegistry.current[activeSession.id];
        showTerminalCursor(handle);
        handle?.terminal.focus();
      }, 0);
    }
  }, [activeSession?.id, terminalRegistry, view]);

  const focusActiveTerminal = () => {
    if (view === "terminal" && activeSession) {
      const handle = terminalRegistry.current[activeSession.id];
      showTerminalCursor(handle);
      handle?.terminal.focus();
    }
  };

  const updateComposer = (sessionId: string, next: ComposerState) => {
    onComposerChange((current) => ({ ...current, [sessionId]: next }));
  };

  const updateCodexComposer = (sessionId: string, next: ComposerState) => {
    onCodexComposerChange((current) => ({ ...current, [sessionId]: next }));
  };

  const appendCodexMessages = (sessionId: string, messages: CodexChatMessage[]) => {
    onCodexMessagesChange((current) => ({
      ...current,
      [sessionId]: [...(current[sessionId] ?? []), ...messages],
    }));
  };

  const addAttachment = (sessionId: string, attachment: AttachmentFile) => {
    onComposerChange((current) => {
      const currentComposer = current[sessionId] ?? { text: "", attachments: [] };
      return {
        ...current,
        [sessionId]: {
          ...currentComposer,
          attachments: [...currentComposer.attachments, attachment],
        },
      };
    });
  };

  const addCodexAttachment = (sessionId: string, attachment: AttachmentFile) => {
    onCodexComposerChange((current) => {
      const currentComposer = current[sessionId] ?? { text: "", attachments: [] };
      return {
        ...current,
        [sessionId]: {
          ...currentComposer,
          attachments: [...currentComposer.attachments, attachment],
        },
      };
    });
  };

  const removeAttachment = (sessionId: string, attachmentId: string) => {
    onComposerChange((current) => {
      const currentComposer = current[sessionId] ?? { text: "", attachments: [] };
      return {
        ...current,
        [sessionId]: {
          ...currentComposer,
          attachments: currentComposer.attachments.filter((item) => item.id !== attachmentId),
        },
      };
    });
  };

  const removeCodexAttachment = (sessionId: string, attachmentId: string) => {
    onCodexComposerChange((current) => {
      const currentComposer = current[sessionId] ?? { text: "", attachments: [] };
      return {
        ...current,
        [sessionId]: {
          ...currentComposer,
          attachments: currentComposer.attachments.filter((item) => item.id !== attachmentId),
        },
      };
    });
  };

  const pasteAttachment = async (
    sessionId: string,
    file: File,
    addSavedAttachment: (sessionId: string, attachment: AttachmentFile) => void,
  ) => {
    if (!file.type.startsWith("image/")) {
      onInputError("只能粘贴图片附件");
      return;
    }
    const dataBase64 = await readFileAsDataURL(file);
    const attachment = await api.saveAttachment({
      sessionId,
      fileName: file.name || `clipboard-${Date.now()}.png`,
      mimeType: file.type,
      dataBase64,
      attachmentRootPath,
    });
    addSavedAttachment(sessionId, attachment);
  };

  const handleComposerPaste = async (event: ReactClipboardEvent<HTMLTextAreaElement>) => {
    if (!activeSession) {
      return;
    }
    const files = Array.from(event.clipboardData.files).filter((file) => file.type.startsWith("image/"));
    const imageItems = Array.from(event.clipboardData.items)
      .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
      .map((item) => item.getAsFile())
      .filter((file): file is File => Boolean(file));
    const images = files.length > 0 ? files : imageItems;
    if (images.length === 0) {
      return;
    }
    event.preventDefault();
    try {
      for (const image of images) {
        await pasteAttachment(activeSession.id, image, addAttachment);
      }
    } catch (error) {
      onInputError(error);
    }
  };

  const handleCodexComposerPaste = async (event: ReactClipboardEvent<HTMLTextAreaElement>) => {
    if (!activeSession) {
      return;
    }
    const files = Array.from(event.clipboardData.files).filter((file) => file.type.startsWith("image/"));
    const imageItems = Array.from(event.clipboardData.items)
      .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
      .map((item) => item.getAsFile())
      .filter((file): file is File => Boolean(file));
    const images = files.length > 0 ? files : imageItems;
    if (images.length === 0) {
      return;
    }
    event.preventDefault();
    try {
      for (const image of images) {
        await pasteAttachment(activeSession.id, image, addCodexAttachment);
      }
    } catch (error) {
      onInputError(error);
    }
  };

  const sendComposer = async () => {
    if (!activeSession || (!composer.text.trim() && composer.attachments.length === 0)) {
      return;
    }
    try {
      for (const input of buildComposerWrites(composer.text, composer.attachments, true)) {
        await api.writeTerminalInput(activeSession.id, input);
      }
      updateComposer(activeSession.id, { text: "", attachments: [] });
    } catch (error) {
      onInputError(error);
    }
  };

  const sendCodexComposer = async () => {
    if (!activeSession || (!codexComposer.text.trim() && codexComposer.attachments.length === 0)) {
      return;
    }
    const userMessage: CodexChatMessage = {
      id: makeId("codex-user"),
      role: "user",
      content: codexComposer.text.trim(),
      attachments: codexComposer.attachments,
    };
    const assistantMessage: CodexChatMessage = {
      id: makeId("codex-assistant"),
      role: "assistant",
      content: "",
      streaming: true,
    };
    try {
      appendCodexMessages(activeSession.id, [userMessage, assistantMessage]);
      const prompt = buildCodexPrompt(codexComposer.text, codexComposer.attachments);
      const writes = buildCodexInteractiveWrites(codexComposer.text, codexComposer.attachments);
      await api.writeTerminalInput(activeSession.id, writes[0]);
      await wait(CODEX_INTERACTIVE_SUBMIT_DELAY_MS);
      onCodexReplyStart(activeSession.id, assistantMessage.id, prompt);
      for (const input of writes.slice(1)) {
        await api.writeTerminalInput(activeSession.id, input);
      }
      updateCodexComposer(activeSession.id, { text: "", attachments: [] });
    } catch (error) {
      onCodexMessagesChange((current) => ({
        ...current,
        [activeSession.id]: (current[activeSession.id] ?? []).map((messageItem) =>
          messageItem.id === assistantMessage.id
            ? { ...messageItem, content: `发送失败：${String(error)}`, streaming: false }
            : messageItem,
        ),
      }));
      onInputError(error);
    }
  };

  const commitAttachmentRootPath = () => {
    if (attachmentPathDraft.trim() !== attachmentRootPath) {
      onAttachmentRootPathChange(attachmentPathDraft);
    }
    setAttachmentPathEditing(false);
  };

  const cancelAttachmentRootPathEdit = () => {
    setAttachmentPathDraft(attachmentRootPath);
    setAttachmentPathEditing(false);
  };

  const handleComposerResizeMouseDown = (event: ReactMouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const startY = event.clientY;
    const startHeight = clampNumber(composerHeight || DEFAULT_COMPOSER_HEIGHT, COMPOSER_MIN_HEIGHT, COMPOSER_MAX_HEIGHT);
    document.body.classList.add("resizing-composer");

    const handleMouseMove = (moveEvent: MouseEvent) => {
      onComposerHeightChange(startHeight - (moveEvent.clientY - startY));
    };
    const handleMouseUp = (upEvent: MouseEvent) => {
      document.body.classList.remove("resizing-composer");
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
      onComposerHeightCommit(startHeight - (upEvent.clientY - startY));
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
  };

  const resolvedComposerHeight = clampNumber(
    composerHeight || DEFAULT_COMPOSER_HEIGHT,
    COMPOSER_MIN_HEIGHT,
    COMPOSER_MAX_HEIGHT,
  );

  return (
    <div className={view === "codex" ? "terminal-panel codex-view-active" : "terminal-panel"} onMouseDown={focusActiveTerminal}>
      {sessions.length > 0 ? (
        <div
          ref={terminalHostRef}
          className={view === "terminal" ? "terminal-host" : "terminal-host terminal-host-hidden"}
          aria-hidden={view !== "terminal"}
        />
      ) : view === "terminal" ? (
        <div className="terminal-empty">点击工作区行的“内嵌终端”创建会话</div>
      ) : null}
      {view === "terminal" ? (
        <>
          <div className="codex-composer" onMouseDown={(event) => event.stopPropagation()}>
            <div className="composer-settings">
              <label>
                <span>附件目录</span>
                <input
                  value={attachmentPathDraft}
                  disabled={!attachmentPathEditing}
                  placeholder="codex_attachments"
                  onChange={(event) => setAttachmentPathDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      commitAttachmentRootPath();
                    } else if (event.key === "Escape") {
                      event.preventDefault();
                      cancelAttachmentRootPathEdit();
                    }
                  }}
                />
              </label>
              <div className="attachment-path-actions">
                {attachmentPathEditing ? (
                  <>
                    <button type="button" onClick={commitAttachmentRootPath}>保存</button>
                    <button type="button" onClick={cancelAttachmentRootPathEdit}>取消</button>
                  </>
                ) : (
                  <button type="button" onClick={() => setAttachmentPathEditing(true)}>编辑</button>
                )}
              </div>
              <div className="enter-mode-toggle" aria-label="回车行为">
                <button
                  type="button"
                  className={enterKeyMode === "send" ? "active" : ""}
                  onClick={() => onEnterKeyModeChange("send")}
                >
                  回车发送
                </button>
                <button
                  type="button"
                  className={enterKeyMode === "newline" ? "active" : ""}
                  onClick={() => onEnterKeyModeChange("newline")}
                >
                  回车换行
                </button>
              </div>
            </div>
            <div className="attachment-strip">
              {composer.attachments.length === 0 ? (
                <span className="attachment-hint">在这里粘贴截图或图片文件</span>
              ) : (
                composer.attachments.map((attachment) => (
                  <div className="attachment-chip" key={attachment.id} title={attachment.path}>
                    <button type="button" onClick={() => api.openAttachment(attachment.path).catch(onInputError)}>打开</button>
                    <span>{attachment.name}</span>
                    <button type="button" onClick={() => activeSession && removeAttachment(activeSession.id, attachment.id)}>删除</button>
                  </div>
                ))
              )}
            </div>
            <button
              className="composer-resize-handle"
              type="button"
              aria-label="调整输入框高度"
              title="拖动调整输入框高度"
              onMouseDown={handleComposerResizeMouseDown}
            />
            <div className="composer-row">
              <textarea
                style={{ height: `${resolvedComposerHeight}px` }}
                value={composer.text}
                disabled={!activeSession?.running}
                placeholder="输入要发给 codex 的内容，支持 Ctrl+V 粘贴截图"
                onPaste={handleComposerPaste}
                onChange={(event) => activeSession && updateComposer(activeSession.id, { ...composer, text: event.target.value })}
                onKeyDown={(event) => {
                  if (shouldSendComposerOnEnter(event, enterKeyMode)) {
                    event.preventDefault();
                    sendComposer();
                  }
                }}
              />
              <div className="composer-actions">
                <button
                  type="button"
                  className="composer-send"
                  disabled={!activeSession?.running}
                  onClick={sendComposer}
                >
                  发送并执行
                </button>
              </div>
            </div>
          </div>
        </>
      ) : (
        <CodexPanel
          activeSession={activeSession}
          messages={codexMessages}
          composer={codexComposer}
          enterKeyMode={enterKeyMode}
          onPaste={handleCodexComposerPaste}
          onComposerChange={updateCodexComposer}
          onRemoveAttachment={removeCodexAttachment}
          onSend={sendCodexComposer}
          onClearMessages={() => activeSession && onCodexMessagesClear(activeSession.id)}
          onInputError={onInputError}
        />
      )}
      {view === "terminal" && activeSession && <div className="terminal-path">{activeSession.directory}</div>}
    </div>
  );
}

function CodexPanel({
  activeSession,
  messages,
  composer,
  enterKeyMode,
  onPaste,
  onComposerChange,
  onRemoveAttachment,
  onSend,
  onClearMessages,
  onInputError,
}: {
  activeSession: TerminalSession | undefined;
  messages: CodexChatMessage[];
  composer: ComposerState;
  enterKeyMode: AppState["ui"]["enterKeyMode"];
  onPaste: (event: ReactClipboardEvent<HTMLTextAreaElement>) => void;
  onComposerChange: (sessionId: string, next: ComposerState) => void;
  onRemoveAttachment: (sessionId: string, attachmentId: string) => void;
  onSend: () => void;
  onClearMessages: () => void;
  onInputError: (error: unknown) => void;
}) {
  const messageListRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const element = messageListRef.current;
    if (!element) {
      return;
    }
    element.scrollTop = element.scrollHeight;
  }, [messages]);

  if (!activeSession) {
    return <div className="codex-chat-empty">点击工作区行的“内嵌终端”创建会话</div>;
  }

  return (
    <div className="codex-chat" onMouseDown={(event) => event.stopPropagation()}>
      <div className="codex-chat-messages" ref={messageListRef}>
        {messages.length === 0 ? (
          <div className="codex-chat-placeholder">
            <div className="codex-placeholder-mark">CX</div>
            <div>
              <strong>Codex 控制台</strong>
              <span>发送消息后，回复会在这里展开</span>
            </div>
          </div>
        ) : (
          messages.map((messageItem) => {
            if (messageItem.role === "assistant" && !messageItem.content && !messageItem.attachments?.length) {
              return null;
            }
            return (
              <article
                className={messageItem.role === "user" ? "codex-message user" : "codex-message assistant"}
                key={messageItem.id}
              >
                <div className="codex-message-bubble">
                  {messageItem.content ? (
                    messageItem.role === "assistant" ? (
                      <pre className="codex-live-output">{messageItem.content}</pre>
                    ) : (
                      <p>{messageItem.content}</p>
                    )
                  ) : null}
                {messageItem.attachments && messageItem.attachments.length > 0 && (
                  <div className="codex-message-attachments">
                    {messageItem.attachments.map((attachment) => (
                      <button
                        type="button"
                        key={attachment.id}
                        title={attachment.path}
                        onClick={() => api.openAttachment(attachment.path).catch(onInputError)}
                      >
                        {attachment.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              </article>
            );
          })
        )}
      </div>
      <div className="codex-chat-input">
        {composer.attachments.length > 0 && (
          <div className="codex-chat-attachments">
            {composer.attachments.map((attachment) => (
              <div className="codex-chat-attachment" key={attachment.id} title={attachment.path}>
                <button type="button" onClick={() => api.openAttachment(attachment.path).catch(onInputError)}>打开</button>
                <span>{attachment.name}</span>
                <button type="button" onClick={() => onRemoveAttachment(activeSession.id, attachment.id)}>删除</button>
              </div>
            ))}
          </div>
        )}
        <div className="codex-chat-input-row">
          <textarea
            value={composer.text}
            disabled={!activeSession.running}
            placeholder="发送消息给 Codex"
            onPaste={onPaste}
            onChange={(event) => onComposerChange(activeSession.id, { ...composer, text: event.target.value })}
            onKeyDown={(event) => {
              if (shouldSendComposerOnEnter(event, enterKeyMode)) {
                event.preventDefault();
                onSend();
              }
            }}
          />
          <button
            type="button"
            className="codex-chat-send"
            disabled={!activeSession.running}
            onClick={onSend}
            title="发送"
          >
            发送
          </button>
        </div>
        <div className="codex-chat-actions">
          <button type="button" disabled={messages.length === 0} onClick={onClearMessages}>清空对话</button>
          <span>{enterKeyMode === "send" ? "Enter 发送，Shift+Enter 换行" : "Ctrl+Enter 发送，Enter 换行"}</span>
        </div>
      </div>
    </div>
  );
}

function readFileAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("读取图片失败"));
    reader.readAsDataURL(file);
  });
}

function DirectoryDialog({ directory, onCancel, onSave, onError }: {
  directory: DirectoryItem | null;
  onCancel: () => void;
  onSave: (directory: DirectoryItem) => void;
  onError: (error: unknown) => void;
}) {
  const [name, setName] = useState(directory?.name ?? "");
  const [path, setPath] = useState(directory?.path ?? "");

  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSave({ id: directory?.id ?? makeId("dir"), name, path, groupId: "", openerIds: directory?.openerIds });
  };

  const selectWorkspacePath = async () => {
    try {
      const selectedPath = (await api.selectDirectory()).trim();
      if (!selectedPath) {
        return;
      }
      setPath(selectedPath);
      if (!name.trim()) {
        const normalizedPath = selectedPath.replace(/[\\/]+$/, "");
        setName(normalizedPath.split(/[\\/]/).filter(Boolean).pop() || normalizedPath || selectedPath);
      }
    } catch (error) {
      if (isCanceledFileDialogError(error)) {
        return;
      }
      onError(error);
    }
  };

  return (
    <div className="modal-backdrop">
      <form className="modal" onSubmit={submit}>
        <h2>{directory ? "编辑工作区" : "新增工作区"}</h2>
        <label>工作区名称<input value={name} onChange={(event) => setName(event.target.value)} required /></label>
        <label>
          工作区路径
          <div className="file-picker-row">
            <input value={path} onChange={(event) => setPath(event.target.value)} required />
            <button type="button" onClick={selectWorkspacePath}>选择目录</button>
          </div>
        </label>
        <div className="modal-actions"><button type="button" onClick={onCancel}>取消</button><button className="primary" type="submit">保存</button></div>
      </form>
    </div>
  );
}

function OpenerDialog({ opener, openers, onCancel, onSave, onEdit, onRemove, onError }: {
  opener: CustomOpener | null;
  openers: CustomOpener[];
  onCancel: () => void;
  onSave: (opener: CustomOpener) => void;
  onEdit: (opener: CustomOpener | null) => void;
  onRemove: (id: string) => void;
  onError: (error: unknown) => void;
}) {
  const [name, setName] = useState(opener?.name ?? "");
  const [commandTemplate, setCommandTemplate] = useState(opener?.commandTemplate ?? "");
  const [selectingApplication, setSelectingApplication] = useState(false);

  useEffect(() => {
    setName(opener?.name ?? "");
    setCommandTemplate(opener?.commandTemplate ?? "");
  }, [opener]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSave({ id: opener?.id ?? makeId("opener"), name: name.trim(), commandTemplate: commandTemplate.trim() });
  };

  const selectOpener = (target: CustomOpener | null) => {
    onEdit(target);
    setName(target?.name ?? "");
    setCommandTemplate(target?.commandTemplate ?? "");
  };

  const selectApplication = async () => {
    try {
      setSelectingApplication(true);
      const applicationPath = (await api.selectApplication()).trim();
      if (!applicationPath) {
        return;
      }
      setCommandTemplate(commandTemplateForApplication(applicationPath));
      if (!name.trim()) {
        setName(nameFromApplicationPath(applicationPath));
      }
    } catch (error) {
      if (isCanceledFileDialogError(error)) {
        return;
      }
      onError(error);
    } finally {
      setSelectingApplication(false);
    }
  };

  return (
    <div className="modal-backdrop">
      <form className="modal wide" onSubmit={submit}>
        <h2>管理打开方式</h2>
        <div className="opener-list">
          {openers.map((item) => (
            <button
              type="button"
              key={item.id}
              className={opener?.id === item.id ? "chip active" : "chip"}
              onClick={() => selectOpener(item)}
            >
              {item.name}
            </button>
          ))}
          <button type="button" className="chip" onClick={() => selectOpener(null)}>新增</button>
        </div>
        <label>名称<input value={name} onChange={(event) => setName(event.target.value)} required /></label>
        <label>
          打开方式
          <div className="file-picker-row">
            <input value={commandTemplate} onChange={(event) => setCommandTemplate(event.target.value)} required />
            <button type="button" onClick={selectApplication} disabled={selectingApplication}>
              {selectingApplication ? "选择中" : "选择应用"}
            </button>
          </div>
        </label>
        <div className="modal-actions">
          {opener && <button type="button" className="danger" onClick={() => { onRemove(opener.id); onEdit(null); }}>删除</button>}
          <button type="button" onClick={onCancel}>取消</button>
          <button className="primary" type="submit">保存</button>
        </div>
      </form>
    </div>
  );
}

export default App;

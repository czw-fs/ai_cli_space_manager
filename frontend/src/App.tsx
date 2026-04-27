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
import { EventsOn } from "../wailsjs/runtime/runtime";
import { api } from "./api";
import { buildComposerWrites, shouldSendComposerOnEnter } from "./codexComposer";
import { reorderDirectories } from "./directoryOrder";
import { shouldCopyTerminalSelection } from "./terminalInput";
import type {
  AppState,
  AttachmentFile,
  ColumnWidths,
  CustomOpener,
  DirectoryItem,
  Group,
  TerminalOutputEvent,
  TerminalSession,
  ViewMode,
} from "./types";
import { emptyState } from "./types";

type DialogMode = "directory" | "group" | "opener" | null;

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

const TERMINAL_HIDE_CURSOR = "\x1b[?25l";
const TERMINAL_SHOW_CURSOR = "\x1b[?25h";
const TERMINAL_OUTPUT_IDLE_MS = 1600;
const DEFAULT_SIDEBAR_WIDTH = 176;
const SIDEBAR_MIN_WIDTH = 128;
const SIDEBAR_MAX_WIDTH = 320;
const DEFAULT_COMPOSER_HEIGHT = 66;
const COMPOSER_MIN_HEIGHT = 48;
const COMPOSER_MAX_HEIGHT = 180;

const makeId = (prefix: string) =>
  `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

const clampNumber = (value: number, min: number, max: number) => Math.min(max, Math.max(min, Math.round(value)));

function App() {
  const [state, setState] = useState<AppState>(emptyState);
  const [selectedGroup, setSelectedGroup] = useState("all");
  const [viewMode, setViewMode] = useState<ViewMode>("grouped");
  const [query, setQuery] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [dialog, setDialog] = useState<DialogMode>(null);
  const [editingDirectory, setEditingDirectory] = useState<DirectoryItem | null>(null);
  const [editingGroup, setEditingGroup] = useState<Group | null>(null);
  const [editingOpener, setEditingOpener] = useState<CustomOpener | null>(null);
  const [message, setMessage] = useState("");
  const [terminalSessions, setTerminalSessions] = useState<TerminalSession[]>([]);
  const [activeTerminalId, setActiveTerminalId] = useState("");
  const [activeArea, setActiveArea] = useState<"directories" | "terminal">("directories");
  const [groupsCollapsed, setGroupsCollapsed] = useState(false);
  const [terminalsCollapsed, setTerminalsCollapsed] = useState(false);
  const [composerBySession, setComposerBySession] = useState<Record<string, ComposerState>>({});
  const stateRef = useRef(state);
  const terminalInstances = useRef<Record<string, TerminalHandle>>({});
  const pendingTerminalOutput = useRef<Record<string, string>>({});

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

  useEffect(() => {
    api.getAppState().then(applyState).catch((error) => setMessage(String(error)));
    api.getTerminalSessions().then(setTerminalSessions).catch((error) => setMessage(String(error)));
  }, []);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    const offOutput = EventsOn("terminal:output", (event: TerminalOutputEvent) => {
      const handle = terminalInstances.current[event.sessionId];
      if (handle) {
        writeTerminalOutput(handle, event.data);
      } else {
        pendingTerminalOutput.current[event.sessionId] = `${pendingTerminalOutput.current[event.sessionId] ?? ""}${event.data}`;
      }
    });
    const offClosed = EventsOn("terminal:closed", (session: TerminalSession) => {
      setTerminalSessions((current) => current.map((item) => (item.id === session.id ? session : item)));
      disposeTerminalHandle(terminalInstances.current[session.id]);
      delete terminalInstances.current[session.id];
      delete pendingTerminalOutput.current[session.id];
    });
    return () => {
      offOutput();
      offClosed();
    };
  }, []);

  const groupCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const directory of state.directories) {
      counts.set(directory.groupId, (counts.get(directory.groupId) ?? 0) + 1);
    }
    return counts;
  }, [state.directories]);

  const filteredDirectories = useMemo(() => {
    const value = query.trim().toLowerCase();
    return state.directories.filter((directory) => {
      const group = state.groups.find((item) => item.id === directory.groupId);
      const matchesGroup = selectedGroup === "all" || directory.groupId === selectedGroup;
      const matchesText =
        value === "" ||
        directory.name.toLowerCase().includes(value) ||
        directory.path.toLowerCase().includes(value) ||
        (group?.name.toLowerCase().includes(value) ?? false);
      return matchesGroup && matchesText;
    });
  }, [query, selectedGroup, state.directories, state.groups]);

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
      setMessage(String(error));
    }
  };

  const setPowerShellLaunchMode = async (powerShellLaunchMode: AppState["ui"]["powerShellLaunchMode"]) => {
    const next = { ...stateRef.current, ui: { ...stateRef.current.ui, powerShellLaunchMode } };
    applyState(next);
    try {
      await api.saveAppState(next);
    } catch (error) {
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

  const saveGroup = async (group: Group) => {
    const exists = state.groups.some((item) => item.id === group.id);
    await persist({
      ...state,
      groups: exists ? state.groups.map((item) => (item.id === group.id ? group : item)) : [...state.groups, group],
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

  const removeGroup = async (id: string) => {
    await persist({
      ...state,
      groups: state.groups.filter((item) => item.id !== id),
      directories: state.directories.map((item) => (item.groupId === id ? { ...item, groupId: "" } : item)),
    });
    if (selectedGroup === id) {
      setSelectedGroup("all");
    }
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
      disposeTerminalHandle(terminalInstances.current[sessionId]);
      delete terminalInstances.current[sessionId];
      delete pendingTerminalOutput.current[sessionId];
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
    setEditingGroup(null);
    setEditingOpener(null);
  };

  const visibleGroups = viewMode === "grouped"
    ? state.groups.filter((group) => selectedGroup === "all" || selectedGroup === group.id)
    : [];
  const ungroupedDirectories = filteredDirectories.filter((item) => item.groupId === "");
  const sidebarWidth = clampNumber(
    state.ui.sidebarWidth || DEFAULT_SIDEBAR_WIDTH,
    SIDEBAR_MIN_WIDTH,
    SIDEBAR_MAX_WIDTH,
  );
  const workspaceStyle = { "--sidebar-width": `${sidebarWidth}px` } as CSSProperties & Record<"--sidebar-width", string>;

  return (
    <div className={`app-shell ${sidebarOpen ? "sidebar-open" : "sidebar-closed"}`}>
      <div className="workspace" style={workspaceStyle}>
        <aside className="sidebar">
          <div className="sidebar-head collapsible-head">
            <button
              className={groupsCollapsed ? "collapse-button collapsed" : "collapse-button"}
              type="button"
              aria-label={groupsCollapsed ? "展开分组" : "折叠分组"}
              aria-expanded={!groupsCollapsed}
              onClick={() => setGroupsCollapsed((current) => !current)}
            >
              ▾
            </button>
            <button
              className={activeArea === "directories" ? "sidebar-title active" : "sidebar-title"}
              type="button"
              onClick={() => {
                setSelectedGroup("all");
                setActiveArea("directories");
              }}
            >
              分组
            </button>
          </div>
          <div className={groupsCollapsed ? "sidebar-section collapsed" : "sidebar-section"}>
            <button
              className={activeArea === "directories" && selectedGroup === "all" ? "nav-item active" : "nav-item"}
              onClick={() => {
                setSelectedGroup("all");
                setActiveArea("directories");
              }}
            >
              <span>全部目录</span><span>{state.directories.length}</span>
            </button>
            {state.groups.map((group) => (
              <div className="nav-row" key={group.id}>
                <button
                  className={activeArea === "directories" && selectedGroup === group.id ? "nav-item active" : "nav-item"}
                  onClick={() => {
                    setSelectedGroup(group.id);
                    setActiveArea("directories");
                  }}
                >
                  <span>{group.name}</span><span>{groupCounts.get(group.id) ?? 0}</span>
                </button>
                <button className="mini-icon" title="编辑分组" onClick={() => { setEditingGroup(group); setDialog("group"); }}>✎</button>
              </div>
            ))}
          </div>
          <div className="sidebar-head terminal-head collapsible-head">
            <button
              className={terminalsCollapsed ? "collapse-button collapsed" : "collapse-button"}
              type="button"
              aria-label={terminalsCollapsed ? "展开终端" : "折叠终端"}
              aria-expanded={!terminalsCollapsed}
              onClick={() => setTerminalsCollapsed((current) => !current)}
            >
              ▾
            </button>
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
          <div className={terminalsCollapsed ? "sidebar-section collapsed" : "sidebar-section"}>
            {terminalSessions.length === 0 && <div className="sidebar-empty">暂无终端</div>}
            {terminalSessions.map((session) => (
              <div className="terminal-nav-row" key={session.id}>
                <button
                  className={activeArea === "terminal" && activeTerminalId === session.id ? "nav-item terminal-item active" : "nav-item terminal-item"}
                  onClick={() => {
                    setActiveTerminalId(session.id);
                    setActiveArea("terminal");
                  }}
                >
                  <span>{session.title}</span>
                  <span className={session.running ? "run-dot running" : "run-dot"} />
                </button>
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

        <main className="main-panel">
          {activeArea === "directories" && (
            <>
              <section className="toolbar">
                <input value={query} onChange={(event) => setQuery(event.target.value)} aria-label="搜索名称、分组或路径" placeholder="搜索名称、分组或路径" />
                <select
                  value={selectedGroup}
                  onChange={(event) => {
                    setSelectedGroup(event.target.value);
                    setActiveArea("directories");
                  }}
                >
                  <option value="all">全部目录</option>
                  {state.groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
                </select>
                <div className="launch-toggle" aria-label="PowerShell 打开方式">
                  <button
                    className={state.ui.powerShellLaunchMode === "tab" ? "active" : ""}
                    type="button"
                    onClick={() => setPowerShellLaunchMode("tab")}
                  >
                    新增标签页
                  </button>
                  <button
                    className={state.ui.powerShellLaunchMode === "window" ? "active" : ""}
                    type="button"
                    onClick={() => setPowerShellLaunchMode("window")}
                  >
                    新终端窗口
                  </button>
                </div>
                <button onClick={() => { setEditingOpener(null); setDialog("opener"); }}>打开方式</button>
                <button onClick={() => { setEditingGroup(null); setDialog("group"); }}>新增分组</button>
                <button className="primary" onClick={() => { setEditingDirectory(null); setDialog("directory"); }}>新增目录</button>
              </section>

              <section className="viewbar">
                <div className="segmented">
                  <button className={viewMode === "grouped" ? "active" : ""} onClick={() => setViewMode("grouped")}>分组</button>
                  <button className={viewMode === "flat" ? "active" : ""} onClick={() => setViewMode("flat")}>平铺</button>
                </div>
                <span>{filteredDirectories.length} 个目录，{state.customOpeners.length} 个自定义打开方式</span>
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
                {viewMode === "grouped" && selectedGroup === "all" && (visibleGroups.length > 0 || ungroupedDirectories.length > 0) ? (
                  <>
                    {visibleGroups.map((group) => (
                      <DirectoryTable
                        key={group.id}
                        title={group.name}
                        directories={filteredDirectories.filter((item) => item.groupId === group.id)}
                        groups={state.groups}
                        customOpeners={state.customOpeners}
                        columnWidths={state.ui.columnWidths}
                        onOpenAction={openAction}
                        onStartEmbeddedTerminal={startEmbeddedTerminal}
                        onEditDirectory={(directory) => { setEditingDirectory(directory); setDialog("directory"); }}
                        onRemoveDirectory={removeDirectory}
                        onReorderDirectory={reorderDirectory}
                        onColumnWidthsChange={updateColumnWidths}
                        onColumnWidthsCommit={persistColumnWidths}
                      />
                    ))}
                    {ungroupedDirectories.length > 0 && (
                      <DirectoryTable
                        title="未分组"
                        directories={ungroupedDirectories}
                        groups={state.groups}
                        customOpeners={state.customOpeners}
                        columnWidths={state.ui.columnWidths}
                        onOpenAction={openAction}
                        onStartEmbeddedTerminal={startEmbeddedTerminal}
                        onEditDirectory={(directory) => { setEditingDirectory(directory); setDialog("directory"); }}
                        onRemoveDirectory={removeDirectory}
                        onReorderDirectory={reorderDirectory}
                        onColumnWidthsChange={updateColumnWidths}
                        onColumnWidthsCommit={persistColumnWidths}
                      />
                    )}
                  </>
                ) : (
                  <DirectoryTable
                    title={selectedGroup === "all" ? "全部目录" : state.groups.find((item) => item.id === selectedGroup)?.name ?? "未分组"}
                    directories={filteredDirectories}
                    groups={state.groups}
                    customOpeners={state.customOpeners}
                    columnWidths={state.ui.columnWidths}
                    onOpenAction={openAction}
                    onStartEmbeddedTerminal={startEmbeddedTerminal}
                    onEditDirectory={(directory) => { setEditingDirectory(directory); setDialog("directory"); }}
                    onRemoveDirectory={removeDirectory}
                    onReorderDirectory={reorderDirectory}
                    onColumnWidthsChange={updateColumnWidths}
                    onColumnWidthsCommit={persistColumnWidths}
                  />
                )}
            </section>
          ) : (
            <TerminalPanel
              sessions={terminalSessions}
              activeId={activeTerminalId}
              terminalRegistry={terminalInstances}
              onSelect={setActiveTerminalId}
              onClose={closeTerminal}
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
            />
          )}
        </main>
      </div>

      <footer className="statusbar">
        <span>Windows Terminal + PowerShell 7：C:\Program Files\WindowsApps\Microsoft.PowerShell_7.6.1.0_x64__8wekyb3d8bbwe\pwsh.exe</span>
        <span>配置：{state.config.configPath || "exe 同级 config.json"}</span>
      </footer>

      {dialog === "directory" && (
        <DirectoryDialog directory={editingDirectory} groups={state.groups} onCancel={closeDialog} onSave={saveDirectory} />
      )}
      {dialog === "group" && (
        <GroupDialog group={editingGroup} onCancel={closeDialog} onSave={saveGroup} onRemove={removeGroup} />
      )}
      {dialog === "opener" && (
        <OpenerDialog
          opener={editingOpener}
          openers={state.customOpeners}
          onCancel={closeDialog}
          onSave={saveOpener}
          onEdit={setEditingOpener}
          onRemove={removeOpener}
        />
      )}
    </div>
  );
}

type TableProps = {
  title: string;
  directories: DirectoryItem[];
  groups: Group[];
  customOpeners: CustomOpener[];
  columnWidths: ColumnWidths;
  onOpenAction: (action: () => Promise<void>) => void;
  onStartEmbeddedTerminal: (directory: DirectoryItem) => void;
  onEditDirectory: (directory: DirectoryItem) => void;
  onRemoveDirectory: (id: string) => void;
  onReorderDirectory: (draggedId: string, targetId: string) => void;
  onColumnWidthsChange: (columnWidths: ColumnWidths) => void;
  onColumnWidthsCommit: (columnWidths: ColumnWidths) => void;
};

function DirectoryTable(props: TableProps) {
  const gridTemplateColumns = `${props.columnWidths.name}px ${props.columnWidths.group}px ${props.columnWidths.path}px ${props.columnWidths.actions}px ${props.columnWidths.manage}px`;

  const startResize = (key: keyof ColumnWidths, startEvent: ReactMouseEvent<HTMLButtonElement>) => {
    startEvent.preventDefault();
    const startX = startEvent.clientX;
    const startWidth = props.columnWidths[key];
    let latestWidths = props.columnWidths;
    const minByKey: Record<keyof ColumnWidths, number> = {
      name: 72,
      group: 72,
      path: 140,
      actions: 500,
      manage: 86,
    };
    const maxByKey: Record<keyof ColumnWidths, number> = {
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
        <div className="grid-head">分组<ResizeHandle onMouseDown={(event) => startResize("group", event)} /></div>
        <div className="grid-head">路径<ResizeHandle onMouseDown={(event) => startResize("path", event)} /></div>
        <div className="grid-head">打开方式<ResizeHandle onMouseDown={(event) => startResize("actions", event)} /></div>
        <div className="grid-head">操作<ResizeHandle onMouseDown={(event) => startResize("manage", event)} /></div>

        {props.directories.length === 0 && (
          <div className="empty-cell" style={{ gridColumn: "1 / -1" }}>暂无目录</div>
        )}
        {props.directories.map((directory) => {
          const group = props.groups.find((item) => item.id === directory.groupId);
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
                className="grid-cell"
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault();
                  const draggedId = event.dataTransfer.getData("text/plain");
                  if (draggedId) {
                    props.onReorderDirectory(draggedId, directory.id);
                  }
                }}
              >
                <span className="tag">{group?.name || "未分组"}</span>
              </div>
              <div
                className="grid-cell path-cell"
                onDragOver={(event) => event.preventDefault()}
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
                  <button className="soft-primary" onClick={() => props.onOpenAction(() => api.openPowerShellAdmin(directory.id))}>管理员 PowerShell 7</button>
                  <button onClick={() => props.onStartEmbeddedTerminal(directory)}>内嵌终端</button>
                  <button onClick={() => props.onOpenAction(() => api.openDirectory(directory.id))}>文件夹</button>
                  {props.customOpeners.slice(0, 1).map((opener) => (
                    <button key={opener.id} onClick={() => props.onOpenAction(() => api.openWithCustomTool(directory.id, opener.id))}>{opener.name}</button>
                  ))}
                  {props.customOpeners.length > 1 && (
                    <select
                      aria-label="更多工具"
                      defaultValue=""
                      onChange={(event) => {
                        const openerId = event.target.value;
                        event.currentTarget.value = "";
                        if (openerId) {
                          props.onOpenAction(() => api.openWithCustomTool(directory.id, openerId));
                        }
                      }}
                    >
                      <option value="">更多工具</option>
                      {props.customOpeners.slice(1).map((opener) => (
                        <option key={opener.id} value={opener.id}>{opener.name}</option>
                      ))}
                    </select>
                  )}
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

function writeTerminalOutput(handle: TerminalHandle, data: string) {
  hideTerminalCursor(handle);
  handle.terminal.write(data);
  handle.terminal.write(TERMINAL_HIDE_CURSOR);
  if (handle.outputQuietTimer) {
    window.clearTimeout(handle.outputQuietTimer);
  }
  handle.outputQuietTimer = window.setTimeout(() => {
    showTerminalCursor(handle);
  }, TERMINAL_OUTPUT_IDLE_MS);
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
  onSelect,
  onClose,
  onInputError,
  onComposerChange,
  onComposerHeightChange,
  onComposerHeightCommit,
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
  onSelect: (sessionId: string) => void;
  onClose: (sessionId: string) => void;
  onInputError: (error: unknown) => void;
  onComposerChange: (value: SetStateAction<Record<string, ComposerState>>) => void;
  onComposerHeightChange: (height: number) => void;
  onComposerHeightCommit: (height: number) => void;
}) {
  const terminalHostRef = useRef<HTMLDivElement | null>(null);
  const onInputErrorRef = useRef(onInputError);
  const activeSession = sessions.find((session) => session.id === activeId) ?? sessions[sessions.length - 1];
  const composer = activeSession ? composerBySession[activeSession.id] ?? { text: "", attachments: [] } : { text: "", attachments: [] };
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
      writeTerminalOutput(handle, pending);
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
    handle.terminal.focus();

    return () => {
      window.cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
    };
  }, [activeSession?.id, pendingOutput, terminalRegistry]);

  useEffect(() => {
    if (activeSession && terminalRegistry.current[activeSession.id]) {
      window.setTimeout(() => {
        const handle = terminalRegistry.current[activeSession.id];
        showTerminalCursor(handle);
        handle?.terminal.focus();
      }, 0);
    }
  }, [activeSession?.id, terminalRegistry]);

  const focusActiveTerminal = () => {
    if (activeSession) {
      const handle = terminalRegistry.current[activeSession.id];
      showTerminalCursor(handle);
      handle?.terminal.focus();
    }
  };

  const updateComposer = (sessionId: string, next: ComposerState) => {
    onComposerChange((current) => ({ ...current, [sessionId]: next }));
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

  const pasteAttachment = async (sessionId: string, file: File) => {
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
    addAttachment(sessionId, attachment);
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
        await pasteAttachment(activeSession.id, image);
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
    <div className="terminal-panel" onMouseDown={focusActiveTerminal}>
      {sessions.length === 0 ? (
        <div className="terminal-empty">点击目录行的“内嵌终端”创建会话</div>
      ) : (
        <div ref={terminalHostRef} className="terminal-host" />
      )}
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
      {activeSession && <div className="terminal-path">{activeSession.directory}</div>}
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

function DirectoryDialog({ directory, groups, onCancel, onSave }: {
  directory: DirectoryItem | null;
  groups: Group[];
  onCancel: () => void;
  onSave: (directory: DirectoryItem) => void;
}) {
  const [name, setName] = useState(directory?.name ?? "");
  const [path, setPath] = useState(directory?.path ?? "");
  const [groupId, setGroupId] = useState(directory?.groupId ?? groups[0]?.id ?? "");

  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSave({ id: directory?.id ?? makeId("dir"), name, path, groupId });
  };

  return (
    <div className="modal-backdrop">
      <form className="modal" onSubmit={submit}>
        <h2>{directory ? "编辑目录" : "新增目录"}</h2>
        <label>名称<input value={name} onChange={(event) => setName(event.target.value)} required /></label>
        <label>路径<input value={path} onChange={(event) => setPath(event.target.value)} required /></label>
        <label>分组<select value={groupId} onChange={(event) => setGroupId(event.target.value)}><option value="">未分组</option>{groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label>
        <div className="modal-actions"><button type="button" onClick={onCancel}>取消</button><button className="primary" type="submit">保存</button></div>
      </form>
    </div>
  );
}

function GroupDialog({ group, onCancel, onSave, onRemove }: {
  group: Group | null;
  onCancel: () => void;
  onSave: (group: Group) => void;
  onRemove: (id: string) => void;
}) {
  const [name, setName] = useState(group?.name ?? "");
  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSave({ id: group?.id ?? makeId("group"), name });
  };
  return (
    <div className="modal-backdrop">
      <form className="modal" onSubmit={submit}>
        <h2>{group ? "编辑分组" : "新增分组"}</h2>
        <label>名称<input value={name} onChange={(event) => setName(event.target.value)} required /></label>
        <div className="modal-actions">
          {group && <button type="button" className="danger" onClick={() => { onRemove(group.id); onCancel(); }}>删除</button>}
          <button type="button" onClick={onCancel}>取消</button>
          <button className="primary" type="submit">保存</button>
        </div>
      </form>
    </div>
  );
}

function OpenerDialog({ opener, openers, onCancel, onSave, onEdit, onRemove }: {
  opener: CustomOpener | null;
  openers: CustomOpener[];
  onCancel: () => void;
  onSave: (opener: CustomOpener) => void;
  onEdit: (opener: CustomOpener | null) => void;
  onRemove: (id: string) => void;
}) {
  const [name, setName] = useState(opener?.name ?? "");
  const [commandTemplate, setCommandTemplate] = useState(opener?.commandTemplate ?? "\"C:\\Program Files\\JetBrains\\IntelliJ IDEA\\bin\\idea64.exe\" \"{path}\"");

  useEffect(() => {
    setName(opener?.name ?? "");
    setCommandTemplate(opener?.commandTemplate ?? "\"C:\\Program Files\\JetBrains\\IntelliJ IDEA\\bin\\idea64.exe\" \"{path}\"");
  }, [opener]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSave({ id: opener?.id ?? makeId("opener"), name, commandTemplate });
  };

  return (
    <div className="modal-backdrop">
      <form className="modal wide" onSubmit={submit}>
        <h2>{opener ? "编辑打开方式" : "新增打开方式"}</h2>
        <div className="opener-list">
          {openers.map((item) => (
            <button type="button" key={item.id} className={opener?.id === item.id ? "chip active" : "chip"} onClick={() => onEdit(item)}>{item.name}</button>
          ))}
          <button type="button" className="chip" onClick={() => onEdit(null)}>新增</button>
        </div>
        <label>名称<input value={name} onChange={(event) => setName(event.target.value)} required /></label>
        <label>命令模板<input value={commandTemplate} onChange={(event) => setCommandTemplate(event.target.value)} required /></label>
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

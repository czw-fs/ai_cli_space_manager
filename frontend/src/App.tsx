import { FormEvent, useEffect, useMemo, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { api } from "./api";
import type { AppState, ColumnWidths, CustomOpener, DirectoryItem, Group, ViewMode } from "./types";
import { emptyState } from "./types";

type DialogMode = "directory" | "group" | "opener" | null;

const makeId = (prefix: string) =>
  `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

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

  useEffect(() => {
    api.getAppState().then(setState).catch((error) => setMessage(String(error)));
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
    setState(next);
    await api.saveAppState(next);
    const refreshed = await api.getAppState();
    setState(refreshed);
    setMessage("已保存到 exe 同级 config.json");
  };

  const updateColumnWidths = (columnWidths: ColumnWidths) => {
    setState((current) => ({ ...current, ui: { ...current.ui, columnWidths } }));
  };

  const persistColumnWidths = async (columnWidths: ColumnWidths) => {
    const next = { ...state, ui: { ...state.ui, columnWidths } };
    setState(next);
    try {
      await api.saveAppState(next);
      setMessage("列宽已保存");
    } catch (error) {
      setMessage(String(error));
    }
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

  const openAction = async (action: () => Promise<void>) => {
    try {
      await action();
      setMessage("打开命令已发送");
    } catch (error) {
      setMessage(String(error));
    }
  };

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

  return (
    <div className={`app-shell ${sidebarOpen ? "sidebar-open" : "sidebar-closed"}`}>
      <header className="titlebar">
        <span className="window-dot" />
        <span className="window-dot" />
        <span className="window-dot" />
        <strong>OpenWorkspacePS</strong>
      </header>

      <div className="workspace">
        <aside className="sidebar">
          <div className="sidebar-head">
            <span>分组</span>
            <button className="icon-button" title="隐藏侧边栏" onClick={() => setSidebarOpen(false)}>‹</button>
          </div>
          <button className={selectedGroup === "all" ? "nav-item active" : "nav-item"} onClick={() => setSelectedGroup("all")}>
            <span>全部目录</span><span>{state.directories.length}</span>
          </button>
          {state.groups.map((group) => (
            <div className="nav-row" key={group.id}>
              <button className={selectedGroup === group.id ? "nav-item active" : "nav-item"} onClick={() => setSelectedGroup(group.id)}>
                <span>{group.name}</span><span>{groupCounts.get(group.id) ?? 0}</span>
              </button>
              <button className="mini-icon" title="编辑分组" onClick={() => { setEditingGroup(group); setDialog("group"); }}>✎</button>
            </div>
          ))}
        </aside>

        {!sidebarOpen && (
          <button className="expand-sidebar" title="展开侧边栏" onClick={() => setSidebarOpen(true)}>›</button>
        )}

        <main className="main-panel">
          <section className="toolbar">
            <input value={query} onChange={(event) => setQuery(event.target.value)} aria-label="搜索名称、分组或路径" placeholder="搜索名称、分组或路径" />
            <select value={selectedGroup} onChange={(event) => setSelectedGroup(event.target.value)}>
              <option value="all">全部目录</option>
              {state.groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
            </select>
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

          {state.config.configError && <div className="alert">配置读取失败：{state.config.configError}</div>}
          {message && <div className="status-message">{message}</div>}

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
                  onEditDirectory={(directory) => { setEditingDirectory(directory); setDialog("directory"); }}
                  onRemoveDirectory={removeDirectory}
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
                    onEditDirectory={(directory) => { setEditingDirectory(directory); setDialog("directory"); }}
                    onRemoveDirectory={removeDirectory}
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
                onEditDirectory={(directory) => { setEditingDirectory(directory); setDialog("directory"); }}
                onRemoveDirectory={removeDirectory}
                onColumnWidthsChange={updateColumnWidths}
                onColumnWidthsCommit={persistColumnWidths}
              />
            )}
          </section>
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
  onEditDirectory: (directory: DirectoryItem) => void;
  onRemoveDirectory: (id: string) => void;
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
      actions: 240,
      manage: 86,
    };
    const maxByKey: Record<keyof ColumnWidths, number> = {
      name: 360,
      group: 260,
      path: 640,
      actions: 640,
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
              <div className="grid-cell strong">{directory.name}</div>
              <div className="grid-cell"><span className="tag">{group?.name || "未分组"}</span></div>
              <div className="grid-cell path-cell">{directory.path}</div>
              <div className="grid-cell">
                <div className="row-actions">
                  <button className="soft-primary" onClick={() => props.onOpenAction(() => api.openPowerShellAdmin(directory.id))}>管理员 PowerShell 7</button>
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

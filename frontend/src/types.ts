export type Group = {
  id: string;
  name: string;
};

export type DirectoryItem = {
  id: string;
  name: string;
  path: string;
  groupId: string;
  openerIds?: string[];
};

export type CustomOpener = {
  id: string;
  name: string;
  commandTemplate: string;
};

export type TerminalSession = {
  id: string;
  title: string;
  directory: string;
  running: boolean;
  createdAt: number;
};

export type TerminalOutputEvent = {
  sessionId: string;
  data: string;
  stream: "pty" | "stdout" | "stderr" | "system";
};

export type AttachmentFile = {
  id: string;
  name: string;
  path: string;
  mimeType: string;
  size: number;
};

export type SaveAttachmentRequest = {
  sessionId: string;
  fileName: string;
  mimeType: string;
  dataBase64: string;
  attachmentRootPath: string;
};

export type ConfigStatus = {
  configExists: boolean;
  configPath: string;
  configError: string;
  usingDefaults: boolean;
};

export type ColumnWidths = {
  search: number;
  name: number;
  group: number;
  path: number;
  actions: number;
  manage: number;
};

export type UISettings = {
  columnWidths: ColumnWidths;
  powerShellLaunchMode: "tab" | "window";
  enterKeyMode: "send" | "newline";
  attachmentRootPath: string;
  sidebarWidth: number;
  composerHeight: number;
};

export type AppState = {
  groups: Group[];
  directories: DirectoryItem[];
  customOpeners: CustomOpener[];
  ui: UISettings;
  config: ConfigStatus;
};

export type ViewMode = "grouped" | "flat";

export const emptyState: AppState = {
  groups: [],
  directories: [],
  customOpeners: [],
  ui: {
    powerShellLaunchMode: "tab",
    enterKeyMode: "send",
    attachmentRootPath: "codex_attachments",
    sidebarWidth: 176,
    composerHeight: 66,
    columnWidths: {
      search: 180,
      name: 120,
      group: 90,
      path: 260,
      actions: 520,
      manage: 110,
    },
  },
  config: {
    configExists: false,
    configPath: "",
    configError: "",
    usingDefaults: true,
  },
};

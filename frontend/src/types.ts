export type Group = {
  id: string;
  name: string;
};

export type DirectoryItem = {
  id: string;
  name: string;
  path: string;
  groupId: string;
};

export type CustomOpener = {
  id: string;
  name: string;
  commandTemplate: string;
};

export type ConfigStatus = {
  configExists: boolean;
  configPath: string;
  configError: string;
  usingDefaults: boolean;
};

export type ColumnWidths = {
  name: number;
  group: number;
  path: number;
  actions: number;
  manage: number;
};

export type UISettings = {
  columnWidths: ColumnWidths;
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
    columnWidths: {
      name: 120,
      group: 90,
      path: 260,
      actions: 360,
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

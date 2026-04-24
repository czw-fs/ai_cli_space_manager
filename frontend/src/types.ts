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

export type AppState = {
  groups: Group[];
  directories: DirectoryItem[];
  customOpeners: CustomOpener[];
  config: ConfigStatus;
};

export type ViewMode = "grouped" | "flat";

export const emptyState: AppState = {
  groups: [],
  directories: [],
  customOpeners: [],
  config: {
    configExists: false,
    configPath: "",
    configError: "",
    usingDefaults: true,
  },
};

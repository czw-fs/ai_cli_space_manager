import type { AppState } from "./types";

type BackendApi = {
  GetAppState(): Promise<AppState>;
  SaveAppState(state: AppState): Promise<void>;
  OpenDirectory(directoryId: string): Promise<void>;
  OpenPowerShellAdmin(directoryId: string): Promise<void>;
  OpenWithCustomTool(directoryId: string, openerId: string): Promise<void>;
  ValidatePath(path: string): Promise<boolean>;
  ResolvePath(path: string): Promise<string>;
};

async function backend(): Promise<BackendApi> {
  return import("../wailsjs/go/main/App") as unknown as Promise<BackendApi>;
}

export const api = {
  async getAppState(): Promise<AppState> {
    return (await backend()).GetAppState();
  },
  async saveAppState(state: AppState): Promise<void> {
    return (await backend()).SaveAppState(state);
  },
  async openDirectory(directoryId: string): Promise<void> {
    return (await backend()).OpenDirectory(directoryId);
  },
  async openPowerShellAdmin(directoryId: string): Promise<void> {
    return (await backend()).OpenPowerShellAdmin(directoryId);
  },
  async openWithCustomTool(directoryId: string, openerId: string): Promise<void> {
    return (await backend()).OpenWithCustomTool(directoryId, openerId);
  },
  async validatePath(path: string): Promise<boolean> {
    return (await backend()).ValidatePath(path);
  },
  async resolvePath(path: string): Promise<string> {
    return (await backend()).ResolvePath(path);
  },
};

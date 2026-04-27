import type { AppState, AttachmentFile, SaveAttachmentRequest, TerminalSession } from "./types";

type BackendApi = {
  GetAppState(): Promise<AppState>;
  SaveAppState(state: AppState): Promise<void>;
  OpenDirectory(directoryId: string): Promise<void>;
  SelectDirectory(): Promise<string>;
  SelectApplication(): Promise<string>;
  OpenPowerShellAdmin(directoryId: string): Promise<void>;
  StartEmbeddedTerminal(directoryId: string): Promise<TerminalSession>;
  GetTerminalSessions(): Promise<TerminalSession[]>;
  WriteTerminalInput(sessionId: string, input: string): Promise<void>;
  ResizeTerminal(sessionId: string, cols: number, rows: number): Promise<void>;
  RenameTerminal(sessionId: string, title: string): Promise<TerminalSession>;
  StopTerminal(sessionId: string): Promise<void>;
  SaveAttachment(request: SaveAttachmentRequest): Promise<AttachmentFile>;
  OpenAttachment(path: string): Promise<void>;
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
  async selectDirectory(): Promise<string> {
    return (await backend()).SelectDirectory();
  },
  async selectApplication(): Promise<string> {
    return (await backend()).SelectApplication();
  },
  async openPowerShellAdmin(directoryId: string): Promise<void> {
    return (await backend()).OpenPowerShellAdmin(directoryId);
  },
  async startEmbeddedTerminal(directoryId: string): Promise<TerminalSession> {
    return (await backend()).StartEmbeddedTerminal(directoryId);
  },
  async getTerminalSessions(): Promise<TerminalSession[]> {
    return (await backend()).GetTerminalSessions();
  },
  async writeTerminalInput(sessionId: string, input: string): Promise<void> {
    return (await backend()).WriteTerminalInput(sessionId, input);
  },
  async resizeTerminal(sessionId: string, cols: number, rows: number): Promise<void> {
    return (await backend()).ResizeTerminal(sessionId, cols, rows);
  },
  async renameTerminal(sessionId: string, title: string): Promise<TerminalSession> {
    return (await backend()).RenameTerminal(sessionId, title);
  },
  async stopTerminal(sessionId: string): Promise<void> {
    return (await backend()).StopTerminal(sessionId);
  },
  async saveAttachment(request: SaveAttachmentRequest): Promise<AttachmentFile> {
    return (await backend()).SaveAttachment(request);
  },
  async openAttachment(path: string): Promise<void> {
    return (await backend()).OpenAttachment(path);
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

/// <reference types="vite/client" />

declare module '*.css';

import type { SSHServer, SSHKey, VaultData } from './types';

export interface IElectronAPI {
  getDefaultVaultPath: () => Promise<string>;
  checkVaultExists: (path?: string) => Promise<boolean>;
  unlockVault: (password: string, filePath?: string) => Promise<{ success: boolean; data?: VaultData; error?: string; filePath?: string; isLegacyV1?: boolean }>;
  initVault: (password: string, filePath?: string, profile?: 'standard' | 'strong' | 'maximum') => Promise<{ success: boolean; data?: VaultData; error?: string; filePath?: string }>;
  saveVault: (data: VaultData, filePath?: string, password?: string, profile?: 'standard' | 'strong' | 'maximum') => Promise<{ success: boolean; error?: string }>;
  selectFileToOpen: () => Promise<string | null>;
  selectFileToSave: () => Promise<string | null>;
  readKeyFile: () => Promise<{ name: string; content: string } | null>;

  spawnLocalTerminal: (sessionId: string, cols?: number, rows?: number, cwd?: string) => Promise<{ success: boolean; error?: string }>;
  sendLocalData: (sessionId: string, data: string) => void;
  resizeLocal: (sessionId: string, cols: number, rows: number) => void;
  killLocal: (sessionId: string) => void;
  onLocalData: (sessionId: string, callback: (data: string) => void) => () => void;
  onLocalClose: (sessionId: string, callback: () => void) => () => void;

  connectSSH: (sessionId: string, server: SSHServer, key?: SSHKey, cols?: number, rows?: number) => Promise<{ success: boolean; error?: string }>;
  sendSSHData: (sessionId: string, data: string) => void;
  resizeSSH: (sessionId: string, cols: number, rows: number) => void;
  disconnectSSH: (sessionId: string) => void;

  onSSHData: (sessionId: string, callback: (data: string) => void) => () => void;
  onSSHError: (sessionId: string, callback: (error: string) => void) => () => void;
  onSSHClose: (sessionId: string, callback: () => void) => () => void;
}

declare global {
  interface Window {
    electronAPI: IElectronAPI;
  }
}

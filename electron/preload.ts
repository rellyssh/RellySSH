import { contextBridge, ipcRenderer } from 'electron';
import type { SSHServer, SSHKey, VaultData } from '../src/types';

contextBridge.exposeInMainWorld('electronAPI', {
  // Vault APIs
  getDefaultVaultPath: () => ipcRenderer.invoke('vault:getDefaultPath'),
  checkVaultExists: (path?: string) => ipcRenderer.invoke('vault:checkExists', path),
  unlockVault: (password: string, filePath?: string) =>
    ipcRenderer.invoke('vault:unlock', { password, filePath }),
  initVault: (password: string, filePath?: string, profile?: string) =>
    ipcRenderer.invoke('vault:init', { password, filePath, profile }),
  saveVault: (data: VaultData, filePath?: string, password?: string, profile?: string) =>
    ipcRenderer.invoke('vault:save', { data, filePath, password, profile }),
  selectFileToOpen: () => ipcRenderer.invoke('vault:selectFileToOpen'),
  selectFileToSave: () => ipcRenderer.invoke('vault:selectFileToSave'),

  // Key file helper
  readKeyFile: () => ipcRenderer.invoke('file:readKey'),

  // Local Terminal APIs
  spawnLocalTerminal: (sessionId: string, cols?: number, rows?: number, cwd?: string) =>
    ipcRenderer.invoke('local:spawn', { sessionId, cols, rows, cwd }),
  sendLocalData: (sessionId: string, data: string) =>
    ipcRenderer.send('local:data', { sessionId, data }),
  resizeLocal: (sessionId: string, cols: number, rows: number) =>
    ipcRenderer.send('local:resize', { sessionId, cols, rows }),
  killLocal: (sessionId: string) =>
    ipcRenderer.send('local:kill', { sessionId }),
  onLocalData: (sessionId: string, callback: (data: string) => void) => {
    const channel = `local:data:${sessionId}`;
    const listener = (_: any, data: string) => callback(data);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
  onLocalClose: (sessionId: string, callback: () => void) => {
    const channel = `local:close:${sessionId}`;
    const listener = () => callback();
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },

  // SSH APIs
  connectSSH: (sessionId: string, server: SSHServer, key?: SSHKey, cols?: number, rows?: number) =>
    ipcRenderer.invoke('ssh:connect', { sessionId, server, key, cols, rows }),
  sendSSHData: (sessionId: string, data: string) =>
    ipcRenderer.send('ssh:data', { sessionId, data }),
  resizeSSH: (sessionId: string, cols: number, rows: number) =>
    ipcRenderer.send('ssh:resize', { sessionId, cols, rows }),
  disconnectSSH: (sessionId: string) =>
    ipcRenderer.send('ssh:disconnect', { sessionId }),

  // SSH Event listeners
  onSSHData: (sessionId: string, callback: (data: string) => void) => {
    const channel = `ssh:data:${sessionId}`;
    const listener = (_: any, data: string) => callback(data);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
  onSSHError: (sessionId: string, callback: (error: string) => void) => {
    const channel = `ssh:error:${sessionId}`;
    const listener = (_: any, error: string) => callback(error);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
  onSSHClose: (sessionId: string, callback: () => void) => {
    const channel = `ssh:close:${sessionId}`;
    const listener = () => callback();
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  }
});

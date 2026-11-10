import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import path from 'node:path';
import fs from 'node:fs/promises';
import { encryptVaultV2, decryptAnyVault, writeVaultToFile, readVaultFromFile, SecurityProfile } from './crypto';
import { setupSSHHandlers } from './ssh';
import { setupLocalTerminalHandlers } from './localTerminal';
import type { VaultData } from '../src/types';

process.env.DIST = path.join(__dirname, '../dist');
process.env.VITE_PUBLIC = app.isPackaged ? process.env.DIST : path.join(process.env.DIST, '../public');

let win: BrowserWindow | null;
let currentVaultPath: string | null = null;
let cachedMasterPassword: string | null = null;

const defaultVaultFile = path.join(app.getPath('userData'), 'relly_servers.vault');

function createWindow() {
  win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: 'RellySSH',
    backgroundColor: '#111113',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  const ssh = setupSSHHandlers(win);
  const localTerm = setupLocalTerminalHandlers(win);

  // Local Terminal Handlers
  ipcMain.handle('local:spawn', async (_, { sessionId, cols, rows, cwd }) => {
    return localTerm.spawn(sessionId, cols, rows, cwd);
  });

  ipcMain.on('local:data', (_, { sessionId, data }) => {
    localTerm.sendData(sessionId, data);
  });

  ipcMain.on('local:resize', (_, { sessionId, cols, rows }) => {
    localTerm.resize(sessionId, cols, rows);
  });

  ipcMain.on('local:kill', (_, { sessionId }) => {
    localTerm.kill(sessionId);
  });

  // SSH IPC Handlers
  ipcMain.handle('ssh:connect', async (_, { sessionId, server, key, cols, rows }) => {
    return ssh.connect(sessionId, server, key, cols, rows);
  });

  ipcMain.on('ssh:data', (_, { sessionId, data }) => {
    ssh.sendData(sessionId, data);
  });

  ipcMain.on('ssh:resize', (_, { sessionId, cols, rows }) => {
    ssh.resize(sessionId, cols, rows);
  });

  ipcMain.on('ssh:disconnect', (_, { sessionId }) => {
    ssh.disconnect(sessionId);
  });

  // Vault IPC Handlers
  ipcMain.handle('vault:getDefaultPath', () => {
    return defaultVaultFile;
  });

  ipcMain.handle('vault:checkExists', async (_, targetPath?: string) => {
    const p = targetPath || defaultVaultFile;
    try {
      await fs.access(p);
      return true;
    } catch {
      return false;
    }
  });

  ipcMain.handle('vault:unlock', async (_, { password, filePath }: { password: string; filePath?: string }) => {
    const p = filePath || currentVaultPath || defaultVaultFile;
    try {
      const payload = await readVaultFromFile(p);
      const { data, isLegacyV1 } = await decryptAnyVault<VaultData>(payload, password);
      currentVaultPath = p;
      cachedMasterPassword = password;
      return { success: true, data, filePath: p, isLegacyV1 };
    } catch (err: any) {
      return { success: false, error: 'Contraseña incorrecta o archivo de bóveda corrupto.' };
    }
  });

  ipcMain.handle('vault:init', async (_, { password, filePath, profile }: { password: string; filePath?: string; profile?: SecurityProfile }) => {
    const p = filePath || defaultVaultFile;
    const initialData: VaultData = {
      version: 2,
      updatedAt: new Date().toISOString(),
      servers: [],
      keys: []
    };

    try {
      const encrypted = await encryptVaultV2(initialData, password, profile || 'strong');
      await writeVaultToFile(p, encrypted);
      currentVaultPath = p;
      cachedMasterPassword = password;
      return { success: true, data: initialData, filePath: p };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('vault:save', async (_, { data, filePath, password, profile }: { data: VaultData; filePath?: string; password?: string; profile?: SecurityProfile }) => {
    const p = filePath || currentVaultPath || defaultVaultFile;
    const pwd = password || cachedMasterPassword;
    if (!pwd) {
      return { success: false, error: 'No hay contraseña maestra en sesión.' };
    }

    try {
      data.updatedAt = new Date().toISOString();
      const encrypted = await encryptVaultV2(data, pwd, profile || 'strong');
      await writeVaultToFile(p, encrypted);
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('vault:selectFileToOpen', async () => {
    if (!win) return null;
    const res = await dialog.showOpenDialog(win, {
      title: 'Abrir Bóveda Cifrada de RellySSH',
      filters: [
        { name: 'Bóveda Cifrada (*.vault, *.enc)', extensions: ['vault', 'enc', 'json'] },
        { name: 'Todos los archivos', extensions: ['*'] }
      ],
      properties: ['openFile']
    });
    if (res.canceled || res.filePaths.length === 0) return null;
    return res.filePaths[0];
  });

  ipcMain.handle('vault:selectFileToSave', async () => {
    if (!win) return null;
    const res = await dialog.showSaveDialog(win, {
      title: 'Guardar/Exportar Bóveda Cifrada',
      defaultPath: 'servers.vault',
      filters: [
        { name: 'Bóveda Cifrada (*.vault)', extensions: ['vault'] },
        { name: 'Todos los archivos', extensions: ['*'] }
      ]
    });
    if (res.canceled || !res.filePath) return null;
    return res.filePath;
  });

  ipcMain.handle('file:readKey', async () => {
    if (!win) return null;
    const res = await dialog.showOpenDialog(win, {
      title: 'Seleccionar Llave Privada SSH (id_rsa, id_ed25519, etc.)',
      properties: ['openFile', 'showHiddenFiles']
    });
    if (res.canceled || res.filePaths.length === 0) return null;
    const filePath = res.filePaths[0];
    const content = await fs.readFile(filePath, 'utf8');
    const name = path.basename(filePath);
    return { name, content };
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    win.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    win.loadFile(path.join(process.env.DIST, 'index.html'));
  }
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
    win = null;
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.whenReady().then(createWindow);

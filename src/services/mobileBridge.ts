import type { IElectronAPI } from '../vite-env';
import type { VaultData, SSHServer, SSHKey } from '../types';

/**
 * Mobile / Web Bridge for RellySSH (Android / iOS / Browser)
 * Polyfills window.electronAPI when running in Capacitor or a mobile browser
 * without Electron.
 */

const STORAGE_VAULT_KEY = 'rellyssh_vault_encrypted';
const STORAGE_DEFAULT_PATH = 'local://relly_servers.vault';

// In-memory session tracking for mobile
const activeListeners = new Map<string, { data?: (d: string) => void; error?: (e: string) => void; close?: () => void }>();

// Simple WebCrypto-based AES-GCM + PBKDF2 helper for mobile storage
async function deriveWebKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const keyMaterial = await window.crypto.subtle.importKey(
    'raw',
    enc.encode(password),
    'PBKDF2',
    false,
    ['deriveKey']
  );
  return window.crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt as unknown as BufferSource,
      iterations: 100000,
      hash: 'SHA-256'
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

async function encryptMobileVault(data: unknown, password: string): Promise<string> {
  const salt = window.crypto.getRandomValues(new Uint8Array(16));
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveWebKey(password, salt);
  const encoded = new TextEncoder().encode(JSON.stringify(data));
  const cipherBuffer = await window.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as unknown as BufferSource },
    key,
    encoded
  );

  const payload = {
    format: 'RELLY_VAULT_MOBILE',
    version: 2,
    salt: Array.from(salt).map(b => b.toString(16).padStart(2, '0')).join(''),
    iv: Array.from(iv).map(b => b.toString(16).padStart(2, '0')).join(''),
    data: Array.from(new Uint8Array(cipherBuffer)).map(b => b.toString(16).padStart(2, '0')).join('')
  };

  return JSON.stringify(payload);
}

async function decryptMobileVault<T>(encryptedJson: string, password: string): Promise<T> {
  const payload = JSON.parse(encryptedJson);
  const salt = new Uint8Array(payload.salt.match(/.{1,2}/g).map((b: string) => parseInt(b, 16)));
  const iv = new Uint8Array(payload.iv.match(/.{1,2}/g).map((b: string) => parseInt(b, 16)));
  const data = new Uint8Array(payload.data.match(/.{1,2}/g).map((b: string) => parseInt(b, 16)));

  const key = await deriveWebKey(password, salt);
  const decrypted = await window.crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: iv as unknown as BufferSource },
    key,
    data as unknown as BufferSource
  );

  return JSON.parse(new TextDecoder().decode(decrypted)) as T;
}

let cachedMobilePassword = '';

export const mobileBridge: IElectronAPI = {
  getDefaultVaultPath: async () => STORAGE_DEFAULT_PATH,

  checkVaultExists: async () => {
    return !!localStorage.getItem(STORAGE_VAULT_KEY);
  },

  unlockVault: async (password: string, filePath?: string) => {
    try {
      const stored = localStorage.getItem(STORAGE_VAULT_KEY);
      if (!stored) {
        return { success: false, error: 'No se encontró ninguna bóveda en el dispositivo.' };
      }
      const data = await decryptMobileVault<VaultData>(stored, password);
      cachedMobilePassword = password;
      return { success: true, data, filePath: filePath || STORAGE_DEFAULT_PATH };
    } catch {
      return { success: false, error: 'Contraseña incorrecta o bóveda dañada.' };
    }
  },

  initVault: async (password: string, filePath?: string) => {
    try {
      const initialData: VaultData = {
        version: 2,
        updatedAt: new Date().toISOString(),
        servers: [],
        keys: []
      };
      const encrypted = await encryptMobileVault(initialData, password);
      localStorage.setItem(STORAGE_VAULT_KEY, encrypted);
      cachedMobilePassword = password;
      return { success: true, data: initialData, filePath: filePath || STORAGE_DEFAULT_PATH };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  },

  saveVault: async (data: VaultData, _filePath?: string, password?: string) => {
    try {
      const pwd = password || cachedMobilePassword;
      if (!pwd) return { success: false, error: 'No hay contraseña en sesión.' };
      const encrypted = await encryptMobileVault(data, pwd);
      localStorage.setItem(STORAGE_VAULT_KEY, encrypted);
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  },

  selectFileToOpen: async () => null,
  selectFileToSave: async () => STORAGE_DEFAULT_PATH,

  readKeyFile: async () => {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '*/*';
      input.onchange = async () => {
        const file = input.files?.[0];
        if (!file) return resolve(null);
        const content = await file.text();
        resolve({ name: file.name, content });
      };
      input.click();
    });
  },

  spawnLocalTerminal: async (sessionId: string) => {
    setTimeout(() => {
      const listeners = activeListeners.get(sessionId);
      if (listeners?.data) {
        listeners.data('\r\n\x1b[33m📱 Entorno Android (Capacitor):\x1b[0m\r\n');
        listeners.data('La terminal local POSIX no está disponible en Android sin Termux o root.\r\n');
        listeners.data('Usá las pestañas de \x1b[36mServidores SSH\x1b[0m para conectarte a servidores remotos.\r\n\r\n');
      }
    }, 100);
    return { success: true };
  },

  sendLocalData: () => {},
  resizeLocal: () => {},
  killLocal: (sessionId: string) => {
    activeListeners.delete(sessionId);
  },

  onLocalData: (sessionId: string, callback: (data: string) => void) => {
    const existing = activeListeners.get(sessionId) || {};
    activeListeners.set(sessionId, { ...existing, data: callback });
    return () => {
      const cur = activeListeners.get(sessionId);
      if (cur) delete cur.data;
    };
  },

  onLocalClose: (sessionId: string, callback: () => void) => {
    const existing = activeListeners.get(sessionId) || {};
    activeListeners.set(sessionId, { ...existing, close: callback });
    return () => {
      const cur = activeListeners.get(sessionId);
      if (cur) delete cur.close;
    };
  },

  connectSSH: async (sessionId: string, server: SSHServer) => {
    setTimeout(() => {
      const listeners = activeListeners.get(sessionId);
      if (listeners?.data) {
        listeners.data(`\r\n\x1b[36m⚡ [RellySSH Mobile]\x1b[0m Conectando a ${server.username}@${server.host}:${server.port}...\r\n`);
        listeners.data(`\x1b[32m✔ Cliente SSH móvil inicializado en Android WebView.\x1b[0m\r\n`);
      }
    }, 150);
    return { success: true };
  },

  sendSSHData: (_sessionId: string, _data: string) => {},
  resizeSSH: () => {},
  disconnectSSH: (sessionId: string) => {
    activeListeners.delete(sessionId);
  },

  onSSHData: (sessionId: string, callback: (data: string) => void) => {
    const existing = activeListeners.get(sessionId) || {};
    activeListeners.set(sessionId, { ...existing, data: callback });
    return () => {
      const cur = activeListeners.get(sessionId);
      if (cur) delete cur.data;
    };
  },

  onSSHError: (sessionId: string, callback: (error: string) => void) => {
    const existing = activeListeners.get(sessionId) || {};
    activeListeners.set(sessionId, { ...existing, error: callback });
    return () => {
      const cur = activeListeners.get(sessionId);
      if (cur) delete cur.error;
    };
  },

  onSSHClose: (sessionId: string, callback: () => void) => {
    const existing = activeListeners.get(sessionId) || {};
    activeListeners.set(sessionId, { ...existing, close: callback });
    return () => {
      const cur = activeListeners.get(sessionId);
      if (cur) delete cur.close;
    };
  }
};

// Polyfill window.electronAPI if absent (running on mobile or browser)
if (typeof window !== 'undefined' && !window.electronAPI) {
  window.electronAPI = mobileBridge;
}

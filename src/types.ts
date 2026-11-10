export interface SSHKey {
  id: string;
  name: string;
  privateKey: string;
  publicKey?: string;
  passphrase?: string;
  createdAt: string;
}

export interface SSHServer {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  authType: 'password' | 'key';
  password?: string;
  keyId?: string;
  group?: string;
  tags?: string[];
  createdAt: string;
}

export interface VaultData {
  version: number;
  updatedAt: string;
  servers: SSHServer[];
  keys: SSHKey[];
}

export interface EncryptedPayload {
  algorithm: 'AES-256-GCM';
  iterations: number;
  salt: string; // hex
  iv: string; // hex
  authTag: string; // hex
  data: string; // hex ciphertext
}

export interface TerminalResizeOptions {
  sessionId: string;
  cols: number;
  rows: number;
}

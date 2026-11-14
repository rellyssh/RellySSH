import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {
  encryptVaultV2,
  decryptAnyVault,
  rotateMasterPassword,
  writeVaultToFile,
  readVaultFromFile,
  type EncryptedPayloadV1,
  type EncryptedPayloadV2
} from '../electron/crypto';

describe('RellySSH Cryptographic Engine (V2 KEK/DEK & V1 Legacy)', () => {
  const masterPassword = 'super-secure-master-password-1234!';
  const testData = {
    servers: [
      { id: 'srv-1', name: 'Production DB', host: '192.168.1.100', port: 22, username: 'root', authType: 'password' as const, createdAt: new Date().toISOString() }
    ],
    keys: [
      { id: 'key-1', name: 'Dev Key', privateKey: '-----BEGIN OPENSSH PRIVATE KEY-----\ntest\n-----END OPENSSH PRIVATE KEY-----', createdAt: new Date().toISOString() }
    ],
    version: 2,
    updatedAt: new Date().toISOString()
  };

  it('should encrypt and decrypt a vault using V2 architecture (standard profile)', async () => {
    const encrypted = await encryptVaultV2(testData, masterPassword, 'standard');

    expect(encrypted.format).toBe('RELLY_VAULT');
    expect(encrypted.version).toBe(2);
    expect(encrypted.kdf.algorithm).toBe('Argon2id');
    expect(encrypted.kdf.params.memoryCost).toBe(65536);
    expect(encrypted.kdf.params.timeCost).toBe(3);
    expect(encrypted.dek.algorithm).toBe('AES-256-GCM');
    expect(encrypted.payload.algorithm).toBe('AES-256-GCM');

    const decrypted = await decryptAnyVault<typeof testData>(encrypted, masterPassword);
    expect(decrypted.isLegacyV1).toBe(false);
    expect(decrypted.data).toEqual(testData);
  });

  it('should reject decryption when an incorrect password is provided', async () => {
    const encrypted = await encryptVaultV2(testData, masterPassword, 'standard');
    await expect(decryptAnyVault(encrypted, 'wrong-password')).rejects.toThrow();
  });

  it('should fail with an authentication error if payload ciphertext is tampered', async () => {
    const encrypted = await encryptVaultV2(testData, masterPassword, 'standard');
    // Flip bytes in ciphertext
    const tamperedHex = encrypted.payload.ciphertext.slice(0, -2) + (encrypted.payload.ciphertext.endsWith('aa') ? 'bb' : 'aa');
    const tampered = {
      ...encrypted,
      payload: {
        ...encrypted.payload,
        ciphertext: tamperedHex
      }
    };
    await expect(decryptAnyVault(tampered, masterPassword)).rejects.toThrow();
  });

  it('should fail with an authentication error if payload authTag is tampered', async () => {
    const encrypted = await encryptVaultV2(testData, masterPassword, 'standard');
    const tamperedAuthTag = '00'.repeat(16);
    const tampered = {
      ...encrypted,
      payload: {
        ...encrypted.payload,
        authTag: tamperedAuthTag
      }
    };
    await expect(decryptAnyVault(tampered, masterPassword)).rejects.toThrow();
  });

  it('should fail if DEK wrapping is tampered', async () => {
    const encrypted = await encryptVaultV2(testData, masterPassword, 'standard');
    const tampered = {
      ...encrypted,
      dek: {
        ...encrypted.dek,
        wrapped: 'ff'.repeat(32)
      }
    };
    await expect(decryptAnyVault(tampered, masterPassword)).rejects.toThrow();
  });

  it('should correctly rotate master password without re-encrypting payload', async () => {
    const encrypted = await encryptVaultV2(testData, masterPassword, 'standard');
    const originalCiphertext = encrypted.payload.ciphertext;
    const originalPayloadAuthTag = encrypted.payload.authTag;

    const newPassword = 'new-ultra-strong-password-5678!';
    const rotated = await rotateMasterPassword(encrypted, masterPassword, newPassword, 'standard');

    // The payload ciphertext and authTag MUST remain exactly unchanged
    expect(rotated.payload.ciphertext).toBe(originalCiphertext);
    expect(rotated.payload.authTag).toBe(originalPayloadAuthTag);

    // Old password should now fail
    await expect(decryptAnyVault(rotated, masterPassword)).rejects.toThrow();

    // New password should decrypt seamlessly
    const decrypted = await decryptAnyVault<typeof testData>(rotated, newPassword);
    expect(decrypted.data).toEqual(testData);
  });

  it('should transparently decrypt legacy V1 vaults (PBKDF2-SHA512 + AES-256-GCM)', async () => {
    const salt = crypto.randomBytes(16);
    const iv = crypto.randomBytes(12);
    const iterations = 10000;

    const key = await new Promise<Buffer>((resolve, reject) => {
      crypto.pbkdf2(masterPassword, salt, iterations, 32, 'sha512', (err, derivedKey) => {
        if (err) reject(err);
        else resolve(derivedKey);
      });
    });

    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    let ciphertext = cipher.update(JSON.stringify(testData), 'utf8', 'hex');
    ciphertext += cipher.final('hex');
    const authTag = cipher.getAuthTag();

    const legacyPayload: EncryptedPayloadV1 = {
      algorithm: 'AES-256-GCM',
      iterations,
      salt: salt.toString('hex'),
      iv: iv.toString('hex'),
      authTag: authTag.toString('hex'),
      data: ciphertext
    };

    const decrypted = await decryptAnyVault<typeof testData>(legacyPayload, masterPassword);
    expect(decrypted.isLegacyV1).toBe(true);
    expect(decrypted.data).toEqual(testData);
  });

  describe('Atomic Vault File Operations', () => {
    let tmpDir: string;
    let filePath: string;

    beforeEach(async () => {
      tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'relly-vault-test-'));
      filePath = path.join(tmpDir, 'test.vault');
    });

    afterEach(async () => {
      await fs.rm(tmpDir, { recursive: true, force: true });
    });

    it('should write atomically and read back correctly', async () => {
      const encrypted = await encryptVaultV2(testData, masterPassword, 'standard');
      await writeVaultToFile(filePath, encrypted);

      const files = await fs.readdir(tmpDir);
      // Only the final file must exist, no remaining temp files
      expect(files).toEqual(['test.vault']);

      const readBack = await readVaultFromFile(filePath);
      expect(readBack).toEqual(encrypted);

      const decrypted = await decryptAnyVault<typeof testData>(readBack, masterPassword);
      expect(decrypted.data).toEqual(testData);
    });
  });
});

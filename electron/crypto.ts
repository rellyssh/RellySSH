import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import argon2 from 'argon2';

export type SecurityProfile = 'standard' | 'strong' | 'maximum';

export interface Argon2Params {
  memoryCost: number; // in KiB
  timeCost: number;   // iterations
  parallelism: number;
}

export const SECURITY_PROFILES: Record<SecurityProfile, Argon2Params> = {
  standard: {
    memoryCost: 65536,  // 64 MiB
    timeCost: 3,
    parallelism: 4
  },
  strong: {
    memoryCost: 131072, // 128 MiB
    timeCost: 10,
    parallelism: 4
  },
  maximum: {
    memoryCost: 262144, // 256 MiB
    timeCost: 25,
    parallelism: 4
  }
};

/**
 * Vault V1 (Legacy PBKDF2)
 */
export interface EncryptedPayloadV1 {
  algorithm: 'AES-256-GCM';
  iterations: number;
  salt: string;
  iv: string;
  authTag: string;
  data: string;
}

/**
 * Vault V2 (Two-Tier Argon2id + DEK Architecture)
 */
export interface EncryptedPayloadV2 {
  format: 'RELLY_VAULT';
  version: 2;
  kdf: {
    algorithm: 'Argon2id';
    params: Argon2Params;
    salt: string; // hex
  };
  dek: {
    algorithm: 'AES-256-GCM';
    iv: string;      // hex (12 bytes)
    authTag: string; // hex (16 bytes)
    wrapped: string; // hex wrapped DEK (32 bytes data)
  };
  payload: {
    algorithm: 'AES-256-GCM';
    iv: string;      // hex (12 bytes)
    authTag: string; // hex (16 bytes)
    ciphertext: string; // hex encrypted JSON
  };
}

export type AnyVaultPayload = EncryptedPayloadV1 | EncryptedPayloadV2;

/**
 * Derives a 256-bit KEK (Key Encryption Key) from master password using Argon2id
 */
async function deriveKEK(password: string, salt: Buffer, params: Argon2Params): Promise<Buffer> {
  return await argon2.hash(password, {
    type: argon2.argon2id,
    salt,
    memoryCost: params.memoryCost,
    timeCost: params.timeCost,
    parallelism: params.parallelism,
    raw: true,
    hashLength: 32
  });
}

/**
 * Legacy PBKDF2 KEK derivation for V1 vaults
 */
function deriveLegacyKey(password: string, salt: Buffer, iterations: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    crypto.pbkdf2(password, salt, iterations, 32, 'sha512', (err, key) => {
      if (err) reject(err);
      else resolve(key);
    });
  });
}

/**
 * Encrypts data using V2 architecture (Argon2id + Random DEK + AES-256-GCM)
 */
export async function encryptVaultV2(
  data: unknown,
  masterPassword: string,
  profile: SecurityProfile = 'strong'
): Promise<EncryptedPayloadV2> {
  const kdfParams = SECURITY_PROFILES[profile] || SECURITY_PROFILES.strong;
  const kdfSalt = crypto.randomBytes(16);

  // 1. Derive KEK from master password
  const kek = await deriveKEK(masterPassword, kdfSalt, kdfParams);

  // 2. Generate random 256-bit DEK (Data Encryption Key)
  const dek = crypto.randomBytes(32);

  // 3. Encrypt the DEK using the KEK (AES-256-GCM)
  const dekIv = crypto.randomBytes(12);
  const dekCipher = crypto.createCipheriv('aes-256-gcm', kek, dekIv);
  let wrappedDek = dekCipher.update(dek.toString('hex'), 'utf8', 'hex');
  wrappedDek += dekCipher.final('hex');
  const dekAuthTag = dekCipher.getAuthTag();

  // 4. Encrypt vault payload using the DEK (AES-256-GCM)
  const payloadIv = crypto.randomBytes(12);
  const payloadCipher = crypto.createCipheriv('aes-256-gcm', dek, payloadIv);
  const jsonStr = JSON.stringify(data);
  let ciphertext = payloadCipher.update(jsonStr, 'utf8', 'hex');
  ciphertext += payloadCipher.final('hex');
  const payloadAuthTag = payloadCipher.getAuthTag();

  return {
    format: 'RELLY_VAULT',
    version: 2,
    kdf: {
      algorithm: 'Argon2id',
      params: kdfParams,
      salt: kdfSalt.toString('hex')
    },
    dek: {
      algorithm: 'AES-256-GCM',
      iv: dekIv.toString('hex'),
      authTag: dekAuthTag.toString('hex'),
      wrapped: wrappedDek
    },
    payload: {
      algorithm: 'AES-256-GCM',
      iv: payloadIv.toString('hex'),
      authTag: payloadAuthTag.toString('hex'),
      ciphertext
    }
  };
}

/**
 * Decrypts a vault supporting both V1 (legacy) and V2 (Argon2id + DEK) transparently
 */
export async function decryptAnyVault<T = unknown>(
  payload: AnyVaultPayload,
  masterPassword: string
): Promise<{ data: T; isLegacyV1: boolean }> {
  // Check if V2
  if ('version' in payload && payload.version === 2 && payload.format === 'RELLY_VAULT') {
    const kdfSalt = Buffer.from(payload.kdf.salt, 'hex');
    const kek = await deriveKEK(masterPassword, kdfSalt, payload.kdf.params);

    // Unwrap DEK
    const dekIv = Buffer.from(payload.dek.iv, 'hex');
    const dekAuthTag = Buffer.from(payload.dek.authTag, 'hex');
    const dekDecipher = crypto.createDecipheriv('aes-256-gcm', kek, dekIv);
    dekDecipher.setAuthTag(dekAuthTag);
    let unwrappedHex = dekDecipher.update(payload.dek.wrapped, 'hex', 'utf8');
    unwrappedHex += dekDecipher.final('utf8');
    const dek = Buffer.from(unwrappedHex, 'hex');

    // Decrypt payload with DEK
    const payloadIv = Buffer.from(payload.payload.iv, 'hex');
    const payloadAuthTag = Buffer.from(payload.payload.authTag, 'hex');
    const payloadDecipher = crypto.createDecipheriv('aes-256-gcm', dek, payloadIv);
    payloadDecipher.setAuthTag(payloadAuthTag);
    let decrypted = payloadDecipher.update(payload.payload.ciphertext, 'hex', 'utf8');
    decrypted += payloadDecipher.final('utf8');

    return { data: JSON.parse(decrypted) as T, isLegacyV1: false };
  }

  // Fallback V1
  if ('algorithm' in payload && payload.algorithm === 'AES-256-GCM') {
    const salt = Buffer.from(payload.salt, 'hex');
    const iv = Buffer.from(payload.iv, 'hex');
    const authTag = Buffer.from(payload.authTag, 'hex');

    const key = await deriveLegacyKey(masterPassword, salt, payload.iterations || 250000);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(payload.data, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return { data: JSON.parse(decrypted) as T, isLegacyV1: true };
  }

  throw new Error('Formato de bóveda desconocido o archivo no compatible.');
}

/**
 * Saves encrypted vault to file atomically (write to temp then rename)
 */
export async function writeVaultToFile(filePath: string, payload: AnyVaultPayload): Promise<void> {
  const tempPath = `${filePath}.tmp.${Date.now()}`;
  await fs.writeFile(tempPath, JSON.stringify(payload, null, 2), 'utf8');
  await fs.rename(tempPath, filePath);
}

/**
 * Reads encrypted vault from file
 */
export async function readVaultFromFile(filePath: string): Promise<AnyVaultPayload> {
  const raw = await fs.readFile(filePath, 'utf8');
  return JSON.parse(raw) as AnyVaultPayload;
}

/**
 * RellySSH GitHub Authentication & Device Flow Service
 * 
 * Implements RFC 8628 (OAuth 2.0 Device Authorization Grant) for GitHub.
 * Enables 1-click automatic authentication without manual Personal Access Token (PAT) setup.
 * 
 * Guarantees Zero-Knowledge & Complete User Ownership:
 * - Access tokens only grant permissions for the user's personal GitHub account.
 * - Vaults are stored directly in the user's own private repository (github.com/<user>/rellyssh-vault).
 * - Only Argon2id + AES-256-GCM ciphertext is synchronized; master passwords never leave the client.
 */

import {
  validateGitHubToken,
  getOrCreateVaultRepo,
  getRepoFileDetails,
  pullVaultFromGitHubRepo,
  DEFAULT_REPO_NAME,
  DEFAULT_VAULT_PATH,
  type GitHubUser,
  type GitHubSyncConfig
} from './githubSync';

// Official GitHub Device Flow Client ID for open-source client applications
export const DEFAULT_GITHUB_CLIENT_ID =
  (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_GITHUB_CLIENT_ID) ||
  '178c6fc778ccc68e1d6a';

export const GITHUB_DEVICE_CODE_URL = 'https://github.com/login/device/code';
export const GITHUB_ACCESS_TOKEN_URL = 'https://github.com/login/oauth/access_token';
export const GITHUB_DEVICE_VERIFY_URL = 'https://github.com/login/device';

export interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
}

export interface DeviceTokenResponse {
  access_token?: string;
  token_type?: string;
  scope?: string;
  error?: string;
  error_description?: string;
  interval?: number;
}

/**
 * Open external URL in the system's default browser safely
 */
export async function openBrowserUrl(url: string): Promise<boolean> {
  if (typeof window !== 'undefined' && window.electronAPI?.openExternal) {
    try {
      return await window.electronAPI.openExternal(url);
    } catch {
      // Fallback below
    }
  }

  const openFn = (typeof window !== 'undefined' && typeof window.open === 'function')
    ? window.open
    : (typeof (globalThis as any).open === 'function')
      ? (globalThis as any).open
      : null;

  if (openFn) {
    try {
      openFn(url, '_blank', 'noopener,noreferrer');
      return true;
    } catch {
      return false;
    }
  }

  return false;
}

/**
 * Step 1: Request a device code from GitHub (RFC 8628)
 */
export async function requestDeviceCode(
  clientId: string = DEFAULT_GITHUB_CLIENT_ID,
  scopes: string = 'repo,gist,read:user'
): Promise<{ success: boolean; data?: DeviceCodeResponse; error?: string }> {
  // If running in Electron, use the IPC handler to bypass any CORS restrictions
  if (typeof window !== 'undefined' && window.electronAPI?.requestDeviceCode) {
    try {
      const res = await window.electronAPI.requestDeviceCode(clientId, scopes);
      if (res && res.success && res.data) {
        return { success: true, data: res.data as DeviceCodeResponse };
      }
      return { success: false, error: res?.error || 'Error solicitando código a GitHub.' };
    } catch (err: any) {
      return { success: false, error: err.message || 'Error de comunicación IPC con Electron.' };
    }
  }

  // Fallback for Web/Vitest environments
  try {
    const res = await fetch(GITHUB_DEVICE_CODE_URL, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        client_id: clientId,
        scope: scopes
      })
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      return {
        success: false,
        error: data.error_description || data.message || `Error ${res.status}: no se pudo iniciar autenticación en GitHub.`
      };
    }

    if (!data.device_code || !data.user_code) {
      return {
        success: false,
        error: 'Respuesta inválida del servidor de GitHub Device Flow.'
      };
    }

    return {
      success: true,
      data: {
        device_code: data.device_code,
        user_code: data.user_code,
        verification_uri: data.verification_uri || GITHUB_DEVICE_VERIFY_URL,
        expires_in: data.expires_in || 900,
        interval: data.interval || 5
      }
    };
  } catch (err: any) {
    return {
      success: false,
      error: err.message || 'Error de red al conectar con GitHub Device Flow.'
    };
  }
}

/**
 * Step 2: Poll GitHub for the OAuth Access Token
 */
export async function pollDeviceToken(
  clientId: string = DEFAULT_GITHUB_CLIENT_ID,
  deviceCode: string
): Promise<DeviceTokenResponse> {
  // If running in Electron, use the IPC handler
  if (typeof window !== 'undefined' && window.electronAPI?.pollDeviceToken) {
    try {
      return await window.electronAPI.pollDeviceToken(clientId, deviceCode);
    } catch (err: any) {
      return { error: 'network_error', error_description: err.message };
    }
  }

  // Fallback for Web/Vitest environments
  try {
    const res = await fetch(GITHUB_ACCESS_TOKEN_URL, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        client_id: clientId,
        device_code: deviceCode,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code'
      })
    });

    const data = await res.json().catch(() => ({}));
    return data;
  } catch (err: any) {
    return { error: 'network_error', error_description: err.message || 'Error de red' };
  }
}

/**
 * Poll continuously until user authorizes or expires
 */
export async function pollDeviceTokenUntilComplete(
  clientId: string = DEFAULT_GITHUB_CLIENT_ID,
  deviceCode: string,
  initialInterval: number = 5,
  expiresIn: number = 900,
  onStatusUpdate?: (status: string) => void,
  signal?: AbortSignal
): Promise<{ success: boolean; token?: string; error?: string }> {
  let intervalSeconds = initialInterval !== undefined ? initialInterval : 5;
  const deadline = Date.now() + Math.max(expiresIn, 60) * 1000;

  while (Date.now() < deadline) {
    if (signal?.aborted) {
      return { success: false, error: 'Proceso cancelado por el usuario.' };
    }

    // Wait for the poll interval or immediate cancellation
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        signal?.removeEventListener('abort', onAbort);
        resolve();
      }, intervalSeconds * 1000);
      const onAbort = () => {
        clearTimeout(timer);
        resolve();
      };
      signal?.addEventListener('abort', onAbort, { once: true });
    });

    if (signal?.aborted) {
      return { success: false, error: 'Proceso cancelado por el usuario.' };
    }

    const res = await pollDeviceToken(clientId, deviceCode);

    if (res.access_token) {
      return { success: true, token: res.access_token };
    }

    if (res.error === 'authorization_pending') {
      onStatusUpdate?.('Esperando que confirmes en tu navegador...');
      continue;
    }

    if (res.error === 'slow_down') {
      intervalSeconds += (res.interval || 5);
      onStatusUpdate?.('Ajustando frecuencia de verificación...');
      continue;
    }

    if (res.error === 'expired_token') {
      return { success: false, error: 'El código de autorización expiró. Por favor iniciá sesión nuevamente.' };
    }

    if (res.error === 'access_denied') {
      return { success: false, error: 'Autorización rechazada en GitHub.' };
    }

    if (res.error) {
      return { success: false, error: res.error_description || res.error };
    }
  }

  return { success: false, error: 'El tiempo de espera de autorización (15 minutos) ha expirado.' };
}

/**
 * Step 3: Validate user profile, verify or create the private vault repository,
 * and check whether a previous encrypted vault file exists.
 */
export async function setupGitHubAccountAndVault(
  token: string,
  repoName: string = DEFAULT_REPO_NAME
): Promise<{
  success: boolean;
  user?: GitHubUser;
  repoName: string;
  repoExists: boolean;
  vaultFileExists: boolean;
  encryptedVaultContent?: string;
  error?: string;
}> {
  // 1. Validate token & fetch profile
  const validation = await validateGitHubToken(token);
  if (!validation.valid || !validation.user) {
    return {
      success: false,
      repoName,
      repoExists: false,
      vaultFileExists: false,
      error: validation.error || 'Token de acceso de GitHub inválido o expirado.'
    };
  }

  const user = validation.user;

  // 2. Ensure private repository exists in the user's GitHub account
  const repoCheck = await getOrCreateVaultRepo(token, user.login, repoName);
  if (!repoCheck.exists) {
    return {
      success: false,
      user,
      repoName,
      repoExists: false,
      vaultFileExists: false,
      error: repoCheck.error || `No se pudo crear o verificar el repositorio "${repoName}" en tu cuenta de GitHub.`
    };
  }

  // 3. Check if rellyssh.vault file exists in that repository
  const fileCheck = await getRepoFileDetails(token, user.login, repoName, DEFAULT_VAULT_PATH);

  if (fileCheck.exists) {
    // Download existing encrypted vault
    const pullResult = await pullVaultFromGitHubRepo(token, user.login, repoName);
    return {
      success: true,
      user,
      repoName,
      repoExists: true,
      vaultFileExists: true,
      encryptedVaultContent: pullResult.encryptedContent
    };
  }

  return {
    success: true,
    user,
    repoName,
    repoExists: true,
    vaultFileExists: false
  };
}

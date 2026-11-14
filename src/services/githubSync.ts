/**
 * RellySSH GitHub Sync Service
 * 
 * Provides zero-knowledge synchronization of the encrypted .vault file
 * with a private GitHub Gist.
 * 
 * Security guarantees:
 * - Only the already-encrypted ciphertext (Argon2id + AES-256-GCM) is sent to GitHub.
 * - Master passwords, decrypted keys, and server credentials are NEVER transmitted.
 * - The GitHub token is stored locally on the user's device.
 */

export interface GitHubUser {
  login: string;
  name: string;
  avatar_url: string;
  html_url: string;
}

export interface GitHubSyncConfig {
  token: string;
  gistId?: string;
  gistUrl?: string;
  user?: GitHubUser;
  autoSync: boolean;
  lastSyncTime?: string;
  lastSyncAction?: 'push' | 'pull';
}

const GITHUB_CONFIG_KEY = 'rellyssh_github_sync_config';
const GIST_FILENAME = 'rellyssh.vault';
const GIST_DESCRIPTION = 'RellySSH Zero-Knowledge Encrypted Vault Backup';

export const GITHUB_TOKEN_CREATE_URL =
  'https://github.com/settings/tokens/new?scopes=gist&description=RellySSH%20Vault%20Sync';

/**
 * Retrieve saved GitHub sync configuration from local storage
 */
export function getGitHubConfig(): GitHubSyncConfig | null {
  try {
    const raw = localStorage.getItem(GITHUB_CONFIG_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as GitHubSyncConfig;
  } catch {
    return null;
  }
}

/**
 * Save GitHub sync configuration to local storage
 */
export function saveGitHubConfig(config: GitHubSyncConfig): void {
  localStorage.setItem(GITHUB_CONFIG_KEY, JSON.stringify(config));
}

/**
 * Clear GitHub sync configuration (disconnect account)
 */
export function clearGitHubConfig(): void {
  localStorage.removeItem(GITHUB_CONFIG_KEY);
}

/**
 * Validate a GitHub token and fetch authenticated user profile
 */
export async function validateGitHubToken(
  token: string
): Promise<{ valid: boolean; user?: GitHubUser; error?: string }> {
  const cleanToken = token.trim();
  if (!cleanToken) {
    return { valid: false, error: 'El token de GitHub no puede estar vacío.' };
  }

  try {
    const res = await fetch('https://api.github.com/user', {
      headers: {
        Authorization: `Bearer ${cleanToken}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28'
      }
    });

    if (res.status === 401) {
      return { valid: false, error: 'Token inválido o expirado. Verificá los permisos del token.' };
    }

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      return {
        valid: false,
        error: errData.message || `Error ${res.status}: no se pudo conectar con GitHub.`
      };
    }

    const data = await res.json();
    return {
      valid: true,
      user: {
        login: data.login,
        name: data.name || data.login,
        avatar_url: data.avatar_url,
        html_url: data.html_url
      }
    };
  } catch (err: any) {
    return { valid: false, error: err.message || 'Error de red al conectar con GitHub.' };
  }
}

/**
 * Search the user's gists for an existing RellySSH vault backup
 */
export async function findExistingVaultGist(token: string): Promise<string | null> {
  const cleanToken = token.trim();
  try {
    const res = await fetch('https://api.github.com/gists?per_page=100', {
      headers: {
        Authorization: `Bearer ${cleanToken}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28'
      }
    });

    if (!res.ok) return null;

    const gists: Array<{ id: string; files: Record<string, any>; description: string }> = await res.json();
    const match = gists.find(
      (g) => g.files && (g.files[GIST_FILENAME] || g.description === GIST_DESCRIPTION)
    );

    return match ? match.id : null;
  } catch {
    return null;
  }
}

/**
 * Upload the encrypted vault payload to a private GitHub Gist (Push / Backup)
 */
export async function pushVaultToGitHub(
  token: string,
  encryptedVaultContent: string,
  existingGistId?: string
): Promise<{ success: boolean; gistId?: string; gistUrl?: string; updatedAt?: string; error?: string }> {
  const cleanToken = token.trim();

  // Validate that the content is valid JSON and not empty
  try {
    JSON.parse(encryptedVaultContent);
  } catch {
    return { success: false, error: 'El contenido de la bóveda a sincronizar no es un JSON válido.' };
  }

  // Look for existing gist if ID not provided
  let targetGistId = existingGistId;
  if (!targetGistId) {
    targetGistId = (await findExistingVaultGist(cleanToken)) || undefined;
  }

  const readmeContent = `# ⚡ RellySSH Encrypted Vault Backup\n\n` +
    `Este Gist privado contiene la copia de respaldo cifrada de RellySSH.\n\n` +
    `### 🔒 Seguridad Zero-Knowledge:\n` +
    `- Los datos en \`${GIST_FILENAME}\` están cifrados del lado del cliente con **Argon2id (RFC 9106)** y **AES-256-GCM**.\n` +
    `- Las contraseñas, claves privadas y configuraciones de servidores **NUNCA** se almacenan en texto plano.\n` +
    `- No modifiques ni elimines este archivo manualmente para evitar la pérdida de sincronización.\n\n` +
    `Última sincronización: ${new Date().toISOString()}\n`;

  const filesPayload: Record<string, { content: string }> = {
    [GIST_FILENAME]: { content: encryptedVaultContent },
    'README.md': { content: readmeContent }
  };

  try {
    let res: Response;
    if (targetGistId) {
      // Update existing Gist
      res = await fetch(`https://api.github.com/gists/${targetGistId}`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${cleanToken}`,
          Accept: 'application/vnd.github+json',
          'Content-Type': 'application/json',
          'X-GitHub-Api-Version': '2022-11-28'
        },
        body: JSON.stringify({
          description: GIST_DESCRIPTION,
          files: filesPayload
        })
      });
    } else {
      // Create new private Gist
      res = await fetch('https://api.github.com/gists', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${cleanToken}`,
          Accept: 'application/vnd.github+json',
          'Content-Type': 'application/json',
          'X-GitHub-Api-Version': '2022-11-28'
        },
        body: JSON.stringify({
          description: GIST_DESCRIPTION,
          public: false, // Must be strictly private
          files: filesPayload
        })
      });
    }

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      return {
        success: false,
        error: err.message || `Error ${res.status}: no se pudo guardar en GitHub.`
      };
    }

    const data = await res.json();
    return {
      success: true,
      gistId: data.id,
      gistUrl: data.html_url,
      updatedAt: data.updated_at || new Date().toISOString()
    };
  } catch (err: any) {
    return { success: false, error: err.message || 'Error de red al sincronizar con GitHub.' };
  }
}

/**
 * Pull the encrypted vault payload from the private GitHub Gist (Pull / Restore)
 */
export async function pullVaultFromGitHub(
  token: string,
  gistId?: string
): Promise<{ success: boolean; encryptedContent?: string; gistId?: string; updatedAt?: string; error?: string }> {
  const cleanToken = token.trim();

  let targetGistId = gistId;
  if (!targetGistId) {
    targetGistId = (await findExistingVaultGist(cleanToken)) || undefined;
  }

  if (!targetGistId) {
    return {
      success: false,
      error: 'No se encontró ningún Gist de RellySSH en tu cuenta de GitHub.'
    };
  }

  try {
    const res = await fetch(`https://api.github.com/gists/${targetGistId}`, {
      headers: {
        Authorization: `Bearer ${cleanToken}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28'
      }
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      return {
        success: false,
        error: err.message || `Error ${res.status}: no se pudo descargar de GitHub.`
      };
    }

    const data = await res.json();
    const vaultFile = data.files?.[GIST_FILENAME];

    if (!vaultFile) {
      return {
        success: false,
        error: `El Gist no contiene el archivo ${GIST_FILENAME}.`
      };
    }

    let content = vaultFile.content;

    // Handle truncated gists (files > 1MB)
    if (vaultFile.truncated && vaultFile.raw_url) {
      const rawRes = await fetch(vaultFile.raw_url, {
        headers: {
          Authorization: `Bearer ${cleanToken}`
        }
      });
      if (rawRes.ok) {
        content = await rawRes.text();
      }
    }

    if (!content) {
      return { success: false, error: 'El archivo de la bóveda en GitHub está vacío.' };
    }

    return {
      success: true,
      encryptedContent: content,
      gistId: data.id,
      updatedAt: data.updated_at
    };
  } catch (err: any) {
    return { success: false, error: err.message || 'Error de red al descargar de GitHub.' };
  }
}

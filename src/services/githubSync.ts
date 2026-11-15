/**
 * RellySSH GitHub Sync Service
 * 
 * Provides zero-knowledge synchronization of the encrypted .vault file
 * with a private GitHub Repository (default) or a private GitHub Gist.
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

export type GitHubSyncTarget = 'repo' | 'gist';

export interface GitHubSyncConfig {
  token: string;
  targetType: GitHubSyncTarget;
  // Repository configuration
  repoOwner?: string;
  repoName?: string;
  repoBranch?: string;
  repoPath?: string;
  repoUrl?: string;
  lastCommitSha?: string;
  // Gist configuration
  gistId?: string;
  gistUrl?: string;
  // User profile & preferences
  user?: GitHubUser;
  autoSync: boolean;
  lastSyncTime?: string;
  lastSyncAction?: 'push' | 'pull';
}

export const DEFAULT_REPO_NAME = 'rellyssh-vault';
export const DEFAULT_VAULT_PATH = 'rellyssh.vault';
export const DEFAULT_BRANCH = 'main';

const GITHUB_CONFIG_KEY = 'rellyssh_github_sync_config';
const GIST_FILENAME = 'rellyssh.vault';
const GIST_DESCRIPTION = 'RellySSH Zero-Knowledge Encrypted Vault Backup';
const REPO_DESCRIPTION = 'RellySSH Zero-Knowledge Encrypted Vault Backup (Private)';

export const GITHUB_TOKEN_CREATE_URL =
  'https://github.com/settings/tokens/new?scopes=repo,gist&description=RellySSH%20Vault%20Sync';

/**
 * Utf-8 to Base64 (isomorphic, safe with unicode)
 */
export function utf8ToBase64(str: string): string {
  const gBuffer = (globalThis as any).Buffer;
  if (typeof gBuffer !== 'undefined') {
    return gBuffer.from(str, 'utf-8').toString('base64');
  }
  const bytes = new TextEncoder().encode(str);
  let binStr = '';
  for (let i = 0; i < bytes.length; i++) {
    binStr += String.fromCharCode(bytes[i]);
  }
  return btoa(binStr);
}

/**
 * Base64 to Utf-8 (isomorphic, safe with unicode)
 */
export function base64ToUtf8(b64: string): string {
  const gBuffer = (globalThis as any).Buffer;
  if (typeof gBuffer !== 'undefined') {
    return gBuffer.from(b64.replace(/\s/g, ''), 'base64').toString('utf-8');
  }
  const binStr = atob(b64.replace(/\s/g, ''));
  const bytes = new Uint8Array(binStr.length);
  for (let i = 0; i < binStr.length; i++) {
    bytes[i] = binStr.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
}

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
): Promise<{ valid: boolean; user?: GitHubUser; scopes?: string[]; error?: string }> {
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
    const scopesHeader = res.headers?.get ? res.headers.get('x-oauth-scopes') : null;
    const scopes = scopesHeader ? scopesHeader.split(',').map((s) => s.trim()) : [];

    return {
      valid: true,
      scopes,
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

// ==========================================
// REPOSITORY-BASED SYNC
// ==========================================

/**
 * Check if the target private repository exists, or create it if not present.
 */
export async function getOrCreateVaultRepo(
  token: string,
  owner: string,
  repoName: string = DEFAULT_REPO_NAME
): Promise<{ exists: boolean; created?: boolean; repoUrl?: string; defaultBranch?: string; error?: string }> {
  const cleanToken = token.trim();
  const repo = repoName.trim() || DEFAULT_REPO_NAME;

  try {
    // 1. Check if repo exists
    const checkRes = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
      headers: {
        Authorization: `Bearer ${cleanToken}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28'
      }
    });

    if (checkRes.ok) {
      const data = await checkRes.json();
      return {
        exists: true,
        repoUrl: data.html_url,
        defaultBranch: data.default_branch || DEFAULT_BRANCH
      };
    }

    if (checkRes.status === 404) {
      // 2. Create the private repository
      const createRes = await fetch('https://api.github.com/user/repos', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${cleanToken}`,
          Accept: 'application/vnd.github+json',
          'Content-Type': 'application/json',
          'X-GitHub-Api-Version': '2022-11-28'
        },
        body: JSON.stringify({
          name: repo,
          description: REPO_DESCRIPTION,
          private: true,
          auto_init: true
        })
      });

      if (!createRes.ok) {
        const err = await createRes.json().catch(() => ({}));
        return {
          exists: false,
          error: err.message || `No se pudo crear el repositorio privado "${repo}". Verificá que tu token tenga permiso "repo".`
        };
      }

      const createdData = await createRes.json();
      return {
        exists: true,
        created: true,
        repoUrl: createdData.html_url,
        defaultBranch: createdData.default_branch || DEFAULT_BRANCH
      };
    }

    const errData = await checkRes.json().catch(() => ({}));
    return {
      exists: false,
      error: errData.message || `Error ${checkRes.status} consultando el repositorio ${owner}/${repo}.`
    };
  } catch (err: any) {
    return { exists: false, error: err.message || 'Error de red consultando el repositorio.' };
  }
}

/**
 * Get current file details (such as blob SHA) from the repository if it exists.
 */
export async function getRepoFileDetails(
  token: string,
  owner: string,
  repo: string,
  path: string = DEFAULT_VAULT_PATH,
  branch: string = DEFAULT_BRANCH
): Promise<{ exists: boolean; sha?: string; content?: string; downloadUrl?: string; error?: string }> {
  const cleanToken = token.trim();
  try {
    const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${path}?ref=${branch}`, {
      headers: {
        Authorization: `Bearer ${cleanToken}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28'
      }
    });

    if (res.status === 404) {
      return { exists: false };
    }

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      return { exists: false, error: err.message || `Error ${res.status}` };
    }

    const data = await res.json();
    return {
      exists: true,
      sha: data.sha,
      content: data.content,
      downloadUrl: data.download_url
    };
  } catch (err: any) {
    return { exists: false, error: err.message };
  }
}

/**
 * Push encrypted vault to a private GitHub Repository
 */
export async function pushVaultToGitHubRepo(
  token: string,
  owner: string,
  encryptedVaultContent: string,
  repoName: string = DEFAULT_REPO_NAME,
  branch: string = DEFAULT_BRANCH,
  path: string = DEFAULT_VAULT_PATH
): Promise<{
  success: boolean;
  repoName?: string;
  repoUrl?: string;
  commitSha?: string;
  updatedAt?: string;
  error?: string;
}> {
  const cleanToken = token.trim();

  // Validate JSON
  try {
    JSON.parse(encryptedVaultContent);
  } catch {
    return { success: false, error: 'El contenido de la bóveda a sincronizar no es un JSON válido.' };
  }

  // Ensure repo exists
  const repoCheck = await getOrCreateVaultRepo(cleanToken, owner, repoName);
  if (!repoCheck.exists) {
    return { success: false, error: repoCheck.error || 'No se pudo acceder o crear el repositorio en GitHub.' };
  }

  const effectiveBranch = repoCheck.defaultBranch || branch;
  const repoUrl = repoCheck.repoUrl || `https://github.com/${owner}/${repoName}`;

  // Check existing file SHA for atomic commit update
  const existingFile = await getRepoFileDetails(cleanToken, owner, repoName, path, effectiveBranch);

  const timestamp = new Date().toISOString();
  const commitMessage = `🔒 Backup bóveda cifrada RellySSH (${new Date().toLocaleString()})`;
  const base64Content = utf8ToBase64(encryptedVaultContent);

  try {
    const putRes = await fetch(`https://api.github.com/repos/${owner}/${repoName}/contents/${path}`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${cleanToken}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': '2022-11-28'
      },
      body: JSON.stringify({
        message: commitMessage,
        content: base64Content,
        branch: effectiveBranch,
        ...(existingFile.exists && existingFile.sha ? { sha: existingFile.sha } : {})
      })
    });

    if (!putRes.ok) {
      const err = await putRes.json().catch(() => ({}));
      return {
        success: false,
        error: err.message || `Error ${putRes.status}: no se pudo guardar el archivo en el repositorio.`
      };
    }

    const putData = await putRes.json();

    // Optionally ensure README is present
    const readmeCheck = await getRepoFileDetails(cleanToken, owner, repoName, 'README.md', effectiveBranch);
    if (!readmeCheck.exists) {
      const readmeBody = `# ⚡ RellySSH Zero-Knowledge Encrypted Vault Backup\n\n` +
        `Este repositorio privado almacena la copia de respaldo cifrada de tu cliente **RellySSH**.\n\n` +
        `### 🔒 Seguridad Criptográfica Zero-Knowledge:\n` +
        `- El archivo \`${path}\` contiene exclusivamente texto cifrado generado del lado del cliente con **Argon2id (RFC 9106)** y **AES-256-GCM**.\n` +
        `- Las contraseñas, claves privadas SSH y configuraciones de servidores **NUNCA** se transmiten ni se almacenan en texto plano.\n` +
        `- No modifiques ni elimines este archivo manualmente para preservar la sincronización.\n\n` +
        `Última actualización: ${timestamp}\n`;

      await fetch(`https://api.github.com/repos/${owner}/${repoName}/contents/README.md`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${cleanToken}`,
          Accept: 'application/vnd.github+json',
          'Content-Type': 'application/json',
          'X-GitHub-Api-Version': '2022-11-28'
        },
        body: JSON.stringify({
          message: 'docs: add zero-knowledge security documentation',
          content: utf8ToBase64(readmeBody),
          branch: effectiveBranch
        })
      }).catch(() => {});
    }

    return {
      success: true,
      repoName,
      repoUrl,
      commitSha: putData.commit?.sha || putData.content?.sha,
      updatedAt: timestamp
    };
  } catch (err: any) {
    return { success: false, error: err.message || 'Error de red al subir la bóveda al repositorio.' };
  }
}

/**
 * Pull encrypted vault from a private GitHub Repository
 */
export async function pullVaultFromGitHubRepo(
  token: string,
  owner: string,
  repoName: string = DEFAULT_REPO_NAME,
  branch: string = DEFAULT_BRANCH,
  path: string = DEFAULT_VAULT_PATH
): Promise<{
  success: boolean;
  encryptedContent?: string;
  repoName?: string;
  repoUrl?: string;
  commitSha?: string;
  updatedAt?: string;
  error?: string;
}> {
  const cleanToken = token.trim();
  const fileDetails = await getRepoFileDetails(cleanToken, owner, repoName, path, branch);

  if (!fileDetails.exists) {
    return {
      success: false,
      error: fileDetails.error || `No se encontró el archivo "${path}" en el repositorio "${owner}/${repoName}".`
    };
  }

  let textContent: string = '';

  if (fileDetails.content) {
    try {
      textContent = base64ToUtf8(fileDetails.content);
    } catch {
      return { success: false, error: 'No se pudo decodificar el contenido base64 del repositorio.' };
    }
  } else if (fileDetails.downloadUrl) {
    try {
      const dlRes = await fetch(fileDetails.downloadUrl, {
        headers: {
          Authorization: `Bearer ${cleanToken}`
        }
      });
      if (!dlRes.ok) {
        return { success: false, error: `Error ${dlRes.status} al descargar el archivo de la bóveda.` };
      }
      textContent = await dlRes.text();
    } catch (err: any) {
      return { success: false, error: err.message || 'Fallo de red al descargar el archivo de la bóveda.' };
    }
  }

  if (!textContent.trim()) {
    return { success: false, error: 'El archivo de la bóveda en GitHub está vacío.' };
  }

  return {
    success: true,
    encryptedContent: textContent,
    repoName,
    repoUrl: `https://github.com/${owner}/${repoName}`,
    commitSha: fileDetails.sha,
    updatedAt: new Date().toISOString()
  };
}

// ==========================================
// GIST-BASED SYNC (COMPATIBILITY)
// ==========================================

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
 * Upload the encrypted vault payload to a private GitHub Gist
 */
export async function pushVaultToGist(
  token: string,
  encryptedVaultContent: string,
  existingGistId?: string
): Promise<{ success: boolean; gistId?: string; gistUrl?: string; updatedAt?: string; error?: string }> {
  const cleanToken = token.trim();

  try {
    JSON.parse(encryptedVaultContent);
  } catch {
    return { success: false, error: 'El contenido de la bóveda a sincronizar no es un JSON válido.' };
  }

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
          public: false,
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
 * Pull the encrypted vault payload from the private GitHub Gist
 */
export async function pullVaultFromGist(
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

// ==========================================
// UNIFIED SYNC API
// ==========================================

export interface UnifiedPushOptions {
  targetType?: GitHubSyncTarget;
  repoOwner?: string;
  repoName?: string;
  gistId?: string;
}

/**
 * Upload the encrypted vault payload to GitHub (Repository or Gist).
 * Isomorphic signature: accepts either (token, content, optionsOrGistId) or (config, content).
 */
export async function pushVaultToGitHub(
  tokenOrConfig: string | GitHubSyncConfig,
  encryptedVaultContent: string,
  optionsOrGistId?: string | UnifiedPushOptions
): Promise<{
  success: boolean;
  targetType?: GitHubSyncTarget;
  repoName?: string;
  repoUrl?: string;
  commitSha?: string;
  gistId?: string;
  gistUrl?: string;
  updatedAt?: string;
  error?: string;
}> {
  // If config object was passed
  if (typeof tokenOrConfig === 'object') {
    const config = tokenOrConfig;
    if (config.targetType === 'gist') {
      const res = await pushVaultToGist(config.token, encryptedVaultContent, config.gistId);
      return { ...res, targetType: 'gist' };
    } else {
      const owner = config.repoOwner || config.user?.login;
      if (!owner) {
        // Fetch user login if not already known
        const userRes = await validateGitHubToken(config.token);
        if (!userRes.valid || !userRes.user) {
          return { success: false, error: 'No se pudo identificar el usuario de GitHub.' };
        }
        config.repoOwner = userRes.user.login;
      }
      const res = await pushVaultToGitHubRepo(
        config.token,
        config.repoOwner || config.user!.login,
        encryptedVaultContent,
        config.repoName || DEFAULT_REPO_NAME,
        config.repoBranch || DEFAULT_BRANCH,
        config.repoPath || DEFAULT_VAULT_PATH
      );
      return { ...res, targetType: 'repo' };
    }
  }

  // If string token was passed
  const token = tokenOrConfig;
  if (typeof optionsOrGistId === 'string' || !optionsOrGistId) {
    // Legacy call (assumes Gist or string gistId)
    const res = await pushVaultToGist(token, encryptedVaultContent, optionsOrGistId);
    return { ...res, targetType: 'gist' };
  }

  const opts = optionsOrGistId as UnifiedPushOptions;
  if (opts.targetType === 'repo') {
    let owner = opts.repoOwner;
    if (!owner) {
      const userRes = await validateGitHubToken(token);
      if (!userRes.valid || !userRes.user) {
        return { success: false, error: 'No se pudo determinar el usuario de GitHub.' };
      }
      owner = userRes.user.login;
    }
    const res = await pushVaultToGitHubRepo(
      token,
      owner,
      encryptedVaultContent,
      opts.repoName || DEFAULT_REPO_NAME
    );
    return { ...res, targetType: 'repo' };
  } else {
    const res = await pushVaultToGist(token, encryptedVaultContent, opts.gistId);
    return { ...res, targetType: 'gist' };
  }
}

/**
 * Pull the encrypted vault payload from GitHub (Repository or Gist).
 * Isomorphic signature: accepts either (token, gistIdOrOptions) or (config).
 */
export async function pullVaultFromGitHub(
  tokenOrConfig: string | GitHubSyncConfig,
  gistIdOrOptions?: string | UnifiedPushOptions
): Promise<{
  success: boolean;
  targetType?: GitHubSyncTarget;
  encryptedContent?: string;
  repoName?: string;
  repoUrl?: string;
  commitSha?: string;
  gistId?: string;
  updatedAt?: string;
  error?: string;
}> {
  // If config object was passed
  if (typeof tokenOrConfig === 'object') {
    const config = tokenOrConfig;
    if (config.targetType === 'gist') {
      const res = await pullVaultFromGist(config.token, config.gistId);
      return { ...res, targetType: 'gist' };
    } else {
      const owner = config.repoOwner || config.user?.login;
      if (!owner) {
        const userRes = await validateGitHubToken(config.token);
        if (!userRes.valid || !userRes.user) {
          return { success: false, error: 'No se pudo identificar el usuario de GitHub.' };
        }
        config.repoOwner = userRes.user.login;
      }
      const res = await pullVaultFromGitHubRepo(
        config.token,
        config.repoOwner || config.user!.login,
        config.repoName || DEFAULT_REPO_NAME,
        config.repoBranch || DEFAULT_BRANCH,
        config.repoPath || DEFAULT_VAULT_PATH
      );
      return { ...res, targetType: 'repo' };
    }
  }

  // String token passed
  const token = tokenOrConfig;
  if (typeof gistIdOrOptions === 'string' || !gistIdOrOptions) {
    // Legacy call (assumes Gist)
    const res = await pullVaultFromGist(token, gistIdOrOptions);
    return { ...res, targetType: 'gist' };
  }

  const opts = gistIdOrOptions as UnifiedPushOptions;
  if (opts.targetType === 'repo') {
    let owner = opts.repoOwner;
    if (!owner) {
      const userRes = await validateGitHubToken(token);
      if (!userRes.valid || !userRes.user) {
        return { success: false, error: 'No se pudo determinar el usuario de GitHub.' };
      }
      owner = userRes.user.login;
    }
    const res = await pullVaultFromGitHubRepo(
      token,
      owner,
      opts.repoName || DEFAULT_REPO_NAME
    );
    return { ...res, targetType: 'repo' };
  } else {
    const res = await pullVaultFromGist(token, opts.gistId);
    return { ...res, targetType: 'gist' };
  }
}

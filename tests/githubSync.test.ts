import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  validateGitHubToken,
  pushVaultToGitHub,
  pullVaultFromGitHub,
  getGitHubConfig,
  saveGitHubConfig,
  clearGitHubConfig,
  getOrCreateVaultRepo,
  pushVaultToGitHubRepo,
  pullVaultFromGitHubRepo,
  utf8ToBase64,
  base64ToUtf8,
  type GitHubSyncConfig
} from '../src/services/githubSync';

// Mock localStorage for Vitest
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => {
      store[key] = value.toString();
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    }
  };
})();

Object.defineProperty(globalThis, 'localStorage', {
  value: localStorageMock,
  writable: true
});

describe('RellySSH GitHub Sync Service', () => {
  beforeEach(() => {
    localStorageMock.clear();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Configuration Storage', () => {
    it('should save, retrieve and clear GitHub configuration', () => {
      expect(getGitHubConfig()).toBeNull();

      const config: GitHubSyncConfig = {
        token: 'ghp_test1234567890',
        gistId: 'gist_abcdef123456',
        user: {
          login: 'testuser',
          name: 'Test User',
          avatar_url: 'https://github.com/testuser.png',
          html_url: 'https://github.com/testuser'
        },
        autoSync: true,
        lastSyncTime: '2026-11-14T12:00:00Z'
      };

      saveGitHubConfig(config);
      const retrieved = getGitHubConfig();
      expect(retrieved).toEqual(config);

      clearGitHubConfig();
      expect(getGitHubConfig()).toBeNull();
    });
  });

  describe('validateGitHubToken', () => {
    it('should successfully validate a legitimate token', async () => {
      const mockUser = {
        login: 'octocat',
        name: 'The Octocat',
        avatar_url: 'https://github.com/images/error/octocat_happy.gif',
        html_url: 'https://github.com/octocat'
      };

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockUser
      } as Response);

      const res = await validateGitHubToken('ghp_valid_token');
      expect(res.valid).toBe(true);
      expect(res.user?.login).toBe('octocat');
      expect(res.user?.name).toBe('The Octocat');
    });

    it('should return valid=false for 401 Unauthorized', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: async () => ({ message: 'Bad credentials' })
      } as Response);

      const res = await validateGitHubToken('ghp_invalid');
      expect(res.valid).toBe(false);
      expect(res.error).toContain('Token inválido');
    });

    it('should reject empty tokens', async () => {
      const res = await validateGitHubToken('   ');
      expect(res.valid).toBe(false);
      expect(res.error).toContain('vacío');
    });
  });

  describe('pushVaultToGitHub', () => {
    const dummyEncryptedVault = JSON.stringify({
      format: 'RELLY_VAULT',
      version: 2,
      payload: { ciphertext: 'a1b2c3d4' }
    });

    it('should reject non-JSON vault content', async () => {
      const res = await pushVaultToGitHub('ghp_token', 'NOT_JSON');
      expect(res.success).toBe(false);
      expect(res.error).toContain('JSON válido');
    });

    it('should create a new private Gist when no gistId exists', async () => {
      // Mock findExistingVaultGist -> returns null (no gists)
      vi.spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => []
        } as Response)
        // Mock POST /gists
        .mockResolvedValueOnce({
          ok: true,
          status: 201,
          json: async () => ({
            id: 'new_gist_999',
            html_url: 'https://gist.github.com/new_gist_999',
            updated_at: '2026-11-14T15:00:00Z'
          })
        } as Response);

      const res = await pushVaultToGitHub('ghp_token', dummyEncryptedVault);
      expect(res.success).toBe(true);
      expect(res.gistId).toBe('new_gist_999');
      expect(res.gistUrl).toBe('https://gist.github.com/new_gist_999');
    });

    it('should update an existing Gist via PATCH when gistId is provided', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          id: 'existing_gist_123',
          html_url: 'https://gist.github.com/existing_gist_123',
          updated_at: '2026-11-14T15:10:00Z'
        })
      } as Response);

      const res = await pushVaultToGitHub('ghp_token', dummyEncryptedVault, 'existing_gist_123');
      expect(res.success).toBe(true);
      expect(res.gistId).toBe('existing_gist_123');

      // Verify that PATCH was called
      expect(fetchSpy).toHaveBeenCalledWith(
        'https://api.github.com/gists/existing_gist_123',
        expect.objectContaining({
          method: 'PATCH'
        })
      );
    });
  });

  describe('pullVaultFromGitHub', () => {
    it('should pull encrypted vault content from existing Gist', async () => {
      const mockGist = {
        id: 'gist_abc',
        updated_at: '2026-11-14T16:00:00Z',
        files: {
          'rellyssh.vault': {
            content: '{"format":"RELLY_VAULT","version":2}',
            truncated: false
          }
        }
      };

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockGist
      } as Response);

      const res = await pullVaultFromGitHub('ghp_token', 'gist_abc');
      expect(res.success).toBe(true);
      expect(res.encryptedContent).toBe('{"format":"RELLY_VAULT","version":2}');
      expect(res.gistId).toBe('gist_abc');
    });

    it('should handle truncated Gists by fetching from raw_url', async () => {
      const mockGist = {
        id: 'gist_large',
        updated_at: '2026-11-14T16:05:00Z',
        files: {
          'rellyssh.vault': {
            content: 'truncated partial content',
            truncated: true,
            raw_url: 'https://gist.githubusercontent.com/raw/vault.json'
          }
        }
      };

      vi.spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => mockGist
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: async () => '{"format":"RELLY_VAULT","full":"data"}'
        } as Response);

      const res = await pullVaultFromGitHub('ghp_token', 'gist_large');
      expect(res.success).toBe(true);
      expect(res.encryptedContent).toBe('{"format":"RELLY_VAULT","full":"data"}');
    });

    it('should return error if no RellySSH gist is found', async () => {
      // Mock findExistingVaultGist -> returns empty list
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => []
      } as Response);

      const res = await pullVaultFromGitHub('ghp_token');
      expect(res.success).toBe(false);
      expect(res.error).toContain('No se encontró');
    });
  });

  describe('Base64 Encoding & Decoding', () => {
    it('should encode and decode unicode strings and JSON payloads correctly', () => {
      const sample = JSON.stringify({
        hello: 'mundo 🚀',
        servidores: ['Servidor Producción ⚡', 'Base de datos ñandú']
      });

      const b64 = utf8ToBase64(sample);
      expect(typeof b64).toBe('string');
      const decoded = base64ToUtf8(b64);
      expect(decoded).toBe(sample);
    });
  });

  describe('Repository Sync', () => {
    const dummyEncryptedVault = JSON.stringify({
      format: 'RELLY_VAULT',
      version: 2,
      payload: { ciphertext: 'beef1234' }
    });

    it('should detect existing private repository', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          html_url: 'https://github.com/octocat/rellyssh-vault',
          default_branch: 'main'
        })
      } as Response);

      const res = await getOrCreateVaultRepo('ghp_token', 'octocat', 'rellyssh-vault');
      expect(res.exists).toBe(true);
      expect(res.repoUrl).toBe('https://github.com/octocat/rellyssh-vault');
      expect(res.defaultBranch).toBe('main');
    });

    it('should create private repository when 404 is returned', async () => {
      // 1. Check -> 404
      vi.spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce({
          ok: false,
          status: 404,
          json: async () => ({ message: 'Not Found' })
        } as Response)
        // 2. Create -> 201
        .mockResolvedValueOnce({
          ok: true,
          status: 201,
          json: async () => ({
            html_url: 'https://github.com/octocat/rellyssh-vault',
            default_branch: 'main'
          })
        } as Response);

      const res = await getOrCreateVaultRepo('ghp_token', 'octocat', 'rellyssh-vault');
      expect(res.exists).toBe(true);
      expect(res.created).toBe(true);
      expect(res.repoUrl).toBe('https://github.com/octocat/rellyssh-vault');
    });

    it('should push vault to GitHub repository with commit sha', async () => {
      // 1. Repo check -> 200
      vi.spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ html_url: 'https://github.com/octocat/rellyssh-vault', default_branch: 'main' })
        } as Response)
        // 2. Existing file check -> 200 with previous sha
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ sha: 'prev_blob_sha' })
        } as Response)
        // 3. PUT file contents
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            commit: { sha: 'new_commit_sha_123' },
            content: { sha: 'new_blob_sha' }
          })
        } as Response)
        // 4. README check -> 200
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ sha: 'readme_sha' })
        } as Response);

      const res = await pushVaultToGitHubRepo('ghp_token', 'octocat', dummyEncryptedVault, 'rellyssh-vault');
      expect(res.success).toBe(true);
      expect(res.commitSha).toBe('new_commit_sha_123');
      expect(res.repoUrl).toBe('https://github.com/octocat/rellyssh-vault');
    });

    it('should pull vault from GitHub repository and decode base64 content', async () => {
      const b64 = utf8ToBase64(dummyEncryptedVault);

      // GET file contents
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          sha: 'blob_sha_xyz',
          content: b64
        })
      } as Response);

      const res = await pullVaultFromGitHubRepo('ghp_token', 'octocat', 'rellyssh-vault');
      expect(res.success).toBe(true);
      expect(res.encryptedContent).toBe(dummyEncryptedVault);
      expect(res.commitSha).toBe('blob_sha_xyz');
    });

    it('should perform unified push and pull targeting repository', async () => {
      const config: GitHubSyncConfig = {
        token: 'ghp_token',
        targetType: 'repo',
        repoOwner: 'octocat',
        repoName: 'my-custom-vault',
        autoSync: true
      };

      // Push mock
      vi.spyOn(globalThis, 'fetch')
        // repo check
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ html_url: 'https://github.com/octocat/my-custom-vault', default_branch: 'main' })
        } as Response)
        // file check
        .mockResolvedValueOnce({
          ok: false,
          status: 404,
          json: async () => ({ message: 'Not found' })
        } as Response)
        // PUT file
        .mockResolvedValueOnce({
          ok: true,
          status: 201,
          json: async () => ({
            commit: { sha: 'commit_sha_abc' },
            content: { sha: 'blob_sha_abc' }
          })
        } as Response)
        // README check
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ sha: 'readme_sha' })
        } as Response);

      const pushRes = await pushVaultToGitHub(config, dummyEncryptedVault);
      expect(pushRes.success).toBe(true);
      expect(pushRes.targetType).toBe('repo');
      expect(pushRes.commitSha).toBe('commit_sha_abc');

      // Pull mock
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          sha: 'blob_sha_abc',
          content: utf8ToBase64(dummyEncryptedVault)
        })
      } as Response);

      const pullRes = await pullVaultFromGitHub(config);
      expect(pullRes.success).toBe(true);
      expect(pullRes.targetType).toBe('repo');
      expect(pullRes.encryptedContent).toBe(dummyEncryptedVault);
    });
  });
});

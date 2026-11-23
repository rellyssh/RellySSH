import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  DEFAULT_GITHUB_CLIENT_ID,
  requestDeviceCode,
  pollDeviceToken,
  pollDeviceTokenUntilComplete,
  setupGitHubAccountAndVault,
  openBrowserUrl,
  GITHUB_DEVICE_CODE_URL,
  GITHUB_ACCESS_TOKEN_URL
} from '../src/services/githubAuth';
import * as githubSyncModule from '../src/services/githubSync';

describe('RellySSH GitHub Auth & Device Flow Service', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Configuration & Constants', () => {
    it('should have a default verified GitHub OAuth Client ID', () => {
      expect(DEFAULT_GITHUB_CLIENT_ID).toBeDefined();
      expect(typeof DEFAULT_GITHUB_CLIENT_ID).toBe('string');
      expect(DEFAULT_GITHUB_CLIENT_ID.length).toBeGreaterThan(5);
    });
  });

  describe('Device Code Request (RFC 8628 Step 1)', () => {
    it('should request a device code and return formatted response', async () => {
      const mockResponse = {
        device_code: 'test_device_code_123',
        user_code: 'ABCD-1234',
        verification_uri: 'https://github.com/login/device',
        expires_in: 900,
        interval: 5
      };

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse
      } as Response);

      const result = await requestDeviceCode('test_client_id', 'repo,gist');

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data?.device_code).toBe('test_device_code_123');
      expect(result.data?.user_code).toBe('ABCD-1234');
      expect(result.data?.verification_uri).toBe('https://github.com/login/device');
      expect(result.data?.interval).toBe(5);

      expect(fetch).toHaveBeenCalledWith(GITHUB_DEVICE_CODE_URL, expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Accept: 'application/json',
          'Content-Type': 'application/json'
        }),
        body: JSON.stringify({
          client_id: 'test_client_id',
          scope: 'repo,gist'
        })
      }));
    });

    it('should handle API failure when requesting device code', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({ error_description: 'Invalid client_id' })
      } as Response);

      const result = await requestDeviceCode('invalid_client');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid client_id');
    });

    it('should handle network exception gracefully', async () => {
      vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('Connection refused'));

      const result = await requestDeviceCode();

      expect(result.success).toBe(false);
      expect(result.error).toContain('Connection refused');
    });
  });

  describe('Device Token Polling (RFC 8628 Step 2)', () => {
    it('should poll access token endpoint with correct parameters', async () => {
      const mockTokenResponse = {
        access_token: 'gho_secret_access_token_xyz',
        token_type: 'bearer',
        scope: 'repo,gist,read:user'
      };

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => mockTokenResponse
      } as Response);

      const result = await pollDeviceToken('test_client_id', 'dev_code_123');

      expect(result.access_token).toBe('gho_secret_access_token_xyz');
      expect(result.token_type).toBe('bearer');

      expect(fetch).toHaveBeenCalledWith(GITHUB_ACCESS_TOKEN_URL, expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Accept: 'application/json',
          'Content-Type': 'application/json'
        }),
        body: JSON.stringify({
          client_id: 'test_client_id',
          device_code: 'dev_code_123',
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code'
        })
      }));
    });

    it('should return error response during authorization_pending', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => ({ error: 'authorization_pending' })
      } as Response);

      const result = await pollDeviceToken('test_client', 'dev_code');
      expect(result.error).toBe('authorization_pending');
    });
  });

  describe('Continuous Polling Orchestration', () => {
    it('should poll until token is received after pending statuses', async () => {
      let callCount = 0;
      vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          return {
            ok: true,
            json: async () => ({ error: 'authorization_pending' })
          } as Response;
        }
        return {
          ok: true,
          json: async () => ({
            access_token: 'gho_final_token_123',
            token_type: 'bearer'
          })
        } as Response;
      });

      const statusUpdates: string[] = [];
      const result = await pollDeviceTokenUntilComplete(
        'client_id',
        'device_code',
        0.01, // 10ms for fast test execution
        10,
        (s) => statusUpdates.push(s)
      );

      expect(result.success).toBe(true);
      expect(result.token).toBe('gho_final_token_123');
      expect(statusUpdates.length).toBeGreaterThan(0);
    });

    it('should handle user cancellation via AbortSignal', async () => {
      const controller = new AbortController();
      controller.abort(); // pre-aborted

      const result = await pollDeviceTokenUntilComplete(
        'client_id',
        'device_code',
        0.01,
        10,
        undefined,
        controller.signal
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('cancelado');
    });

    it('should fail immediately when expired_token error is returned', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => ({ error: 'expired_token' })
      } as Response);

      const result = await pollDeviceTokenUntilComplete(
        'client_id',
        'device_code',
        0.01,
        10
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('expiró');
    });

    it('should fail immediately when access_denied error is returned', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => ({ error: 'access_denied' })
      } as Response);

      const result = await pollDeviceTokenUntilComplete(
        'client_id',
        'device_code',
        0.01,
        10
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('rechazada');
    });
  });

  describe('Setup GitHub Account and Vault Detection (Zero-Knowledge)', () => {
    it('should validate user, create repo and detect existing vault file', async () => {
      vi.spyOn(githubSyncModule, 'validateGitHubToken').mockResolvedValueOnce({
        valid: true,
        user: {
          login: 'rellydev',
          name: 'Relly Developer',
          avatar_url: 'https://github.com/rellydev.png',
          html_url: 'https://github.com/rellydev'
        }
      });

      vi.spyOn(githubSyncModule, 'getOrCreateVaultRepo').mockResolvedValueOnce({
        exists: true,
        repoUrl: 'https://github.com/rellydev/rellyssh-vault',
        defaultBranch: 'main'
      });

      vi.spyOn(githubSyncModule, 'getRepoFileDetails').mockResolvedValueOnce({
        exists: true,
        sha: 'blob_sha_123'
      });

      vi.spyOn(githubSyncModule, 'pullVaultFromGitHubRepo').mockResolvedValueOnce({
        success: true,
        encryptedContent: '{"version":2,"ciphertext":"abc=="}'
      });

      const setup = await setupGitHubAccountAndVault('gho_valid_token');

      expect(setup.success).toBe(true);
      expect(setup.user?.login).toBe('rellydev');
      expect(setup.repoExists).toBe(true);
      expect(setup.vaultFileExists).toBe(true);
      expect(setup.encryptedVaultContent).toBe('{"version":2,"ciphertext":"abc=="}');
    });

    it('should recognize a brand new account where vault file does not exist yet', async () => {
      vi.spyOn(githubSyncModule, 'validateGitHubToken').mockResolvedValueOnce({
        valid: true,
        user: {
          login: 'newuser',
          name: 'New User',
          avatar_url: 'https://github.com/newuser.png',
          html_url: 'https://github.com/newuser'
        }
      });

      vi.spyOn(githubSyncModule, 'getOrCreateVaultRepo').mockResolvedValueOnce({
        exists: true,
        created: true,
        repoUrl: 'https://github.com/newuser/rellyssh-vault'
      });

      vi.spyOn(githubSyncModule, 'getRepoFileDetails').mockResolvedValueOnce({
        exists: false
      });

      const setup = await setupGitHubAccountAndVault('gho_new_token');

      expect(setup.success).toBe(true);
      expect(setup.user?.login).toBe('newuser');
      expect(setup.repoExists).toBe(true);
      expect(setup.vaultFileExists).toBe(false);
      expect(setup.encryptedVaultContent).toBeUndefined();
    });

    it('should return error if token validation fails', async () => {
      vi.spyOn(githubSyncModule, 'validateGitHubToken').mockResolvedValueOnce({
        valid: false,
        error: 'Bad credentials'
      });

      const setup = await setupGitHubAccountAndVault('invalid_token');

      expect(setup.success).toBe(false);
      expect(setup.error).toContain('Bad credentials');
    });
  });

  describe('Browser URL Opening Helper', () => {
    it('should safely attempt to open browser URL', async () => {
      const openSpy = vi.fn();
      if (typeof window !== 'undefined') {
        (window as any).open = openSpy;
      }
      vi.stubGlobal('open', openSpy);

      const res = await openBrowserUrl('https://github.com/login/device');
      expect(res).toBe(true);
      expect(openSpy).toHaveBeenCalledWith('https://github.com/login/device', '_blank', 'noopener,noreferrer');
    });
  });
});

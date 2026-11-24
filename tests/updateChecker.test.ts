import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  cleanVersion,
  compareSemver,
  parseSha256Sums,
  detectPlatform,
  findRecommendedAsset,
  checkForUpdates,
  calculateBufferSha256,
  verifyBufferSha256,
  type ReleaseAsset
} from '../src/services/updateChecker';

describe('updateChecker Service', () => {
  describe('cleanVersion', () => {
    it('strips leading v or V and trims whitespace', () => {
      expect(cleanVersion('v1.3.0')).toBe('1.3.0');
      expect(cleanVersion('V2.0.1')).toBe('2.0.1');
      expect(cleanVersion(' 1.4.2 ')).toBe('1.4.2');
      expect(cleanVersion('')).toBe('0.0.0');
    });
  });

  describe('compareSemver', () => {
    it('correctly compares major, minor, patch versions', () => {
      expect(compareSemver('1.4.0', '1.3.0')).toBe(1);
      expect(compareSemver('1.3.1', '1.3.0')).toBe(1);
      expect(compareSemver('2.0.0', '1.9.9')).toBe(1);
      expect(compareSemver('1.3.0', '1.4.0')).toBe(-1);
      expect(compareSemver('1.3.0', '1.3.1')).toBe(-1);
      expect(compareSemver('1.3.0', '1.3.0')).toBe(0);
      expect(compareSemver('v1.3.0', '1.3.0')).toBe(0);
      expect(compareSemver('1.3.0-beta.1', '1.3.0')).toBe(-1);
      expect(compareSemver('1.3.0', '1.3.0-rc.1')).toBe(1);
    });
  });

  describe('parseSha256Sums', () => {
    it('parses standard sha256sum outputs', () => {
      const raw = `
# Comentarios
f9c988e104b27bbaf8737ded7d982591756ee97df1d5bb46d60ced087318f376  RellySSH-1.2.0.AppImage
45319c1a9bd6289d94c56102afcd9918d2d014670c594c7978059ce04906a3ff *rellyssh_1.2.0_amd64.deb
F578E70307973AB28350D5F88C2CB3EDE2FAE318A7B67234C80BCBB93822CAD7  rellyssh-1.2.0.x86_64.rpm
      `;
      const map = parseSha256Sums(raw);
      expect(map['RellySSH-1.2.0.AppImage']).toBe('f9c988e104b27bbaf8737ded7d982591756ee97df1d5bb46d60ced087318f376');
      expect(map['rellyssh_1.2.0_amd64.deb']).toBe('45319c1a9bd6289d94c56102afcd9918d2d014670c594c7978059ce04906a3ff');
      expect(map['rellyssh-1.2.0.x86_64.rpm']).toBe('f578e70307973ab28350d5f88c2cb3ede2fae318a7b67234c80bcbb93822cad7');
    });

    it('handles empty or malformed input safely', () => {
      expect(parseSha256Sums('')).toEqual({});
      expect(parseSha256Sums('not a hash at all')).toEqual({});
    });
  });

  describe('findRecommendedAsset', () => {
    const assets: ReleaseAsset[] = [
      { id: 1, name: 'rellyssh_1.3.0_amd64.deb', size: 100, downloadUrl: 'url1', contentType: 'application/x-deb' },
      { id: 2, name: 'Terminal-RellySSH-1.3.0.AppImage', size: 200, downloadUrl: 'url2', contentType: 'application/octet-stream' },
      { id: 3, name: 'Terminal-RellySSH-Setup-1.3.0.exe', size: 300, downloadUrl: 'url3', contentType: 'application/x-msdos' },
      { id: 4, name: 'Terminal-RellySSH-1.3.0.dmg', size: 400, downloadUrl: 'url4', contentType: 'application/x-dmg' },
      { id: 5, name: 'Terminal-RellySSH.apk', size: 50, downloadUrl: 'url5', contentType: 'application/vnd.android.package-archive' }
    ];

    it('returns AppImage for Linux', () => {
      const rec = findRecommendedAsset(assets, 'linux');
      expect(rec?.name).toBe('Terminal-RellySSH-1.3.0.AppImage');
    });

    it('returns Setup.exe for Windows', () => {
      const rec = findRecommendedAsset(assets, 'windows');
      expect(rec?.name).toBe('Terminal-RellySSH-Setup-1.3.0.exe');
    });

    it('returns .dmg for macOS', () => {
      const rec = findRecommendedAsset(assets, 'macos');
      expect(rec?.name).toBe('Terminal-RellySSH-1.3.0.dmg');
    });

    it('returns .apk for Android', () => {
      const rec = findRecommendedAsset(assets, 'android');
      expect(rec?.name).toBe('Terminal-RellySSH.apk');
    });
  });

  describe('calculateBufferSha256 and verifyBufferSha256', () => {
    it('computes known SHA-256 correctly', async () => {
      const encoder = new TextEncoder();
      const data = encoder.encode('Terminal RellySSH Security Check');
      const hash = await calculateBufferSha256(data);
      expect(hash).toHaveLength(64);

      const verification = await verifyBufferSha256(data, hash);
      expect(verification.matches).toBe(true);

      const mismatch = await verifyBufferSha256(data, '0000000000000000000000000000000000000000000000000000000000000000');
      expect(mismatch.matches).toBe(false);
    });
  });

  describe('checkForUpdates', () => {
    it('detects when an update is available and downloads checksum files', async () => {
      const mockRelease = {
        tag_name: 'v1.4.0',
        name: 'Terminal RellySSH v1.4.0',
        body: '## Novedades\n- Soporte para verificación de hashes.',
        published_at: '2026-11-24T12:00:00Z',
        html_url: 'https://github.com/rellyssh/RellySSH/releases/tag/v1.4.0',
        assets: [
          {
            id: 101,
            name: 'Terminal-RellySSH-1.4.0.AppImage',
            size: 150000000,
            browser_download_url: 'https://github.com/rellyssh/RellySSH/releases/download/v1.4.0/Terminal-RellySSH-1.4.0.AppImage',
            content_type: 'application/octet-stream',
            digest: 'sha256:1111111111111111111111111111111111111111111111111111111111111111'
          },
          {
            id: 102,
            name: 'SHA256SUMS.txt',
            size: 200,
            browser_download_url: 'https://github.com/rellyssh/RellySSH/releases/download/v1.4.0/SHA256SUMS.txt',
            content_type: 'text/plain'
          }
        ]
      };

      const mockSumsText = `
1111111111111111111111111111111111111111111111111111111111111111  Terminal-RellySSH-1.4.0.AppImage
      `;

      const mockFetch = vi.fn().mockImplementation((url: string) => {
        if (url.includes('/releases/latest')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => mockRelease
          });
        }
        if (url.includes('SHA256SUMS.txt')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            text: async () => mockSumsText
          });
        }
        return Promise.reject(new Error(`Unknown URL: ${url}`));
      });

      const result = await checkForUpdates('1.3.0', 'rellyssh/RellySSH', mockFetch as any);

      expect(result.success).toBe(true);
      expect(result.hasUpdate).toBe(true);
      expect(result.latestRelease?.tagName).toBe('v1.4.0');
      expect(result.latestRelease?.version).toBe('1.4.0');
      expect(result.latestRelease?.checksums['Terminal-RellySSH-1.4.0.AppImage']).toBe(
        '1111111111111111111111111111111111111111111111111111111111111111'
      );
      const appImageAsset = result.latestRelease?.assets.find((a) => a.name.endsWith('.AppImage'));
      expect(appImageAsset?.sha256).toBe('1111111111111111111111111111111111111111111111111111111111111111');
    });

    it('reports no update when already on latest version', async () => {
      const mockRelease = {
        tag_name: 'v1.3.0',
        name: 'Terminal RellySSH v1.3.0',
        assets: []
      };

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => mockRelease
      });

      const result = await checkForUpdates('1.3.0', 'rellyssh/RellySSH', mockFetch as any);
      expect(result.success).toBe(true);
      expect(result.hasUpdate).toBe(false);
    });

    it('handles network failure gracefully', async () => {
      const mockFetch = vi.fn().mockRejectedValue(new Error('Network offline'));
      const result = await checkForUpdates('1.3.0', 'rellyssh/RellySSH', mockFetch as any);
      expect(result.success).toBe(false);
      expect(result.hasUpdate).toBe(false);
      expect(result.error).toContain('Network offline');
    });
  });
});

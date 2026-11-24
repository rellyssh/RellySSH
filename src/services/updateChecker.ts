/**
 * Terminal RellySSH - Update Checker & Checksum Verification Service
 * 
 * Checks for updates against GitHub Releases, parses release assets,
 * extracts official SHA-256 checksums (from SHA256SUMS.txt / asset digests),
 * and verifies local or downloaded file integrity.
 */

export interface ReleaseAsset {
  id: number | string;
  name: string;
  size: number;
  downloadUrl: string;
  contentType: string;
  digest?: string;
  sha256?: string;
}

export interface GitHubReleaseInfo {
  tagName: string;
  version: string;
  name: string;
  body: string;
  publishedAt: string;
  htmlUrl: string;
  assets: ReleaseAsset[];
  checksums: Record<string, string>;
  isNewer: boolean;
  recommendedAsset?: ReleaseAsset;
}

export interface UpdateCheckResult {
  success: boolean;
  hasUpdate: boolean;
  currentVersion: string;
  latestRelease?: GitHubReleaseInfo;
  error?: string;
}

export const DEFAULT_UPDATE_REPO = 'rellyssh/RellySSH';
export const CURRENT_APP_VERSION = '1.3.0';

/**
 * Strips 'v' or 'V' and trims whitespace from a version string.
 */
export function cleanVersion(v: string): string {
  if (!v) return '0.0.0';
  return v.trim().replace(/^[vV]/, '');
}

/**
 * Semver comparison:
 * Returns 1 if v1 > v2
 * Returns -1 if v1 < v2
 * Returns 0 if v1 === v2
 */
export function compareSemver(v1: string, v2: string): number {
  const c1 = cleanVersion(v1);
  const c2 = cleanVersion(v2);
  if (c1 === c2) return 0;

  const [core1, pre1] = c1.split('-');
  const [core2, pre2] = c2.split('-');

  const parts1 = core1.split('.').map((p) => parseInt(p, 10) || 0);
  const parts2 = core2.split('.').map((p) => parseInt(p, 10) || 0);

  const len = Math.max(parts1.length, parts2.length);
  for (let i = 0; i < len; i++) {
    const p1 = parts1[i] ?? 0;
    const p2 = parts2[i] ?? 0;
    if (p1 > p2) return 1;
    if (p1 < p2) return -1;
  }

  // Pre-release handling: release without pre-release > release with pre-release
  if (!pre1 && pre2) return 1;
  if (pre1 && !pre2) return -1;
  if (pre1 && pre2) return pre1.localeCompare(pre2);

  return 0;
}

/**
 * Parses SHA256SUMS.txt format:
 * "<64-hex-chars>  <filename>" or "<64-hex-chars> *<filename>"
 */
export function parseSha256Sums(content: string): Record<string, string> {
  const map: Record<string, string> = {};
  if (!content) return map;

  const lines = content.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const match = trimmed.match(/^([a-fA-F0-9]{64})\s+[*]?(.+)$/);
    if (match) {
      const hash = match[1].toLowerCase();
      const filename = match[2].trim();
      map[filename] = hash;
    }
  }
  return map;
}

/**
 * Detects current platform for recommending the right package installer.
 */
export function detectPlatform(): 'linux' | 'windows' | 'macos' | 'android' {
  if (typeof navigator !== 'undefined') {
    const ua = navigator.userAgent.toLowerCase();
    if (ua.includes('android')) return 'android';
    if (ua.includes('win')) return 'windows';
    if (ua.includes('mac')) return 'macos';
    if (ua.includes('linux')) return 'linux';
  }
  const proc = (globalThis as any).process;
  if (proc?.platform) {
    if (proc.platform === 'win32') return 'windows';
    if (proc.platform === 'darwin') return 'macos';
    return 'linux';
  }
  return 'linux';
}

/**
 * Chooses the best matching asset for the detected platform.
 */
export function findRecommendedAsset(assets: ReleaseAsset[], platform = detectPlatform()): ReleaseAsset | undefined {
  if (!assets || assets.length === 0) return undefined;

  switch (platform) {
    case 'linux':
      return (
        assets.find((a) => a.name.endsWith('.AppImage')) ||
        assets.find((a) => a.name.endsWith('.deb')) ||
        assets.find((a) => a.name.endsWith('.rpm'))
      );
    case 'windows':
      return (
        assets.find((a) => a.name.includes('Setup') && a.name.endsWith('.exe')) ||
        assets.find((a) => a.name.endsWith('.exe'))
      );
    case 'macos':
      return (
        assets.find((a) => a.name.endsWith('.dmg')) ||
        assets.find((a) => a.name.endsWith('.zip'))
      );
    case 'android':
      return assets.find((a) => a.name.endsWith('.apk'));
    default:
      return assets[0];
  }
}

/**
 * Checks GitHub Releases for updates and extracts SHA256 checksums.
 */
export async function checkForUpdates(
  currentVersion: string = CURRENT_APP_VERSION,
  repo: string = DEFAULT_UPDATE_REPO,
  customFetch: typeof fetch = fetch
): Promise<UpdateCheckResult> {
  try {
    const url = `https://api.github.com/repos/${repo}/releases/latest`;
    const res = await customFetch(url, {
      headers: {
        Accept: 'application/vnd.github.v3+json',
        'User-Agent': 'Terminal-RellySSH-UpdateChecker'
      }
    });

    if (!res.ok) {
      return {
        success: false,
        hasUpdate: false,
        currentVersion,
        error: `Error al consultar GitHub Releases (HTTP ${res.status}): ${res.statusText}`
      };
    }

    const release = await res.json();
    const tagName = release.tag_name || '';
    const releaseVersion = cleanVersion(tagName);
    const isNewer = compareSemver(releaseVersion, currentVersion) > 0;

    const rawAssets = Array.isArray(release.assets) ? release.assets : [];
    const checksums: Record<string, string> = {};

    // Map initial assets
    const assets: ReleaseAsset[] = rawAssets.map((a: any) => ({
      id: a.id,
      name: a.name,
      size: a.size || 0,
      downloadUrl: a.browser_download_url || a.url,
      contentType: a.content_type || 'application/octet-stream',
      digest: a.digest
    }));

    // Find and fetch SHA256SUMS files
    const checksumAssets = assets.filter(
      (a) => a.name.toLowerCase().includes('sha256sum') || a.name.endsWith('.txt')
    );

    for (const ca of checksumAssets) {
      try {
        const cRes = await customFetch(ca.downloadUrl);
        if (cRes.ok) {
          const text = await cRes.text();
          const parsed = parseSha256Sums(text);
          Object.assign(checksums, parsed);
        }
      } catch (e) {
        console.warn(`No se pudo descargar checksum file ${ca.name}:`, e);
      }
    }

    // Assign SHA-256 hashes to each asset
    for (const asset of assets) {
      if (checksums[asset.name]) {
        asset.sha256 = checksums[asset.name];
      } else if (asset.digest && asset.digest.toLowerCase().startsWith('sha256:')) {
        asset.sha256 = asset.digest.substring(7).toLowerCase();
        checksums[asset.name] = asset.sha256;
      }
    }

    const recommendedAsset = findRecommendedAsset(assets);

    const latestRelease: GitHubReleaseInfo = {
      tagName,
      version: releaseVersion,
      name: release.name || tagName,
      body: release.body || '',
      publishedAt: release.published_at || new Date().toISOString(),
      htmlUrl: release.html_url || `https://github.com/${repo}/releases`,
      assets,
      checksums,
      isNewer,
      recommendedAsset
    };

    return {
      success: true,
      hasUpdate: isNewer,
      currentVersion,
      latestRelease
    };
  } catch (err: any) {
    return {
      success: false,
      hasUpdate: false,
      currentVersion,
      error: err.message || 'Error desconocido al comprobar actualizaciones.'
    };
  }
}

/**
 * Calculates SHA-256 of an ArrayBuffer / Uint8Array using Web Crypto API.
 */
export async function calculateBufferSha256(data: ArrayBuffer | Uint8Array): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new Error('La API Web Crypto (crypto.subtle) no está disponible en este entorno.');
  }

  // Ensure ArrayBufferView is passed as buffer
  const buffer = data instanceof Uint8Array ? data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) : data;
  const hashBuffer = await subtle.digest('SHA-256', buffer as ArrayBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('').toLowerCase();
}

/**
 * Verifies an ArrayBuffer against an expected SHA-256 hex string.
 */
export async function verifyBufferSha256(
  data: ArrayBuffer | Uint8Array,
  expectedHash: string
): Promise<{ matches: boolean; actualHash: string }> {
  const actualHash = await calculateBufferSha256(data);
  const cleanExpected = expectedHash.trim().toLowerCase();
  return {
    matches: actualHash === cleanExpected,
    actualHash
  };
}

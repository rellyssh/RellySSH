import React, { useState, useEffect, useRef } from 'react';
import {
  Flex,
  Box,
  Heading,
  Text,
  Button,
  Callout,
  Badge,
  Card,
  Separator,
  IconButton,
  ScrollArea,
  TextField
} from '@radix-ui/themes';
import {
  Download,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  ShieldCheck,
  RefreshCw,
  Copy,
  Check,
  ArrowRight,
  ShieldAlert,
  FileCheck,
  UploadCloud,
  FileText,
  Terminal,
  Sparkles,
  Search
} from 'lucide-react';
import { GitHubLogoIcon } from '@radix-ui/react-icons';
import {
  checkForUpdates,
  calculateBufferSha256,
  CURRENT_APP_VERSION,
  detectPlatform,
  type UpdateCheckResult,
  type ReleaseAsset,
  type GitHubReleaseInfo
} from '../services/updateChecker';

interface Props {
  showToast: (msg: string) => void;
  onBackToServers?: () => void;
  initialResult?: UpdateCheckResult | null;
  onCheckCompleted?: (result: UpdateCheckResult) => void;
}

export const UpdatePanel: React.FC<Props> = ({
  showToast,
  onBackToServers,
  initialResult,
  onCheckCompleted
}) => {
  const [currentVersion, setCurrentVersion] = useState<string>(CURRENT_APP_VERSION);
  const [isChecking, setIsChecking] = useState<boolean>(false);
  const [result, setResult] = useState<UpdateCheckResult | null>(initialResult || null);
  const [error, setError] = useState<string | null>(null);

  // Descarga y verificación
  const [downloadingAssetId, setDownloadingAssetId] = useState<string | number | null>(null);
  const [downloadStatus, setDownloadStatus] = useState<{
    success: boolean;
    filePath?: string;
    fileName?: string;
    matches?: boolean;
    actualHash?: string;
    expectedHash?: string;
    error?: string;
  } | null>(null);

  // Verificación de archivo local
  const [isVerifyingFile, setIsVerifyingFile] = useState<boolean>(false);
  const [localVerification, setLocalVerification] = useState<{
    fileName: string;
    actualHash: string;
    expectedHash?: string;
    matches: boolean;
  } | null>(null);

  const [copiedHash, setCopiedHash] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const platform = detectPlatform();

  // Obtener versión de app de Electron si está disponible
  useEffect(() => {
    if (window.electronAPI?.getAppVersion) {
      window.electronAPI.getAppVersion().then((v) => {
        if (v) setCurrentVersion(v);
      }).catch(() => {});
    }
  }, []);

  // Si no hay resultado inicial, buscar automáticamente al entrar
  useEffect(() => {
    if (!result && !isChecking) {
      handleCheckUpdates();
    }
  }, []);

  const handleCheckUpdates = async () => {
    setIsChecking(true);
    setError(null);
    setDownloadStatus(null);
    try {
      const res = await checkForUpdates(currentVersion);
      setResult(res);
      if (onCheckCompleted) onCheckCompleted(res);
      if (!res.success) {
        setError(res.error || 'Error al comprobar actualizaciones.');
      } else if (res.hasUpdate) {
        showToast(`⚡ ¡Nueva versión disponible: ${res.latestRelease?.tagName}!`);
      } else {
        showToast('Terminal RellySSH está al día.');
      }
    } catch (err: any) {
      setError(err.message || 'Error inesperado de conexión con GitHub.');
    } finally {
      setIsChecking(false);
    }
  };

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text).catch(() => {});
    setCopiedHash(id);
    showToast('Hash SHA-256 copiado al portapapeles.');
    setTimeout(() => setCopiedHash(null), 2500);
  };

  const openUrl = (url: string) => {
    if (window.electronAPI?.openExternal) {
      window.electronAPI.openExternal(url);
    } else {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  };

  const handleDownloadAndVerify = async (asset: ReleaseAsset) => {
    if (!asset.downloadUrl) return;
    setDownloadingAssetId(asset.id);
    setDownloadStatus(null);
    showToast(`Iniciando descarga de ${asset.name}...`);

    try {
      if (window.electronAPI?.downloadAndVerifyAsset) {
        // En Electron descargamos a disco y verificamos hash nativo
        const res = await window.electronAPI.downloadAndVerifyAsset(
          asset.downloadUrl,
          asset.name,
          asset.sha256
        );
        if (res.success) {
          setDownloadStatus({
            success: true,
            filePath: res.filePath,
            fileName: res.fileName,
            matches: res.matches,
            actualHash: res.actualHash,
            expectedHash: asset.sha256
          });
          if (res.matches) {
            showToast(`✔ ${asset.name} descargado y verificado (SHA-256 válido).`);
          } else {
            showToast(`⚠️ Descarga completada pero el hash SHA-256 no coincide.`);
          }
        } else {
          setDownloadStatus({
            success: false,
            error: res.error || 'Error al descargar el paquete.'
          });
          showToast(`Error: ${res.error}`);
        }
      } else {
        // En web abrimos enlace directamente
        openUrl(asset.downloadUrl);
        showToast(`Descarga iniciada en el navegador: ${asset.name}`);
      }
    } catch (e: any) {
      setDownloadStatus({ success: false, error: e.message });
      showToast(`Error al procesar descarga: ${e.message}`);
    } finally {
      setDownloadingAssetId(null);
    }
  };

  const handleSelectLocalFileToVerify = async (expectedHash?: string) => {
    setIsVerifyingFile(true);
    try {
      if (window.electronAPI?.selectFileAndVerify) {
        const res = await window.electronAPI.selectFileAndVerify(expectedHash);
        if (res.success && res.actualHash && res.fileName) {
          const matched = expectedHash ? res.actualHash === expectedHash.toLowerCase().trim() : false;
          setLocalVerification({
            fileName: res.fileName,
            actualHash: res.actualHash,
            expectedHash,
            matches: matched
          });
          showToast(matched ? '✔ Hash SHA-256 verificado y auténtico.' : 'Hash calculado.');
        }
      } else if (fileInputRef.current) {
        fileInputRef.current.click();
      }
    } catch (err: any) {
      showToast(`Error al verificar archivo: ${err.message}`);
    } finally {
      setIsVerifyingFile(false);
    }
  };

  const handleWebFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsVerifyingFile(true);
    try {
      const buffer = await file.arrayBuffer();
      const actualHash = await calculateBufferSha256(buffer);
      // Buscar si el archivo coincide con algún asset conocido
      const matchedAsset = result?.latestRelease?.assets.find(
        (a) => a.name.toLowerCase() === file.name.toLowerCase() || a.sha256 === actualHash
      );
      const expectedHash = matchedAsset?.sha256;
      const matches = expectedHash ? actualHash === expectedHash.toLowerCase() : false;

      setLocalVerification({
        fileName: file.name,
        actualHash,
        expectedHash,
        matches
      });
      showToast(matches ? '✔ Hash SHA-256 auténtico.' : 'Hash calculado.');
    } catch (err: any) {
      showToast(`Error en verificación: ${err.message}`);
    } finally {
      setIsVerifyingFile(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const release = result?.latestRelease;
  const recommendedAsset = release?.recommendedAsset;

  return (
    <ScrollArea style={{ height: '100%' }}>
      <Box p="4" style={{ maxWidth: 1040, margin: '0 auto' }}>
        {/* Input oculto para verificación web */}
        <input
          type="file"
          ref={fileInputRef}
          style={{ display: 'none' }}
          onChange={handleWebFileSelect}
        />

        {/* Encabezado Superior */}
        <Flex justify="between" align="center" mb="4" wrap="wrap" gap="3">
          <Flex align="center" gap="3">
            <Box
              style={{
                width: 44,
                height: 44,
                borderRadius: 12,
                background: 'linear-gradient(135deg, rgba(8, 123, 255, 0.2), rgba(33, 212, 245, 0.2))',
                border: '1px solid rgba(33, 212, 245, 0.4)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#21d4f5'
              }}
            >
              <RefreshCw size={24} className={isChecking ? 'spin' : ''} />
            </Box>
            <Box>
              <Flex align="center" gap="2">
                <Heading size="5">Revisor de Actualizaciones y Hashes</Heading>
                <Badge color="blue" size="1">
                  GitHub Releases
                </Badge>
              </Flex>
              <Text size="2" color="gray">
                Compara la versión local con la pública oficial y valida la integridad criptográfica (SHA-256).
              </Text>
            </Box>
          </Flex>

          <Flex align="center" gap="2">
            {onBackToServers && (
              <Button variant="soft" color="gray" size="2" onClick={onBackToServers}>
                ← Volver a Terminales
              </Button>
            )}
            <Button
              variant="solid"
              color="iris"
              size="2"
              disabled={isChecking}
              onClick={handleCheckUpdates}
              style={{ cursor: 'pointer' }}
            >
              <RefreshCw size={15} style={{ marginRight: 6 }} className={isChecking ? 'spin' : ''} />
              {isChecking ? 'Comprobando...' : 'Buscar Actualizaciones'}
            </Button>
          </Flex>
        </Flex>

        {/* Error Callout */}
        {error && (
          <Callout.Root color="red" mb="4">
            <Callout.Icon>
              <AlertCircle size={16} />
            </Callout.Icon>
            <Callout.Text>{error}</Callout.Text>
          </Callout.Root>
        )}

        {/* Tarjeta de Estado de Versión */}
        <Card size="2" mb="4" style={{ background: 'var(--gray-2)', borderColor: 'var(--gray-5)' }}>
          <Flex direction="column" gap="3">
            <Flex justify="between" align="center" wrap="wrap" gap="2">
              <Flex align="center" gap="2">
                <Text size="2" weight="bold" color="gray">
                  VERSIÓN LOCAL INSTALADA:
                </Text>
                <Badge size="2" color="iris" variant="solid">
                  v{currentVersion}
                </Badge>
                <Badge size="1" color="gray" variant="soft">
                  Plataforma: {platform.toUpperCase()}
                </Badge>
              </Flex>

              {result && (
                <Flex align="center" gap="2">
                  <Text size="2" color="gray">
                    Última comprobación:
                  </Text>
                  <Text size="2" weight="medium">
                    {new Date().toLocaleTimeString()}
                  </Text>
                </Flex>
              )}
            </Flex>

            <Separator size="4" />

            {isChecking ? (
              <Flex align="center" gap="3" py="3">
                <RefreshCw size={18} className="spin" color="var(--iris-9)" />
                <Text size="2" color="gray">
                  Consultando releases oficiales en GitHub y descargando sumas SHA256...
                </Text>
              </Flex>
            ) : result?.hasUpdate && release ? (
              /* Banner de Actualización Disponible */
              <Box
                p="3"
                style={{
                  background: 'linear-gradient(135deg, rgba(16, 45, 98, 0.4), rgba(8, 123, 255, 0.15))',
                  borderRadius: 8,
                  border: '1px solid rgba(33, 212, 245, 0.3)'
                }}
              >
                <Flex justify="between" align="center" wrap="wrap" gap="3">
                  <Flex align="center" gap="3">
                    <Sparkles size={24} color="#21d4f5" />
                    <Box>
                      <Flex align="center" gap="2">
                        <Heading size="3" style={{ color: '#21d4f5' }}>
                          ¡Nueva versión disponible: {release.tagName}!
                        </Heading>
                        <Badge color="green" size="1">
                          Recomendado
                        </Badge>
                      </Flex>
                      <Text size="2" color="gray">
                        Se publicó una versión más reciente el {new Date(release.publishedAt).toLocaleDateString()}.
                      </Text>
                    </Box>
                  </Flex>

                  <Flex gap="2">
                    {recommendedAsset && (
                      <Button
                        size="2"
                        variant="solid"
                        color="cyan"
                        disabled={downloadingAssetId === recommendedAsset.id}
                        onClick={() => handleDownloadAndVerify(recommendedAsset)}
                        style={{ cursor: 'pointer' }}
                      >
                        <Download size={15} style={{ marginRight: 6 }} />
                        {downloadingAssetId === recommendedAsset.id
                          ? 'Descargando...'
                          : `Descargar y Verificar (${recommendedAsset.name})`}
                      </Button>
                    )}
                    <Button
                      size="2"
                      variant="soft"
                      color="gray"
                      onClick={() => openUrl(release.htmlUrl)}
                      style={{ cursor: 'pointer' }}
                    >
                      <GitHubLogoIcon width={15} height={15} style={{ marginRight: 6 }} />
                      Ver en GitHub
                    </Button>
                  </Flex>
                </Flex>
              </Box>
            ) : result?.success ? (
              /* Al Día */
              <Flex align="center" gap="3" py="2">
                <CheckCircle2 size={24} color="#30a46c" />
                <Box>
                  <Text size="3" weight="bold" color="green">
                    Terminal RellySSH está actualizado (v{currentVersion})
                  </Text>
                  <Text size="2" color="gray">
                    No hay nuevas versiones pendientes en el repositorio oficial. Todos los componentes y bóveda están al día.
                  </Text>
                </Box>
              </Flex>
            ) : (
              <Text size="2" color="gray">
                Haz clic en "Buscar Actualizaciones" para verificar contra el repositorio oficial de GitHub.
              </Text>
            )}
          </Flex>
        </Card>

        {/* Estado de Descarga y Verificación Inline */}
        {downloadStatus && (
          <Card
            size="2"
            mb="4"
            style={{
              background: downloadStatus.success
                ? downloadStatus.matches
                  ? 'rgba(48, 164, 108, 0.1)'
                  : 'rgba(239, 68, 68, 0.1)'
                : 'rgba(239, 68, 68, 0.1)',
              borderColor: downloadStatus.success
                ? downloadStatus.matches
                  ? 'rgba(48, 164, 108, 0.3)'
                  : 'rgba(239, 68, 68, 0.3)'
                : 'rgba(239, 68, 68, 0.3)'
            }}
          >
            <Flex direction="column" gap="2">
              <Flex align="center" gap="2">
                {downloadStatus.matches ? (
                  <ShieldCheck size={20} color="#30a46c" />
                ) : (
                  <ShieldAlert size={20} color="#ef4444" />
                )}
                <Text size="2" weight="bold">
                  {downloadStatus.matches
                    ? '✔ DESCARGA COMPLETADA Y HASH SHA-256 VERIFICADO'
                    : '⚠️ VERIFICACIÓN DE INTEGRIDAD FALLIDA'}
                </Text>
              </Flex>

              {downloadStatus.filePath && (
                <Text size="2" color="gray">
                  Guardado en: <code>{downloadStatus.filePath}</code>
                </Text>
              )}

              {downloadStatus.actualHash && (
                <Box
                  p="2"
                  style={{
                    background: 'var(--gray-1)',
                    borderRadius: 6,
                    fontFamily: 'monospace',
                    fontSize: 12
                  }}
                >
                  <Text size="1" color="gray" as="div">
                    Hash SHA-256 Calculado:
                  </Text>
                  <Text size="2" weight="bold" style={{ wordBreak: 'break-all' }}>
                    {downloadStatus.actualHash}
                  </Text>
                </Box>
              )}
            </Flex>
          </Card>
        )}

        {/* Herramienta Integrada de Verificación de Archivos Locales */}
        <Card size="2" mb="4" style={{ background: 'var(--gray-2)', borderColor: 'var(--gray-5)' }}>
          <Flex direction="column" gap="3">
            <Flex justify="between" align="center" wrap="wrap" gap="2">
              <Flex align="center" gap="2">
                <FileCheck size={18} color="var(--iris-9)" />
                <Heading size="3">Comprobador de Hash SHA-256 Local</Heading>
              </Flex>
              <Button
                size="1"
                variant="soft"
                color="iris"
                disabled={isVerifyingFile}
                onClick={() => handleSelectLocalFileToVerify()}
                style={{ cursor: 'pointer' }}
              >
                <Search size={13} style={{ marginRight: 4 }} />
                Seleccionar archivo y calcular hash
              </Button>
            </Flex>

            <Text size="2" color="gray">
              Puedes verificar cualquier instalador o paquete descargado (.AppImage, .deb, .rpm, .exe, .dmg, .apk) para contrastar su suma criptográfica contra el release oficial.
            </Text>

            {localVerification && (
              <Box
                p="3"
                style={{
                  background: 'var(--gray-3)',
                  borderRadius: 8,
                  border: localVerification.expectedHash
                    ? localVerification.matches
                      ? '1px solid rgba(48, 164, 108, 0.4)'
                      : '1px solid rgba(239, 68, 68, 0.4)'
                    : '1px solid var(--gray-6)'
                }}
              >
                <Flex direction="column" gap="2">
                  <Flex justify="between" align="center" wrap="wrap" gap="2">
                    <Text size="2" weight="bold">
                      Archivo: {localVerification.fileName}
                    </Text>
                    {localVerification.expectedHash ? (
                      <Badge size="2" color={localVerification.matches ? 'green' : 'red'}>
                        {localVerification.matches ? '✔ Coincidencia Exacta' : '✖ Hash Discordante'}
                      </Badge>
                    ) : (
                      <Badge size="1" color="gray">
                        Hash calculado
                      </Badge>
                    )}
                  </Flex>

                  <Box
                    p="2"
                    style={{
                      background: 'var(--gray-1)',
                      borderRadius: 6,
                      fontFamily: 'monospace',
                      fontSize: 12
                    }}
                  >
                    <Text size="1" color="gray" as="div">
                      SHA-256:
                    </Text>
                    <Text size="1" weight="medium" style={{ wordBreak: 'break-all' }}>
                      {localVerification.actualHash}
                    </Text>
                  </Box>
                </Flex>
              </Box>
            )}
          </Flex>
        </Card>

        {/* Tabla de Assets y Hashes Oficiales de la Versión Remota */}
        {release && release.assets.length > 0 && (
          <Card size="2" style={{ background: 'var(--gray-2)', borderColor: 'var(--gray-5)' }}>
            <Flex direction="column" gap="3">
              <Flex justify="between" align="center" wrap="wrap" gap="2">
                <Flex align="center" gap="2">
                  <ShieldCheck size={18} color="#21d4f5" />
                  <Heading size="3">
                    Hashes SHA-256 Oficiales ({release.tagName})
                  </Heading>
                </Flex>
                <Text size="1" color="gray">
                  Publicado: {new Date(release.publishedAt).toLocaleString()}
                </Text>
              </Flex>

              <Text size="2" color="gray">
                Las siguientes sumas de verificación fueron extraídas de los manifiestos oficiales de GitHub Releases (SHA256SUMS.txt):
              </Text>

              <Flex direction="column" gap="2">
                {release.assets
                  .filter((a) => !a.name.endsWith('.txt'))
                  .map((asset) => {
                    const isRecommended = recommendedAsset?.id === asset.id;
                    const isDownloadingThis = downloadingAssetId === asset.id;

                    return (
                      <Box
                        key={asset.id}
                        p="3"
                        style={{
                          background: isRecommended ? 'rgba(8, 123, 255, 0.08)' : 'var(--gray-3)',
                          borderRadius: 8,
                          border: isRecommended
                            ? '1px solid rgba(33, 212, 245, 0.3)'
                            : '1px solid var(--gray-4)'
                        }}
                      >
                        <Flex justify="between" align="start" wrap="wrap" gap="3">
                          <Box style={{ flex: 1, minWidth: 260 }}>
                            <Flex align="center" gap="2" mb="1">
                              <Text size="2" weight="bold">
                                {asset.name}
                              </Text>
                              {isRecommended && (
                                <Badge size="1" color="cyan">
                                  Tu Sistema
                                </Badge>
                              )}
                              <Text size="1" color="gray">
                                ({(asset.size / (1024 * 1024)).toFixed(1)} MB)
                              </Text>
                            </Flex>

                            {/* Hash Monospace */}
                            {asset.sha256 ? (
                              <Flex align="center" gap="2" mt="1">
                                <Box
                                  px="2"
                                  py="1"
                                  style={{
                                    background: 'var(--gray-1)',
                                    borderRadius: 4,
                                    fontFamily: 'monospace',
                                    fontSize: 11,
                                    wordBreak: 'break-all',
                                    flex: 1
                                  }}
                                >
                                  <span style={{ color: 'var(--gray-9)', marginRight: 6 }}>SHA256:</span>
                                  <code>{asset.sha256}</code>
                                </Box>
                                <IconButton
                                  size="1"
                                  variant="ghost"
                                  color="gray"
                                  onClick={() => copyToClipboard(asset.sha256!, String(asset.id))}
                                  title="Copiar hash SHA-256"
                                >
                                  {copiedHash === String(asset.id) ? (
                                    <Check size={12} color="#30a46c" />
                                  ) : (
                                    <Copy size={12} />
                                  )}
                                </IconButton>
                              </Flex>
                            ) : (
                              <Text size="1" color="gray" mt="1">
                                Hash no listado en manifiesto
                              </Text>
                            )}
                          </Box>

                          <Flex gap="2" align="center">
                            {asset.sha256 && (
                              <Button
                                size="1"
                                variant="soft"
                                color="gray"
                                onClick={() => handleSelectLocalFileToVerify(asset.sha256)}
                                title="Seleccionar archivo local y comparar con este hash"
                              >
                                <FileCheck size={13} style={{ marginRight: 4 }} />
                                Comprobar Archivo
                              </Button>
                            )}
                            <Button
                              size="1"
                              variant={isRecommended ? 'solid' : 'soft'}
                              color={isRecommended ? 'cyan' : 'iris'}
                              disabled={isDownloadingThis}
                              onClick={() => handleDownloadAndVerify(asset)}
                              style={{ cursor: 'pointer' }}
                            >
                              <Download size={13} style={{ marginRight: 4 }} />
                              {isDownloadingThis ? 'Descargando...' : 'Descargar'}
                            </Button>
                          </Flex>
                        </Flex>
                      </Box>
                    );
                  })}
              </Flex>
            </Flex>
          </Card>
        )}
      </Box>
    </ScrollArea>
  );
};

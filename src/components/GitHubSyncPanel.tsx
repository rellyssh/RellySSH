import React, { useState, useEffect, useRef } from 'react';
import {
  Flex,
  Box,
  Heading,
  Text,
  Button,
  TextField,
  Callout,
  Badge,
  Card,
  Switch,
  Separator,
  IconButton
} from '@radix-ui/themes';
import { GitHubLogoIcon } from '@radix-ui/react-icons';
import {
  CloudUpload,
  CloudDownload,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  ShieldCheck,
  RefreshCw,
  LogOut,
  FolderGit2,
  GitCommit,
  Copy,
  Check,
  ArrowRight,
  Shield,
  Key
} from 'lucide-react';
import {
  getGitHubConfig,
  saveGitHubConfig,
  clearGitHubConfig,
  validateGitHubToken,
  pushVaultToGitHub,
  pullVaultFromGitHub,
  DEFAULT_REPO_NAME,
  type GitHubSyncConfig,
  type GitHubSyncTarget
} from '../services/githubSync';
import {
  requestDeviceCode,
  pollDeviceTokenUntilComplete,
  openBrowserUrl,
  setupGitHubAccountAndVault,
  DEFAULT_GITHUB_CLIENT_ID,
  type DeviceCodeResponse
} from '../services/githubAuth';
import type { VaultData } from '../types';

interface Props {
  onVaultUpdated?: (data: VaultData) => void;
  showToast: (msg: string) => void;
  onBackToServers?: () => void;
}

export const GitHubSyncPanel: React.FC<Props> = ({
  onVaultUpdated,
  showToast,
  onBackToServers
}) => {
  const [config, setConfig] = useState<GitHubSyncConfig | null>(null);
  const [autoSyncEnabled, setAutoSyncEnabled] = useState(false);
  const [isPushing, setIsPushing] = useState(false);
  const [isPulling, setIsPulling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Desconexión inline (sin modal)
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);

  // Estado para conexión mediante Device Flow en el panel
  const [isAuthorizing, setIsAuthorizing] = useState(false);
  const [deviceData, setDeviceData] = useState<DeviceCodeResponse | null>(null);
  const [pollStatus, setPollStatus] = useState<string>('');
  const [codeCopied, setCodeCopied] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  // Estado para conexión manual por PAT
  const [showManualToken, setShowManualToken] = useState(false);
  const [manualTokenInput, setManualTokenInput] = useState('');
  const [isConnectingManual, setIsConnectingManual] = useState(false);

  useEffect(() => {
    const current = getGitHubConfig();
    setConfig(current);
    if (current) {
      setAutoSyncEnabled(current.autoSync ?? false);
    }
  }, []);

  useEffect(() => {
    return () => {
      if (abortRef.current) {
        abortRef.current.abort();
      }
    };
  }, []);

  // ==========================================
  // CONEXIÓN AUTOMÁTICA CON DEVICE FLOW
  // ==========================================

  const handleStartDeviceAuth = async () => {
    setError(null);
    setSuccessMsg(null);
    setIsAuthorizing(true);
    setPollStatus('Solicitando código de dispositivo a GitHub...');

    try {
      const res = await requestDeviceCode(DEFAULT_GITHUB_CLIENT_ID, 'repo,gist,read:user');
      if (!res.success || !res.data) {
        setIsAuthorizing(false);
        setError(res.error || 'No se pudo conectar con GitHub.');
        return;
      }

      setDeviceData(res.data);
      setPollStatus('Esperando confirmación en tu navegador...');

      // Copiar código al portapapeles
      if (navigator.clipboard && res.data.user_code) {
        navigator.clipboard.writeText(res.data.user_code).catch(() => {});
        setCodeCopied(true);
        setTimeout(() => setCodeCopied(false), 3000);
      }

      // Abrir navegador
      openBrowserUrl(res.data.verification_uri);

      // Iniciar polling
      const controller = new AbortController();
      abortRef.current = controller;

      const tokenResult = await pollDeviceTokenUntilComplete(
        DEFAULT_GITHUB_CLIENT_ID,
        res.data.device_code,
        res.data.interval,
        res.data.expires_in,
        (s) => setPollStatus(s),
        controller.signal
      );

      if (!tokenResult.success || !tokenResult.token) {
        if (!controller.signal.aborted) {
          setError(tokenResult.error || 'Error en la autorización.');
          setIsAuthorizing(false);
        }
        return;
      }

      // Configurar cuenta y verificar/crear repo
      setPollStatus('Verificando repositorio privado en tu cuenta...');
      const setup = await setupGitHubAccountAndVault(tokenResult.token);

      if (!setup.success || !setup.user) {
        setError(setup.error || 'Error vinculando repositorio.');
        setIsAuthorizing(false);
        return;
      }

      const newConfig: GitHubSyncConfig = {
        token: tokenResult.token,
        targetType: 'repo',
        repoOwner: setup.user.login,
        repoName: setup.repoName || DEFAULT_REPO_NAME,
        user: setup.user,
        autoSync: true,
        lastSyncTime: new Date().toISOString()
      };

      saveGitHubConfig(newConfig);
      setConfig(newConfig);
      setAutoSyncEnabled(true);
      setIsAuthorizing(false);
      setDeviceData(null);
      setSuccessMsg(`¡Cuenta @${setup.user.login} vinculada con éxito!`);
      showToast(`¡Conectado exitosamente con @${setup.user.login}!`);
    } catch (err: any) {
      setIsAuthorizing(false);
      setError(err.message || 'Error durante la autenticación con GitHub.');
    }
  };

  const handleCancelDeviceAuth = () => {
    if (abortRef.current) {
      abortRef.current.abort();
    }
    setIsAuthorizing(false);
    setDeviceData(null);
    setError(null);
  };

  // ==========================================
  // CONEXIÓN MANUAL CON TOKEN (PAT)
  // ==========================================

  const handleManualTokenSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualTokenInput.trim()) {
      setError('Por favor ingresá un Personal Access Token de GitHub.');
      return;
    }

    setIsConnectingManual(true);
    setError(null);

    const validation = await validateGitHubToken(manualTokenInput.trim());
    if (!validation.valid || !validation.user) {
      setIsConnectingManual(false);
      setError(validation.error || 'Token inválido.');
      return;
    }

    const newConfig: GitHubSyncConfig = {
      token: manualTokenInput.trim(),
      targetType: 'repo',
      repoOwner: validation.user.login,
      repoName: DEFAULT_REPO_NAME,
      user: validation.user,
      autoSync: autoSyncEnabled,
      lastSyncTime: undefined
    };

    saveGitHubConfig(newConfig);
    setConfig(newConfig);
    setManualTokenInput('');
    setIsConnectingManual(false);
    setShowManualToken(false);
    showToast(`¡Conectado exitosamente con @${validation.user.login}!`);
  };

  // ==========================================
  // OPERACIONES DE SINCRONIZACIÓN (PUSH / PULL)
  // ==========================================

  const handlePush = async () => {
    if (!config?.token) return;
    setIsPushing(true);
    setError(null);
    setSuccessMsg(null);

    try {
      const rawVault = await window.electronAPI.getRawVault();
      if (!rawVault) {
        throw new Error('No se pudo leer la bóveda local.');
      }

      const res = await pushVaultToGitHub(config, rawVault);
      if (res.success) {
        const updatedConfig: GitHubSyncConfig = {
          ...config,
          lastSyncTime: res.updatedAt || new Date().toISOString(),
          lastSyncAction: 'push',
          lastCommitSha: res.commitSha
        };
        saveGitHubConfig(updatedConfig);
        setConfig(updatedConfig);
        setSuccessMsg(`Bóveda respaldada en GitHub exitosamente (${res.repoName || 'rellyssh-vault'}).`);
        showToast('Bóveda respaldada en GitHub con éxito.');
      } else {
        setError(res.error || 'Error al respaldar en GitHub.');
      }
    } catch (err: any) {
      setError(err.message || 'Error al respaldar en GitHub.');
    } finally {
      setIsPushing(false);
    }
  };

  const handlePull = async () => {
    if (!config?.token) return;
    setIsPulling(true);
    setError(null);
    setSuccessMsg(null);

    try {
      const res = await pullVaultFromGitHub(config);
      if (res.success && res.encryptedContent) {
        const saveRes = await window.electronAPI.saveRawVault(res.encryptedContent);
        if (!saveRes.success) {
          throw new Error(saveRes.error || 'No se pudo guardar la bóveda descargada.');
        }

        const unlockRes = await window.electronAPI.unlockVault('');
        if (unlockRes.success && unlockRes.data && onVaultUpdated) {
          onVaultUpdated(unlockRes.data);
        }

        const updatedConfig: GitHubSyncConfig = {
          ...config,
          lastSyncTime: res.updatedAt || new Date().toISOString(),
          lastSyncAction: 'pull',
          lastCommitSha: res.commitSha
        };
        saveGitHubConfig(updatedConfig);
        setConfig(updatedConfig);
        setSuccessMsg('Bóveda descargada y actualizada exitosamente.');
        showToast('Bóveda descargada desde GitHub.');
      } else {
        setError(res.error || 'Error al descargar desde GitHub.');
      }
    } catch (err: any) {
      setError(err.message || 'Error al descargar desde GitHub.');
    } finally {
      setIsPulling(false);
    }
  };

  const handleToggleAutoSync = (checked: boolean) => {
    setAutoSyncEnabled(checked);
    if (config) {
      const updated = { ...config, autoSync: checked };
      saveGitHubConfig(updated);
      setConfig(updated);
      showToast(checked ? 'Sincronización automática activada.' : 'Sincronización automática desactivada.');
    }
  };

  const handleDisconnect = () => {
    clearGitHubConfig();
    setConfig(null);
    setConfirmDisconnect(false);
    setSuccessMsg(null);
    showToast('Cuenta de GitHub desconectada.');
  };

  return (
    <Flex direction="column" style={{ flex: 1, minHeight: 0, overflowY: 'auto' }} p="6">
      {/* Encabezado Principal */}
      <Flex align="center" justify="between" pb="4" style={{ borderBottom: '1px solid var(--gray-4)' }}>
        <Flex direction="column" gap="1">
          <Flex align="center" gap="2">
            <GitHubLogoIcon width={24} height={24} />
            <Heading size="5">Sincronización con GitHub</Heading>
          </Flex>
          <Text size="2" color="gray">
            Respaldo y sincronización automática Zero-Knowledge en tu repositorio privado
          </Text>
        </Flex>

        {onBackToServers && (
          <Button size="2" variant="soft" color="gray" onClick={onBackToServers}>
            Volver a Servidores
          </Button>
        )}
      </Flex>

      {/* Alertas de error y éxito */}
      {error && (
        <Callout.Root color="red" size="1" mt="4">
          <Callout.Icon>
            <AlertCircle size={16} />
          </Callout.Icon>
          <Callout.Text>{error}</Callout.Text>
        </Callout.Root>
      )}

      {successMsg && (
        <Callout.Root color="green" size="1" mt="4">
          <Callout.Icon>
            <CheckCircle2 size={16} />
          </Callout.Icon>
          <Callout.Text>{successMsg}</Callout.Text>
        </Callout.Root>
      )}

      <Box pt="4" style={{ maxWidth: 840 }}>
        {config?.user ? (
          /* ==========================================================
             ESTADO 1: USUARIO CONECTADO
             ========================================================== */
          <Flex direction="column" gap="4">
            {/* Tarjeta de Cuenta Conectada */}
            <Card variant="surface" style={{ background: 'var(--gray-2)', border: '1px solid var(--gray-4)' }}>
              <Flex justify="between" align="center" wrap="wrap" gap="3">
                <Flex align="center" gap="3">
                  {config.user.avatar_url ? (
                    <img
                      src={config.user.avatar_url}
                      alt={config.user.login}
                      style={{ width: 48, height: 48, borderRadius: '50%', border: '2px solid #21d4f5' }}
                    />
                  ) : (
                    <GitHubLogoIcon width={40} height={40} />
                  )}
                  <Flex direction="column">
                    <Flex align="center" gap="2">
                      <Text size="3" weight="bold">
                        {config.user.name || config.user.login}
                      </Text>
                      <Badge color="green" size="1">
                        Conectado
                      </Badge>
                    </Flex>
                    <Text size="2" color="gray">
                      @{config.user.login}
                    </Text>
                  </Flex>
                </Flex>

                <Button
                  size="2"
                  variant="soft"
                  color="gray"
                  onClick={() => openBrowserUrl(`https://github.com/${config.user?.login}/${config.repoName || DEFAULT_REPO_NAME}`)}
                >
                  <FolderGit2 size={15} style={{ marginRight: 6 }} /> Ver Repositorio en GitHub <ExternalLink size={12} style={{ marginLeft: 4 }} />
                </Button>
              </Flex>
            </Card>

            {/* Panel de Operaciones de Sincronización */}
            <Card variant="surface" style={{ background: 'var(--gray-2)', border: '1px solid var(--gray-4)' }}>
              <Flex direction="column" gap="4">
                <Heading size="3">Estado de Sincronización</Heading>

                <Flex align="center" justify="between" p="3" style={{ background: 'var(--gray-3)', borderRadius: 6 }}>
                  <Flex direction="column" gap="1">
                    <Text size="2" weight="medium">
                      Sincronización Automática al Guardar
                    </Text>
                    <Text size="1" color="gray">
                      Sube automáticamente los cambios a tu repositorio al agregar o editar servidores y llaves.
                    </Text>
                  </Flex>
                  <Switch checked={autoSyncEnabled} onCheckedChange={handleToggleAutoSync} />
                </Flex>

                <Flex gap="3" wrap="wrap">
                  <Button
                    size="3"
                    variant="solid"
                    color="iris"
                    loading={isPushing}
                    onClick={handlePush}
                    style={{ flex: 1, minWidth: 200, cursor: 'pointer' }}
                  >
                    <CloudUpload size={16} style={{ marginRight: 6 }} /> Subir a GitHub (Push)
                  </Button>

                  <Button
                    size="3"
                    variant="soft"
                    color="cyan"
                    loading={isPulling}
                    onClick={handlePull}
                    style={{ flex: 1, minWidth: 200, cursor: 'pointer' }}
                  >
                    <CloudDownload size={16} style={{ marginRight: 6 }} /> Descargar de GitHub (Pull)
                  </Button>
                </Flex>

                {config.lastSyncTime && (
                  <Flex align="center" gap="2" pt="1">
                    <GitCommit size={14} color="var(--gray-9)" />
                    <Text size="1" color="gray">
                      Última sincronización: <strong>{new Date(config.lastSyncTime).toLocaleString()}</strong>
                      {config.lastSyncAction && ` (${config.lastSyncAction.toUpperCase()})`}
                    </Text>
                  </Flex>
                )}
              </Flex>
            </Card>

            {/* Garantía Zero-Knowledge */}
            <Callout.Root color="blue" size="1">
              <Callout.Icon>
                <ShieldCheck size={16} />
              </Callout.Icon>
              <Callout.Text>
                <strong>Garantía de Conocimiento Cero (Zero-Knowledge):</strong> El archivo en tu repositorio de GitHub contiene únicamente texto cifrado generado localmente con <strong>Argon2id + AES-256-GCM</strong>. Ni GitHub ni intermediarios pueden leer tus claves o contraseñas.
              </Callout.Text>
            </Callout.Root>

            {/* Zona de Desconexión Integrada (Sin Modales) */}
            <Card variant="surface" style={{ background: 'var(--gray-2)', border: '1px solid var(--red-5)', padding: 16 }}>
              {!confirmDisconnect ? (
                <Flex align="center" justify="between" wrap="wrap" gap="2">
                  <Flex direction="column">
                    <Text size="2" weight="bold" color="red">
                      Desconectar Cuenta de GitHub
                    </Text>
                    <Text size="1" color="gray">
                      Desvincula esta instalación de RellySSH. Tus datos en el repositorio privado permanecerán intactos.
                    </Text>
                  </Flex>
                  <Button size="2" variant="soft" color="red" onClick={() => setConfirmDisconnect(true)}>
                    <LogOut size={15} style={{ marginRight: 6 }} /> Desconectar
                  </Button>
                </Flex>
              ) : (
                <Flex direction="column" gap="3">
                  <Text size="2" weight="bold" color="red">
                    ¿Estás seguro de que deseas desconectar tu cuenta @{config.user.login}?
                  </Text>
                  <Text size="1" color="gray">
                    La sincronización automática se detendrá en este dispositivo. Podrás volver a vincularte en cualquier momento.
                  </Text>
                  <Flex gap="2">
                    <Button size="2" variant="solid" color="red" onClick={handleDisconnect}>
                      Confirmar Desconexión
                    </Button>
                    <Button size="2" variant="soft" color="gray" onClick={() => setConfirmDisconnect(false)}>
                      Cancelar
                    </Button>
                  </Flex>
                </Flex>
              )}
            </Card>
          </Flex>
        ) : (
          /* ==========================================================
             ESTADO 2: NO CONECTADO -> INICIO DE SESIÓN EN 1-CLIC
             ========================================================== */
          <Flex direction="column" gap="4">
            <Callout.Root color="indigo" size="2">
              <Callout.Icon>
                <Shield size={18} />
              </Callout.Icon>
              <Callout.Text>
                Vincular RellySSH con GitHub te permite respaldar y sincronizar tus servidores y llaves cifradas automáticamente en tu propio repositorio privado <strong>rellyssh-vault</strong> en cualquier equipo.
              </Callout.Text>
            </Callout.Root>

            {isAuthorizing ? (
              /* Flujo Device Flow Activo */
              <Card variant="surface" style={{ background: 'var(--gray-2)', border: '1px solid #21d4f5', padding: 24 }}>
                <Flex direction="column" gap="4">
                  <Heading size="3">Autorizá RellySSH en tu Navegador</Heading>
                  <Text size="2" color="gray">
                    Hemos abierto la página de verificación de GitHub. Ingresá el siguiente código:
                  </Text>

                  <Flex
                    direction="column"
                    align="center"
                    justify="center"
                    p="4"
                    gap="2"
                    style={{
                      background: 'rgba(0, 0, 0, 0.4)',
                      border: '1px dashed #21d4f5',
                      borderRadius: 8
                    }}
                  >
                    <Text size="1" color="gray">
                      CÓDIGO DE AUTORIZACIÓN:
                    </Text>
                    <Heading
                      size="7"
                      style={{
                        letterSpacing: 4,
                        color: '#21d4f5',
                        fontFamily: 'monospace',
                        fontWeight: 700
                      }}
                    >
                      {deviceData?.user_code || '---- ----'}
                    </Heading>

                    <Button
                      size="1"
                      variant="soft"
                      color={codeCopied ? 'green' : 'gray'}
                      onClick={() => {
                        if (deviceData?.user_code && navigator.clipboard) {
                          navigator.clipboard.writeText(deviceData.user_code);
                          setCodeCopied(true);
                          setTimeout(() => setCodeCopied(false), 2500);
                        }
                      }}
                      style={{ cursor: 'pointer', gap: 4 }}
                    >
                      {codeCopied ? <Check size={13} /> : <Copy size={13} />}
                      <span>{codeCopied ? '¡Código Copiado!' : 'Copiar Código'}</span>
                    </Button>
                  </Flex>

                  <Button
                    size="3"
                    variant="solid"
                    onClick={() => deviceData?.verification_uri && openBrowserUrl(deviceData.verification_uri)}
                    style={{ background: '#087bff', color: '#fff', fontWeight: 600, cursor: 'pointer' }}
                  >
                    <ExternalLink size={16} style={{ marginRight: 6 }} /> Abrir Página de Autorización de GitHub
                  </Button>

                  <Flex align="center" justify="center" gap="2">
                    <Box
                      style={{
                        width: 14,
                        height: 14,
                        borderRadius: '50%',
                        border: '2px solid #88a0c5',
                        borderTopColor: '#21d4f5',
                        animation: 'spin 1s linear infinite'
                      }}
                    />
                    <Text size="1" color="gray">
                      {pollStatus}
                    </Text>
                  </Flex>

                  <Button size="1" variant="ghost" color="gray" onClick={handleCancelDeviceAuth} style={{ alignSelf: 'center' }}>
                    Cancelar
                  </Button>
                </Flex>
              </Card>
            ) : (
              /* Botón Principal de Conexión Automática */
              <Card variant="surface" style={{ background: 'var(--gray-2)', border: '1px solid var(--gray-4)', padding: 24 }}>
                <Flex direction="column" gap="4" align="center" style={{ textAlign: 'center' }}>
                  <GitHubLogoIcon width={48} height={48} />
                  <Flex direction="column" gap="1">
                    <Heading size="4">Conexión Automática con GitHub</Heading>
                    <Text size="2" color="gray" style={{ maxWidth: 500 }}>
                      Un solo clic para vincular tu cuenta sin crear ni copiar tokens manuales. Creará y configurará tu repositorio privado automáticamente.
                    </Text>
                  </Flex>

                  <Button
                    size="3"
                    variant="solid"
                    onClick={handleStartDeviceAuth}
                    style={{
                      background: '#24292f',
                      border: '1px solid rgba(255, 255, 255, 0.15)',
                      color: '#ffffff',
                      height: 48,
                      fontSize: 14,
                      fontWeight: 600,
                      cursor: 'pointer',
                      paddingLeft: 24,
                      paddingRight: 24
                    }}
                  >
                    <GitHubLogoIcon width={18} height={18} style={{ marginRight: 8 }} />
                    Conectar con GitHub (1-Clic)
                  </Button>

                  <Separator style={{ width: '100%', margin: '8px 0' }} />

                  {/* Opción Manual Alternativa (PAT) */}
                  {!showManualToken ? (
                    <Button size="1" variant="ghost" color="gray" onClick={() => setShowManualToken(true)}>
                      <Key size={13} style={{ marginRight: 4 }} /> O conectar con Personal Access Token (PAT)
                    </Button>
                  ) : (
                    <form onSubmit={handleManualTokenSubmit} style={{ width: '100%', maxWidth: 460 }}>
                      <Flex direction="column" gap="3" style={{ textAlign: 'left' }}>
                        <Flex justify="between" align="center">
                          <Text size="1" weight="medium">
                            Personal Access Token de GitHub
                          </Text>
                          <Button size="1" variant="ghost" color="gray" onClick={() => setShowManualToken(false)}>
                            Ocultar
                          </Button>
                        </Flex>
                        <TextField.Root
                          type="password"
                          size="2"
                          placeholder="ghp_... o github_pat_..."
                          value={manualTokenInput}
                          onChange={(e) => setManualTokenInput(e.target.value)}
                        />
                        <Button type="submit" size="2" variant="solid" loading={isConnectingManual}>
                          Guardar y Conectar Token
                        </Button>
                      </Flex>
                    </form>
                  )}
                </Flex>
              </Card>
            )}
          </Flex>
        )}
      </Box>
    </Flex>
  );
};

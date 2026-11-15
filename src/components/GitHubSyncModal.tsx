import React, { useState, useEffect } from 'react';
import {
  Dialog,
  Flex,
  Box,
  Text,
  Button,
  TextField,
  Callout,
  Badge,
  Card,
  Avatar,
  Separator,
  Switch,
  Tooltip,
  SegmentedControl
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
  FileCode2,
  GitCommit,
  GitBranch
} from 'lucide-react';
import {
  getGitHubConfig,
  saveGitHubConfig,
  clearGitHubConfig,
  validateGitHubToken,
  pushVaultToGitHub,
  pullVaultFromGitHub,
  DEFAULT_REPO_NAME,
  GITHUB_TOKEN_CREATE_URL,
  type GitHubSyncConfig,
  type GitHubSyncTarget
} from '../services/githubSync';
import type { VaultData } from '../types';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onVaultUpdated?: (data: VaultData) => void;
  showToast: (msg: string) => void;
}

export const GitHubSyncModal: React.FC<Props> = ({
  isOpen,
  onClose,
  onVaultUpdated,
  showToast
}) => {
  const [config, setConfig] = useState<GitHubSyncConfig | null>(null);
  const [tokenInput, setTokenInput] = useState('');
  const [targetType, setTargetType] = useState<GitHubSyncTarget>('repo');
  const [repoNameInput, setRepoNameInput] = useState(DEFAULT_REPO_NAME);
  const [autoSyncEnabled, setAutoSyncEnabled] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isPushing, setIsPushing] = useState(false);
  const [isPulling, setIsPulling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      const current = getGitHubConfig();
      setConfig(current);
      if (current) {
        setTargetType(current.targetType || (current.gistId ? 'gist' : 'repo'));
        setRepoNameInput(current.repoName || DEFAULT_REPO_NAME);
        setAutoSyncEnabled(current.autoSync ?? false);
      } else {
        setTargetType('repo');
        setRepoNameInput(DEFAULT_REPO_NAME);
        setAutoSyncEnabled(false);
      }
      setError(null);
    }
  }, [isOpen]);

  const handleConnect = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tokenInput.trim()) {
      setError('Por favor ingresá un Personal Access Token de GitHub.');
      return;
    }

    setIsConnecting(true);
    setError(null);

    const validation = await validateGitHubToken(tokenInput);
    if (!validation.valid || !validation.user) {
      setIsConnecting(false);
      setError(validation.error || 'Token inválido.');
      return;
    }

    const cleanRepoName = repoNameInput.trim() || DEFAULT_REPO_NAME;
    const newConfig: GitHubSyncConfig = {
      token: tokenInput.trim(),
      targetType,
      repoOwner: validation.user.login,
      repoName: cleanRepoName,
      user: validation.user,
      autoSync: autoSyncEnabled,
      lastSyncTime: undefined
    };

    saveGitHubConfig(newConfig);
    setConfig(newConfig);
    setTokenInput('');
    setIsConnecting(false);
    showToast(`¡Conectado exitosamente con @${validation.user.login}!`);
  };

  const handleDisconnect = () => {
    clearGitHubConfig();
    setConfig(null);
    setAutoSyncEnabled(false);
    setTargetType('repo');
    setRepoNameInput(DEFAULT_REPO_NAME);
    showToast('Cuenta de GitHub desvinculada.');
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

  const handleTargetTypeChange = (value: GitHubSyncTarget) => {
    setTargetType(value);
    if (config) {
      const updated: GitHubSyncConfig = {
        ...config,
        targetType: value,
        repoName: config.repoName || DEFAULT_REPO_NAME
      };
      saveGitHubConfig(updated);
      setConfig(updated);
      showToast(`Modo de sincronización cambiado a ${value === 'repo' ? 'Repositorio Privado' : 'Gist Privado'}.`);
    }
  };

  const handleSaveRepoName = (newRepo: string) => {
    const clean = newRepo.trim() || DEFAULT_REPO_NAME;
    setRepoNameInput(clean);
    if (config) {
      const updated = { ...config, repoName: clean };
      saveGitHubConfig(updated);
      setConfig(updated);
    }
  };

  const handlePush = async () => {
    if (!config) return;
    setIsPushing(true);
    setError(null);

    try {
      const rawEncrypted = await window.electronAPI.getRawVault();
      if (!rawEncrypted) {
        throw new Error('No se pudo leer la bóveda cifrada local.');
      }

      const activeConfig: GitHubSyncConfig = {
        ...config,
        targetType,
        repoName: repoNameInput.trim() || DEFAULT_REPO_NAME
      };

      const res = await pushVaultToGitHub(activeConfig, rawEncrypted);
      if (!res.success) {
        throw new Error(res.error || 'Error al subir la bóveda a GitHub.');
      }

      const updated: GitHubSyncConfig = {
        ...activeConfig,
        repoUrl: res.repoUrl || activeConfig.repoUrl,
        lastCommitSha: res.commitSha || activeConfig.lastCommitSha,
        gistId: res.gistId || activeConfig.gistId,
        gistUrl: res.gistUrl || activeConfig.gistUrl,
        lastSyncTime: res.updatedAt || new Date().toISOString(),
        lastSyncAction: 'push'
      };

      saveGitHubConfig(updated);
      setConfig(updated);

      const dest = activeConfig.targetType === 'repo'
        ? `repositorio privado "${activeConfig.repoName}"`
        : 'Gist privado';
      showToast(`¡Bóveda cifrada respaldada exitosamente en tu ${dest}!`);
    } catch (err: any) {
      setError(err.message || 'Fallo al subir a GitHub.');
    } finally {
      setIsPushing(false);
    }
  };

  const handlePull = async () => {
    if (!config) return;
    setIsPulling(true);
    setError(null);

    try {
      const activeConfig: GitHubSyncConfig = {
        ...config,
        targetType,
        repoName: repoNameInput.trim() || DEFAULT_REPO_NAME
      };

      const res = await pullVaultFromGitHub(activeConfig);
      if (!res.success || !res.encryptedContent) {
        throw new Error(res.error || 'Error al descargar la bóveda de GitHub.');
      }

      // Guardar bóveda cifrada localmente
      const saveRes = await window.electronAPI.saveRawVault(res.encryptedContent);
      if (!saveRes.success) {
        throw new Error(saveRes.error || 'Error al guardar la bóveda localmente.');
      }

      const updated: GitHubSyncConfig = {
        ...activeConfig,
        repoUrl: res.repoUrl || activeConfig.repoUrl,
        lastCommitSha: res.commitSha || activeConfig.lastCommitSha,
        gistId: res.gistId || activeConfig.gistId,
        lastSyncTime: res.updatedAt || new Date().toISOString(),
        lastSyncAction: 'pull'
      };

      saveGitHubConfig(updated);
      setConfig(updated);
      showToast('Bóveda descargada de GitHub y sincronizada localmente.');

      // Desbloquear con contraseña actual en memoria si está disponible
      const unlockRes = await window.electronAPI.unlockVault('');
      if (unlockRes.success && unlockRes.data && onVaultUpdated) {
        onVaultUpdated(unlockRes.data);
      }
    } catch (err: any) {
      setError(err.message || 'Fallo al descargar de GitHub.');
    } finally {
      setIsPulling(false);
    }
  };

  return (
    <Dialog.Root open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <Dialog.Content style={{ maxWidth: 540, borderRadius: 12 }}>
        <Dialog.Title>
          <Flex align="center" gap="2">
            <GitHubLogoIcon width={22} height={22} color="var(--iris-9)" />
            <Text size="4" weight="bold">
              Sincronización con GitHub
            </Text>
          </Flex>
        </Dialog.Title>

        <Dialog.Description size="2" color="gray" mb="3">
          Respaldo y sincronización entre dispositivos mediante un repositorio privado o Gist seguro.
        </Dialog.Description>

        {error && (
          <Callout.Root color="red" size="1" mb="3">
            <Callout.Icon>
              <AlertCircle size={15} />
            </Callout.Icon>
            <Callout.Text>{error}</Callout.Text>
          </Callout.Root>
        )}

        {!config ? (
          /* Formulario de Conexión Inicial */
          <form onSubmit={handleConnect}>
            <Flex direction="column" gap="3">
              <Callout.Root color="blue" size="1">
                <Callout.Icon>
                  <ShieldCheck size={16} />
                </Callout.Icon>
                <Callout.Text>
                  <strong>Seguridad Zero-Knowledge:</strong> Tus contraseñas, claves privadas y configuraciones nunca se envían en texto plano. En GitHub solo se almacena el archivo cifrado con <strong>Argon2id + AES-256-GCM</strong>.
                </Callout.Text>
              </Callout.Root>

              <Box>
                <Text size="2" weight="medium" mb="1">
                  Destino de Almacenamiento:
                </Text>
                <SegmentedControl.Root
                  value={targetType}
                  onValueChange={(val) => setTargetType(val as GitHubSyncTarget)}
                  style={{ width: '100%' }}
                >
                  <SegmentedControl.Item value="repo">
                    <Flex align="center" gap="1">
                      <FolderGit2 size={14} /> Repositorio Privado
                    </Flex>
                  </SegmentedControl.Item>
                  <SegmentedControl.Item value="gist">
                    <Flex align="center" gap="1">
                      <FileCode2 size={14} /> Gist Privado
                    </Flex>
                  </SegmentedControl.Item>
                </SegmentedControl.Root>
              </Box>

              {targetType === 'repo' && (
                <Box>
                  <Text size="2" weight="medium" mb="1">
                    Nombre del Repositorio Privado
                  </Text>
                  <TextField.Root
                    placeholder="rellyssh-vault"
                    value={repoNameInput}
                    onChange={(e) => setRepoNameInput(e.target.value)}
                    disabled={isConnecting}
                  />
                  <Text size="1" color="gray" mt="1">
                    Se creará automáticamente en tu cuenta si no existe.
                  </Text>
                </Box>
              )}

              <Box>
                <Flex justify="between" align="center" mb="1">
                  <Text size="2" weight="medium">
                    Personal Access Token de GitHub (PAT)
                  </Text>
                  <a
                    href={GITHUB_TOKEN_CREATE_URL}
                    target="_blank"
                    rel="noreferrer"
                    style={{
                      fontSize: 12,
                      color: 'var(--iris-9)',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 4,
                      textDecoration: 'none'
                    }}
                  >
                    Crear Token en GitHub <ExternalLink size={12} />
                  </a>
                </Flex>
                <TextField.Root
                  type="password"
                  placeholder="ghp_... o github_pat_..."
                  value={tokenInput}
                  onChange={(e) => setTokenInput(e.target.value)}
                  disabled={isConnecting}
                />
                <Text size="1" color="gray" mt="1">
                  Requiere permiso <Badge color="indigo" size="1">repo</Badge> (para repositorios privados) o <Badge color="indigo" size="1">gist</Badge>.
                </Text>
              </Box>

              <Flex justify="end" gap="2" mt="2">
                <Button variant="soft" color="gray" onClick={onClose} type="button">
                  Cancelar
                </Button>
                <Button variant="solid" color="iris" type="submit" loading={isConnecting}>
                  <GitHubLogoIcon width={15} height={15} style={{ marginRight: 6 }} /> Vincular Cuenta
                </Button>
              </Flex>
            </Flex>
          </form>
        ) : (
          /* Estado Conectado */
          <Flex direction="column" gap="3">
            {/* Tarjeta de Perfil de Usuario */}
            <Card size="2" style={{ background: 'var(--gray-3)' }}>
              <Flex align="center" justify="between">
                <Flex align="center" gap="3">
                  <Avatar
                    src={config.user?.avatar_url}
                    fallback={config.user?.login.slice(0, 2).toUpperCase() || 'GH'}
                    size="3"
                    radius="full"
                  />
                  <Box>
                    <Flex align="center" gap="2">
                      <Text size="3" weight="bold">
                        {config.user?.name || config.user?.login}
                      </Text>
                      <Badge color="green" size="1">
                        Conectado
                      </Badge>
                    </Flex>
                    <Text size="1" color="gray">
                      @{config.user?.login}
                    </Text>
                  </Box>
                </Flex>

                <Tooltip content="Desvincular cuenta de GitHub">
                  <Button size="1" variant="ghost" color="red" onClick={handleDisconnect}>
                    <LogOut size={14} style={{ marginRight: 4 }} /> Desvincular
                  </Button>
                </Tooltip>
              </Flex>
            </Card>

            {/* Selector de Modo de Destino */}
            <Box px="1">
              <Flex justify="between" align="center" mb="2">
                <Text size="2" weight="medium">
                  Modo de sincronización:
                </Text>
                <SegmentedControl.Root
                  value={targetType}
                  onValueChange={(val) => handleTargetTypeChange(val as GitHubSyncTarget)}
                  size="1"
                >
                  <SegmentedControl.Item value="repo">
                    <Flex align="center" gap="1">
                      <FolderGit2 size={13} /> Repositorio
                    </Flex>
                  </SegmentedControl.Item>
                  <SegmentedControl.Item value="gist">
                    <Flex align="center" gap="1">
                      <FileCode2 size={13} /> Gist
                    </Flex>
                  </SegmentedControl.Item>
                </SegmentedControl.Root>
              </Flex>

              {targetType === 'repo' ? (
                <Box mb="2">
                  <Flex justify="between" align="center">
                    <Text size="2" color="gray">
                      Repositorio Privado:
                    </Text>
                    {config.repoUrl || (config.user && config.repoName) ? (
                      <a
                        href={config.repoUrl || `https://github.com/${config.user?.login}/${config.repoName || DEFAULT_REPO_NAME}`}
                        target="_blank"
                        rel="noreferrer"
                        style={{
                          fontSize: 12,
                          color: 'var(--iris-9)',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 4,
                          textDecoration: 'none'
                        }}
                      >
                        {config.user?.login}/{config.repoName || DEFAULT_REPO_NAME} <ExternalLink size={12} />
                      </a>
                    ) : (
                      <Text size="1" color="gray">
                        {config.repoName || DEFAULT_REPO_NAME} (Privado)
                      </Text>
                    )}
                  </Flex>

                  {config.lastCommitSha && (
                    <Flex justify="between" align="center" mt="1">
                      <Text size="2" color="gray">
                        Último Commit:
                      </Text>
                      <Badge size="1" color="gray" variant="surface">
                        <GitCommit size={11} style={{ marginRight: 3 }} />
                        {config.lastCommitSha.slice(0, 7)}
                      </Badge>
                    </Flex>
                  )}
                </Box>
              ) : (
                <Box mb="2">
                  <Flex justify="between" align="center">
                    <Text size="2" color="gray">
                      Gist Privado:
                    </Text>
                    {config.gistUrl ? (
                      <a
                        href={config.gistUrl}
                        target="_blank"
                        rel="noreferrer"
                        style={{
                          fontSize: 12,
                          color: 'var(--iris-9)',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 4,
                          textDecoration: 'none'
                        }}
                      >
                        Gist ({config.gistId?.slice(0, 8)}...) <ExternalLink size={12} />
                      </a>
                    ) : (
                      <Text size="1" color="gray">
                        Pendiente de primer respaldo
                      </Text>
                    )}
                  </Flex>
                </Box>
              )}

              <Flex justify="between" align="center">
                <Text size="2" color="gray">
                  Última sincronización:
                </Text>
                <Text size="1" weight="medium">
                  {config.lastSyncTime
                    ? `${new Date(config.lastSyncTime).toLocaleString()} (${config.lastSyncAction === 'push' ? 'Subida' : 'Descarga'})`
                    : 'Nunca sincronizado'}
                </Text>
              </Flex>
            </Box>

            <Separator size="4" my="1" />

            {/* Switch de Auto-Sync */}
            <Flex align="center" justify="between" px="1">
              <Box>
                <Text size="2" weight="medium">
                  Sincronización Automática (Auto-Sync)
                </Text>
                <Text size="1" color="gray">
                  Guarda automáticamente en GitHub cada vez que creás o modificás un servidor o clave SSH.
                </Text>
              </Box>
              <Switch checked={autoSyncEnabled} onCheckedChange={handleToggleAutoSync} />
            </Flex>

            <Separator size="4" my="1" />

            {/* Botones de Acción de Sincronización */}
            <Flex gap="2" mt="1">
              <Button
                variant="solid"
                color="iris"
                style={{ flex: 1 }}
                onClick={handlePush}
                loading={isPushing}
                disabled={isPulling}
              >
                <CloudUpload size={15} style={{ marginRight: 6 }} /> Subir a GitHub ({targetType === 'repo' ? 'Repo' : 'Gist'})
              </Button>

              <Button
                variant="soft"
                color="blue"
                style={{ flex: 1 }}
                onClick={handlePull}
                loading={isPulling}
                disabled={isPushing}
              >
                <CloudDownload size={15} style={{ marginRight: 6 }} /> Descargar y Restaurar
              </Button>
            </Flex>

            <Flex justify="end" mt="2">
              <Button variant="ghost" color="gray" onClick={onClose}>
                Cerrar
              </Button>
            </Flex>
          </Flex>
        )}
      </Dialog.Content>
    </Dialog.Root>
  );
};

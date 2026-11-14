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
  Tooltip
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
  Info
} from 'lucide-react';
import {
  getGitHubConfig,
  saveGitHubConfig,
  clearGitHubConfig,
  validateGitHubToken,
  pushVaultToGitHub,
  pullVaultFromGitHub,
  GITHUB_TOKEN_CREATE_URL,
  type GitHubSyncConfig
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
  const [autoSyncEnabled, setAutoSyncEnabled] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isPushing, setIsPushing] = useState(false);
  const [isPulling, setIsPulling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      const current = getGitHubConfig();
      setConfig(current);
      setAutoSyncEnabled(current?.autoSync ?? false);
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

    const newConfig: GitHubSyncConfig = {
      token: tokenInput.trim(),
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

  const handlePush = async () => {
    if (!config) return;
    setIsPushing(true);
    setError(null);

    try {
      const rawEncrypted = await window.electronAPI.getRawVault();
      if (!rawEncrypted) {
        throw new Error('No se pudo leer la bóveda cifrada local.');
      }

      const res = await pushVaultToGitHub(config.token, rawEncrypted, config.gistId);
      if (!res.success) {
        throw new Error(res.error || 'Error al subir la bóveda.');
      }

      const updated: GitHubSyncConfig = {
        ...config,
        gistId: res.gistId,
        gistUrl: res.gistUrl || config.gistUrl,
        lastSyncTime: res.updatedAt,
        lastSyncAction: 'push'
      };

      saveGitHubConfig(updated);
      setConfig(updated);
      showToast('Bóveda cifrada respaldada exitosamente en GitHub Gist privado.');
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
      const res = await pullVaultFromGitHub(config.token, config.gistId);
      if (!res.success || !res.encryptedContent) {
        throw new Error(res.error || 'Error al descargar la bóveda.');
      }

      // Save raw vault locally
      const saveRes = await window.electronAPI.saveRawVault(res.encryptedContent);
      if (!saveRes.success) {
        throw new Error(saveRes.error || 'Error al guardar la bóveda localmente.');
      }

      const updated: GitHubSyncConfig = {
        ...config,
        gistId: res.gistId,
        lastSyncTime: res.updatedAt,
        lastSyncAction: 'pull'
      };

      saveGitHubConfig(updated);
      setConfig(updated);
      showToast('Bóveda descargada de GitHub y actualizada localmente.');

      // Try unlocking with cached password if possible
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
      <Dialog.Content style={{ maxWidth: 520, borderRadius: 12 }}>
        <Dialog.Title>
          <Flex align="center" gap="2">
            <GitHubLogoIcon width={22} height={22} color="var(--iris-9)" />
            <Text size="4" weight="bold">
              Sincronización con GitHub
            </Text>
          </Flex>
        </Dialog.Title>

        <Dialog.Description size="2" color="gray" mb="3">
          Sincronizá tu bóveda entre computadoras y dispositivos móviles mediante un Gist privado y cifrado.
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
          /* Connect Form */
          <form onSubmit={handleConnect}>
            <Flex direction="column" gap="3">
              <Callout.Root color="blue" size="1">
                <Callout.Icon>
                  <ShieldCheck size={16} />
                </Callout.Icon>
                <Callout.Text>
                  <strong>Seguridad Zero-Knowledge:</strong> Tus servidores, contraseñas y claves privadas nunca se envían en texto plano. Solo se almacena el archivo cifrado con <strong>Argon2id + AES-256-GCM</strong>.
                </Callout.Text>
              </Callout.Root>

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
                    Generar Token en GitHub <ExternalLink size={12} />
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
                  Solo requiere el permiso <Badge color="indigo" size="1">gist</Badge> para crear un Gist privado con tu bóveda.
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
          /* Connected State */
          <Flex direction="column" gap="3">
            {/* User Profile Card */}
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

            {/* Gist Info */}
            <Box px="1">
              <Flex justify="between" align="center">
                <Text size="2" color="gray">
                  Almacenamiento:
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
                    Gist Privado ({config.gistId?.slice(0, 8)}...) <ExternalLink size={12} />
                  </a>
                ) : (
                  <Text size="1" color="gray">
                    Pendiente de primer respaldo
                  </Text>
                )}
              </Flex>

              <Flex justify="between" align="center" mt="1">
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

            {/* Auto-Sync Toggle */}
            <Flex align="center" justify="between" px="1">
              <Box>
                <Text size="2" weight="medium">
                  Sincronización Automática (Auto-Sync)
                </Text>
                <Text size="1" color="gray">
                  Sube los cambios a GitHub automáticamente al guardar servidores o llaves.
                </Text>
              </Box>
              <Switch checked={autoSyncEnabled} onCheckedChange={handleToggleAutoSync} />
            </Flex>

            <Separator size="4" my="1" />

            {/* Sync Action Buttons */}
            <Flex gap="2" mt="1">
              <Button
                variant="solid"
                color="iris"
                style={{ flex: 1 }}
                onClick={handlePush}
                loading={isPushing}
                disabled={isPulling}
              >
                <CloudUpload size={15} style={{ marginRight: 6 }} /> Subir a GitHub (Backup)
              </Button>

              <Button
                variant="soft"
                color="blue"
                style={{ flex: 1 }}
                onClick={handlePull}
                loading={isPulling}
                disabled={isPushing}
              >
                <CloudDownload size={15} style={{ marginRight: 6 }} /> Descargar de GitHub
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

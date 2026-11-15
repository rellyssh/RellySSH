import React, { useState, useEffect } from 'react';
import { Card, Heading, Text, TextField, Button, Flex, Callout, Tabs, Box, Select, Progress, Badge, SegmentedControl, IconButton } from '@radix-ui/themes';
import { Lock, KeyRound, FolderOpen, AlertCircle, Sparkles, Cpu, CloudDownload, CheckCircle2, ExternalLink, Eye, EyeOff, FolderGit2, FileCode2 } from 'lucide-react';
import { GitHubLogoIcon } from '@radix-ui/react-icons';
import type { VaultData } from '../types';
import {
  getGitHubConfig,
  saveGitHubConfig,
  validateGitHubToken,
  pullVaultFromGitHub,
  DEFAULT_REPO_NAME,
  GITHUB_TOKEN_CREATE_URL,
  type GitHubSyncTarget,
  type GitHubSyncConfig
} from '../services/githubSync';
import logoSvg from '../assets/logo.svg';

interface Props {
  onUnlock: (data: VaultData, filePath: string, isLegacyV1?: boolean) => void;
}

export const UnlockScreen: React.FC<Props> = ({ onUnlock }) => {
  const [tab, setTab] = useState<'unlock' | 'create' | 'github'>('unlock');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [filePath, setFilePath] = useState<string>('');
  const [profile, setProfile] = useState<'standard' | 'strong' | 'maximum'>('strong');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successInfo, setSuccessInfo] = useState<string | null>(null);

  // GitHub Restore state
  const [githubToken, setGithubToken] = useState('');
  const [restoreTarget, setRestoreTarget] = useState<GitHubSyncTarget>('repo');
  const [restoreRepoName, setRestoreRepoName] = useState(DEFAULT_REPO_NAME);
  const [isPullingFromGitHub, setIsPullingFromGitHub] = useState(false);

  useEffect(() => {
    const config = getGitHubConfig();
    if (config?.token) {
      setGithubToken(config.token);
      setRestoreTarget(config.targetType || (config.gistId ? 'gist' : 'repo'));
      if (config.repoName) {
        setRestoreRepoName(config.repoName);
      }
    }
  }, []);
  
  // Status during encryption/decryption
  const [isProcessing, setIsProcessing] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string>('');
  const [progressValue, setProgressValue] = useState<number>(0);

  const handleSelectFile = async () => {
    try {
      const selected = await window.electronAPI.selectFileToOpen();
      if (selected) {
        setFilePath(selected);
      }
    } catch (err: any) {
      setError(err.message);
    }
  };

  const simulateProgress = (message: string, durationMs: number): Promise<void> => {
    return new Promise((resolve) => {
      setStatusMessage(message);
      setProgressValue(10);
      const interval = 100;
      const step = 90 / (durationMs / interval);
      let current = 10;
      const timer = setInterval(() => {
        current += step;
        if (current >= 95) {
          clearInterval(timer);
          resolve();
        } else {
          setProgressValue(Math.floor(current));
        }
      }, interval);
    });
  };

  const handleUnlock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password) return;
    setIsProcessing(true);
    setError(null);

    try {
      const progressPromise = simulateProgress('Derivando clave con Argon2id y verificando integridad AES-GCM...', 1100);
      const unlockPromise = window.electronAPI.unlockVault(password, filePath || undefined);

      const [, res] = await Promise.all([progressPromise, unlockPromise]);

      setProgressValue(100);
      if (res.success && res.data) {
        setStatusMessage('Bóveda verificada con éxito. Abriendo...');
        setTimeout(() => {
          onUnlock(res.data!, res.filePath || filePath, res.isLegacyV1);
        }, 250);
      } else {
        setIsProcessing(false);
        setError(res.error || 'Contraseña incorrecta o archivo de bóveda corrupto.');
      }
    } catch (err: any) {
      setIsProcessing(false);
      setError(err.message || 'Error al procesar la bóveda.');
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password) {
      setError('Introduce una contraseña maestra.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Las contraseñas no coinciden.');
      return;
    }
    setIsProcessing(true);
    setError(null);

    try {
      const progressPromise = simulateProgress('Generando DEK y computando KEK con Argon2id...', 1100);
      const initPromise = window.electronAPI.initVault(password, filePath || undefined, profile);

      const [, res] = await Promise.all([progressPromise, initPromise]);

      setProgressValue(100);
      if (res.success && res.data) {
        setStatusMessage('Bóveda protegida exitosamente. Abriendo...');
        setTimeout(() => {
          onUnlock(res.data!, res.filePath || filePath, false);
        }, 250);
      } else {
        setIsProcessing(false);
        setError(res.error || 'Error creando la bóveda.');
      }
    } catch (err: any) {
      setIsProcessing(false);
      setError(err.message);
    }
  };

  const handleGitHubRestore = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!githubToken.trim()) {
      setError('Por favor ingresá tu Personal Access Token de GitHub.');
      return;
    }
    setIsPullingFromGitHub(true);
    setError(null);
    setSuccessInfo(null);

    try {
      const validation = await validateGitHubToken(githubToken);
      if (!validation.valid || !validation.user) {
        throw new Error(validation.error || 'Token inválido o sin permisos.');
      }

      const syncConfig: GitHubSyncConfig = {
        token: githubToken.trim(),
        targetType: restoreTarget,
        repoOwner: validation.user.login,
        repoName: restoreRepoName.trim() || DEFAULT_REPO_NAME,
        user: validation.user,
        autoSync: true
      };

      const res = await pullVaultFromGitHub(syncConfig);
      if (!res.success || !res.encryptedContent) {
        throw new Error(res.error || 'No se encontró la bóveda de RellySSH en tu cuenta de GitHub.');
      }

      const saveRes = await window.electronAPI.saveRawVault(res.encryptedContent);
      if (!saveRes.success) {
        throw new Error(saveRes.error || 'Error al guardar la bóveda descargada.');
      }

      saveGitHubConfig({
        ...syncConfig,
        repoUrl: res.repoUrl,
        lastCommitSha: res.commitSha,
        gistId: res.gistId,
        lastSyncTime: res.updatedAt || new Date().toISOString(),
        lastSyncAction: 'pull'
      });

      const sourceName = restoreTarget === 'repo'
        ? `repositorio "${syncConfig.repoName}"`
        : 'Gist privado';
      setSuccessInfo(`¡Bóveda descargada exitosamente desde tu ${sourceName}! Ingresá tu contraseña maestra para abrirla.`);
      setTab('unlock');
    } catch (err: any) {
      setError(err.message || 'Error al restaurar desde GitHub.');
    } finally {
      setIsPullingFromGitHub(false);
    }
  };

  return (
    <Flex
      align="center"
      justify="center"
      style={{
        height: '100vh',
        width: '100vw',
        background: 'radial-gradient(circle at 50% 25%, #0c234a 0%, #07152f 50%, #030914 100%)'
      }}
    >
      <Card
        size="4"
        style={{
          width: 470,
          padding: 32,
          backdropFilter: 'blur(30px)',
          background: 'rgba(7, 21, 47, 0.75)',
          border: '1px solid rgba(33, 212, 245, 0.25)',
          boxShadow: '0 25px 60px rgba(0, 0, 0, 0.7)'
        }}
      >
        <Flex direction="column" gap="4">
          {/* Logo y Encabezado */}
          <Flex direction="column" align="center" gap="2" mb="1">
            <Box
              style={{
                width: 72,
                height: 72,
                filter: 'drop-shadow(0 0 15px rgba(33, 212, 245, 0.4))'
              }}
            >
              <img src={logoSvg} alt="RellySSH Logo" style={{ width: '100%', height: '100%' }} />
            </Box>
            <Heading size="6" weight="bold" style={{ color: '#ffffff', letterSpacing: '-0.5px' }}>
              RellySSH
            </Heading>
            <Text size="2" style={{ color: '#88a0c5', textAlign: 'center' }}>
              Bóveda cifrada con arquitectura de dos niveles: <strong>Argon2id + AES-256-GCM</strong>.
            </Text>
          </Flex>

          {error && (
            <Callout.Root color="red" size="1">
              <Callout.Icon>
                <AlertCircle size={16} />
              </Callout.Icon>
              <Callout.Text>{error}</Callout.Text>
            </Callout.Root>
          )}

          {successInfo && (
            <Callout.Root color="green" size="1">
              <Callout.Icon>
                <CheckCircle2 size={16} />
              </Callout.Icon>
              <Callout.Text>{successInfo}</Callout.Text>
            </Callout.Root>
          )}

          {/* Animación de procesamiento criptográfico */}
          {isProcessing ? (
            <Flex direction="column" align="center" justify="center" py="6" gap="3">
              <Box
                style={{
                  width: 56,
                  height: 56,
                  borderRadius: '50%',
                  border: '3px solid rgba(33, 212, 245, 0.2)',
                  borderTopColor: '#21d4f5',
                  animation: 'spin 1s linear infinite'
                }}
              />
              <style>{`
                @keyframes spin {
                  0% { transform: rotate(0deg); }
                  100% { transform: rotate(360deg); }
                }
              `}</style>
              <Text size="2" weight="bold" style={{ color: '#21d4f5' }}>
                {statusMessage}
              </Text>
              <Box style={{ width: '80%' }}>
                <Progress value={progressValue} color="iris" />
              </Box>
              <Text size="1" color="gray">
                Resistencia activa contra fuerza bruta y GPU
              </Text>
            </Flex>
          ) : (
            <Tabs.Root value={tab} onValueChange={(val) => { setTab(val as any); setError(null); setSuccessInfo(null); }}>
              <Tabs.List size="2" style={{ width: '100%' }}>
                <Tabs.Trigger value="unlock" style={{ flex: 1 }}>
                  <KeyRound size={14} style={{ marginRight: 6 }} /> Abrir
                </Tabs.Trigger>
                <Tabs.Trigger value="create" style={{ flex: 1 }}>
                  <Sparkles size={14} style={{ marginRight: 6 }} /> Crear
                </Tabs.Trigger>
                <Tabs.Trigger value="github" style={{ flex: 1 }}>
                  <GitHubLogoIcon width={14} height={14} style={{ marginRight: 6 }} /> GitHub Sync
                </Tabs.Trigger>
              </Tabs.List>

              <Box pt="4">
                {tab === 'unlock' ? (
                  <form onSubmit={handleUnlock}>
                    <Flex direction="column" gap="3">
                      <Flex direction="column" gap="1">
                        <Text size="1" weight="medium" style={{ color: '#88a0c5' }}>
                          Archivo de Bóveda (.vault)
                        </Text>
                        <Flex gap="2">
                          <TextField.Root
                            size="2"
                            placeholder="Predeterminada (userData/relly_servers.vault)"
                            value={filePath}
                            onChange={(e) => setFilePath(e.target.value)}
                            style={{ flex: 1 }}
                          />
                          <Button type="button" variant="soft" color="gray" onClick={handleSelectFile} title="Explorar archivo">
                            <FolderOpen size={16} />
                          </Button>
                        </Flex>
                      </Flex>

                      <Flex direction="column" gap="1">
                        <Text size="1" weight="medium" style={{ color: '#88a0c5' }}>
                          Contraseña Maestra
                        </Text>
                        <TextField.Root
                          type={showPassword ? 'text' : 'password'}
                          size="3"
                          placeholder="••••••••••••"
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          autoFocus
                        >
                          <TextField.Slot>
                            <Lock size={16} />
                          </TextField.Slot>
                          <TextField.Slot>
                            <IconButton
                              size="1"
                              variant="ghost"
                              color="gray"
                              type="button"
                              onClick={() => setShowPassword(!showPassword)}
                              tabIndex={-1}
                              title={showPassword ? 'Ocultar contraseña' : 'Ver contraseña'}
                            >
                              {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                            </IconButton>
                          </TextField.Slot>
                        </TextField.Root>
                      </Flex>

                      <Button type="submit" size="3" variant="solid" mt="2" style={{ background: '#087bff', color: '#fff', cursor: 'pointer' }}>
                        Desbloquear Bóveda
                      </Button>
                    </Flex>
                  </form>
                ) : tab === 'create' ? (
                  <form onSubmit={handleCreate}>
                    <Flex direction="column" gap="3">
                      <Flex direction="column" gap="1">
                        <Text size="1" weight="medium" style={{ color: '#88a0c5' }}>
                          Ruta de Guardado (Opcional)
                        </Text>
                        <Flex gap="2">
                          <TextField.Root
                            size="2"
                            placeholder="Predeterminada o seleccionar..."
                            value={filePath}
                            onChange={(e) => setFilePath(e.target.value)}
                            style={{ flex: 1 }}
                          />
                          <Button
                            type="button"
                            variant="soft"
                            color="gray"
                            onClick={async () => {
                              const res = await window.electronAPI.selectFileToSave();
                              if (res) setFilePath(res);
                            }}
                          >
                            <FolderOpen size={16} />
                          </Button>
                        </Flex>
                      </Flex>

                      <Flex direction="column" gap="1">
                        <Flex justify="between" align="center">
                          <Text size="1" weight="medium" style={{ color: '#88a0c5' }}>
                            Perfil de Seguridad Argon2id
                          </Text>
                          <Flex align="center" gap="1">
                            <Cpu size={12} color="#21d4f5" />
                            <Text size="1" color="gray">
                              {profile === 'maximum' ? '256 MiB / Max' : profile === 'strong' ? '128 MiB / Recomendado' : '64 MiB'}
                            </Text>
                          </Flex>
                        </Flex>
                        <Select.Root value={profile} onValueChange={(v: any) => setProfile(v)}>
                          <Select.Trigger />
                          <Select.Content>
                            <Select.Item value="standard">Estándar (64 MiB, 3 pasadas)</Select.Item>
                            <Select.Item value="strong">Reforzado (128 MiB, 10 pasadas - Recomendado)</Select.Item>
                            <Select.Item value="maximum">Máximo (256 MiB, 25 pasadas - Anti-GPU)</Select.Item>
                          </Select.Content>
                        </Select.Root>
                      </Flex>

                      <Flex direction="column" gap="1">
                        <Text size="1" weight="medium" style={{ color: '#88a0c5' }}>
                          Nueva Contraseña Maestra
                        </Text>
                        <TextField.Root
                          type={showPassword ? 'text' : 'password'}
                          size="2"
                          placeholder="Contraseña robusta..."
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                        >
                          <TextField.Slot>
                            <Lock size={16} />
                          </TextField.Slot>
                          <TextField.Slot>
                            <IconButton
                              size="1"
                              variant="ghost"
                              color="gray"
                              type="button"
                              onClick={() => setShowPassword(!showPassword)}
                              tabIndex={-1}
                            >
                              {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                            </IconButton>
                          </TextField.Slot>
                        </TextField.Root>
                      </Flex>

                      <Flex direction="column" gap="1">
                        <Text size="1" weight="medium" style={{ color: '#88a0c5' }}>
                          Confirmar Contraseña
                        </Text>
                        <TextField.Root
                          type={showConfirmPassword ? 'text' : 'password'}
                          size="2"
                          placeholder="Repite la contraseña..."
                          value={confirmPassword}
                          onChange={(e) => setConfirmPassword(e.target.value)}
                        >
                          <TextField.Slot>
                            <Lock size={16} />
                          </TextField.Slot>
                          <TextField.Slot>
                            <IconButton
                              size="1"
                              variant="ghost"
                              color="gray"
                              type="button"
                              onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                              tabIndex={-1}
                            >
                              {showConfirmPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                            </IconButton>
                          </TextField.Slot>
                        </TextField.Root>
                      </Flex>

                      <Button type="submit" size="3" variant="solid" mt="2" style={{ background: '#087bff', color: '#fff', cursor: 'pointer' }}>
                        Inicializar Bóveda V2
                      </Button>
                    </Flex>
                  </form>
                ) : (
                  <form onSubmit={handleGitHubRestore}>
                    <Flex direction="column" gap="3">
                      <Callout.Root color="blue" size="1">
                        <Callout.Icon>
                          <GitHubLogoIcon width={16} height={16} />
                        </Callout.Icon>
                        <Callout.Text>
                          Restaurá tu bóveda cifrada desde tu repositorio privado de GitHub en cualquier equipo nuevo.
                        </Callout.Text>
                      </Callout.Root>

                      <Box>
                        <Text size="1" weight="medium" mb="1" style={{ color: '#88a0c5' }}>
                          Origen de la Bóveda en GitHub:
                        </Text>
                        <SegmentedControl.Root
                          value={restoreTarget}
                          onValueChange={(val) => setRestoreTarget(val as GitHubSyncTarget)}
                          size="1"
                          style={{ width: '100%' }}
                        >
                          <SegmentedControl.Item value="repo">
                            <Flex align="center" gap="1">
                              <FolderGit2 size={13} /> Repositorio Privado
                            </Flex>
                          </SegmentedControl.Item>
                          <SegmentedControl.Item value="gist">
                            <Flex align="center" gap="1">
                              <FileCode2 size={13} /> Gist
                            </Flex>
                          </SegmentedControl.Item>
                        </SegmentedControl.Root>
                      </Box>

                      {restoreTarget === 'repo' && (
                        <Box>
                          <Text size="1" weight="medium" mb="1" style={{ color: '#88a0c5' }}>
                            Nombre del Repositorio
                          </Text>
                          <TextField.Root
                            size="2"
                            placeholder="rellyssh-vault"
                            value={restoreRepoName}
                            onChange={(e) => setRestoreRepoName(e.target.value)}
                          />
                        </Box>
                      )}

                      <Flex direction="column" gap="1">
                        <Flex justify="between" align="center">
                          <Text size="1" weight="medium" style={{ color: '#88a0c5' }}>
                            Personal Access Token de GitHub
                          </Text>
                          <a
                            href={GITHUB_TOKEN_CREATE_URL}
                            target="_blank"
                            rel="noreferrer"
                            style={{
                              fontSize: 11,
                              color: '#21d4f5',
                              display: 'flex',
                              alignItems: 'center',
                              gap: 3,
                              textDecoration: 'none'
                            }}
                          >
                            Crear Token <ExternalLink size={10} />
                          </a>
                        </Flex>
                        <TextField.Root
                          type="password"
                          size="2"
                          placeholder="ghp_... o github_pat_..."
                          value={githubToken}
                          onChange={(e) => setGithubToken(e.target.value)}
                        />
                        <Text size="1" color="gray">
                          Requiere permiso <Badge color="indigo" size="1">repo</Badge> o <Badge color="indigo" size="1">gist</Badge>.
                        </Text>
                      </Flex>

                      <Button
                        type="submit"
                        size="3"
                        variant="solid"
                        mt="2"
                        loading={isPullingFromGitHub}
                        style={{ background: '#087bff', color: '#fff', cursor: 'pointer' }}
                      >
                        <CloudDownload size={16} style={{ marginRight: 6 }} /> Descargar y Restaurar Bóveda
                      </Button>
                    </Flex>
                  </form>
                )}
              </Box>
            </Tabs.Root>
          )}
        </Flex>
      </Card>
    </Flex>
  );
};

import React, { useState, useEffect, useRef } from 'react';
import {
  Card,
  Heading,
  Text,
  TextField,
  Button,
  Flex,
  Callout,
  Box,
  Select,
  Progress,
  Badge,
  IconButton,
  Separator
} from '@radix-ui/themes';
import {
  Lock,
  KeyRound,
  FolderOpen,
  AlertCircle,
  Sparkles,
  CloudDownload,
  CheckCircle2,
  ExternalLink,
  Eye,
  EyeOff,
  FolderGit2,
  Copy,
  Check,
  RefreshCw,
  ArrowLeft,
  Shield,
  Laptop
} from 'lucide-react';
import { GitHubLogoIcon } from '@radix-ui/react-icons';
import type { VaultData } from '../types';
import {
  getGitHubConfig,
  saveGitHubConfig,
  clearGitHubConfig,
  DEFAULT_REPO_NAME,
  pushVaultToGitHubRepo,
  type GitHubSyncConfig,
  type GitHubUser
} from '../services/githubSync';
import {
  requestDeviceCode,
  pollDeviceTokenUntilComplete,
  openBrowserUrl,
  setupGitHubAccountAndVault,
  DEFAULT_GITHUB_CLIENT_ID,
  type DeviceCodeResponse
} from '../services/githubAuth';
import logoSvg from '../assets/logo.svg';

interface Props {
  onUnlock: (data: VaultData, filePath: string, isLegacyV1?: boolean) => void;
}

type AuthMode =
  | 'github-login'        // Pantalla inicial principal: Continuar con GitHub (o cuenta previa)
  | 'github-authorizing'  // Esperando código en GitHub en el navegador
  | 'github-setup'        // Autorizado: ingresar/crear contraseña para la bóveda en GitHub
  | 'local-unlock'        // Desbloqueo clásico offline con archivo local
  | 'local-create';       // Inicialización de bóveda offline local

export const UnlockScreen: React.FC<Props> = ({ onUnlock }) => {
  // Configuración previa de GitHub si existe
  const [savedConfig, setSavedConfig] = useState<GitHubSyncConfig | null>(null);

  // Modo de acceso activo
  const [mode, setMode] = useState<AuthMode>('github-login');

  // Credenciales y campos comunes
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [filePath, setFilePath] = useState<string>('');
  const [profile, setProfile] = useState<'standard' | 'strong' | 'maximum'>('strong');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successInfo, setSuccessInfo] = useState<string | null>(null);

  // Estado del flujo OAuth Device Flow
  const [deviceCodeData, setDeviceCodeData] = useState<DeviceCodeResponse | null>(null);
  const [pollStatus, setPollStatus] = useState<string>('');
  const [codeCopied, setCodeCopied] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Estado tras autorización en GitHub
  const [activeGitHubToken, setActiveGitHubToken] = useState<string>('');
  const [authenticatedUser, setAuthenticatedUser] = useState<GitHubUser | null>(null);
  const [vaultRepoName, setVaultRepoName] = useState<string>(DEFAULT_REPO_NAME);
  const [vaultFileExistsInRepo, setVaultFileExistsInRepo] = useState<boolean>(false);
  const [downloadedEncryptedContent, setDownloadedEncryptedContent] = useState<string | null>(null);

  // Estado de procesamiento y derivación Argon2id
  const [isProcessing, setIsProcessing] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string>('');
  const [progressValue, setProgressValue] = useState<number>(0);

  useEffect(() => {
    const config = getGitHubConfig();
    if (config?.token && config?.user) {
      setSavedConfig(config);
      setAuthenticatedUser(config.user);
      setActiveGitHubToken(config.token);
      setVaultRepoName(config.repoName || DEFAULT_REPO_NAME);
    }
  }, []);

  // Limpieza al desmontar
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

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

  // ==========================================
  // INICIO DE SESIÓN CON GITHUB (DEVICE FLOW)
  // ==========================================

  const handleStartGitHubAuth = async () => {
    setError(null);
    setSuccessInfo(null);
    setIsProcessing(true);
    setStatusMessage('Iniciando vinculación con GitHub...');

    try {
      // 1. Solicitar código de dispositivo a GitHub
      const res = await requestDeviceCode(DEFAULT_GITHUB_CLIENT_ID, 'repo,gist,read:user');
      if (!res.success || !res.data) {
        setIsProcessing(false);
        setError(res.error || 'No se pudo conectar con GitHub. Verificá tu conexión a internet.');
        return;
      }

      setDeviceCodeData(res.data);
      setMode('github-authorizing');
      setIsProcessing(false);
      setPollStatus('Esperando que autorices en tu navegador...');

      // Copiar código automáticamente al portapapeles
      if (navigator.clipboard && res.data.user_code) {
        navigator.clipboard.writeText(res.data.user_code).catch(() => {});
        setCodeCopied(true);
        setTimeout(() => setCodeCopied(false), 3000);
      }

      // 2. Abrir navegador automáticamente
      openBrowserUrl(res.data.verification_uri);

      // 3. Iniciar polling en segundo plano
      const controller = new AbortController();
      abortControllerRef.current = controller;

      const tokenResult = await pollDeviceTokenUntilComplete(
        DEFAULT_GITHUB_CLIENT_ID,
        res.data.device_code,
        res.data.interval,
        res.data.expires_in,
        (status) => setPollStatus(status),
        controller.signal
      );

      if (!tokenResult.success || !tokenResult.token) {
        if (!controller.signal.aborted) {
          setError(tokenResult.error || 'Error durante la autenticación.');
          setMode('github-login');
        }
        return;
      }

      // 4. Token recibido exitosamente
      setActiveGitHubToken(tokenResult.token);
      setIsProcessing(true);
      setStatusMessage('Verificando repositorio privado y bóveda...');

      // 5. Configurar cuenta y verificar bóveda
      const setup = await setupGitHubAccountAndVault(tokenResult.token);
      setIsProcessing(false);

      if (!setup.success) {
        setError(setup.error || 'Error configurando la bóveda en GitHub.');
        setMode('github-login');
        return;
      }

      setAuthenticatedUser(setup.user || null);
      setVaultRepoName(setup.repoName);
      setVaultFileExistsInRepo(setup.vaultFileExists);
      if (setup.encryptedVaultContent) {
        setDownloadedEncryptedContent(setup.encryptedVaultContent);
      }

      setMode('github-setup');
    } catch (err: any) {
      setIsProcessing(false);
      setError(err.message || 'Error en el flujo de inicio de sesión con GitHub.');
      setMode('github-login');
    }
  };

  const handleCopyCode = () => {
    if (deviceCodeData?.user_code && navigator.clipboard) {
      navigator.clipboard.writeText(deviceCodeData.user_code);
      setCodeCopied(true);
      setTimeout(() => setCodeCopied(false), 2500);
    }
  };

  const handleCancelGitHubAuth = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    setDeviceCodeData(null);
    setMode('github-login');
    setError(null);
  };

  // ==========================================
  // DESBLOQUEO O INICIALIZACIÓN POST-GITHUB
  // ==========================================

  const handleGitHubSubmitUnlockOrInit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password) {
      setError('Por favor ingresá tu contraseña maestra.');
      return;
    }

    setError(null);
    setIsProcessing(true);

    try {
      const token = activeGitHubToken || savedConfig?.token;
      if (!token || !authenticatedUser) {
        throw new Error('No se detectó una sesión activa de GitHub.');
      }

      if (vaultFileExistsInRepo || downloadedEncryptedContent) {
        // CASO A: La bóveda ya existía en GitHub -> guardar raw local y descifrar
        setStatusMessage('Guardando copia local y derivando clave con Argon2id...');
        const progressPromise = simulateProgress('Descifrando bóveda con KEK/DEK...', 1000);

        if (downloadedEncryptedContent) {
          await window.electronAPI.saveRawVault(downloadedEncryptedContent, filePath || undefined);
        }

        const unlockPromise = window.electronAPI.unlockVault(password, filePath || undefined);
        const [, res] = await Promise.all([progressPromise, unlockPromise]);

        if (!res.success || !res.data) {
          setIsProcessing(false);
          setError(res.error || 'Contraseña incorrecta para descifrar la bóveda de tu repositorio.');
          return;
        }

        // Guardar configuración de GitHub localmente
        const newConfig: GitHubSyncConfig = {
          token,
          targetType: 'repo',
          repoOwner: authenticatedUser.login,
          repoName: vaultRepoName,
          user: authenticatedUser,
          autoSync: true,
          lastSyncTime: new Date().toISOString(),
          lastSyncAction: 'pull'
        };
        saveGitHubConfig(newConfig);

        setProgressValue(100);
        setStatusMessage('¡Bóveda verificada! Ingresando...');
        setTimeout(() => {
          onUnlock(res.data!, res.filePath || filePath, res.isLegacyV1);
        }, 300);
      } else {
        // CASO B: Usuario nuevo con GitHub -> inicializar bóveda y hacer push
        if (password !== confirmPassword) {
          setIsProcessing(false);
          setError('Las contraseñas maestras no coinciden.');
          return;
        }

        setStatusMessage('Generando DEK y derivando KEK con Argon2id...');
        const progressPromise = simulateProgress('Inicializando bóveda Zero-Knowledge...', 1100);
        const initPromise = window.electronAPI.initVault(password, filePath || undefined, profile);

        const [, res] = await Promise.all([progressPromise, initPromise]);

        if (!res.success || !res.data) {
          setIsProcessing(false);
          setError(res.error || 'Error inicializando la bóveda.');
          return;
        }

        // Subir la bóveda recién cifrada a su repositorio privado
        setStatusMessage('Respaldando bóveda en tu repositorio privado de GitHub...');
        const rawVault = await window.electronAPI.getRawVault(res.filePath);
        if (rawVault) {
          await pushVaultToGitHubRepo(token, authenticatedUser.login, rawVault, vaultRepoName);
        }

        const newConfig: GitHubSyncConfig = {
          token,
          targetType: 'repo',
          repoOwner: authenticatedUser.login,
          repoName: vaultRepoName,
          user: authenticatedUser,
          autoSync: true,
          lastSyncTime: new Date().toISOString(),
          lastSyncAction: 'push'
        };
        saveGitHubConfig(newConfig);

        setProgressValue(100);
        setStatusMessage('¡Bóveda inicializada y respaldada! Ingresando...');
        setTimeout(() => {
          onUnlock(res.data!, res.filePath || filePath);
        }, 300);
      }
    } catch (err: any) {
      setIsProcessing(false);
      setError(err.message || 'Error procesando la bóveda.');
    }
  };

  // ==========================================
  // DESBLOQUEO Y CREACIÓN LOCAL (OFFLINE)
  // ==========================================

  const handleLocalUnlock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password) return;
    setIsProcessing(true);
    setError(null);

    try {
      const progressPromise = simulateProgress('Derivando clave con Argon2id y verificando integridad...', 1100);
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
        setError(res.error || 'Contraseña incorrecta o archivo corrupto.');
      }
    } catch (err: any) {
      setIsProcessing(false);
      setError(err.message || 'Error al procesar la bóveda.');
    }
  };

  const handleLocalCreate = async (e: React.FormEvent) => {
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
        setStatusMessage('Bóveda creada exitosamente. Abriendo...');
        setTimeout(() => {
          onUnlock(res.data!, res.filePath || filePath);
        }, 250);
      } else {
        setIsProcessing(false);
        setError(res.error || 'Error al inicializar la bóveda.');
      }
    } catch (err: any) {
      setIsProcessing(false);
      setError(err.message || 'Error al inicializar la bóveda.');
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
          width: 480,
          padding: 32,
          backdropFilter: 'blur(30px)',
          background: 'rgba(7, 21, 47, 0.85)',
          border: '1px solid rgba(33, 212, 245, 0.25)',
          boxShadow: '0 25px 60px rgba(0, 0, 0, 0.7)'
        }}
      >
        <Flex direction="column" gap="4">
          {/* Logo y Encabezado */}
          <Flex direction="column" align="center" gap="2" mb="1">
            <Box
              style={{
                width: 68,
                height: 68,
                filter: 'drop-shadow(0 0 15px rgba(33, 212, 245, 0.45))'
              }}
            >
              <img src={logoSvg} alt="RellySSH Logo" style={{ width: '100%', height: '100%' }} />
            </Box>
            <Heading size="6" weight="bold" style={{ color: '#ffffff', letterSpacing: '-0.5px' }}>
              RellySSH
            </Heading>
            <Text size="2" style={{ color: '#88a0c5', textAlign: 'center' }}>
              Cliente SSH Seguro • Cero Conocimiento • <strong>Argon2id + AES-256-GCM</strong>
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

          {/* Spinner de procesamiento */}
          {isProcessing ? (
            <Flex direction="column" align="center" justify="center" py="6" gap="3">
              <Box
                style={{
                  width: 52,
                  height: 52,
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
              <Box style={{ width: '85%' }}>
                <Progress value={progressValue} color="iris" />
              </Box>
              <Text size="1" color="gray">
                Protección criptográfica Zero-Knowledge activa
              </Text>
            </Flex>
          ) : mode === 'github-login' ? (
            /* ========================================================
               MODO PRINCIPAL: ACCEDER CON GITHUB (1-CLIC)
               ======================================================== */
            <Flex direction="column" gap="4">
              {savedConfig?.user ? (
                /* Usuario ya vinculado previamente */
                <Card
                  variant="surface"
                  style={{
                    background: 'rgba(16, 45, 98, 0.35)',
                    border: '1px solid rgba(33, 212, 245, 0.3)',
                    padding: 16
                  }}
                >
                  <Flex direction="column" gap="3">
                    <Flex align="center" justify="between">
                      <Flex align="center" gap="3">
                        {savedConfig.user.avatar_url ? (
                          <img
                            src={savedConfig.user.avatar_url}
                            alt={savedConfig.user.login}
                            style={{ width: 40, height: 40, borderRadius: '50%', border: '2px solid #21d4f5' }}
                          />
                        ) : (
                          <GitHubLogoIcon width={32} height={32} />
                        )}
                        <Flex direction="column">
                          <Text size="2" weight="bold" style={{ color: '#fff' }}>
                            {savedConfig.user.name || savedConfig.user.login}
                          </Text>
                          <Text size="1" style={{ color: '#88a0c5' }}>
                            @{savedConfig.user.login}
                          </Text>
                        </Flex>
                      </Flex>
                      <Badge color="cyan" size="1">
                        Vinculado
                      </Badge>
                    </Flex>

                    <Flex align="center" gap="1">
                      <FolderGit2 size={13} color="#21d4f5" />
                      <Text size="1" style={{ color: '#88a0c5' }}>
                        Repositorio: <strong>github.com/{savedConfig.user.login}/{savedConfig.repoName || DEFAULT_REPO_NAME}</strong>
                      </Text>
                    </Flex>

                    <form onSubmit={handleGitHubSubmitUnlockOrInit}>
                      <Flex direction="column" gap="2" mt="1">
                        <Text size="1" weight="medium" style={{ color: '#88a0c5' }}>
                          Contraseña Maestra de tu Bóveda
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
                            >
                              {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                            </IconButton>
                          </TextField.Slot>
                        </TextField.Root>

                        <Button
                          type="submit"
                          size="3"
                          variant="solid"
                          style={{
                            background: 'linear-gradient(90deg, #087bff, #21d4f5)',
                            color: '#fff',
                            fontWeight: 600,
                            cursor: 'pointer'
                          }}
                        >
                          <KeyRound size={16} style={{ marginRight: 6 }} /> Desbloquear y Sincronizar
                        </Button>
                      </Flex>
                    </form>

                    <Flex justify="between" align="center" pt="1">
                      <Button
                        size="1"
                        variant="ghost"
                        color="gray"
                        onClick={() => {
                          clearGitHubConfig();
                          setSavedConfig(null);
                          setAuthenticatedUser(null);
                        }}
                      >
                        Cambiar de cuenta
                      </Button>
                      <Button
                        size="1"
                        variant="ghost"
                        color="cyan"
                        onClick={() => setMode('local-unlock')}
                      >
                        Usar archivo local
                      </Button>
                    </Flex>
                  </Flex>
                </Card>
              ) : (
                /* Primer acceso: Botón Hero de GitHub */
                <Flex direction="column" gap="3">
                  <Button
                    size="4"
                    variant="solid"
                    onClick={handleStartGitHubAuth}
                    style={{
                      background: '#24292f',
                      border: '1px solid rgba(255, 255, 255, 0.15)',
                      color: '#ffffff',
                      height: 52,
                      fontSize: 15,
                      fontWeight: 600,
                      cursor: 'pointer',
                      boxShadow: '0 4px 15px rgba(0, 0, 0, 0.4)'
                    }}
                  >
                    <GitHubLogoIcon width={22} height={22} style={{ marginRight: 10 }} />
                    Continuar con GitHub
                  </Button>

                  <Text size="1" style={{ color: '#88a0c5', textAlign: 'center', lineHeight: 1.4 }}>
                    Sincronización automática de tu bóveda en tu <strong>repositorio privado</strong>. Cero configuración de tokens o claves manuales.
                  </Text>

                  <Flex align="center" gap="2" my="1">
                    <Separator style={{ flex: 1 }} />
                    <Text size="1" color="gray">
                      o accede sin conexión
                    </Text>
                    <Separator style={{ flex: 1 }} />
                  </Flex>

                  <Flex gap="2">
                    <Button
                      size="2"
                      variant="soft"
                      color="gray"
                      style={{ flex: 1 }}
                      onClick={() => setMode('local-unlock')}
                    >
                      <KeyRound size={14} style={{ marginRight: 6 }} /> Bóveda Local
                    </Button>
                    <Button
                      size="2"
                      variant="soft"
                      color="gray"
                      style={{ flex: 1 }}
                      onClick={() => setMode('local-create')}
                    >
                      <Sparkles size={14} style={{ marginRight: 6 }} /> Crear Local
                    </Button>
                  </Flex>
                </Flex>
              )}
            </Flex>
          ) : mode === 'github-authorizing' ? (
            /* ========================================================
               ESPERANDO AUTORIZACIÓN EN GITHUB (DEVICE FLOW)
               ======================================================== */
            <Flex direction="column" gap="4">
              <Callout.Root color="blue" size="1">
                <Callout.Icon>
                  <GitHubLogoIcon width={16} height={16} />
                </Callout.Icon>
                <Callout.Text>
                  Autorizá el acceso de RellySSH en tu navegador. Tu bóveda se guardará en tu cuenta privada.
                </Callout.Text>
              </Callout.Root>

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
                  CÓDIGO DE VERIFICACIÓN:
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
                  {deviceCodeData?.user_code || '---- ----'}
                </Heading>

                <Button
                  size="1"
                  variant="soft"
                  color={codeCopied ? 'green' : 'gray'}
                  onClick={handleCopyCode}
                  style={{ cursor: 'pointer', gap: 4 }}
                >
                  {codeCopied ? <Check size={13} /> : <Copy size={13} />}
                  <span>{codeCopied ? '¡Código Copiado!' : 'Copiar Código'}</span>
                </Button>
              </Flex>

              <Button
                size="3"
                variant="solid"
                onClick={() => deviceCodeData?.verification_uri && openBrowserUrl(deviceCodeData.verification_uri)}
                style={{
                  background: '#087bff',
                  color: '#fff',
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
              >
                <ExternalLink size={16} style={{ marginRight: 6 }} /> Abrir GitHub en el Navegador
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
                  {pollStatus || 'Esperando confirmación en GitHub...'}
                </Text>
              </Flex>

              <Button
                size="1"
                variant="ghost"
                color="gray"
                onClick={handleCancelGitHubAuth}
                style={{ alignSelf: 'center' }}
              >
                Cancelar y Volver
              </Button>
            </Flex>
          ) : mode === 'github-setup' ? (
            /* ========================================================
               AUTORIZADO: CONTRASEÑA MAESTRA ZERO-KNOWLEDGE
               ======================================================== */
            <form onSubmit={handleGitHubSubmitUnlockOrInit}>
              <Flex direction="column" gap="3">
                <Flex align="center" gap="3" p="2" style={{ background: 'rgba(16, 45, 98, 0.4)', borderRadius: 6 }}>
                  {authenticatedUser?.avatar_url && (
                    <img
                      src={authenticatedUser.avatar_url}
                      alt={authenticatedUser.login}
                      style={{ width: 36, height: 36, borderRadius: '50%', border: '2px solid #21d4f5' }}
                    />
                  )}
                  <Flex direction="column">
                    <Text size="2" weight="bold" style={{ color: '#fff' }}>
                      ¡Hola, @{authenticatedUser?.login}!
                    </Text>
                    <Text size="1" style={{ color: '#88a0c5' }}>
                      {vaultFileExistsInRepo
                        ? `Bóveda encontrada en github.com/${authenticatedUser?.login}/${vaultRepoName}`
                        : `Nuevo repositorio privado: github.com/${authenticatedUser?.login}/${vaultRepoName}`}
                    </Text>
                  </Flex>
                </Flex>

                <Callout.Root color="indigo" size="1">
                  <Callout.Icon>
                    <Shield size={16} />
                  </Callout.Icon>
                  <Callout.Text>
                    {vaultFileExistsInRepo
                      ? 'Ingresá tu contraseña maestra para descifrar tu bóveda y acceder.'
                      : 'Definí una contraseña maestra. Tu bóveda se cifrará con Argon2id antes de sincronizarse a GitHub.'}
                  </Callout.Text>
                </Callout.Root>

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
                      >
                        {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                      </IconButton>
                    </TextField.Slot>
                  </TextField.Root>
                </Flex>

                {!vaultFileExistsInRepo && (
                  <>
                    <Flex direction="column" gap="1">
                      <Text size="1" weight="medium" style={{ color: '#88a0c5' }}>
                        Confirmar Contraseña
                      </Text>
                      <TextField.Root
                        type={showConfirmPassword ? 'text' : 'password'}
                        size="3"
                        placeholder="••••••••••••"
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
                            {showConfirmPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                          </IconButton>
                        </TextField.Slot>
                      </TextField.Root>
                    </Flex>

                    <Flex direction="column" gap="1">
                      <Text size="1" weight="medium" style={{ color: '#88a0c5' }}>
                        Nivel de Seguridad Argon2id
                      </Text>
                      <Select.Root value={profile} onValueChange={(val: any) => setProfile(val)} size="2">
                        <Select.Trigger />
                        <Select.Content>
                          <Select.Item value="standard">Estándar (64MB, r=3) - Rápido</Select.Item>
                          <Select.Item value="strong">Robusto (128MB, r=4) - Recomendado</Select.Item>
                          <Select.Item value="maximum">Máximo (256MB, r=8) - Ultra Seguro</Select.Item>
                        </Select.Content>
                      </Select.Root>
                    </Flex>
                  </>
                )}

                <Button
                  type="submit"
                  size="3"
                  variant="solid"
                  mt="2"
                  style={{
                    background: 'linear-gradient(90deg, #087bff, #21d4f5)',
                    color: '#fff',
                    fontWeight: 600,
                    cursor: 'pointer'
                  }}
                >
                  <KeyRound size={16} style={{ marginRight: 6 }} />
                  {vaultFileExistsInRepo ? 'Descifrar y Acceder' : 'Crear Bóveda y Acceder'}
                </Button>

                <Button
                  type="button"
                  size="1"
                  variant="ghost"
                  color="gray"
                  onClick={() => setMode('github-login')}
                  style={{ alignSelf: 'center' }}
                >
                  Cancelar
                </Button>
              </Flex>
            </form>
          ) : mode === 'local-unlock' ? (
            /* ========================================================
               DESBLOQUEO LOCAL CLÁSICO (OFFLINE)
               ======================================================== */
            <form onSubmit={handleLocalUnlock}>
              <Flex direction="column" gap="3">
                <Flex align="center" justify="between">
                  <Text size="2" weight="bold" style={{ color: '#fff' }}>
                    Desbloqueo Local Offline
                  </Text>
                  <Button size="1" variant="ghost" color="cyan" onClick={() => setMode('github-login')}>
                    <ArrowLeft size={13} style={{ marginRight: 4 }} /> Volver a GitHub
                  </Button>
                </Flex>

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
                      >
                        {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                      </IconButton>
                    </TextField.Slot>
                  </TextField.Root>
                </Flex>

                <Button
                  type="submit"
                  size="3"
                  variant="solid"
                  mt="2"
                  style={{ background: '#087bff', color: '#fff', cursor: 'pointer' }}
                >
                  <KeyRound size={16} style={{ marginRight: 6 }} /> Desbloquear Bóveda Local
                </Button>
              </Flex>
            </form>
          ) : (
            /* ========================================================
               CREACIÓN LOCAL CLÁSICA (OFFLINE)
               ======================================================== */
            <form onSubmit={handleLocalCreate}>
              <Flex direction="column" gap="3">
                <Flex align="center" justify="between">
                  <Text size="2" weight="bold" style={{ color: '#fff' }}>
                    Nueva Bóveda Local
                  </Text>
                  <Button size="1" variant="ghost" color="cyan" onClick={() => setMode('github-login')}>
                    <ArrowLeft size={13} style={{ marginRight: 4 }} /> Volver a GitHub
                  </Button>
                </Flex>

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
                        {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
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
                    size="3"
                    placeholder="••••••••••••"
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
                        {showConfirmPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                      </IconButton>
                    </TextField.Slot>
                  </TextField.Root>
                </Flex>

                <Flex direction="column" gap="1">
                  <Text size="1" weight="medium" style={{ color: '#88a0c5' }}>
                    Nivel de Seguridad Argon2id
                  </Text>
                  <Select.Root value={profile} onValueChange={(val: any) => setProfile(val)} size="2">
                    <Select.Trigger />
                    <Select.Content>
                      <Select.Item value="standard">Estándar (64MB, r=3) - Rápido</Select.Item>
                      <Select.Item value="strong">Robusto (128MB, r=4) - Recomendado</Select.Item>
                      <Select.Item value="maximum">Máximo (256MB, r=8) - Ultra Seguro</Select.Item>
                    </Select.Content>
                  </Select.Root>
                </Flex>

                <Button
                  type="submit"
                  size="3"
                  variant="solid"
                  mt="2"
                  style={{ background: '#087bff', color: '#fff', cursor: 'pointer' }}
                >
                  <Sparkles size={16} style={{ marginRight: 6 }} /> Inicializar Bóveda Local
                </Button>
              </Flex>
            </form>
          )}
        </Flex>
      </Card>
    </Flex>
  );
};

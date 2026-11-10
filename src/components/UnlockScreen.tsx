import React, { useState } from 'react';
import { Card, Heading, Text, TextField, Button, Flex, Callout, Tabs, Box, Select, Progress } from '@radix-ui/themes';
import { Lock, KeyRound, FolderOpen, AlertCircle, Sparkles, Cpu, ShieldAlert } from 'lucide-react';
import type { VaultData } from '../types';
import logoSvg from '../assets/logo.svg';

interface Props {
  onUnlock: (data: VaultData, filePath: string, isLegacyV1?: boolean) => void;
}

export const UnlockScreen: React.FC<Props> = ({ onUnlock }) => {
  const [tab, setTab] = useState<'unlock' | 'create'>('unlock');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [filePath, setFilePath] = useState<string>('');
  const [profile, setProfile] = useState<'standard' | 'strong' | 'maximum'>('strong');
  const [error, setError] = useState<string | null>(null);
  
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
      // Indicador visual de computación criptográfica
      const progressPromise = simulateProgress('Derivando clave con Argon2id y verificando integridad AES-GCM...', 1200);
      const unlockPromise = window.electronAPI.unlockVault(password, filePath || undefined);

      const [, res] = await Promise.all([progressPromise, unlockPromise]);

      setProgressValue(100);
      if (res.success && res.data) {
        setStatusMessage('Bóveda verificada con éxito. Abriendo...');
        setTimeout(() => {
          onUnlock(res.data!, res.filePath || filePath, res.isLegacyV1);
        }, 300);
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
      const progressPromise = simulateProgress('Generando DEK y computando KEK con Argon2id...', 1200);
      const initPromise = window.electronAPI.initVault(password, filePath || undefined, profile);

      const [, res] = await Promise.all([progressPromise, initPromise]);

      setProgressValue(100);
      if (res.success && res.data) {
        setStatusMessage('Bóveda protegida exitosamente. Abriendo...');
        setTimeout(() => {
          onUnlock(res.data!, res.filePath || filePath, false);
        }, 300);
      } else {
        setIsProcessing(false);
        setError(res.error || 'Error creando la bóveda.');
      }
    } catch (err: any) {
      setIsProcessing(false);
      setError(err.message);
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
          width: 460,
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
            <Tabs.Root value={tab} onValueChange={(val) => { setTab(val as any); setError(null); }}>
              <Tabs.List size="2" style={{ width: '100%' }}>
                <Tabs.Trigger value="unlock" style={{ flex: 1 }}>
                  <KeyRound size={14} style={{ marginRight: 6 }} /> Abrir Bóveda
                </Tabs.Trigger>
                <Tabs.Trigger value="create" style={{ flex: 1 }}>
                  <Sparkles size={14} style={{ marginRight: 6 }} /> Crear Bóveda V2
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
                          <Button type="button" variant="soft" color="gray" onClick={handleSelectFile}>
                            <FolderOpen size={16} />
                          </Button>
                        </Flex>
                      </Flex>

                      <Flex direction="column" gap="1">
                        <Text size="1" weight="medium" style={{ color: '#88a0c5' }}>
                          Contraseña Maestra
                        </Text>
                        <TextField.Root
                          type="password"
                          size="3"
                          placeholder="••••••••••••"
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          autoFocus
                        >
                          <TextField.Slot>
                            <Lock size={16} />
                          </TextField.Slot>
                        </TextField.Root>
                      </Flex>

                      <Button type="submit" size="3" variant="solid" mt="2" style={{ background: '#087bff', color: '#fff', cursor: 'pointer' }}>
                        Desbloquear Bóveda
                      </Button>
                    </Flex>
                  </form>
                ) : (
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
                          type="password"
                          size="2"
                          placeholder="Contraseña robusta..."
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                        >
                          <TextField.Slot>
                            <Lock size={16} />
                          </TextField.Slot>
                        </TextField.Root>
                      </Flex>

                      <Flex direction="column" gap="1">
                        <Text size="1" weight="medium" style={{ color: '#88a0c5' }}>
                          Confirmar Contraseña
                        </Text>
                        <TextField.Root
                          type="password"
                          size="2"
                          placeholder="Repite la contraseña..."
                          value={confirmPassword}
                          onChange={(e) => setConfirmPassword(e.target.value)}
                        >
                          <TextField.Slot>
                            <Lock size={16} />
                          </TextField.Slot>
                        </TextField.Root>
                      </Flex>

                      <Button type="submit" size="3" variant="solid" mt="2" style={{ background: '#087bff', color: '#fff', cursor: 'pointer' }}>
                        Inicializar Bóveda V2
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

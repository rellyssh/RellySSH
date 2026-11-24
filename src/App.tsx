import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Flex,
  Box,
  Heading,
  Text,
  Button,
  IconButton,
  Badge,
  Card,
  ScrollArea,
  Tooltip,
  DropdownMenu,
  Separator,
  TextField
} from '@radix-ui/themes';
import {
  Server,
  Plus,
  Terminal,
  KeyRound,
  Trash2,
  Lock,
  Download,
  Edit2,
  MoreVertical,
  Layers,
  Shield,
  ExternalLink,
  Copy,
  X,
  Search,
  CheckCircle2,
  Cloud,
  Check,
  FolderGit2,
  Sparkles,
  RefreshCw,
  LayoutGrid,
  Radio,
  Columns,
  Maximize2
} from 'lucide-react';
import { GitHubLogoIcon } from '@radix-ui/react-icons';
import type { VaultData, SSHServer, SSHKey } from './types';
import { UnlockScreen } from './components/UnlockScreen';
import { ServerModal } from './components/ServerModal';
import { KeyModal } from './components/KeyModal';
import { TerminalTab } from './components/TerminalTab';
import { BroadcastBar } from './components/BroadcastBar';
import { GitHubSyncPanel } from './components/GitHubSyncPanel';
import { UpdatePanel } from './components/UpdatePanel';
import { getGitHubConfig, saveGitHubConfig, pushVaultToGitHub } from './services/githubSync';
import { checkForUpdates, type UpdateCheckResult } from './services/updateChecker';
import { getTerminalGridLayout } from './utils/gridLayout';
import logoSvg from './assets/logo.svg';

interface OpenSession {
  sessionId: string;
  name: string;
  isLocal?: boolean;
  server?: SSHServer;
}

export default function App() {
  const [vault, setVault] = useState<VaultData | null>(null);
  const [currentPath, setCurrentPath] = useState<string>('');
  const [activeTab, setActiveTab] = useState<'servers' | 'keys' | 'github' | 'updates'>('servers');
  const [showMigrationBanner, setShowMigrationBanner] = useState<boolean>(false);
  const [serverSearch, setServerSearch] = useState<string>('');
  const [selectedGroup, setSelectedGroup] = useState<string>('ALL');
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Revisor de Actualizaciones y Hashes
  const [updateInfo, setUpdateInfo] = useState<UpdateCheckResult | null>(null);
  const [dismissedUpdateBanner, setDismissedUpdateBanner] = useState<boolean>(false);

  // Modals
  const [isServerModalOpen, setIsServerModalOpen] = useState(false);
  const [editingServer, setEditingServer] = useState<SSHServer | null>(null);
  const [isKeyModalOpen, setIsKeyModalOpen] = useState(false);

  // Active SSH & local terminal sessions
  const [sessions, setSessions] = useState<OpenSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);

  // Multi-terminal layout & broadcast state (Termius-like Split Grid)
  const [layoutMode, setLayoutMode] = useState<'single' | 'grid'>('single');
  const [gridFilterMode, setGridFilterMode] = useState<'all' | 'broadcastOnly'>('all');
  const [isBroadcastOpen, setIsBroadcastOpen] = useState<boolean>(false);
  const [isLiveBroadcast, setIsLiveBroadcast] = useState<boolean>(false);
  const [selectedBroadcastSessionIds, setSelectedBroadcastSessionIds] = useState<string[]>([]);

  const searchInputRef = useRef<HTMLInputElement>(null);

  // Comprobación de actualizaciones en segundo plano al iniciar
  useEffect(() => {
    checkForUpdates().then((res) => {
      if (res.success && res.hasUpdate) {
        setUpdateInfo(res);
      }
    }).catch(() => {});
  }, []);

  const showToast = (message: string) => {
    setToastMessage(message);
    setTimeout(() => {
      setToastMessage((prev) => (prev === message ? null : prev));
    }, 3200);
  };

  const handleUnlock = (data: VaultData, path: string, isLegacyV1?: boolean) => {
    setVault(data);
    setCurrentPath(path);
    if (isLegacyV1) {
      setShowMigrationBanner(true);
    }
    showToast('Bóveda descifrada correctamente.');
  };

  const handleMigrateToV2 = async () => {
    if (!vault) return;
    try {
      await window.electronAPI.saveVault(vault, currentPath || undefined, undefined, 'strong');
      setShowMigrationBanner(false);
      showToast('¡Bóveda migrada con éxito al formato V2 (Argon2id + AES-256-GCM + DEK)!');
    } catch (err: any) {
      showToast(`Error en la migración: ${err.message}`);
    }
  };

  const handleLock = () => {
    setVault(null);
    setCurrentPath('');
    setSessions([]);
    setSelectedBroadcastSessionIds([]);
    setIsBroadcastOpen(false);
    setIsLiveBroadcast(false);
    setLayoutMode('single');
    setGridFilterMode('all');
    setActiveSessionId(null);
    showToast('Bóveda bloqueada con éxito.');
  };

  const persistVault = async (updated: VaultData) => {
    setVault(updated);
    await window.electronAPI.saveVault(updated, currentPath || undefined);

    // Auto-sync con GitHub si está configurado
    const ghConfig = getGitHubConfig();
    if (ghConfig?.autoSync && ghConfig.token) {
      try {
        const raw = await window.electronAPI.getRawVault(currentPath || undefined);
        if (raw) {
          const res = await pushVaultToGitHub(ghConfig, raw);
          if (res.success) {
            saveGitHubConfig({
              ...ghConfig,
              repoUrl: res.repoUrl || ghConfig.repoUrl,
              lastCommitSha: res.commitSha || ghConfig.lastCommitSha,
              gistId: res.gistId || ghConfig.gistId,
              gistUrl: res.gistUrl || ghConfig.gistUrl,
              lastSyncTime: res.updatedAt || new Date().toISOString(),
              lastSyncAction: 'push'
            });
          }
        }
      } catch (e) {
        console.warn('Auto-sync error:', e);
      }
    }
  };

  const handleSaveServer = async (server: SSHServer) => {
    if (!vault) return;
    const exists = vault.servers.some((s) => s.id === server.id);
    let updatedServers: SSHServer[];
    if (exists) {
      updatedServers = vault.servers.map((s) => (s.id === server.id ? server : s));
      showToast(`Servidor "${server.name}" actualizado.`);
    } else {
      updatedServers = [...vault.servers, server];
      showToast(`Servidor "${server.name}" guardado.`);
    }
    await persistVault({ ...vault, servers: updatedServers });
    setEditingServer(null);
  };

  const handleDuplicateServer = async (server: SSHServer) => {
    if (!vault) return;
    const duplicated: SSHServer = {
      ...server,
      id: crypto.randomUUID(),
      name: `${server.name} (Copia)`,
      createdAt: new Date().toISOString()
    };
    const updatedServers = [...vault.servers, duplicated];
    await persistVault({ ...vault, servers: updatedServers });
    showToast(`Servidor "${server.name}" duplicado.`);
  };

  const handleDeleteServer = async (id: string) => {
    if (!vault) return;
    const server = vault.servers.find((s) => s.id === id);
    const updatedServers = vault.servers.filter((s) => s.id !== id);
    await persistVault({ ...vault, servers: updatedServers });
    showToast(`Servidor "${server?.name || id}" eliminado.`);
  };

  const handleSaveKey = async (key: SSHKey) => {
    if (!vault) return;
    const exists = vault.keys.some((k) => k.id === key.id);
    let updatedKeys: SSHKey[];
    if (exists) {
      updatedKeys = vault.keys.map((k) => (k.id === key.id ? key : k));
      showToast(`Clave SSH "${key.name}" actualizada.`);
    } else {
      updatedKeys = [...vault.keys, key];
      showToast(`Clave SSH "${key.name}" guardada en la bóveda.`);
    }
    await persistVault({ ...vault, keys: updatedKeys });
  };

  const handleDeleteKey = async (id: string) => {
    if (!vault) return;
    const key = vault.keys.find((k) => k.id === id);
    const updatedKeys = vault.keys.filter((k) => k.id !== id);
    await persistVault({ ...vault, keys: updatedKeys });
    showToast(`Clave SSH "${key?.name || id}" eliminada.`);
  };

  const handleConnect = (server: SSHServer) => {
    const sessionId = crypto.randomUUID();
    setSessions((prev) => [...prev, { sessionId, name: server.name, server }]);
    setSelectedBroadcastSessionIds((prev) => [...prev, sessionId]);
    setActiveSessionId(sessionId);
  };

  const handleOpenLocalTerminal = () => {
    const sessionId = crypto.randomUUID();
    const count = sessions.filter((p) => p.isLocal).length + 1;
    setSessions((prev) => [...prev, { sessionId, name: `Local #${count}`, isLocal: true }]);
    setSelectedBroadcastSessionIds((prev) => [...prev, sessionId]);
    setActiveSessionId(sessionId);
  };

  const handleCloseSession = (sessionId: string) => {
    setSessions((prev) => {
      const remaining = prev.filter((s) => s.sessionId !== sessionId);
      if (activeSessionId === sessionId) {
        setActiveSessionId(remaining.length > 0 ? remaining[remaining.length - 1].sessionId : null);
      }
      return remaining;
    });
    setSelectedBroadcastSessionIds((prev) => prev.filter((id) => id !== sessionId));
  };

  // Layout & Broadcast handlers (Termius-like multi-terminal execution & split screen)
  const handleToggleLayoutMode = () => {
    setLayoutMode((prev) => {
      const next = prev === 'grid' ? 'single' : 'grid';
      showToast(next === 'grid' ? 'Vista en mosaico activada: todas las terminales en pantalla.' : 'Vista de pestaña individual activada.');
      setTimeout(() => window.dispatchEvent(new Event('resize')), 50);
      return next;
    });
  };

  const handleToggleBroadcast = () => {
    if (sessions.length === 0) {
      showToast('Abre al menos una sesión de terminal para emitir comandos.');
      return;
    }
    setIsBroadcastOpen((prev) => {
      const next = !prev;
      // Al abrir broadcast con 2 o más sesiones, activamos la vista en mosaico automáticamente estilo Termius
      if (next && sessions.length >= 2) {
        setLayoutMode('grid');
        setTimeout(() => window.dispatchEvent(new Event('resize')), 50);
      }
      return next;
    });
  };

  const handleToggleBroadcastSession = (sessionId: string) => {
    setSelectedBroadcastSessionIds((prev) =>
      prev.includes(sessionId) ? prev.filter((id) => id !== sessionId) : [...prev, sessionId]
    );
  };

  const handleSelectAllBroadcastSessions = () => {
    setSelectedBroadcastSessionIds(sessions.map((s) => s.sessionId));
  };

  const handleDeselectAllBroadcastSessions = () => {
    setSelectedBroadcastSessionIds([]);
  };

  const handleToggleLiveBroadcast = () => {
    setIsLiveBroadcast((prev) => {
      const next = !prev;
      if (next) {
        showToast('⚠️ Modo Teclado en Vivo activado: tu escritura se replicará en las terminales seleccionadas.');
      } else {
        showToast('Modo Teclado en Vivo desactivado.');
      }
      return next;
    });
  };

  const handleSendBroadcastCommand = (command: string) => {
    const cmd = command.trim();
    if (!cmd) return;
    const targets = sessions.filter((s) => selectedBroadcastSessionIds.includes(s.sessionId));
    if (targets.length === 0) {
      showToast('Selecciona al menos una terminal para emitir el comando.');
      return;
    }
    const payload = cmd + '\r\n';
    targets.forEach((s) => {
      if (s.isLocal) {
        window.electronAPI.sendLocalData(s.sessionId, payload);
      } else {
        window.electronAPI.sendSSHData(s.sessionId, payload);
      }
    });
    showToast(`📡 Comando "${cmd}" emitido a ${targets.length} terminal${targets.length > 1 ? 'es' : ''}.`);
  };

  const handleTerminalUserInput = (sourceSessionId: string, data: string) => {
    if (!isLiveBroadcast) return;
    sessions.forEach((s) => {
      if (s.sessionId !== sourceSessionId && selectedBroadcastSessionIds.includes(s.sessionId)) {
        if (s.isLocal) {
          window.electronAPI.sendLocalData(s.sessionId, data);
        } else {
          window.electronAPI.sendSSHData(s.sessionId, data);
        }
      }
    });
  };

  const handleExportVault = async () => {
    if (!vault) return;
    const target = await window.electronAPI.selectFileToSave();
    if (target) {
      await window.electronAPI.saveVault(vault, target);
      showToast(`Bóveda exportada exitosamente.`);
    }
  };

  const handleCopySSHCommand = (s: SSHServer, e: React.MouseEvent) => {
    e.stopPropagation();
    const cmd = `ssh ${s.username}@${s.host} -p ${s.port}`;
    navigator.clipboard.writeText(cmd).catch(() => {});
    showToast(`Comando copiado: ${cmd}`);
  };

  // Atajos de Teclado Globales (Productividad y Velocidad)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isInput = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
      const isCtrl = e.ctrlKey || e.metaKey;

      // Ctrl+K -> Enfocar búsqueda
      if (isCtrl && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setActiveTab('servers');
        setActiveSessionId(null);
        setTimeout(() => searchInputRef.current?.focus(), 50);
        return;
      }

      // Ctrl+T -> Nueva terminal local
      if (isCtrl && e.key.toLowerCase() === 't') {
        e.preventDefault();
        handleOpenLocalTerminal();
        return;
      }

      // Ctrl+N -> Nuevo servidor
      if (isCtrl && e.key.toLowerCase() === 'n' && !isInput) {
        e.preventDefault();
        setEditingServer(null);
        setIsServerModalOpen(true);
        return;
      }

      // Ctrl+W -> Cerrar pestaña activa
      if (isCtrl && e.key.toLowerCase() === 'w') {
        if (activeSessionId) {
          e.preventDefault();
          handleCloseSession(activeSessionId);
        }
        return;
      }

      // Ctrl+L -> Bloquear bóveda
      if (isCtrl && e.key.toLowerCase() === 'l' && !isInput) {
        e.preventDefault();
        handleLock();
        return;
      }

      // Ctrl+B -> Alternar panel de emisión masiva (Broadcast)
      if (isCtrl && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        handleToggleBroadcast();
        return;
      }

      // Ctrl+Shift+G -> Alternar vista mosaico / pestaña única
      if (isCtrl && e.shiftKey && e.key.toLowerCase() === 'g') {
        e.preventDefault();
        if (sessions.length >= 2) {
          handleToggleLayoutMode();
        } else {
          showToast('Abre al menos 2 sesiones para dividir la pantalla.');
        }
        return;
      }

      // Escape -> Limpiar búsqueda o volver al panel de servidores
      if (e.key === 'Escape') {
        if (serverSearch) {
          setServerSearch('');
        } else if (activeSessionId) {
          setActiveSessionId(null);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeSessionId, serverSearch, sessions]);

  // Si la bóveda está bloqueada, renderizar pantalla de bienvenida y desbloqueo
  if (!vault) {
    return <UnlockScreen onUnlock={handleUnlock} />;
  }

  // Grupos únicos disponibles
  const availableGroups = Array.from(
    new Set(vault.servers.map((s) => s.group || 'General'))
  ).sort();

  // Filtrado reactivo de servidores
  const filteredServers = vault.servers.filter((s) => {
    // Filtro por grupo
    if (selectedGroup !== 'ALL' && (s.group || 'General') !== selectedGroup) {
      return false;
    }
    // Filtro por búsqueda de texto
    if (!serverSearch.trim()) return true;
    const q = serverSearch.toLowerCase();
    return (
      s.name.toLowerCase().includes(q) ||
      s.host.toLowerCase().includes(q) ||
      s.username.toLowerCase().includes(q) ||
      (s.group && s.group.toLowerCase().includes(q)) ||
      String(s.port).includes(q)
    );
  });

  // Agrupamiento de servidores filtrados
  const serverGroups = filteredServers.reduce((acc, server) => {
    const g = server.group || 'General';
    if (!acc[g]) acc[g] = [];
    acc[g].push(server);
    return acc;
  }, {} as Record<string, SSHServer[]>);

  return (
    <Flex style={{ height: '100vh', width: '100vw', background: 'var(--color-background)', overflow: 'hidden' }}>
      {/* Toast Flotante estilizado */}
      {toastMessage && (
        <Box
          style={{
            position: 'fixed',
            bottom: 24,
            right: 24,
            zIndex: 9999,
            background: 'linear-gradient(135deg, #102d62, #087bff)',
            color: 'white',
            padding: '10px 18px',
            borderRadius: 10,
            boxShadow: '0 10px 30px rgba(0,0,0,0.6)',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            fontSize: 13,
            fontWeight: 500,
            border: '1px solid rgba(255,255,255,0.15)',
            animation: 'fadeIn 0.2s ease-out'
          }}
        >
          <CheckCircle2 size={16} color="#21d4f5" />
          <span>{toastMessage}</span>
          <IconButton
            size="1"
            variant="ghost"
            color="gray"
            style={{ color: 'white', width: 18, height: 18, marginLeft: 6 }}
            onClick={() => setToastMessage(null)}
          >
            <X size={12} />
          </IconButton>
        </Box>
      )}

      {/* Sidebar Lateral */}
      <Flex
        direction="column"
        style={{
          width: 260,
          background: 'var(--gray-2)',
          borderRight: '1px solid var(--gray-4)',
          flexShrink: 0
        }}
      >
        {/* Encabezado del Sidebar */}
        <Flex align="center" justify="between" px="3" py="3" className="titlebar-drag-region" style={{ borderBottom: '1px solid var(--gray-4)' }}>
          <Flex align="center" gap="2">
            <Box style={{ width: 28, height: 28, filter: 'drop-shadow(0 0 8px rgba(33, 212, 245, 0.6))', display: 'flex', alignItems: 'center' }}>
              <img src={logoSvg} alt="Terminal RellySSH Logo" style={{ width: '100%', height: '100%' }} />
            </Box>
            <Flex direction="column">
              <Heading size="3" weight="bold" style={{ lineHeight: 1.1 }}>
                Terminal RellySSH
              </Heading>
              <Text size="1" color="gray" style={{ fontSize: 10 }}>
                v1.3.0
              </Text>
            </Flex>
          </Flex>

          <Tooltip content="Bloquear Bóveda (Ctrl+L)">
            <IconButton size="1" variant="ghost" color="gray" onClick={handleLock} className="no-drag">
              <Lock size={15} />
            </IconButton>
          </Tooltip>
        </Flex>

        {/* Botones de Navegación del Sidebar */}
        <Box p="2">
          <Flex direction="column" gap="1">
            <Button
              variant={activeTab === 'servers' && !activeSessionId ? 'solid' : 'ghost'}
              color="iris"
              style={{ justifyContent: 'flex-start', cursor: 'pointer' }}
              onClick={() => {
                setActiveTab('servers');
                setActiveSessionId(null);
              }}
            >
              <Server size={16} style={{ marginRight: 8 }} />
              Servidores ({vault.servers.length})
            </Button>

            <Button
              variant={activeTab === 'keys' && !activeSessionId ? 'solid' : 'ghost'}
              color="iris"
              style={{ justifyContent: 'flex-start', cursor: 'pointer' }}
              onClick={() => {
                setActiveTab('keys');
                setActiveSessionId(null);
              }}
            >
              <KeyRound size={16} style={{ marginRight: 8 }} />
              Claves SSH ({vault.keys.length})
            </Button>

            <Button
              variant={activeTab === 'github' && !activeSessionId ? 'solid' : 'ghost'}
              color="iris"
              style={{ justifyContent: 'flex-start', cursor: 'pointer' }}
              onClick={() => {
                setActiveTab('github');
                setActiveSessionId(null);
              }}
            >
              <GitHubLogoIcon width={16} height={16} style={{ marginRight: 8 }} />
              GitHub Sync
            </Button>

            <Button
              variant={activeTab === 'updates' && !activeSessionId ? 'solid' : 'ghost'}
              color={updateInfo?.hasUpdate ? 'cyan' : 'iris'}
              style={{ justifyContent: 'flex-start', cursor: 'pointer' }}
              onClick={() => {
                setActiveTab('updates');
                setActiveSessionId(null);
              }}
            >
              <RefreshCw size={16} style={{ marginRight: 8 }} />
              Actualizaciones
              {updateInfo?.hasUpdate && (
                <Badge size="1" color="cyan" style={{ marginLeft: 'auto' }}>
                  Nuevo
                </Badge>
              )}
            </Button>

            <Button
              variant="soft"
              color="blue"
              style={{ justifyContent: 'flex-start', cursor: 'pointer', marginTop: 4 }}
              onClick={handleOpenLocalTerminal}
              title="Atajo: Ctrl+T"
            >
              <Terminal size={16} style={{ marginRight: 8 }} />
              Nueva Terminal Local
            </Button>
          </Flex>
        </Box>

        <Separator size="4" my="1" />

        {/* Lista de Sesiones Activas en Sidebar */}
        <Flex direction="column" style={{ flex: 1, minHeight: 0 }} px="2">
          <Box px="2" mb="1">
            <Text size="1" weight="bold" color="gray">
              SESIONES ACTIVAS ({sessions.length})
            </Text>
          </Box>
          <ScrollArea style={{ flex: 1 }}>
            <Flex direction="column" gap="1">
              {sessions.map((s) => (
                <Card
                  key={s.sessionId}
                  size="1"
                  style={{
                    cursor: 'pointer',
                    background: activeSessionId === s.sessionId ? 'var(--iris-4)' : 'transparent',
                    borderColor: activeSessionId === s.sessionId ? 'var(--iris-7)' : 'var(--gray-4)'
                  }}
                  onClick={() => setActiveSessionId(s.sessionId)}
                >
                  <Flex justify="between" align="center">
                    <Flex align="center" gap="2" style={{ minWidth: 0, overflow: 'hidden' }}>
                      <Terminal size={14} color={s.isLocal ? 'var(--blue-9)' : 'var(--iris-10)'} />
                      <Text size="2" weight="medium" truncate>
                        {s.name}
                      </Text>
                    </Flex>
                    <IconButton
                      size="1"
                      variant="ghost"
                      color="gray"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleCloseSession(s.sessionId);
                      }}
                      title="Cerrar sesión"
                    >
                      <Trash2 size={12} />
                    </IconButton>
                  </Flex>
                </Card>
              ))}
              {sessions.length === 0 && (
                <Box px="2" py="1">
                  <Text size="1" color="gray">
                    Ninguna sesión activa
                  </Text>
                </Box>
              )}
            </Flex>
          </ScrollArea>
        </Flex>

        {/* Barra inferior de estado y sincronización */}
        <Box p="3" style={{ borderTop: '1px solid var(--gray-4)', background: 'var(--gray-3)' }}>
          <Flex direction="column" gap="1">
            <Flex align="center" justify="between">
              <Text size="1" color="gray" weight="medium">
                Bóveda Cifrada
              </Text>
              <Badge color="green" size="1">
                Argon2id + AES
              </Badge>
            </Flex>
            <Text size="1" color="gray" truncate title={currentPath}>
              {currentPath ? currentPath.split(/[\\/]/).pop() : 'relly_servers.vault'}
            </Text>
            <Flex gap="1" mt="2">
              <Button size="1" variant="soft" color="gray" style={{ flex: 1 }} onClick={handleExportVault}>
                <Download size={13} style={{ marginRight: 4 }} /> Exportar
              </Button>
              <Button
                size="1"
                variant={activeTab === 'github' && !activeSessionId ? 'solid' : 'soft'}
                color="iris"
                style={{ flex: 1 }}
                onClick={() => {
                  setActiveTab('github');
                  setActiveSessionId(null);
                }}
              >
                <GitHubLogoIcon width={13} height={13} style={{ marginRight: 4 }} /> GitHub
              </Button>
            </Flex>
          </Flex>
        </Box>
      </Flex>

      {/* Área de Contenido Principal */}
      <Flex direction="column" style={{ flex: 1, minWidth: 0, height: '100%' }}>
        {showMigrationBanner && (
          <Flex
            align="center"
            justify="between"
            px="4"
            py="2"
            style={{
              background: 'linear-gradient(90deg, #102d62, #087bff)',
              color: 'white'
            }}
          >
            <Flex align="center" gap="2">
              <Shield size={16} />
              <Text size="2" weight="medium">
                Esta bóveda utiliza el formato V1 (PBKDF2). ¿Deseas migrarla ahora al formato V2 (Argon2id + DEK)?
              </Text>
            </Flex>
            <Flex gap="2">
              <Button size="1" variant="solid" color="cyan" onClick={handleMigrateToV2}>
                Migrar a V2 Ahora
              </Button>
              <Button size="1" variant="ghost" color="gray" onClick={() => setShowMigrationBanner(false)}>
                Recordar más tarde
              </Button>
            </Flex>
          </Flex>
        )}

        {/* Banner de Actualización Disponible (Integrado en UI, sin modal) */}
        {updateInfo?.hasUpdate && !dismissedUpdateBanner && (
          <Flex
            align="center"
            justify="between"
            px="4"
            py="2"
            style={{
              background: 'linear-gradient(90deg, #091b3a, #102d62)',
              borderBottom: '1px solid rgba(33, 212, 245, 0.3)',
              color: 'white'
            }}
          >
            <Flex align="center" gap="2">
              <Sparkles size={16} color="#21d4f5" />
              <Text size="2" weight="medium">
                ⚡ ¡Nueva versión disponible: <strong style={{ color: '#21d4f5' }}>{updateInfo.latestRelease?.tagName}</strong>! ¿Deseas verificar los hashes SHA-256 y actualizar?
              </Text>
            </Flex>
            <Flex gap="2" align="center">
              <Button
                size="1"
                variant="solid"
                color="cyan"
                onClick={() => {
                  setActiveTab('updates');
                  setActiveSessionId(null);
                }}
                style={{ cursor: 'pointer' }}
              >
                Revisar y Actualizar
              </Button>
              <Button
                size="1"
                variant="ghost"
                color="gray"
                onClick={() => setDismissedUpdateBanner(true)}
                style={{ cursor: 'pointer' }}
              >
                Descartar
              </Button>
            </Flex>
          </Flex>
        )}

        {/* Barra Superior Horizontal de Pestañas */}
        <Flex
          align="center"
          style={{
            background: 'var(--gray-3)',
            borderBottom: '1px solid var(--gray-5)',
            overflowX: 'auto',
            minHeight: 40,
            paddingLeft: 8,
            paddingRight: 8,
            gap: 4
          }}
        >
          {/* Botón rápido para volver al panel de servidores/claves */}
          <Button
            size="1"
            variant={!activeSessionId ? 'solid' : 'ghost'}
            color={!activeSessionId ? 'iris' : 'gray'}
            onClick={() => setActiveSessionId(null)}
            style={{ borderRadius: '6px 6px 0 0', cursor: 'pointer' }}
          >
            <LayoutGrid size={13} style={{ marginRight: 4 }} /> Panel de Servidores
          </Button>

          {sessions.map((s) => {
            const isActive = activeSessionId === s.sessionId;
            return (
              <Flex
                key={s.sessionId}
                align="center"
                gap="2"
                px="3"
                py="1"
                style={{
                  cursor: 'pointer',
                  borderRadius: '6px 6px 0 0',
                  background: isActive ? '#0d1117' : 'var(--gray-4)',
                  borderBottom: isActive ? '2px solid var(--iris-9)' : '2px solid transparent',
                  color: isActive ? 'white' : 'var(--gray-11)',
                  transition: 'all 0.15s ease',
                  maxWidth: 220
                }}
                onClick={() => setActiveSessionId(s.sessionId)}
              >
                {s.isLocal ? (
                  <Terminal size={14} color="var(--blue-9)" />
                ) : (
                  <Server size={14} color="var(--iris-9)" />
                )}
                <Text size="2" weight={isActive ? 'bold' : 'regular'} truncate style={{ maxWidth: 140 }}>
                  {s.name}
                </Text>
                <IconButton
                  size="1"
                  variant="ghost"
                  color="gray"
                  style={{ width: 18, height: 18, borderRadius: 9 }}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleCloseSession(s.sessionId);
                  }}
                  title="Cerrar pestaña (Ctrl+W)"
                >
                  <X size={12} />
                </IconButton>
              </Flex>
            );
          })}

          {/* Menú '+' para abrir pestañas rápidas */}
          <DropdownMenu.Root>
            <DropdownMenu.Trigger>
              <IconButton size="1" variant="soft" color="gray" title="Abrir nueva pestaña (Ctrl+T)">
                <Plus size={14} />
              </IconButton>
            </DropdownMenu.Trigger>
            <DropdownMenu.Content>
              <DropdownMenu.Item onClick={handleOpenLocalTerminal}>
                <Terminal size={14} style={{ marginRight: 6 }} /> Terminal Local (Ctrl+T)
              </DropdownMenu.Item>
              {vault.servers.length > 0 && <DropdownMenu.Separator />}
              {vault.servers.map((srv) => (
                <DropdownMenu.Item key={srv.id} onClick={() => handleConnect(srv)}>
                  <Server size={14} style={{ marginRight: 6 }} /> Conectar a {srv.name}
                </DropdownMenu.Item>
              ))}
            </DropdownMenu.Content>
          </DropdownMenu.Root>

          {/* Botón de alternancia de vista Mosaico / Pestaña única */}
          {sessions.length >= 2 && (
            <Button
              size="1"
              variant={layoutMode === 'grid' ? 'solid' : 'ghost'}
              color={layoutMode === 'grid' ? 'iris' : 'gray'}
              onClick={handleToggleLayoutMode}
              title="Alternar entre vista en mosaico y pestaña individual (Ctrl+Shift+G)"
              style={{ borderRadius: '6px 6px 0 0', cursor: 'pointer', gap: 4 }}
            >
              {layoutMode === 'grid' ? <LayoutGrid size={13} /> : <Columns size={13} />}
              <span>{layoutMode === 'grid' ? 'Mosaico' : 'Dividir'}</span>
            </Button>
          )}

          {/* Botón de Broadcast / Emisión Masiva (estilo Termius) */}
          {sessions.length > 0 && (
            <Button
              size="1"
              variant={isBroadcastOpen ? 'solid' : 'soft'}
              color={isLiveBroadcast ? 'amber' : isBroadcastOpen ? 'iris' : 'gray'}
              onClick={handleToggleBroadcast}
              title="Emisión de comandos a múltiples terminales (Ctrl+B)"
              style={{ marginLeft: 'auto', cursor: 'pointer', gap: 6 }}
            >
              <Radio size={13} />
              <span>Broadcast ({selectedBroadcastSessionIds.length}/{sessions.length})</span>
              {isLiveBroadcast && (
                <Badge size="1" color="red" variant="solid">
                  EN VIVO
                </Badge>
              )}
            </Button>
          )}
        </Flex>

        {/* Panel de Emisión Masiva (Broadcast & Snippets) */}
        {isBroadcastOpen && sessions.length > 0 && (
          <BroadcastBar
            sessions={sessions}
            activeSessionId={activeSessionId}
            selectedSessionIds={selectedBroadcastSessionIds}
            isLiveBroadcast={isLiveBroadcast}
            layoutMode={layoutMode}
            gridFilterMode={gridFilterMode}
            onToggleSession={handleToggleBroadcastSession}
            onSelectAll={handleSelectAllBroadcastSessions}
            onDeselectAll={handleDeselectAllBroadcastSessions}
            onToggleLiveBroadcast={handleToggleLiveBroadcast}
            onToggleLayoutMode={handleToggleLayoutMode}
            onToggleGridFilterMode={() => setGridFilterMode((prev) => (prev === 'all' ? 'broadcastOnly' : 'all'))}
            onSendCommand={handleSendBroadcastCommand}
            onClose={() => setIsBroadcastOpen(false)}
          />
        )}

        {/* Área de Terminales Persistentes (Mantiene conexiones vivas en DOM sin destruirlas) */}
        {(() => {
          const visibleSessionsInGrid = sessions.filter((s) =>
            gridFilterMode === 'broadcastOnly' ? selectedBroadcastSessionIds.includes(s.sessionId) : true
          );
          const gridCount = visibleSessionsInGrid.length > 0 ? visibleSessionsInGrid.length : sessions.length;

          return (
            <Box
              style={{
                flex: 1,
                minHeight: 0,
                width: '100%',
                background: layoutMode === 'grid' ? '#0a0d12' : '#0d1117',
                display: activeSessionId ? (layoutMode === 'grid' ? 'grid' : 'flex') : 'none',
                ...(layoutMode === 'grid'
                  ? {
                      ...getTerminalGridLayout(gridCount),
                      gap: '8px',
                      padding: '8px',
                      boxSizing: 'border-box'
                    }
                  : {})
              }}
            >
              {sessions.map((s) => {
                const sKey = s.server?.keyId ? vault.keys.find((k) => k.id === s.server?.keyId) : undefined;
                const isVisibleInGrid = gridFilterMode === 'broadcastOnly'
                  ? selectedBroadcastSessionIds.includes(s.sessionId)
                  : true;
                const isVisible = layoutMode === 'grid' ? isVisibleInGrid : activeSessionId === s.sessionId;
                const isActive = activeSessionId === s.sessionId;

                return (
                  <Box
                    key={s.sessionId}
                    style={{
                      display: isVisible ? 'flex' : 'none',
                      height: '100%',
                      width: '100%',
                      minWidth: 0,
                      minHeight: 0,
                      flex: layoutMode === 'single' ? 1 : undefined
                    }}
                  >
                    <TerminalTab
                      sessionId={s.sessionId}
                      server={s.server}
                      sshKey={sKey}
                      isLocal={s.isLocal}
                      isActive={isActive}
                      isGridMode={layoutMode === 'grid'}
                      isBroadcastTarget={selectedBroadcastSessionIds.includes(s.sessionId)}
                      isLiveBroadcast={isLiveBroadcast}
                      onToggleBroadcast={() => handleToggleBroadcastSession(s.sessionId)}
                      onMaximize={() => {
                        setActiveSessionId(s.sessionId);
                        setLayoutMode('single');
                        showToast(`Maximizada terminal "${s.name}".`);
                      }}
                      onFocus={() => setActiveSessionId(s.sessionId)}
                      onClose={() => handleCloseSession(s.sessionId)}
                      onUserInput={(data) => handleTerminalUserInput(s.sessionId, data)}
                    />
                  </Box>
                );
              })}
            </Box>
          );
        })()}

        {/* VISTA DE SERVIDORES */}
        {!activeSessionId && activeTab === 'servers' && (
          <Flex direction="column" style={{ flex: 1, minHeight: 0 }}>
            {/* Header de Servidores */}
            <Flex align="center" justify="between" px="5" py="4" style={{ borderBottom: '1px solid var(--gray-4)' }}>
              <Flex direction="column">
                <Heading size="5">Servidores SSH</Heading>
                <Text size="2" color="gray">
                  Administra tus servidores remotos con máxima seguridad y conexión instantánea
                </Text>
              </Flex>
              <Flex gap="2">
                <Button
                  size="2"
                  variant="solid"
                  onClick={() => {
                    setEditingServer(null);
                    setIsServerModalOpen(true);
                  }}
                  title="Atajo: Ctrl+N"
                >
                  <Plus size={16} style={{ marginRight: 4 }} /> Nuevo Servidor
                </Button>
              </Flex>
            </Flex>

            {/* Barra de Búsqueda y Filtros Rápidos */}
            <Flex direction="column" px="5" py="3" gap="2" style={{ borderBottom: '1px solid var(--gray-4)', background: 'var(--gray-2)' }}>
              <Flex gap="3" align="center">
                <Box style={{ flex: 1, maxWidth: 420 }}>
                  <TextField.Root
                    ref={searchInputRef}
                    placeholder="Buscar por nombre, host, usuario o puerto... (Ctrl+K)"
                    value={serverSearch}
                    onChange={(e) => setServerSearch(e.target.value)}
                    size="2"
                  >
                    <TextField.Slot>
                      <Search size={14} color="var(--gray-9)" />
                    </TextField.Slot>
                    {serverSearch && (
                      <TextField.Slot>
                        <IconButton size="1" variant="ghost" color="gray" onClick={() => setServerSearch('')}>
                          <X size={12} />
                        </IconButton>
                      </TextField.Slot>
                    )}
                  </TextField.Root>
                </Box>
                <Text size="1" color="gray">
                  {filteredServers.length} de {vault.servers.length} servidores
                </Text>
              </Flex>

              {/* Píldoras de Filtro por Grupo */}
              {availableGroups.length > 0 && (
                <Flex gap="1" wrap="wrap" align="center">
                  <Button
                    size="1"
                    variant={selectedGroup === 'ALL' ? 'solid' : 'soft'}
                    color={selectedGroup === 'ALL' ? 'iris' : 'gray'}
                    onClick={() => setSelectedGroup('ALL')}
                    style={{ cursor: 'pointer', borderRadius: 14 }}
                  >
                    Todos ({vault.servers.length})
                  </Button>
                  {availableGroups.map((grp) => {
                    const count = vault.servers.filter((s) => (s.group || 'General') === grp).length;
                    const isSelected = selectedGroup === grp;
                    return (
                      <Button
                        key={grp}
                        size="1"
                        variant={isSelected ? 'solid' : 'soft'}
                        color={isSelected ? 'cyan' : 'gray'}
                        onClick={() => setSelectedGroup(grp)}
                        style={{ cursor: 'pointer', borderRadius: 14 }}
                      >
                        {grp} ({count})
                      </Button>
                    );
                  })}
                </Flex>
              )}
            </Flex>

            {/* Cuadrícula de Servidores */}
            <ScrollArea style={{ flex: 1, padding: 24 }}>
              {Object.keys(serverGroups).length === 0 ? (
                <Flex direction="column" align="center" justify="center" style={{ height: 320 }} gap="3">
                  <Server size={48} color="var(--gray-8)" />
                  <Heading size="3" color="gray">
                    {serverSearch || selectedGroup !== 'ALL'
                      ? 'No se encontraron servidores coincidentes'
                      : 'No tienes servidores registrados'}
                  </Heading>
                  <Text size="2" color="gray">
                    {serverSearch || selectedGroup !== 'ALL'
                      ? 'Intenta restablecer los filtros de búsqueda.'
                      : 'Agrega tu primer servidor SSH haciendo clic en "Nuevo Servidor".'}
                  </Text>
                  {serverSearch || selectedGroup !== 'ALL' ? (
                    <Button
                      variant="outline"
                      onClick={() => {
                        setServerSearch('');
                        setSelectedGroup('ALL');
                      }}
                    >
                      Limpiar Filtros
                    </Button>
                  ) : (
                    <Button
                      variant="outline"
                      onClick={() => {
                        setEditingServer(null);
                        setIsServerModalOpen(true);
                      }}
                    >
                      <Plus size={14} style={{ marginRight: 4 }} /> Agregar Servidor
                    </Button>
                  )}
                </Flex>
              ) : (
                Object.entries(serverGroups).map(([groupName, groupServers]) => (
                  <Box key={groupName} mb="6">
                    <Flex align="center" gap="2" mb="3">
                      <Layers size={16} color="var(--iris-9)" />
                      <Heading size="3" weight="bold">
                        {groupName}
                      </Heading>
                      <Badge size="1" color="gray">
                        {groupServers.length}
                      </Badge>
                    </Flex>

                    <Flex wrap="wrap" gap="3">
                      {groupServers.map((s) => {
                        const keyObj = s.keyId ? vault.keys.find((k) => k.id === s.keyId) : undefined;
                        return (
                          <Card
                            key={s.id}
                            size="2"
                            style={{
                              width: 320,
                              border: '1px solid var(--gray-5)',
                              transition: 'transform 0.15s ease, box-shadow 0.15s ease',
                              cursor: 'pointer'
                            }}
                            onDoubleClick={() => handleConnect(s)}
                          >
                            <Flex direction="column" gap="3">
                              {/* Header de la tarjeta */}
                              <Flex justify="between" align="start">
                                <Box style={{ minWidth: 0, flex: 1, paddingRight: 8 }}>
                                  <Heading size="3" truncate title={s.name}>
                                    {s.name}
                                  </Heading>
                                  <Text size="1" color="gray" truncate title={`${s.username}@${s.host}:${s.port}`}>
                                    {s.username}@{s.host}
                                  </Text>
                                </Box>

                                <Flex align="center" gap="1">
                                  <Tooltip content="Copiar comando SSH">
                                    <IconButton
                                      size="1"
                                      variant="ghost"
                                      color="gray"
                                      onClick={(e) => handleCopySSHCommand(s, e)}
                                    >
                                      <Copy size={13} />
                                    </IconButton>
                                  </Tooltip>

                                  <DropdownMenu.Root>
                                    <DropdownMenu.Trigger>
                                      <IconButton size="1" variant="ghost" color="gray">
                                        <MoreVertical size={16} />
                                      </IconButton>
                                    </DropdownMenu.Trigger>
                                    <DropdownMenu.Content>
                                      <DropdownMenu.Item
                                        onClick={() => {
                                          setEditingServer(s);
                                          setIsServerModalOpen(true);
                                        }}
                                      >
                                        <Edit2 size={14} style={{ marginRight: 6 }} /> Editar
                                      </DropdownMenu.Item>
                                      <DropdownMenu.Item onClick={() => handleDuplicateServer(s)}>
                                        <Copy size={14} style={{ marginRight: 6 }} /> Duplicar
                                      </DropdownMenu.Item>
                                      <DropdownMenu.Item onClick={(e) => handleCopySSHCommand(s, e as any)}>
                                        <Terminal size={14} style={{ marginRight: 6 }} /> Copiar Comando SSH
                                      </DropdownMenu.Item>
                                      <DropdownMenu.Separator />
                                      <DropdownMenu.Item color="red" onClick={() => handleDeleteServer(s.id)}>
                                        <Trash2 size={14} style={{ marginRight: 6 }} /> Eliminar
                                      </DropdownMenu.Item>
                                    </DropdownMenu.Content>
                                  </DropdownMenu.Root>
                                </Flex>
                              </Flex>

                              {/* Badges de Detalles */}
                              <Flex align="center" gap="2" wrap="wrap">
                                <Badge color={s.port === 22 ? 'gray' : 'cyan'} size="1">
                                  Puerto {s.port}
                                </Badge>

                                <Badge color={s.authType === 'key' ? 'iris' : 'amber'} size="1">
                                  {s.authType === 'key'
                                    ? `Llave: ${keyObj?.name || 'Asignada'}`
                                    : 'Contraseña'}
                                </Badge>
                              </Flex>

                              {/* Botón Principal de Conexión */}
                              <Button
                                variant="solid"
                                color="iris"
                                size="2"
                                onClick={() => handleConnect(s)}
                                style={{ cursor: 'pointer' }}
                              >
                                <Terminal size={15} style={{ marginRight: 6 }} /> Conectar SSH
                              </Button>
                            </Flex>
                          </Card>
                        );
                      })}
                    </Flex>
                  </Box>
                ))
              )}
            </ScrollArea>
          </Flex>
        )}

        {/* VISTA DE CLAVES SSH */}
        {!activeSessionId && activeTab === 'keys' && (
          <Flex direction="column" style={{ flex: 1, minHeight: 0 }}>
            <Flex align="center" justify="between" px="5" py="4" style={{ borderBottom: '1px solid var(--gray-4)' }}>
              <Flex direction="column">
                <Heading size="5">Claves SSH de la Bóveda</Heading>
                <Text size="2" color="gray">
                  Llaves privadas y públicas almacenadas con cifrado fuerte de memoria
                </Text>
              </Flex>
              <Button size="2" variant="solid" onClick={() => setIsKeyModalOpen(true)}>
                <Plus size={16} style={{ marginRight: 4 }} /> Nueva Clave
              </Button>
            </Flex>

            <ScrollArea style={{ flex: 1, padding: 24 }}>
              {vault.keys.length === 0 ? (
                <Flex direction="column" align="center" justify="center" style={{ height: 320 }} gap="3">
                  <KeyRound size={48} color="var(--gray-8)" />
                  <Heading size="3" color="gray">
                    No tienes claves SSH guardadas
                  </Heading>
                  <Text size="2" color="gray">
                    Almacena llaves RSA o Ed25519 para asignarlas fácilmente a tus servidores sin tipear contraseñas.
                  </Text>
                  <Button variant="outline" onClick={() => setIsKeyModalOpen(true)}>
                    <Plus size={14} style={{ marginRight: 4 }} /> Agregar Clave
                  </Button>
                </Flex>
              ) : (
                <Flex wrap="wrap" gap="3">
                  {vault.keys.map((k) => (
                    <Card key={k.id} size="2" style={{ width: 340, border: '1px solid var(--gray-5)' }}>
                      <Flex direction="column" gap="2">
                        <Flex justify="between" align="start">
                          <Flex align="center" gap="2">
                            <KeyRound size={18} color="var(--iris-9)" />
                            <Heading size="3">{k.name}</Heading>
                          </Flex>
                          <IconButton size="1" variant="ghost" color="ruby" onClick={() => handleDeleteKey(k.id)} title="Eliminar llave">
                            <Trash2 size={15} />
                          </IconButton>
                        </Flex>

                        <Text size="1" color="gray">
                          Creado: {new Date(k.createdAt).toLocaleDateString()}
                        </Text>

                        {k.publicKey && (
                          <Flex align="center" gap="2" mt="1">
                            <Badge color="green" size="1">
                              Clave Pública disponible
                            </Badge>
                            <Button
                              size="1"
                              variant="ghost"
                              color="gray"
                              onClick={() => {
                                navigator.clipboard.writeText(k.publicKey || '');
                                showToast('Clave pública copiada al portapapeles.');
                              }}
                            >
                              <Copy size={12} style={{ marginRight: 4 }} /> Copiar
                            </Button>
                          </Flex>
                        )}
                      </Flex>
                    </Card>
                  ))}
                </Flex>
              )}
            </ScrollArea>
          </Flex>
        )}

        {/* VISTA DE SINCRONIZACIÓN CON GITHUB (INTEGRADA, SIN MODALES) */}
        {!activeSessionId && activeTab === 'github' && (
          <GitHubSyncPanel
            onVaultUpdated={(data) => setVault(data)}
            showToast={showToast}
            onBackToServers={() => setActiveTab('servers')}
          />
        )}

        {/* VISTA DE REVISOR DE ACTUALIZACIONES Y HASHES (INTEGRADA, SIN MODALES) */}
        {!activeSessionId && activeTab === 'updates' && (
          <UpdatePanel
            showToast={showToast}
            onBackToServers={() => setActiveTab('servers')}
            initialResult={updateInfo}
            onCheckCompleted={(res) => setUpdateInfo(res)}
          />
        )}
      </Flex>

      {/* Modales */}
      <ServerModal
        open={isServerModalOpen}
        onOpenChange={setIsServerModalOpen}
        keys={vault.keys}
        onSave={handleSaveServer}
        initialServer={editingServer}
      />

      <KeyModal
        open={isKeyModalOpen}
        onOpenChange={setIsKeyModalOpen}
        onSave={handleSaveKey}
      />
    </Flex>
  );
}

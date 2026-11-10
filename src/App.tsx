import React, { useState } from 'react';
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
  Separator
} from '@radix-ui/themes';
import {
  Server,
  Plus,
  Terminal,
  KeyRound,
  Trash2,
  Lock,
  Download,
  FolderOpen,
  Edit2,
  MoreVertical,
  Layers,
  Shield,
  ExternalLink
} from 'lucide-react';
import type { VaultData, SSHServer, SSHKey } from './types';
import { UnlockScreen } from './components/UnlockScreen';
import { ServerModal } from './components/ServerModal';
import { KeyModal } from './components/KeyModal';
import { TerminalTab } from './components/TerminalTab';
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
  const [activeTab, setActiveTab] = useState<'servers' | 'keys'>('servers');
  const [showMigrationBanner, setShowMigrationBanner] = useState<boolean>(false);

  // Modals
  const [isServerModalOpen, setIsServerModalOpen] = useState(false);
  const [editingServer, setEditingServer] = useState<SSHServer | null>(null);
  const [isKeyModalOpen, setIsKeyModalOpen] = useState(false);

  // Active SSH terminal sessions
  const [sessions, setSessions] = useState<OpenSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);

  const handleUnlock = (data: VaultData, path: string, isLegacyV1?: boolean) => {
    setVault(data);
    setCurrentPath(path);
    if (isLegacyV1) {
      setShowMigrationBanner(true);
    }
  };

  const handleMigrateToV2 = async () => {
    if (!vault) return;
    try {
      await window.electronAPI.saveVault(vault, currentPath || undefined, undefined, 'strong');
      setShowMigrationBanner(false);
      alert('¡Bóveda migrada con éxito al formato V2 (Argon2id + AES-256-GCM + DEK)!');
    } catch (err: any) {
      alert(`Error en la migración: ${err.message}`);
    }
  };

  const handleLock = () => {
    setVault(null);
    setCurrentPath('');
    setSessions([]);
    setActiveSessionId(null);
  };

  const persistVault = async (updated: VaultData) => {
    setVault(updated);
    await window.electronAPI.saveVault(updated, currentPath || undefined);
  };

  const handleSaveServer = async (server: SSHServer) => {
    if (!vault) return;
    const exists = vault.servers.some((s) => s.id === server.id);
    let updatedServers: SSHServer[];
    if (exists) {
      updatedServers = vault.servers.map((s) => (s.id === server.id ? server : s));
    } else {
      updatedServers = [...vault.servers, server];
    }
    await persistVault({ ...vault, servers: updatedServers });
    setEditingServer(null);
  };

  const handleDeleteServer = async (id: string) => {
    if (!vault) return;
    const updatedServers = vault.servers.filter((s) => s.id !== id);
    await persistVault({ ...vault, servers: updatedServers });
  };

  const handleSaveKey = async (key: SSHKey) => {
    if (!vault) return;
    const updatedKeys = [...vault.keys, key];
    await persistVault({ ...vault, keys: updatedKeys });
  };

  const handleDeleteKey = async (id: string) => {
    if (!vault) return;
    const updatedKeys = vault.keys.filter((k) => k.id !== id);
    await persistVault({ ...vault, keys: updatedKeys });
  };

  const handleConnect = (server: SSHServer) => {
    const sessionId = crypto.randomUUID();
    setSessions((prev) => [...prev, { sessionId, name: server.name, server }]);
    setActiveSessionId(sessionId);
  };

  const handleOpenLocalTerminal = () => {
    const sessionId = crypto.randomUUID();
    setSessions((prev) => [...prev, { sessionId, name: 'Terminal Local', isLocal: true }]);
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
  };

  const handleExportVault = async () => {
    if (!vault) return;
    const target = await window.electronAPI.selectFileToSave();
    if (target) {
      await window.electronAPI.saveVault(vault, target);
      alert(`Bóveda exportada exitosamente a: ${target}`);
    }
  };

  // If vault is locked, show unlock/create screen
  if (!vault) {
    return <UnlockScreen onUnlock={handleUnlock} />;
  }

  // Active session object
  const currentSession = sessions.find((s) => s.sessionId === activeSessionId);
  const currentSessionKey = currentSession?.server?.keyId
    ? vault.keys.find((k) => k.id === currentSession.server?.keyId)
    : undefined;

  // Group servers
  const serverGroups = vault.servers.reduce((acc, server) => {
    const g = server.group || 'General';
    if (!acc[g]) acc[g] = [];
    acc[g].push(server);
    return acc;
  }, {} as Record<string, SSHServer[]>);

  return (
    <Flex style={{ height: '100vh', width: '100vw', background: 'var(--color-background)', overflow: 'hidden' }}>
      {/* Sidebar */}
      <Flex
        direction="column"
        style={{
          width: 260,
          background: 'var(--gray-2)',
          borderRight: '1px solid var(--gray-4)',
          flexShrink: 0
        }}
      >
        {/* App Titlebar region */}
        <Flex align="center" justify="between" px="3" py="3" className="titlebar-drag-region" style={{ borderBottom: '1px solid var(--gray-4)' }}>
          <Flex align="center" gap="2">
            <Box style={{ width: 26, height: 26, filter: 'drop-shadow(0 0 6px rgba(33, 212, 245, 0.5))' }}>
              <img src={logoSvg} alt="Logo" style={{ width: '100%', height: '100%' }} />
            </Box>
            <Heading size="3" weight="bold">
              RellySSH
            </Heading>
          </Flex>

          <Tooltip content="Bloquear Bóveda">
            <IconButton size="1" variant="ghost" color="gray" onClick={handleLock} className="no-drag">
              <Lock size={15} />
            </IconButton>
          </Tooltip>
        </Flex>

        {/* Sidebar Nav buttons */}
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
              variant="soft"
              color="blue"
              style={{ justifyContent: 'flex-start', cursor: 'pointer', marginTop: 4 }}
              onClick={handleOpenLocalTerminal}
            >
              <Terminal size={16} style={{ marginRight: 8 }} />
              Nueva Terminal Local
            </Button>
          </Flex>
        </Box>

        <Separator size="4" my="1" />

        {/* Running SSH Sessions List */}
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

        {/* Vault info bottom bar */}
        <Box p="3" style={{ borderTop: '1px solid var(--gray-4)', background: 'var(--gray-3)' }}>
          <Flex direction="column" gap="1">
            <Flex align="center" justify="between">
              <Text size="1" color="gray" weight="medium">
                Bóveda Cifrada
              </Text>
              <Badge color="green" size="1">
                AES-256
              </Badge>
            </Flex>
            <Text size="1" color="gray" truncate title={currentPath}>
              {currentPath ? currentPath.split(/[\\/]/).pop() : 'relly_servers.vault'}
            </Text>
            <Flex gap="1" mt="2">
              <Button size="1" variant="soft" color="gray" style={{ flex: 1 }} onClick={handleExportVault}>
                <Download size={13} style={{ marginRight: 4 }} /> Exportar (.vault)
              </Button>
            </Flex>
          </Flex>
        </Box>
      </Flex>

      {/* Main Content Area */}
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
        {/* If there is an active session selected, show terminal */}
        {activeSessionId && currentSession ? (
          <TerminalTab
            key={activeSessionId}
            sessionId={activeSessionId}
            server={currentSession.server}
            sshKey={currentSessionKey}
            isLocal={currentSession.isLocal}
            onClose={() => handleCloseSession(activeSessionId)}
          />
        ) : activeTab === 'servers' ? (
          /* SERVERS VIEW */
          <Flex direction="column" style={{ flex: 1, minHeight: 0 }}>
            <Flex align="center" justify="between" px="5" py="4" style={{ borderBottom: '1px solid var(--gray-4)' }}>
              <Flex direction="column">
                <Heading size="5">Servidores SSH</Heading>
                <Text size="2" color="gray">
                  Administra tus conexiones remotas y credenciales protegidas
                </Text>
              </Flex>
              <Button
                size="2"
                variant="solid"
                onClick={() => {
                  setEditingServer(null);
                  setIsServerModalOpen(true);
                }}
              >
                <Plus size={16} style={{ marginRight: 4 }} /> Nuevo Servidor
              </Button>
            </Flex>

            <ScrollArea style={{ flex: 1, padding: 24 }}>
              {Object.keys(serverGroups).length === 0 ? (
                <Flex direction="column" align="center" justify="center" style={{ height: 300 }} gap="3">
                  <Server size={48} color="var(--gray-8)" />
                  <Heading size="3" color="gray">
                    No tienes servidores registrados
                  </Heading>
                  <Text size="2" color="gray">
                    Agrega tu primer servidor SSH haciendo clic en "Nuevo Servidor".
                  </Text>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setEditingServer(null);
                      setIsServerModalOpen(true);
                    }}
                  >
                    <Plus size={14} style={{ marginRight: 4 }} /> Agregar Servidor
                  </Button>
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
                      {groupServers.map((s) => (
                        <Card
                          key={s.id}
                          size="2"
                          style={{
                            width: 300,
                            border: '1px solid var(--gray-5)',
                            transition: 'all 0.15s ease'
                          }}
                        >
                          <Flex direction="column" gap="3">
                            <Flex justify="between" align="start">
                              <Box>
                                <Heading size="3">{s.name}</Heading>
                                <Text size="1" color="gray">
                                  {s.username}@{s.host}:{s.port}
                                </Text>
                              </Box>

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
                                  <DropdownMenu.Separator />
                                  <DropdownMenu.Item color="red" onClick={() => handleDeleteServer(s.id)}>
                                    <Trash2 size={14} style={{ marginRight: 6 }} /> Eliminar
                                  </DropdownMenu.Item>
                                </DropdownMenu.Content>
                              </DropdownMenu.Root>
                            </Flex>

                            <Flex align="center" gap="2">
                              <Badge color={s.authType === 'key' ? 'iris' : 'amber'} size="1">
                                {s.authType === 'key' ? 'Clave SSH' : 'Contraseña'}
                              </Badge>
                            </Flex>

                            <Button variant="solid" color="iris" size="2" onClick={() => handleConnect(s)}>
                              <ExternalLink size={15} style={{ marginRight: 6 }} /> Conectar SSH
                            </Button>
                          </Flex>
                        </Card>
                      ))}
                    </Flex>
                  </Box>
                ))
              )}
            </ScrollArea>
          </Flex>
        ) : (
          /* KEYS VIEW */
          <Flex direction="column" style={{ flex: 1, minHeight: 0 }}>
            <Flex align="center" justify="between" px="5" py="4" style={{ borderBottom: '1px solid var(--gray-4)' }}>
              <Flex direction="column">
                <Heading size="5">Claves SSH de la Bóveda</Heading>
                <Text size="2" color="gray">
                  Llaves privadas y públicas almacenadas con cifrado fuerte
                </Text>
              </Flex>
              <Button size="2" variant="solid" onClick={() => setIsKeyModalOpen(true)}>
                <Plus size={16} style={{ marginRight: 4 }} /> Nueva Clave
              </Button>
            </Flex>

            <ScrollArea style={{ flex: 1, padding: 24 }}>
              {vault.keys.length === 0 ? (
                <Flex direction="column" align="center" justify="center" style={{ height: 300 }} gap="3">
                  <KeyRound size={48} color="var(--gray-8)" />
                  <Heading size="3" color="gray">
                    No tienes claves SSH guardadas
                  </Heading>
                  <Text size="2" color="gray">
                    Almacena llaves RSA o Ed25519 para asignarlas fácilmente a tus servidores.
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
                          <IconButton size="1" variant="ghost" color="ruby" onClick={() => handleDeleteKey(k.id)}>
                            <Trash2 size={15} />
                          </IconButton>
                        </Flex>

                        <Text size="1" color="gray">
                          Creado: {new Date(k.createdAt).toLocaleDateString()}
                        </Text>

                        {k.publicKey ? (
                          <Box
                            p="2"
                            style={{
                              background: 'var(--gray-3)',
                              borderRadius: '6px',
                              fontFamily: 'monospace',
                              fontSize: 11,
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap'
                            }}
                          >
                            {k.publicKey}
                          </Box>
                        ) : (
                          <Text size="1" color="gray">
                            (Sin llave pública asociada)
                          </Text>
                        )}

                        <Flex justify="between" align="center" mt="1">
                          <Badge color="green" size="1">
                            {k.passphrase ? 'Con Passphrase' : 'Sin Passphrase'}
                          </Badge>
                          <Button
                            size="1"
                            variant="soft"
                            onClick={() => {
                              navigator.clipboard.writeText(k.publicKey || k.privateKey);
                              alert('Copiado al portapapeles');
                            }}
                          >
                            Copiar
                          </Button>
                        </Flex>
                      </Flex>
                    </Card>
                  ))}
                </Flex>
              )}
            </ScrollArea>
          </Flex>
        )}
      </Flex>

      {/* Modals */}
      <ServerModal
        open={isServerModalOpen}
        onOpenChange={setIsServerModalOpen}
        keys={vault.keys}
        onSave={handleSaveServer}
        initialServer={editingServer}
      />

      <KeyModal open={isKeyModalOpen} onOpenChange={setIsKeyModalOpen} onSave={handleSaveKey} />
    </Flex>
  );
}

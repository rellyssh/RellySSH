import React, { useState } from 'react';
import {
  Dialog,
  Button,
  Flex,
  Text,
  TextField,
  Select,
  SegmentedControl
} from '@radix-ui/themes';
import { Server, Key, Lock, Hash, User } from 'lucide-react';
import type { SSHServer, SSHKey } from '../types';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  keys: SSHKey[];
  onSave: (server: SSHServer) => void;
  initialServer?: SSHServer | null;
}

export const ServerModal: React.FC<Props> = ({
  open,
  onOpenChange,
  keys,
  onSave,
  initialServer
}) => {
  const [name, setName] = useState(initialServer?.name || '');
  const [host, setHost] = useState(initialServer?.host || '');
  const [port, setPort] = useState(initialServer?.port ? String(initialServer.port) : '22');
  const [username, setUsername] = useState(initialServer?.username || '');
  const [authType, setAuthType] = useState<'password' | 'key'>(initialServer?.authType || 'password');
  const [password, setPassword] = useState(initialServer?.password || '');
  const [keyId, setKeyId] = useState(initialServer?.keyId || (keys[0]?.id || ''));
  const [group, setGroup] = useState(initialServer?.group || 'Producción');

  React.useEffect(() => {
    if (initialServer) {
      setName(initialServer.name);
      setHost(initialServer.host);
      setPort(String(initialServer.port));
      setUsername(initialServer.username);
      setAuthType(initialServer.authType);
      setPassword(initialServer.password || '');
      setKeyId(initialServer.keyId || (keys[0]?.id || ''));
      setGroup(initialServer.group || 'Producción');
    } else {
      setName('');
      setHost('');
      setPort('22');
      setUsername('root');
      setAuthType('password');
      setPassword('');
      setKeyId(keys[0]?.id || '');
      setGroup('General');
    }
  }, [initialServer, open, keys]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || !host || !username) return;

    const server: SSHServer = {
      id: initialServer?.id || crypto.randomUUID(),
      name,
      host,
      port: parseInt(port, 10) || 22,
      username,
      authType,
      password: authType === 'password' ? password : undefined,
      keyId: authType === 'key' ? keyId : undefined,
      group: group.trim() || 'General',
      createdAt: initialServer?.createdAt || new Date().toISOString()
    };

    onSave(server);
    onOpenChange(false);
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Content style={{ maxWidth: 480 }}>
        <Dialog.Title>
          <Flex align="center" gap="2">
            <Server size={20} color="var(--iris-9)" />
            {initialServer ? 'Editar Servidor SSH' : 'Nuevo Servidor SSH'}
          </Flex>
        </Dialog.Title>
        <Dialog.Description size="2" mb="4" color="gray">
          Configura los detalles de conexión. Todos los secretos se almacenan cifrados.
        </Dialog.Description>

        <form onSubmit={handleSubmit}>
          <Flex direction="column" gap="3">
            <Flex direction="column" gap="1">
              <Text size="1" weight="medium">
                Nombre del Servidor / Etiqueta
              </Text>
              <TextField.Root
                placeholder="ej. VPS Producción AWS"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </Flex>

            <Flex gap="3">
              <Flex direction="column" gap="1" style={{ flex: 3 }}>
                <Text size="1" weight="medium">
                  Host / Dirección IP
                </Text>
                <TextField.Root
                  placeholder="ej. 192.168.1.100 o api.midominio.com"
                  value={host}
                  onChange={(e) => setHost(e.target.value)}
                  required
                />
              </Flex>

              <Flex direction="column" gap="1" style={{ flex: 1 }}>
                <Text size="1" weight="medium">
                  Puerto
                </Text>
                <TextField.Root
                  placeholder="22"
                  value={port}
                  onChange={(e) => setPort(e.target.value)}
                  required
                >
                  <TextField.Slot>
                    <Hash size={14} />
                  </TextField.Slot>
                </TextField.Root>
              </Flex>
            </Flex>

            <Flex gap="3">
              <Flex direction="column" gap="1" style={{ flex: 2 }}>
                <Text size="1" weight="medium">
                  Usuario SSH
                </Text>
                <TextField.Root
                  placeholder="root / ubuntu / admin"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  required
                >
                  <TextField.Slot>
                    <User size={14} />
                  </TextField.Slot>
                </TextField.Root>
              </Flex>

              <Flex direction="column" gap="1" style={{ flex: 2 }}>
                <Text size="1" weight="medium">
                  Grupo / Entorno
                </Text>
                <TextField.Root
                  placeholder="Producción, Staging, etc."
                  value={group}
                  onChange={(e) => setGroup(e.target.value)}
                />
              </Flex>
            </Flex>

            <Flex direction="column" gap="1" mt="1">
              <Text size="1" weight="medium">
                Método de Autenticación
              </Text>
              <SegmentedControl.Root
                value={authType}
                onValueChange={(v) => setAuthType(v as any)}
                size="2"
              >
                <SegmentedControl.Item value="password">
                  <Flex align="center" gap="1">
                    <Lock size={14} /> Contraseña
                  </Flex>
                </SegmentedControl.Item>
                <SegmentedControl.Item value="key">
                  <Flex align="center" gap="1">
                    <Key size={14} /> Clave SSH
                  </Flex>
                </SegmentedControl.Item>
              </SegmentedControl.Root>
            </Flex>

            {authType === 'password' ? (
              <Flex direction="column" gap="1">
                <Text size="1" weight="medium">
                  Contraseña SSH
                </Text>
                <TextField.Root
                  type="password"
                  placeholder="••••••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </Flex>
            ) : (
              <Flex direction="column" gap="1">
                <Text size="1" weight="medium">
                  Llave SSH Asociada
                </Text>
                {keys.length === 0 ? (
                  <Text size="2" color="ruby">
                    No tienes claves registradas en la bóveda. Agrega una primero en la pestaña "Claves SSH".
                  </Text>
                ) : (
                  <Select.Root value={keyId} onValueChange={setKeyId}>
                    <Select.Trigger placeholder="Seleccionar llave SSH..." />
                    <Select.Content>
                      {keys.map((k) => (
                        <Select.Item key={k.id} value={k.id}>
                          {k.name}
                        </Select.Item>
                      ))}
                    </Select.Content>
                  </Select.Root>
                )}
              </Flex>
            )}

            <Flex gap="3" mt="4" justify="end">
              <Dialog.Close>
                <Button variant="soft" color="gray">
                  Cancelar
                </Button>
              </Dialog.Close>
              <Button type="submit" variant="solid">
                Guardar Servidor
              </Button>
            </Flex>
          </Flex>
        </form>
      </Dialog.Content>
    </Dialog.Root>
  );
};

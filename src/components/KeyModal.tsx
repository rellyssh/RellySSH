import React, { useState } from 'react';
import {
  Dialog,
  Button,
  Flex,
  Text,
  TextField,
  TextArea
} from '@radix-ui/themes';
import { KeyRound, FolderOpen } from 'lucide-react';
import type { SSHKey } from '../types';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (key: SSHKey) => void;
}

export const KeyModal: React.FC<Props> = ({ open, onOpenChange, onSave }) => {
  const [name, setName] = useState('');
  const [privateKey, setPrivateKey] = useState('');
  const [publicKey, setPublicKey] = useState('');
  const [passphrase, setPassphrase] = useState('');

  const handleImportFile = async () => {
    const res = await window.electronAPI.readKeyFile();
    if (res) {
      if (!name) setName(res.name);
      setPrivateKey(res.content);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || !privateKey) return;

    const newKey: SSHKey = {
      id: crypto.randomUUID(),
      name,
      privateKey: privateKey.trim(),
      publicKey: publicKey.trim() || undefined,
      passphrase: passphrase.trim() || undefined,
      createdAt: new Date().toISOString()
    };

    onSave(newKey);
    onOpenChange(false);
    setName('');
    setPrivateKey('');
    setPublicKey('');
    setPassphrase('');
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Content style={{ maxWidth: 520 }}>
        <Dialog.Title>
          <Flex align="center" gap="2">
            <KeyRound size={20} color="var(--iris-9)" />
            Nueva Clave SSH
          </Flex>
        </Dialog.Title>
        <Dialog.Description size="2" mb="3" color="gray">
          Almacena llaves RSA o Ed25519 con cifrado dentro de tu bóveda para versionar en git.
        </Dialog.Description>

        <form onSubmit={handleSubmit}>
          <Flex direction="column" gap="3">
            <Flex direction="column" gap="1">
              <Text size="1" weight="medium">
                Nombre de la Clave
              </Text>
              <TextField.Root
                placeholder="ej. id_rsa_github o clave-servidor-aws"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </Flex>

            <Flex direction="column" gap="1">
              <Flex justify="between" align="center">
                <Text size="1" weight="medium">
                  Llave Privada (PEM / OpenSSH)
                </Text>
                <Button type="button" size="1" variant="ghost" onClick={handleImportFile}>
                  <FolderOpen size={14} style={{ marginRight: 4 }} /> Importar desde Archivo
                </Button>
              </Flex>
              <TextArea
                rows={6}
                placeholder="-----BEGIN OPENSSH PRIVATE KEY-----&#10;...&#10;-----END OPENSSH PRIVATE KEY-----"
                value={privateKey}
                onChange={(e) => setPrivateKey(e.target.value)}
                style={{ fontFamily: 'monospace', fontSize: 12 }}
                required
              />
            </Flex>

            <Flex direction="column" gap="1">
              <Text size="1" weight="medium">
                Llave Pública (Opcional)
              </Text>
              <TextArea
                rows={2}
                placeholder="ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAA... usuario@equipo"
                value={publicKey}
                onChange={(e) => setPublicKey(e.target.value)}
                style={{ fontFamily: 'monospace', fontSize: 12 }}
              />
            </Flex>

            <Flex direction="column" gap="1">
              <Text size="1" weight="medium">
                Passphrase de la Llave (Si la clave privada está protegida)
              </Text>
              <TextField.Root
                type="password"
                placeholder="••••••••••••"
                value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)}
              />
            </Flex>

            <Flex gap="3" mt="3" justify="end">
              <Dialog.Close>
                <Button variant="soft" color="gray">
                  Cancelar
                </Button>
              </Dialog.Close>
              <Button type="submit" variant="solid">
                Guardar Clave en Bóveda
              </Button>
            </Flex>
          </Flex>
        </form>
      </Dialog.Content>
    </Dialog.Root>
  );
};

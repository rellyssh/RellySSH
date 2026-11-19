import React, { useState, useRef, useEffect } from 'react';
import { Flex, Box, Text, Button, IconButton, Badge, TextField, Tooltip, Separator } from '@radix-ui/themes';
import { Radio, Send, CheckSquare, Square, X, Zap, Terminal, Server, AlertTriangle, LayoutGrid, Columns } from 'lucide-react';
import type { SSHServer } from '../types';

export interface OpenSession {
  sessionId: string;
  name: string;
  isLocal?: boolean;
  server?: SSHServer;
}

export interface BroadcastBarProps {
  sessions: OpenSession[];
  activeSessionId: string | null;
  selectedSessionIds: string[];
  isLiveBroadcast: boolean;
  layoutMode: 'single' | 'grid';
  gridFilterMode?: 'all' | 'broadcastOnly';
  onToggleSession: (sessionId: string) => void;
  onSelectAll: () => void;
  onDeselectAll: () => void;
  onToggleLiveBroadcast: () => void;
  onToggleLayoutMode: () => void;
  onToggleGridFilterMode?: () => void;
  onSendCommand: (command: string) => void;
  onClose: () => void;
}

const DEFAULT_SNIPPETS = [
  { label: 'uptime', cmd: 'uptime' },
  { label: 'free -h', cmd: 'free -h' },
  { label: 'df -h', cmd: 'df -h' },
  { label: 'docker ps', cmd: 'docker ps' },
  { label: 'uname -a', cmd: 'uname -a' },
  { label: 'limpiar', cmd: 'clear' }
];

export const BroadcastBar: React.FC<BroadcastBarProps> = ({
  sessions,
  activeSessionId,
  selectedSessionIds,
  isLiveBroadcast,
  layoutMode,
  gridFilterMode = 'all',
  onToggleSession,
  onSelectAll,
  onDeselectAll,
  onToggleLiveBroadcast,
  onToggleLayoutMode,
  onToggleGridFilterMode,
  onSendCommand,
  onClose
}) => {
  const [commandInput, setCommandInput] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const allSelected = sessions.length > 0 && selectedSessionIds.length === sessions.length;
  const targetCount = selectedSessionIds.length;

  useEffect(() => {
    // Focus input on mount
    setTimeout(() => inputRef.current?.focus(), 50);
  }, []);

  const handleSend = () => {
    const cmd = commandInput.trim();
    if (!cmd) return;
    onSendCommand(cmd);
    setCommandInput('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <Box
      style={{
        background: isLiveBroadcast ? 'rgba(40, 20, 10, 0.95)' : 'var(--gray-3)',
        borderBottom: isLiveBroadcast ? '2px solid var(--amber-9)' : '1px solid var(--gray-5)',
        padding: '10px 16px',
        transition: 'all 0.2s ease'
      }}
    >
      <Flex direction="column" gap="2">
        {/* Fila 1: Encabezado, Selección de Terminales, Toggle Mosaico y Toggle de Transmisión en Vivo */}
        <Flex align="center" justify="between" wrap="wrap" gap="2">
          <Flex align="center" gap="2">
            <Radio
              size={16}
              color={isLiveBroadcast ? 'var(--amber-9)' : 'var(--iris-9)'}
              style={{
                animation: isLiveBroadcast ? 'pulse 1.5s infinite' : 'none'
              }}
            />
            <Text size="2" weight="bold">
              Emisión Masiva de Comandos (Broadcast)
            </Text>
            <Badge size="1" color={targetCount > 0 ? 'iris' : 'gray'} variant="soft">
              {targetCount} de {sessions.length} seleccionadas
            </Badge>
          </Flex>

          <Flex align="center" gap="2">
            {/* Toggle Vista en Mosaico (Split Screen / Termius Style) */}
            <Tooltip content={layoutMode === 'grid' ? 'Cambiar a pestaña individual' : 'Ver todas las terminales en la misma pantalla (Split Grid estilo Termius)'}>
              <Button
                size="1"
                variant={layoutMode === 'grid' ? 'solid' : 'surface'}
                color="iris"
                onClick={onToggleLayoutMode}
                style={{ cursor: 'pointer', gap: 6 }}
              >
                {layoutMode === 'grid' ? (
                  <>
                    <LayoutGrid size={13} />
                    <span>Mosaico Activo</span>
                  </>
                ) : (
                  <>
                    <Columns size={13} />
                    <span>Dividir Pantalla</span>
                  </>
                )}
              </Button>
            </Tooltip>

            {layoutMode === 'grid' && onToggleGridFilterMode && sessions.length > selectedSessionIds.length && (
              <Button
                size="1"
                variant="ghost"
                color="gray"
                onClick={onToggleGridFilterMode}
                style={{ cursor: 'pointer', fontSize: 11 }}
                title="Alternar entre ver todas las terminales o únicamente las que reciben broadcast"
              >
                {gridFilterMode === 'broadcastOnly' ? '👁️ Ver todas' : '🎯 Solo broadcast'}
              </Button>
            )}

            <Tooltip content="Replicar todo lo que tipees en la terminal activa a todas las seleccionadas">
              <Button
                size="1"
                variant={isLiveBroadcast ? 'solid' : 'surface'}
                color={isLiveBroadcast ? 'amber' : 'gray'}
                onClick={onToggleLiveBroadcast}
                style={{ cursor: 'pointer', gap: 6 }}
              >
                {isLiveBroadcast ? (
                  <>
                    <AlertTriangle size={13} />
                    <span>Teclado en Vivo: ACTIVO</span>
                  </>
                ) : (
                  <>
                    <Zap size={13} />
                    <span>Activar Teclado en Vivo</span>
                  </>
                )}
              </Button>
            </Tooltip>

            <IconButton size="1" variant="ghost" color="gray" onClick={onClose} title="Cerrar barra (Ctrl+B)">
              <X size={14} />
            </IconButton>
          </Flex>
        </Flex>

        {/* Fila 2: Selector de terminales destino */}
        <Flex align="center" gap="2" wrap="wrap">
          <Text size="1" color="gray" weight="bold">
            DESTINO:
          </Text>
          <Button
            size="1"
            variant="ghost"
            color={allSelected ? 'iris' : 'gray'}
            onClick={allSelected ? onDeselectAll : onSelectAll}
            style={{ fontSize: '0.75rem', height: 22, padding: '0 6px', cursor: 'pointer' }}
          >
            {allSelected ? (
              <CheckSquare size={13} style={{ marginRight: 4 }} />
            ) : (
              <Square size={13} style={{ marginRight: 4 }} />
            )}
            {allSelected ? 'Deseleccionar todas' : 'Todas'}
          </Button>

          <Separator orientation="vertical" style={{ height: 16 }} />

          {sessions.map((s) => {
            const isSelected = selectedSessionIds.includes(s.sessionId);
            const isCurrent = activeSessionId === s.sessionId;
            return (
              <Button
                key={s.sessionId}
                size="1"
                variant={isSelected ? 'solid' : 'soft'}
                color={isSelected ? (isCurrent ? 'iris' : 'blue') : 'gray'}
                onClick={() => onToggleSession(s.sessionId)}
                style={{
                  fontSize: '0.78rem',
                  height: 24,
                  cursor: 'pointer',
                  borderRadius: 6,
                  padding: '0 8px',
                  border: isCurrent ? '1px solid var(--iris-8)' : 'none'
                }}
              >
                {s.isLocal ? (
                  <Terminal size={12} style={{ marginRight: 4 }} />
                ) : (
                  <Server size={12} style={{ marginRight: 4 }} />
                )}
                {s.name}
                {isCurrent && <span style={{ opacity: 0.6, fontSize: '0.68rem', marginLeft: 4 }}>(activa)</span>}
              </Button>
            );
          })}
        </Flex>

        {/* Fila 3: Input de Comando Masivo y Botón Enviar */}
        <Flex gap="2" align="center">
          <Box style={{ flex: 1 }}>
            <TextField.Root
              ref={inputRef}
              size="2"
              placeholder={`Escribí un comando para ejecutar en ${targetCount} terminal${targetCount === 1 ? '' : 'es'} seleccionada${targetCount === 1 ? '' : 's'} (Enter para enviar)...`}
              value={commandInput}
              onChange={(e) => setCommandInput(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={targetCount === 0}
            >
              <TextField.Slot>
                <Terminal size={14} color="var(--gray-9)" />
              </TextField.Slot>
              {commandInput && (
                <TextField.Slot>
                  <IconButton size="1" variant="ghost" color="gray" onClick={() => setCommandInput('')}>
                    <X size={12} />
                  </IconButton>
                </TextField.Slot>
              )}
            </TextField.Root>
          </Box>

          <Button
            size="2"
            variant="solid"
            color={targetCount > 0 ? 'iris' : 'gray'}
            disabled={targetCount === 0 || !commandInput.trim()}
            onClick={handleSend}
            style={{ cursor: targetCount > 0 && commandInput.trim() ? 'pointer' : 'default' }}
          >
            <Send size={14} style={{ marginRight: 4 }} />
            Enviar a {targetCount}
          </Button>
        </Flex>

        {/* Fila 4: Snippets de Comandos Rápidos */}
        <Flex align="center" gap="2" wrap="wrap">
          <Text size="1" color="gray">
            Snippets rápidos:
          </Text>
          {DEFAULT_SNIPPETS.map((snip) => (
            <Button
              key={snip.cmd}
              size="1"
              variant="surface"
              color="gray"
              disabled={targetCount === 0}
              onClick={() => onSendCommand(snip.cmd)}
              style={{
                fontFamily: 'var(--font-mono, monospace)',
                fontSize: '0.75rem',
                height: 22,
                cursor: targetCount > 0 ? 'pointer' : 'default'
              }}
              title={`Ejecutar "${snip.cmd}" en ${targetCount} terminales`}
            >
              <Zap size={11} style={{ marginRight: 3, color: 'var(--amber-9)' }} />
              {snip.label}
            </Button>
          ))}
        </Flex>

        {isLiveBroadcast && (
          <Box
            style={{
              background: 'rgba(245, 158, 11, 0.12)',
              border: '1px solid rgba(245, 158, 11, 0.35)',
              borderRadius: 6,
              padding: '6px 12px'
            }}
          >
            <Text size="1" color="amber" weight="medium">
              ⚠️ <strong>Modo Teclado en Vivo Activado:</strong> Cada pulsación de tecla y carácter ingresado en la terminal activa se reflejará instantáneamente en todas las terminales marcadas.
            </Text>
          </Box>
        )}
      </Flex>
    </Box>
  );
};

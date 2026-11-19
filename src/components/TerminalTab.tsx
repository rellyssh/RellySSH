import React, { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { ClipboardAddon } from '@xterm/addon-clipboard';
import { Box, Flex, Button, Badge, IconButton } from '@radix-ui/themes';
import { X, RefreshCw, Copy, ClipboardPaste, Maximize2, Radio } from 'lucide-react';
import type { SSHServer, SSHKey } from '../types';

interface Props {
  sessionId: string;
  server?: SSHServer;
  sshKey?: SSHKey;
  isLocal?: boolean;
  isActive?: boolean;
  isGridMode?: boolean;
  isBroadcastTarget?: boolean;
  isLiveBroadcast?: boolean;
  onToggleBroadcast?: () => void;
  onMaximize?: () => void;
  onFocus?: () => void;
  onClose: () => void;
  onUserInput?: (data: string) => void;
}

export const TerminalTab: React.FC<Props> = ({
  sessionId,
  server,
  sshKey,
  isLocal,
  isActive = true,
  isGridMode = false,
  isBroadcastTarget = false,
  isLiveBroadcast = false,
  onToggleBroadcast,
  onMaximize,
  onFocus,
  onClose,
  onUserInput
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalInstanceRef = useRef<{ term: Terminal; fit: FitAddon } | null>(null);
  const onUserInputRef = useRef(onUserInput);
  onUserInputRef.current = onUserInput;

  useEffect(() => {
    if (terminalInstanceRef.current) {
      setTimeout(() => {
        try {
          terminalInstanceRef.current?.fit.fit();
          if (isActive) {
            terminalInstanceRef.current?.term.focus();
          }
        } catch (_) {}
      }, 50);
    }
  }, [isActive, isGridMode]);

  useEffect(() => {
    if (!containerRef.current) return;

    const term = new Terminal({
      cursorBlink: true,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      fontSize: 13,
      rightClickSelectsWord: true,
      theme: {
        background: '#0d1117',
        foreground: '#c9d1d9',
        cursor: '#58a6ff',
        selectionBackground: '#1f6feb',
        black: '#484f58',
        red: '#ff7b72',
        green: '#3fb950',
        yellow: '#d29922',
        blue: '#58a6ff',
        magenta: '#bc8cff',
        cyan: '#39c5cf',
        white: '#b1bac4',
        brightBlack: '#6e7681',
        brightRed: '#ffa198',
        brightGreen: '#56d364',
        brightYellow: '#e3b341',
        brightBlue: '#79c0ff',
        brightMagenta: '#d2a8ff',
        brightCyan: '#56d4dd',
        brightWhite: '#f0f6fc'
      }
    });

    const fitAddon = new FitAddon();
    const clipboardAddon = new ClipboardAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(clipboardAddon);
    term.open(containerRef.current);
    fitAddon.fit();

    terminalInstanceRef.current = { term, fit: fitAddon };

    // Atajos de teclado para Copiar y Pegar:
    // Ctrl+C con texto seleccionado -> Copiar al portapapeles
    // Ctrl+Shift+C -> Copiar al portapapeles
    // Ctrl+Shift+V -> Pegar desde el portapapeles
    term.attachCustomKeyEventHandler((event: KeyboardEvent) => {
      // Ctrl+Shift+C or Ctrl+C when selection exists
      if (event.type === 'keydown') {
        const isCtrl = event.ctrlKey || event.metaKey;

        if (isCtrl && event.key.toLowerCase() === 'c' && term.hasSelection()) {
          const selection = term.getSelection();
          navigator.clipboard.writeText(selection);
          return false; // don't send SIGINT to terminal if user was copying
        }

        if (isCtrl && event.shiftKey && event.key.toLowerCase() === 'c') {
          const selection = term.getSelection();
          navigator.clipboard.writeText(selection);
          return false;
        }

        if (isCtrl && event.shiftKey && event.key.toLowerCase() === 'v') {
          navigator.clipboard.readText().then((clipText) => {
            if (isLocal) {
              window.electronAPI.sendLocalData(sessionId, clipText);
            } else {
              window.electronAPI.sendSSHData(sessionId, clipText);
            }
            onUserInputRef.current?.(clipText);
          });
          return false;
        }
      }
      return true;
    });

    // Copiar automáticamente al seleccionar con el mouse (opción muy cómoda)
    term.onSelectionChange(() => {
      const selection = term.getSelection();
      if (selection) {
        navigator.clipboard.writeText(selection).catch(() => {});
      }
    });

    let unsubscribeData: () => void = () => {};
    let unsubscribeClose: () => void = () => {};
    let unsubscribeError: () => void = () => {};

    if (isLocal) {
      term.writeln(`\x1b[32m💻 Sesión de Terminal Local iniciada\x1b[0m\r\n`);
      window.electronAPI.spawnLocalTerminal(sessionId, term.cols, term.rows);

      unsubscribeData = window.electronAPI.onLocalData(sessionId, (data) => {
        term.write(data);
      });

      unsubscribeClose = window.electronAPI.onLocalClose(sessionId, () => {
        term.writeln(`\r\n\x1b[33m⚡ Proceso local terminado.\x1b[0m\r\n`);
      });

      term.onData((data) => {
        window.electronAPI.sendLocalData(sessionId, data);
        onUserInputRef.current?.(data);
      });
    } else if (server) {
      term.writeln(`\x1b[36m⚡ Conectando a ${server.username}@${server.host}:${server.port}...\x1b[0m\r\n`);

      window.electronAPI
        .connectSSH(sessionId, server, sshKey, term.cols, term.rows)
        .then((res) => {
          if (!res.success) {
            term.writeln(`\r\n\x1b[31m✖ Error de conexión: ${res.error}\x1b[0m\r\n`);
          }
        });

      unsubscribeData = window.electronAPI.onSSHData(sessionId, (data) => {
        term.write(data);
      });

      unsubscribeError = window.electronAPI.onSSHError(sessionId, (err) => {
        term.writeln(`\r\n\x1b[31m[SSH Error]: ${err}\x1b[0m\r\n`);
      });

      unsubscribeClose = window.electronAPI.onSSHClose(sessionId, () => {
        term.writeln(`\r\n\x1b[33m⚡ Sesión SSH cerrada.\x1b[0m\r\n`);
      });

      term.onData((data) => {
        window.electronAPI.sendSSHData(sessionId, data);
        onUserInputRef.current?.(data);
      });
    }

    const resizeObserver = new ResizeObserver(() => {
      try {
        fitAddon.fit();
        if (isLocal) {
          window.electronAPI.resizeLocal(sessionId, term.cols, term.rows);
        } else {
          window.electronAPI.resizeSSH(sessionId, term.cols, term.rows);
        }
      } catch (_) {}
    });
    resizeObserver.observe(containerRef.current);

    return () => {
      unsubscribeData();
      unsubscribeError();
      unsubscribeClose();
      resizeObserver.disconnect();
      if (isLocal) {
        window.electronAPI.killLocal(sessionId);
      } else {
        window.electronAPI.disconnectSSH(sessionId);
      }
      term.dispose();
    };
  }, [sessionId, server, sshKey, isLocal]);

  const handleCopySelection = () => {
    const term = terminalInstanceRef.current?.term;
    if (term && term.hasSelection()) {
      navigator.clipboard.writeText(term.getSelection());
    }
  };

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        if (isLocal) {
          window.electronAPI.sendLocalData(sessionId, text);
        } else {
          window.electronAPI.sendSSHData(sessionId, text);
        }
        onUserInputRef.current?.(text);
      }
    } catch (_) {}
  };

  return (
    <Flex
      direction="column"
      style={{
        width: '100%',
        height: '100%',
        background: '#0d1117',
        borderRadius: isGridMode ? 8 : 0,
        overflow: 'hidden',
        border: isGridMode
          ? isActive
            ? isLiveBroadcast
              ? '2px solid var(--amber-9)'
              : '2px solid var(--iris-9)'
            : isBroadcastTarget
            ? '1px solid var(--iris-6)'
            : '1px solid var(--gray-4)'
          : 'none',
        boxShadow: isGridMode && isActive
          ? isLiveBroadcast
            ? '0 0 14px rgba(245, 158, 11, 0.35)'
            : '0 0 14px rgba(94, 106, 210, 0.35)'
          : 'none',
        transition: 'border 0.15s ease, box-shadow 0.15s ease'
      }}
      onClick={() => {
        onFocus?.();
        terminalInstanceRef.current?.term.focus();
      }}
    >
      {/* Session header bar */}
      <Flex
        align="center"
        justify="between"
        px="3"
        py={isGridMode ? '1' : '2'}
        style={{
          background: isActive
            ? isLiveBroadcast
              ? 'rgba(245, 158, 11, 0.15)'
              : 'rgba(94, 106, 210, 0.15)'
            : 'rgba(255,255,255,0.03)',
          borderBottom: isActive
            ? isLiveBroadcast
              ? '1px solid var(--amber-8)'
              : '1px solid var(--iris-8)'
            : '1px solid var(--gray-4)',
          userSelect: 'none',
          minHeight: 34
        }}
        onClick={(e) => {
          e.stopPropagation();
          onFocus?.();
          terminalInstanceRef.current?.term.focus();
        }}
      >
        <Flex align="center" gap="2" style={{ minWidth: 0, overflow: 'hidden' }}>
          <Badge color={isLocal ? 'blue' : 'green'} variant="surface" size="1">
            {isLocal ? 'Local' : 'Conectado'}
          </Badge>
          <span style={{ fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }}>
            {isLocal ? 'Terminal Local' : server?.name}
          </span>
          {!isLocal && server && (
            <span style={{ fontSize: 11, color: 'var(--gray-9)', whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }}>
              ({server.username}@{server.host}:{server.port})
            </span>
          )}

          {/* Broadcast status toggle pill */}
          {onToggleBroadcast && (
            <Badge
              size="1"
              color={isBroadcastTarget ? (isLiveBroadcast ? 'amber' : 'iris') : 'gray'}
              variant={isBroadcastTarget ? 'solid' : 'surface'}
              style={{
                cursor: 'pointer',
                fontSize: 10,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                marginLeft: 4,
                opacity: isBroadcastTarget ? 1 : 0.65
              }}
              onClick={(e) => {
                e.stopPropagation();
                onToggleBroadcast();
              }}
              title={isBroadcastTarget ? 'En emisión masiva (clic para excluir)' : 'Excluido de emisión (clic para incluir)'}
            >
              <Radio size={10} />
              {isBroadcastTarget ? 'Broadcast' : '+ Broadcast'}
            </Badge>
          )}
        </Flex>

        <Flex align="center" gap="1" style={{ flexShrink: 0 }}>
          {isGridMode && onMaximize && (
            <IconButton
              size="1"
              variant="ghost"
              color="gray"
              onClick={(e) => {
                e.stopPropagation();
                onMaximize();
              }}
              title="Maximizar a pestaña individual"
            >
              <Maximize2 size={13} />
            </IconButton>
          )}
          <IconButton
            size="1"
            variant="ghost"
            color="gray"
            onClick={(e) => {
              e.stopPropagation();
              handleCopySelection();
            }}
            title="Copiar selección (Ctrl+C)"
          >
            <Copy size={13} />
          </IconButton>
          <IconButton
            size="1"
            variant="ghost"
            color="gray"
            onClick={(e) => {
              e.stopPropagation();
              handlePaste();
            }}
            title="Pegar (Ctrl+Shift+V)"
          >
            <ClipboardPaste size={13} />
          </IconButton>
          <IconButton
            size="1"
            variant="ghost"
            color="gray"
            onClick={(e) => {
              e.stopPropagation();
              terminalInstanceRef.current?.fit.fit();
            }}
            title="Ajustar tamaño"
          >
            <RefreshCw size={13} />
          </IconButton>
          <IconButton
            size="1"
            variant="ghost"
            color="ruby"
            onClick={(e) => {
              e.stopPropagation();
              onClose();
            }}
            title="Cerrar terminal"
          >
            <X size={14} />
          </IconButton>
        </Flex>
      </Flex>

      {/* Terminal Viewport */}
      <Box
        ref={containerRef}
        style={{ flex: 1, padding: 6, overflow: 'hidden' }}
        onContextMenu={handlePaste} // Click derecho para pegar directamente
      />
    </Flex>
  );
};

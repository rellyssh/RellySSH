import React, { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { ClipboardAddon } from '@xterm/addon-clipboard';
import { Box, Flex, Button, Badge } from '@radix-ui/themes';
import { X, RefreshCw, Copy, ClipboardPaste } from 'lucide-react';
import type { SSHServer, SSHKey } from '../types';

interface Props {
  sessionId: string;
  server?: SSHServer;
  sshKey?: SSHKey;
  isLocal?: boolean;
  isActive?: boolean;
  onClose: () => void;
}

export const TerminalTab: React.FC<Props> = ({ sessionId, server, sshKey, isLocal, isActive = true, onClose }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalInstanceRef = useRef<{ term: Terminal; fit: FitAddon } | null>(null);

  useEffect(() => {
    if (isActive && terminalInstanceRef.current) {
      setTimeout(() => {
        try {
          terminalInstanceRef.current?.fit.fit();
          terminalInstanceRef.current?.term.focus();
        } catch (_) {}
      }, 50);
    }
  }, [isActive]);

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
      }
    } catch (_) {}
  };

  return (
    <Flex direction="column" style={{ width: '100%', height: '100%', background: '#0d1117' }}>
      {/* Session header bar */}
      <Flex
        align="center"
        justify="between"
        px="3"
        py="2"
        style={{
          background: 'rgba(255,255,255,0.02)',
          borderBottom: '1px solid var(--gray-4)'
        }}
      >
        <Flex align="center" gap="2">
          <Badge color={isLocal ? 'blue' : 'green'} variant="surface">
            {isLocal ? 'Local' : 'Conectado'}
          </Badge>
          <span style={{ fontSize: 13, fontWeight: 600 }}>
            {isLocal ? 'Terminal Local' : server?.name}
          </span>
          {!isLocal && server && (
            <span style={{ fontSize: 12, color: 'var(--gray-9)' }}>
              ({server.username}@{server.host}:{server.port})
            </span>
          )}
        </Flex>

        <Flex align="center" gap="1">
          <Button size="1" variant="ghost" color="gray" onClick={handleCopySelection} title="Copiar selección (Ctrl+C)">
            <Copy size={13} style={{ marginRight: 4 }} /> Copiar
          </Button>
          <Button size="1" variant="ghost" color="gray" onClick={handlePaste} title="Pegar (Ctrl+Shift+V)">
            <ClipboardPaste size={13} style={{ marginRight: 4 }} /> Pegar
          </Button>
          <Button
            size="1"
            variant="ghost"
            color="gray"
            onClick={() => {
              terminalInstanceRef.current?.fit.fit();
            }}
            title="Ajustar tamaño"
          >
            <RefreshCw size={13} />
          </Button>
          <Button size="1" variant="ghost" color="ruby" onClick={onClose}>
            <X size={14} /> Salir
          </Button>
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

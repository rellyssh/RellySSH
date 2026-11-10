import * as pty from 'node-pty';
import os from 'node:os';
import { BrowserWindow } from 'electron';

interface LocalSession {
  ptyProcess: pty.IPty;
}

const localSessions = new Map<string, LocalSession>();

export function setupLocalTerminalHandlers(win: BrowserWindow) {
  return {
    spawn(sessionId: string, cols = 80, rows = 24, cwd?: string) {
      try {
        const shell = process.env.SHELL || (os.platform() === 'win32' ? 'powershell.exe' : 'bash');
        const workingDir = cwd || os.homedir();

        const ptyProcess = pty.spawn(shell, [], {
          name: 'xterm-256color',
          cols,
          rows,
          cwd: workingDir,
          env: process.env as Record<string, string>
        });

        localSessions.set(sessionId, { ptyProcess });

        ptyProcess.onData((data: string) => {
          if (!win.isDestroyed()) {
            win.webContents.send(`local:data:${sessionId}`, data);
          }
        });

        ptyProcess.onExit(() => {
          if (!win.isDestroyed()) {
            win.webContents.send(`local:close:${sessionId}`);
          }
          localSessions.delete(sessionId);
        });

        return { success: true };
      } catch (err: any) {
        return { success: false, error: err.message };
      }
    },

    sendData(sessionId: string, data: string) {
      const session = localSessions.get(sessionId);
      if (session) {
        session.ptyProcess.write(data);
      }
    },

    resize(sessionId: string, cols: number, rows: number) {
      const session = localSessions.get(sessionId);
      if (session) {
        try {
          session.ptyProcess.resize(cols, rows);
        } catch (_) {}
      }
    },

    kill(sessionId: string) {
      const session = localSessions.get(sessionId);
      if (session) {
        try {
          session.ptyProcess.kill();
        } catch (_) {}
        localSessions.delete(sessionId);
      }
    }
  };
}

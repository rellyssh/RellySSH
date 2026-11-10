import { Client, type ClientChannel } from 'ssh2';
import { BrowserWindow } from 'electron';
import type { SSHServer, SSHKey } from '../src/types';

interface ActiveSession {
  client: Client;
  stream?: ClientChannel;
}

const sessions = new Map<string, ActiveSession>();

export function setupSSHHandlers(win: BrowserWindow) {
  return {
    async connect(
      sessionId: string,
      server: SSHServer,
      key?: SSHKey,
      termCols = 80,
      termRows = 24
    ): Promise<{ success: boolean; error?: string }> {
      return new Promise((resolve) => {
        try {
          const conn = new Client();
          sessions.set(sessionId, { client: conn });

          conn.on('ready', () => {
            conn.shell({ term: 'xterm-256color', cols: termCols, rows: termRows }, (err, stream) => {
              if (err) {
                conn.end();
                sessions.delete(sessionId);
                return resolve({ success: false, error: err.message });
              }

              const session = sessions.get(sessionId);
              if (session) {
                session.stream = stream;
              }

              stream.on('data', (data: Buffer) => {
                if (!win.isDestroyed()) {
                  win.webContents.send(`ssh:data:${sessionId}`, data.toString('utf-8'));
                }
              });

              stream.stderr.on('data', (data: Buffer) => {
                if (!win.isDestroyed()) {
                  win.webContents.send(`ssh:data:${sessionId}`, data.toString('utf-8'));
                }
              });

              stream.on('close', () => {
                if (!win.isDestroyed()) {
                  win.webContents.send(`ssh:close:${sessionId}`);
                }
                conn.end();
                sessions.delete(sessionId);
              });

              resolve({ success: true });
            });
          });

          conn.on('error', (err) => {
            if (!win.isDestroyed()) {
              win.webContents.send(`ssh:error:${sessionId}`, err.message);
            }
            sessions.delete(sessionId);
            resolve({ success: false, error: err.message });
          });

          const config: Record<string, any> = {
            host: server.host,
            port: server.port || 22,
            username: server.username,
            readyTimeout: 20000,
            keepaliveInterval: 10000
          };

          if (server.authType === 'password') {
            config.password = server.password;
          } else if (server.authType === 'key' && key) {
            config.privateKey = key.privateKey;
            if (key.passphrase) {
              config.passphrase = key.passphrase;
            }
          }

          conn.connect(config);
        } catch (err: any) {
          resolve({ success: false, error: err.message || 'Unknown SSH error' });
        }
      });
    },

    sendData(sessionId: string, data: string) {
      const session = sessions.get(sessionId);
      if (session && session.stream) {
        session.stream.write(data);
      }
    },

    resize(sessionId: string, cols: number, rows: number) {
      const session = sessions.get(sessionId);
      if (session && session.stream) {
        session.stream.setWindow(rows, cols, 0, 0);
      }
    },

    disconnect(sessionId: string) {
      const session = sessions.get(sessionId);
      if (session) {
        try {
          if (session.stream) session.stream.end();
          session.client.end();
        } catch (_) {}
        sessions.delete(sessionId);
      }
    }
  };
}

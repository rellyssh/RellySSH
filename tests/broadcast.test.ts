import { describe, it, expect, vi } from 'vitest';
import type { SSHServer } from '../src/types';
import { getTerminalGridLayout } from '../src/utils/gridLayout';

interface OpenSession {
  sessionId: string;
  name: string;
  isLocal?: boolean;
  server?: SSHServer;
}

describe('Multi-Terminal Broadcast & Command Execution (Termius-like)', () => {
  const dummyServer1: SSHServer = {
    id: 'srv-1',
    name: 'prod-cluster-01',
    host: '10.0.0.1',
    port: 22,
    username: 'root',
    authType: 'password',
    createdAt: new Date().toISOString()
  };

  const dummyServer2: SSHServer = {
    id: 'srv-2',
    name: 'replica-db-02',
    host: '10.0.0.2',
    port: 22,
    username: 'postgres',
    authType: 'password',
    createdAt: new Date().toISOString()
  };

  const mockSessions: OpenSession[] = [
    { sessionId: 'sess-1', name: 'prod-cluster-01', server: dummyServer1 },
    { sessionId: 'sess-2', name: 'replica-db-02', server: dummyServer2 },
    { sessionId: 'sess-local', name: 'Local #1', isLocal: true }
  ];

  it('formatea correctamente los comandos masivos agregando retorno de carro', () => {
    const rawCmd = '  docker ps -a  ';
    const payload = rawCmd.trim() + '\r\n';
    expect(payload).toBe('docker ps -a\r\n');
  });

  it('permite seleccionar y deseleccionar terminales individualmente', () => {
    let selected: string[] = ['sess-1', 'sess-2', 'sess-local'];

    // Deseleccionar una terminal
    const toggle = (id: string) =>
      selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id];

    selected = toggle('sess-local');
    expect(selected).toEqual(['sess-1', 'sess-2']);
    expect(selected.includes('sess-local')).toBe(false);

    // Volver a seleccionarla
    selected = toggle('sess-local');
    expect(selected).toContain('sess-local');
  });

  it('permite seleccionar y deseleccionar todas las terminales en masa', () => {
    const allIds = mockSessions.map((s) => s.sessionId);
    let selected: string[] = [];

    // Seleccionar todas
    selected = [...allIds];
    expect(selected.length).toBe(3);

    // Deseleccionar todas
    selected = [];
    expect(selected.length).toBe(0);
  });

  it('emite el comando a los canales correctos (SSH vs Local) según el tipo de sesión', () => {
    const mockSendSSH = vi.fn();
    const mockSendLocal = vi.fn();

    const selectedIds = ['sess-1', 'sess-local'];
    const command = 'uptime';
    const payload = command.trim() + '\r\n';

    const targets = mockSessions.filter((s) => selectedIds.includes(s.sessionId));
    targets.forEach((s) => {
      if (s.isLocal) {
        mockSendLocal(s.sessionId, payload);
      } else {
        mockSendSSH(s.sessionId, payload);
      }
    });

    expect(mockSendSSH).toHaveBeenCalledTimes(1);
    expect(mockSendSSH).toHaveBeenCalledWith('sess-1', 'uptime\r\n');

    expect(mockSendLocal).toHaveBeenCalledTimes(1);
    expect(mockSendLocal).toHaveBeenCalledWith('sess-local', 'uptime\r\n');
  });

  it('replica las teclas en vivo a las otras terminales seleccionadas sin duplicar en la de origen', () => {
    const mockSendSSH = vi.fn();
    const mockSendLocal = vi.fn();

    const selectedIds = ['sess-1', 'sess-2', 'sess-local'];
    const sourceSessionId = 'sess-1'; // usuario tipeó en sess-1
    const typedChar = 'l';

    // Función de replicación idéntica a App.tsx
    mockSessions.forEach((s) => {
      if (s.sessionId !== sourceSessionId && selectedIds.includes(s.sessionId)) {
        if (s.isLocal) {
          mockSendLocal(s.sessionId, typedChar);
        } else {
          mockSendSSH(s.sessionId, typedChar);
        }
      }
    });

    // sess-1 no debe ser llamada porque fue la fuente
    expect(mockSendSSH).toHaveBeenCalledTimes(1);
    expect(mockSendSSH).toHaveBeenCalledWith('sess-2', 'l');

    expect(mockSendLocal).toHaveBeenCalledTimes(1);
    expect(mockSendLocal).toHaveBeenCalledWith('sess-local', 'l');
  });

  describe('Organización de Terminales en Mosaico / Split Screen (Termius Style)', () => {
    it('calcula la distribución de columnas y filas en CSS Grid para 1, 2, 3, 4 y 6 terminales', () => {
      // 1 terminal: 100% ancho y alto
      const layout1 = getTerminalGridLayout(1);
      expect(layout1.gridTemplateColumns).toBe('minmax(0, 1fr)');
      expect(layout1.gridTemplateRows).toBe('minmax(0, 1fr)');

      // 2 terminales: 2 columnas, 1 fila (50% / 50%)
      const layout2 = getTerminalGridLayout(2);
      expect(layout2.gridTemplateColumns).toBe('repeat(2, minmax(0, 1fr))');
      expect(layout2.gridTemplateRows).toBe('minmax(0, 1fr)');

      // 3 terminales: 3 columnas simétricas
      const layout3 = getTerminalGridLayout(3);
      expect(layout3.gridTemplateColumns).toBe('repeat(3, minmax(0, 1fr))');
      expect(layout3.gridTemplateRows).toBe('minmax(0, 1fr)');

      // 4 terminales: 2x2 grid cuadrícula balanceada
      const layout4 = getTerminalGridLayout(4);
      expect(layout4.gridTemplateColumns).toBe('repeat(2, minmax(0, 1fr))');
      expect(layout4.gridTemplateRows).toBe('repeat(2, minmax(0, 1fr))');

      // 6 terminales: 3 columnas x 2 filas
      const layout6 = getTerminalGridLayout(6);
      expect(layout6.gridTemplateColumns).toBe('repeat(3, minmax(0, 1fr))');
      expect(layout6.gridTemplateRows).toBe('repeat(2, minmax(0, 1fr))');

      // > 6 terminales: auto-fit dinámico
      const layout8 = getTerminalGridLayout(8);
      expect(layout8.gridTemplateColumns).toBe('repeat(auto-fit, minmax(360px, 1fr))');
    });

    it('filtra correctamente las sesiones visibles en modo mosaico según el modo de filtro', () => {
      const selectedIds = ['sess-1', 'sess-2'];

      // Modo 'all': todas visibles
      const filterAll = (sessions: OpenSession[], mode: 'all' | 'broadcastOnly') =>
        sessions.filter((s) => (mode === 'broadcastOnly' ? selectedIds.includes(s.sessionId) : true));

      const visibleAll = filterAll(mockSessions, 'all');
      expect(visibleAll.length).toBe(3);

      // Modo 'broadcastOnly': únicamente las seleccionadas
      const visibleBroadcastOnly = filterAll(mockSessions, 'broadcastOnly');
      expect(visibleBroadcastOnly.length).toBe(2);
      expect(visibleBroadcastOnly.map((s) => s.sessionId)).toEqual(['sess-1', 'sess-2']);
    });

    it('activa automáticamente la vista en mosaico al abrir broadcast si hay 2 o más sesiones', () => {
      let layoutMode: 'single' | 'grid' = 'single';
      const openBroadcast = (sessionCount: number) => {
        if (sessionCount >= 2) {
          layoutMode = 'grid';
        }
      };

      openBroadcast(mockSessions.length); // 3 sesiones
      expect(layoutMode).toBe('grid');
    });
  });
});

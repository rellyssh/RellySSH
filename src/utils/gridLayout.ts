import React from 'react';

/**
 * Calcula la distribución responsiva de columnas y filas en CSS Grid para organizar
 * múltiples terminales en una misma pantalla (estilo Split View / Mosaico de Termius).
 */
export function getTerminalGridLayout(count: number): React.CSSProperties {
  if (count <= 1) {
    return {
      gridTemplateColumns: 'minmax(0, 1fr)',
      gridTemplateRows: 'minmax(0, 1fr)'
    };
  }

  if (count === 2) {
    return {
      gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
      gridTemplateRows: 'minmax(0, 1fr)'
    };
  }

  if (count === 3) {
    return {
      gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
      gridTemplateRows: 'minmax(0, 1fr)'
    };
  }

  if (count === 4) {
    return {
      gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
      gridTemplateRows: 'repeat(2, minmax(0, 1fr))'
    };
  }

  if (count <= 6) {
    return {
      gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
      gridTemplateRows: 'repeat(2, minmax(0, 1fr))'
    };
  }

  return {
    gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))',
    gridAutoRows: 'minmax(280px, 1fr)'
  };
}

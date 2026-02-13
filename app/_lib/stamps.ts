/**
 * Pixel stamp patterns for the simulation.
 * Each stamp is a 2D boolean grid where `true` = place a cell.
 * Stamps are defined top-to-bottom, left-to-right.
 */

import type { DrawCommand } from './input';

// 15×17 pixel ghost — rounded head, two eyes, wavy bottom
// Designed to match a classic ghost silhouette at pixel scale.
const GHOST_BODY: readonly string[] = [
  '....*******....',
  '..***********..', 
  '.*************.',
  '***************',
  '***************',
  '***************',
  '***..****..****',
  '***..****..****',
  '***************',
  '***************',
  '***************',
  '***************',
  '***************',
  '***************',
  '.**..***..**..*',
  '..*...*...*....',
];


/**
 * Generate draw commands to stamp a ghost centered at (cx, cy).
 * Body cells use `bodySpecies`, eye cells use species 0 (Empty).
 */
export function ghostStamp(
  cx: number,
  cy: number,
  bodySpecies: number,
  gridWidth: number,
  gridHeight: number,
): DrawCommand[] {
  const h = GHOST_BODY.length;
  const w = GHOST_BODY[0].length;
  const ox = cx - Math.floor(w / 2);
  const oy = cy - Math.floor(h / 2);

  const cmds: DrawCommand[] = [];
  for (let row = 0; row < h; row++) {
    const line = GHOST_BODY[row];
    for (let col = 0; col < w; col++) {
      if (line[col] === '.') continue;
      const x = ox + col;
      const y = oy + row;
      if (x < 0 || x >= gridWidth || y < 0 || y >= gridHeight) continue;
      cmds.push({ x, y, species: bodySpecies });
    }
  }
  return cmds;
}

/** Check if a species value represents the Ghost element. */
export const GHOST_SPECIES = 5;

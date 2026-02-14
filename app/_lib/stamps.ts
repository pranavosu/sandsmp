/**
 * Pixel stamp patterns for the simulation.
 * Each stamp is a 2D boolean grid where `true` = place a cell.
 * Stamps are defined top-to-bottom, left-to-right.
 */

import type { DrawCommand } from './input';

// 19×21 pixel ghost — tall smooth dome, wide body, short subtle tendrils.
// '*' = body, 'Z' = eye zone (potential eye position), '.' = empty.
const GHOST_BODY: readonly string[] = [
  '......*******......',
  '....***********....',
  '...*************...',
  '..***************..',
  '.*****************.',
  '.*****************.',
  '*******************',
  '*****ZZZZ*ZZZZ*****',
  '*****ZZZZ*ZZZZ*****',
  '*****ZZZZ*ZZZZ*****',
  '*****ZZZZ*ZZZZ*****',
  '*****ZZZZ*ZZZZ*****',
  '*******************',
  '*******************',
  '*******************',
  '*******************',
  '*******************',
  '*******************',
  '******.*****.******',
  '*****..*****..****.',
  '****...****....*...',
];

/** rb value for normal ghost body cells. */
export const RB_BODY = 0;
/** rb value for eye-zone cells (potential eye position, rendered as body). */
export const RB_EYE_ZONE = 1;
/** rb value for active eye cells (rendered dark). */
export const RB_EYE = 2;

/** Draw command extended with rb for ghost cells. */
export interface GhostDrawCommand {
  x: number;
  y: number;
  species: number;
  rb: number;
}

/**
 * Generate draw commands to stamp a ghost centered at (cx, cy).
 * Body cells use `bodySpecies` with rb encoding their visual role.
 */
export function ghostStamp(
  cx: number,
  cy: number,
  bodySpecies: number,
  gridWidth: number,
  gridHeight: number,
): GhostDrawCommand[] {
  const h = GHOST_BODY.length;
  const w = GHOST_BODY[0].length;
  const ox = cx - Math.floor(w / 2);
  const oy = cy - Math.floor(h / 2);

  const cmds: GhostDrawCommand[] = [];
  for (let row = 0; row < h; row++) {
    const line = GHOST_BODY[row];
    for (let col = 0; col < w; col++) {
      const ch = line[col];
      if (ch === '.') continue;
      const x = ox + col;
      const y = oy + row;
      if (x < 0 || x >= gridWidth || y < 0 || y >= gridHeight) continue;

      let rb = RB_BODY;
      if (ch === 'Z') rb = RB_EYE_ZONE;

      cmds.push({ x, y, species: bodySpecies, rb });
    }
  }
  return cmds;
}

/** Check if a species value represents the Ghost element. */
export const GHOST_SPECIES = 5;

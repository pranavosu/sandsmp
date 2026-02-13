/** Draw command produced by the input handler. */
export interface DrawCommand {
  x: number;
  y: number;
  species: number;
}

// ── Pure helper functions (exported for testing) ──────────

/**
 * Convert normalised screen coordinates (0–1 range) to grid coordinates
 * clamped to [0, gridSize-1].
 */
export function screenToGridCoord(
  screenNorm: number,
  gridSize: number,
): number {
  const g = Math.floor(screenNorm * gridSize);
  return Math.max(0, Math.min(gridSize - 1, g));
}

/**
 * Bresenham line interpolation between two grid points.
 * Returns every point along the line (inclusive of both endpoints).
 */
export function interpolateLine(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): Array<{ x: number; y: number }> {
  const points: Array<{ x: number; y: number }> = [];
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;

  let cx = x0;
  let cy = y0;

  for (;;) {
    points.push({ x: cx, y: cy });
    if (cx === x1 && cy === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      cx += sx;
    }
    if (e2 <= dx) {
      err += dx;
      cy += sy;
    }
  }
  return points;
}

/**
 * Compute the set of grid cells covered by a filled circle brush.
 * Cells outside [0, gridWidth) × [0, gridHeight) are excluded.
 */
export function brushCells(
  cx: number,
  cy: number,
  radius: number,
  gridWidth: number,
  gridHeight: number,
): Array<{ x: number; y: number }> {
  const cells: Array<{ x: number; y: number }> = [];
  const r2 = radius * radius;
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (dx * dx + dy * dy > r2) continue;
      const px = cx + dx;
      const py = cy + dy;
      if (px < 0 || px >= gridWidth || py < 0 || py >= gridHeight) continue;
      cells.push({ x: px, y: py });
    }
  }
  return cells;
}

/**
 * Handles mouse/touch input on the simulation canvas.
 * Converts pointer events to grid-space draw commands with
 * Bresenham interpolation and configurable brush radius.
 */
export class InputHandler {
  private canvas: HTMLCanvasElement;
  private gridWidth: number;
  private gridHeight: number;
  private selectedSpecies: number = 1; // Sand by default
  private brushRadius: number = 2;
  private isDrawing: boolean = false;
  private lastPos: { x: number; y: number } | null = null;
  private commands: DrawCommand[] = [];

  // Bound listeners for cleanup
  private onPointerDown: (e: PointerEvent) => void;
  private onPointerMove: (e: PointerEvent) => void;
  private onPointerUp: (e: PointerEvent) => void;

  constructor(canvas: HTMLCanvasElement, gridWidth: number, gridHeight: number) {
    this.canvas = canvas;
    this.gridWidth = gridWidth;
    this.gridHeight = gridHeight;

    this.onPointerDown = this.handlePointerDown.bind(this);
    this.onPointerMove = this.handlePointerMove.bind(this);
    this.onPointerUp = this.handlePointerUp.bind(this);

    canvas.addEventListener("pointerdown", this.onPointerDown);
    canvas.addEventListener("pointermove", this.onPointerMove);
    canvas.addEventListener("pointerup", this.onPointerUp);
  }

  setSpecies(species: number): void {
    this.selectedSpecies = species;
  }

  setBrushRadius(radius: number): void {
    this.brushRadius = Math.max(0, radius);
  }

  /** Returns pending draw commands since last call, then clears the buffer. */
  flush(): DrawCommand[] {
    const out = this.commands;
    this.commands = [];
    return out;
  }

  destroy(): void {
    this.canvas.removeEventListener("pointerdown", this.onPointerDown);
    this.canvas.removeEventListener("pointermove", this.onPointerMove);
    this.canvas.removeEventListener("pointerup", this.onPointerUp);
  }

  // ── Private ──────────────────────────────────────────────

  private handlePointerDown(e: PointerEvent): void {
    this.isDrawing = true;
    const pos = this.screenToGrid(e);
    this.lastPos = pos;
    this.paintBrush(pos.x, pos.y);
  }

  private handlePointerMove(e: PointerEvent): void {
    if (!this.isDrawing) return;
    const pos = this.screenToGrid(e);
    if (this.lastPos) {
      this.interpolateAndPaint(this.lastPos.x, this.lastPos.y, pos.x, pos.y);
    } else {
      this.paintBrush(pos.x, pos.y);
    }
    this.lastPos = pos;
  }

  private handlePointerUp(): void {
    this.isDrawing = false;
    this.lastPos = null;
  }

  /**
   * Convert screen pixel coordinates to grid coordinates clamped to [0, gridSize-1].
   */
  private screenToGrid(e: PointerEvent): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    const sx = (e.clientX - rect.left) / rect.width;
    const sy = (e.clientY - rect.top) / rect.height;
    return {
      x: screenToGridCoord(sx, this.gridWidth),
      y: screenToGridCoord(sy, this.gridHeight),
    };
  }

  /**
   * Bresenham line interpolation between two grid points.
   * Paints a brush circle at every point along the line.
   */
  private interpolateAndPaint(x0: number, y0: number, x1: number, y1: number): void {
    const points = interpolateLine(x0, y0, x1, y1);
    for (const p of points) {
      this.paintBrush(p.x, p.y);
    }
  }

  /**
   * Paint a filled circle of cells around (cx, cy) with the current brush radius.
   */
  private paintBrush(cx: number, cy: number): void {
    const cells = brushCells(cx, cy, this.brushRadius, this.gridWidth, this.gridHeight);
    for (const c of cells) {
      this.commands.push({ x: c.x, y: c.y, species: this.selectedSpecies });
    }
  }
}

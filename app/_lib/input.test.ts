import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { screenToGridCoord, interpolateLine, brushCells } from "./input";

// Feature: single-player-simulation-mvp, Property 16: Screen-to-grid coordinate conversion
// **Validates: Requirements 9.3**
describe("Property 16: Screen-to-grid coordinate conversion", () => {
  it("output always in [0, 255] for any screen coordinate", () => {
    fc.assert(
      fc.property(fc.double({ min: -10, max: 10, noNaN: true }), (screenNorm) => {
        const g = screenToGridCoord(screenNorm, 256);
        expect(g).toBeGreaterThanOrEqual(0);
        expect(g).toBeLessThanOrEqual(255);
        expect(Number.isInteger(g)).toBe(true);
      }),
      { numRuns: 200 },
    );
  });

  it("monotonically increasing: larger screen x → larger or equal grid x", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        (a, b) => {
          const lo = Math.min(a, b);
          const hi = Math.max(a, b);
          expect(screenToGridCoord(hi, 256)).toBeGreaterThanOrEqual(
            screenToGridCoord(lo, 256),
          );
        },
      ),
      { numRuns: 200 },
    );
  });
});

// Feature: single-player-simulation-mvp, Property 17: Stroke interpolation produces connected paths
// **Validates: Requirements 9.2**
describe("Property 17: Stroke interpolation produces connected paths", () => {
  it("consecutive points differ by at most 1 in each axis (8-connected)", () => {
    const gridCoord = fc.integer({ min: 0, max: 255 });
    fc.assert(
      fc.property(gridCoord, gridCoord, gridCoord, gridCoord, (x0, y0, x1, y1) => {
        const points = interpolateLine(x0, y0, x1, y1);
        // Must include both endpoints
        expect(points.length).toBeGreaterThanOrEqual(1);
        expect(points[0]).toEqual({ x: x0, y: y0 });
        expect(points[points.length - 1]).toEqual({ x: x1, y: y1 });
        // Each consecutive pair is 8-connected
        for (let i = 1; i < points.length; i++) {
          const dx = Math.abs(points[i].x - points[i - 1].x);
          const dy = Math.abs(points[i].y - points[i - 1].y);
          expect(dx).toBeLessThanOrEqual(1);
          expect(dy).toBeLessThanOrEqual(1);
        }
      }),
      { numRuns: 200 },
    );
  });
});

// Feature: single-player-simulation-mvp, Property 18: Brush radius produces filled circle
// **Validates: Requirements 9.4**
describe("Property 18: Brush radius produces filled circle", () => {
  it("all cells within radius included, none outside", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 255 }),
        fc.integer({ min: 0, max: 255 }),
        fc.integer({ min: 0, max: 10 }),
        (cx, cy, radius) => {
          const cells = brushCells(cx, cy, radius, 256, 256);
          const cellSet = new Set(cells.map((c) => `${c.x},${c.y}`));
          const r2 = radius * radius;

          // Check all cells in the bounding box
          for (let dy = -radius; dy <= radius; dy++) {
            for (let dx = -radius; dx <= radius; dx++) {
              const px = cx + dx;
              const py = cy + dy;
              const inBounds = px >= 0 && px < 256 && py >= 0 && py < 256;
              const inCircle = dx * dx + dy * dy <= r2;
              const key = `${px},${py}`;

              if (inCircle && inBounds) {
                expect(cellSet.has(key)).toBe(true);
              } else {
                expect(cellSet.has(key)).toBe(false);
              }
            }
          }
        },
      ),
      { numRuns: 200 },
    );
  });
});

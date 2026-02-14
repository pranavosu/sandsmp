//! Water element: falls, slides diagonally, spreads horizontally.
//!
//! Diagonal and horizontal spread use per-particle `ra % 2` direction
//! for varied flow. Level swap alternates by generation parity to
//! distribute excess surface particles evenly (avoiding left-bias).
//!
//! Horizontal spread uses Noita-style ray-cast: water scans up to
//! `HORIZONTAL_RANGE` cells each tick, moving to the nearest
//! reachable empty cell.
//!
//! Level swap ray-casts through adjacent water to find a surface cell
//! (one with empty above), then swaps with it. The scan follows the
//! water body's contour around obstacles (stepping down/up when it
//! hits non-water cells), enabling leveling across sloped terrain.

use crate::api::SandApi;
use crate::cell::{Cell, Species};

/// How far water ray-casts horizontally for empty cells each tick.
const HORIZONTAL_RANGE: i32 = 5;

/// How far the level swap scans through water to find a surface cell.
const LEVEL_SCAN_RANGE: i32 = 20;

/// One-in-N chance of re-randomizing flow direction during freefall.
const FREEFALL_RERANDOMIZE_CHANCE: u8 = 20;

pub fn update_water(api: &mut SandApi) {
    let me = api.get(0, 0);
    let dir: i32 = if me.ra % 2 == 0 { -1 } else { 1 };

    // Phase 1: Gravity — fall straight down.
    let below = api.get(0, 1);
    if below.species == Species::Empty {
        let mut falling = me;
        if api.generation % FREEFALL_RERANDOMIZE_CHANCE == 0 {
            falling.ra = api.generation;
        }
        api.set(0, 0, below);
        api.set(0, 1, falling);
        return;
    }

    // Phase 2: Diagonal fall — per-particle direction for varied flow.
    let diag1 = api.get(dir, 1);
    if diag1.species == Species::Empty {
        api.set(0, 0, diag1);
        api.set(dir, 1, me);
        return;
    }
    let diag2 = api.get(-dir, 1);
    if diag2.species == Species::Empty {
        api.set(0, 0, diag2);
        api.set(-dir, 1, me);
        return;
    }

    // Phase 3: Horizontal ray-cast spread — per-particle direction.
    if try_horizontal(api, &me, dir) {
        return;
    }
    if try_horizontal(api, &me, -dir) {
        return;
    }

    let above = api.get(0, -1);

    // Phase 4: Surface diffusion — if we're a surface particle (empty above)
    // sitting on water, try to hop onto an adjacent water column that has
    // empty space above it, or flow sideways into an empty neighbor that
    // has support below. Alternate direction by generation parity to
    // prevent scan-order bias from pushing extras to one side.
    if above.species == Species::Empty && below.species == Species::Water {
        let surf_dir: i32 = if api.generation % 2 == 0 { 1 } else { -1 };
        if try_surface_hop(api, &me, surf_dir) {
            return;
        }
        if try_surface_hop(api, &me, -surf_dir) {
            return;
        }
    }

    // Phase 5: Level swap — only for buried cells (not surface).
    // Ray-cast through water to find a surface cell and swap with it.
    // This moves mass from tall columns to short ones.
    if above.species != Species::Empty {
        let level_dir: i32 = if api.generation % 2 == 0 { 1 } else { -1 };
        if try_level_swap(api, &me, level_dir) {
            return;
        }
        if try_level_swap(api, &me, -level_dir) {
            return;
        }
    }

    // Phase 6: Fully blocked — flip direction.
    let mut blocked = me;
    blocked.ra ^= 1;
    api.set(0, 0, blocked);
}

/// Ray-cast up to HORIZONTAL_RANGE cells in direction `dx`.
/// Move to the nearest reachable empty cell (viscous flow).
fn try_horizontal(api: &mut SandApi, me: &Cell, dx: i32) -> bool {
    for step in 1..=HORIZONTAL_RANGE {
        let neighbor = api.get(dx * step, 0);
        if neighbor.species == Species::Empty {
            api.set(0, 0, Cell::empty());
            api.set(dx * step, 0, *me);
            return true;
        }
        if neighbor.species != Species::Water {
            break;
        }
    }
    false
}

/// Scan through water in direction `dx` up to LEVEL_SCAN_RANGE cells.
/// Find a water cell that has empty above it (a surface cell) and swap
/// with it, redistributing mass from tall columns to short ones.
///
/// Skips surface cells found in the first 2 steps to avoid pointless
/// swaps with adjacent cells at the same height, which cause
/// oscillation near walls and obstacles.
///
/// When the horizontal scan hits a non-water cell, it tries stepping
/// down or up to follow the water body's contour around obstacles like
/// sand slopes or walls.
fn try_level_swap(api: &mut SandApi, me: &Cell, dx: i32) -> bool {
    let mut cx = dx;
    let mut cy: i32 = 0;
    let mut steps_taken: i32 = 0;
    for _ in 1..=LEVEL_SCAN_RANGE {
        let neighbor = api.get(cx, cy);
        if neighbor.species == Species::Water {
            steps_taken += 1;
            let neighbor_above = api.get(cx, cy - 1);
            if neighbor_above.species == Species::Empty && steps_taken > 2 {
                // Found a surface cell far enough away to be in a
                // different (shorter) column. Swap to redistribute.
                api.set(0, 0, neighbor);
                api.set(cx, cy, *me);
                return true;
            }
            cx += dx;
        } else {
            // Hit a non-water cell. Step down (gravity preference) or
            // up to follow the water body's contour.
            let scan_below = api.get(cx, cy + 1);
            if scan_below.species == Species::Water {
                cy += 1;
            } else {
                let scan_above = api.get(cx, cy - 1);
                if scan_above.species == Species::Water {
                    cy -= 1;
                } else {
                    return false;
                }
            }
        }
    }
    false
}

/// Surface hop: move this surface particle to an adjacent shorter column.
///
/// If the neighbor is empty with support below, flow sideways into it.
/// This is the key mechanism for leveling water surfaces near obstacles
/// where horizontal ray-cast can't reach (blocked by the obstacle).
fn try_surface_hop(api: &mut SandApi, me: &Cell, dx: i32) -> bool {
    let neighbor = api.get(dx, 0);
    if neighbor.species == Species::Empty {
        // Neighbor column is shorter — flow sideways into it.
        // Only if there's support below (not floating in open air).
        let below_neighbor = api.get(dx, 1);
        if below_neighbor.species != Species::Empty {
            api.set(0, 0, Cell::empty());
            api.set(dx, 0, *me);
            return true;
        }
    }
    false
}

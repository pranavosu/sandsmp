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
//! (one with empty above), then swaps with it. This propagates leveling
//! deep through water bodies, flattening humps even around obstacles.

use crate::api::SandApi;
use crate::cell::{Cell, Species};

/// How far water ray-casts horizontally for empty cells each tick.
/// Water moves to the nearest empty cell within this range, giving
/// a viscous look while still reaching gaps quickly.
const HORIZONTAL_RANGE: i32 = 5;

/// How far the level swap scans through water to find a surface cell.
const LEVEL_SCAN_RANGE: i32 = 10;

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

    // Phase 4: Surface diffusion — if we're a surface particle (empty above)
    // sitting on water, try to hop onto an adjacent water column that has
    // empty space above it. Alternate direction by generation parity to
    // prevent scan-order bias from pushing extras to one side.
    let above = api.get(0, -1);
    if above.species == Species::Empty && below.species == Species::Water {
        let surf_dir: i32 = if api.generation % 2 == 0 { 1 } else { -1 };
        if try_surface_hop(api, &me, surf_dir) {
            return;
        }
        if try_surface_hop(api, &me, -surf_dir) {
            return;
        }
    }

    // Phase 5: Level swap — ray-cast through water to find a surface cell
    // (water with empty above) and swap with it.
    let level_dir: i32 = if api.generation % 2 == 0 { 1 } else { -1 };
    if try_level_swap(api, &me, level_dir) {
        return;
    }
    if try_level_swap(api, &me, -level_dir) {
        return;
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
/// Find the first water cell that has empty above it (a surface cell in
/// a shorter column) and swap with it.
fn try_level_swap(api: &mut SandApi, me: &Cell, dx: i32) -> bool {
    for step in 1..=LEVEL_SCAN_RANGE {
        let neighbor = api.get(dx * step, 0);
        if neighbor.species != Species::Water {
            // Hit a non-water cell (sand, wall, empty) — stop scanning.
            return false;
        }
        let above = api.get(dx * step, -1);
        if above.species == Species::Empty {
            // Found a surface cell — swap with it.
            api.set(0, 0, neighbor);
            api.set(dx * step, 0, *me);
            return true;
        }
    }
    false
}

/// Surface hop: move this surface particle up-and-over to sit on top of
/// an adjacent water cell. Only succeeds if the neighbor is water and
/// the cell above it is empty (i.e., there's room on top).
fn try_surface_hop(api: &mut SandApi, me: &Cell, dx: i32) -> bool {
    let neighbor = api.get(dx, 0);
    if neighbor.species != Species::Water {
        return false;
    }
    let above_neighbor = api.get(dx, -1);
    if above_neighbor.species == Species::Empty {
        // Move to the cell above the neighbor.
        api.set(0, 0, Cell::empty());
        api.set(dx, -1, *me);
        return true;
    }
    false
}

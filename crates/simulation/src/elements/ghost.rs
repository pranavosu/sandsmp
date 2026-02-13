//! Ghost element: all ghost cells move together as a cohesive group.
//!
//! Movement is handled as a bulk operation in `Grid::move_ghosts()`,
//! not per-cell, so the entire shape translates uniformly.
//! The per-cell `update_ghost` is a no-op.

/// Directions: up, down, left, right, and diagonals.
pub const DIRS: [(i32, i32); 8] = [
    (0, -1),  // up
    (1, -1),  // up-right
    (1, 0),   // right
    (1, 1),   // down-right
    (0, 1),   // down
    (-1, 1),  // down-left
    (-1, 0),  // left
    (-1, -1), // up-left
];

/// How many ticks to hold the same direction before picking a new one.
pub const DIRECTION_HOLD_TICKS: u8 = 10;

/// Only move on every Nth tick so the ghost drifts lazily.
pub const MOVE_DIVISOR: u8 = 6;

/// Derive a direction from the generation counter and group ID.
/// Different groups get different directions at the same tick.
pub fn shared_direction(generation: u8, group_id: u8) -> (i32, i32) {
    let epoch = generation / DIRECTION_HOLD_TICKS;
    // Mix group_id into the hash so each group diverges.
    let h = (epoch as u32)
        .wrapping_mul(2654435761)
        .wrapping_add(group_id as u32)
        .wrapping_mul(2246822519);
    let idx = (h >> 16) as usize % DIRS.len();
    DIRS[idx]
}

/// Per-cell update is a no-op — bulk movement is in Grid::move_ghosts.
pub fn update_ghost(_api: &mut crate::api::SandApi) {}

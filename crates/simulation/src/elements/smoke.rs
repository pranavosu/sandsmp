//! Smoke element: rises slowly with random horizontal drift, fades over time.
//!
//! Smoke uses `rb` as a lifetime counter (starts high, decrements each tick).
//! When `rb` reaches 0 the particle dies. The shader uses `rb` to fade
//! smoke from opaque gray to transparent as it ages.

use crate::api::SandApi;
use crate::cell::{Cell, Species};

/// One-in-N chance of drifting horizontally each tick.
const DRIFT_CHANCE: u8 = 3;

pub fn update_smoke(api: &mut SandApi) {
    let me = api.get(0, 0);

    // Expire when lifetime runs out.
    if me.rb == 0 {
        api.set(0, 0, Cell::empty());
        return;
    }

    let mut updated = me;
    updated.rb = me.rb.saturating_sub(1);

    // Try to rise.
    let above = api.get(0, -1);
    if above.species == Species::Empty {
        api.set(0, 0, above);
        api.set(0, -1, updated);
        return;
    }

    // Random horizontal drift — gives smoke a billowy look.
    let gen = api.generation;
    if gen % DRIFT_CHANCE == 0 {
        let dx: i32 = if me.ra % 2 == 0 { -1 } else { 1 };
        let side = api.get(dx, 0);
        if side.species == Species::Empty {
            api.set(0, 0, side);
            api.set(dx, 0, updated);
            return;
        }
        // Try the other side.
        let other = api.get(-dx, 0);
        if other.species == Species::Empty {
            api.set(0, 0, other);
            api.set(-dx, 0, updated);
            return;
        }
    }

    // Try diagonal up.
    let dx: i32 = if gen % 2 == 0 { -1 } else { 1 };
    let diag = api.get(dx, -1);
    if diag.species == Species::Empty {
        api.set(0, 0, diag);
        api.set(dx, -1, updated);
        return;
    }
    let diag2 = api.get(-dx, -1);
    if diag2.species == Species::Empty {
        api.set(0, 0, diag2);
        api.set(-dx, -1, updated);
        return;
    }

    // Stuck — just age in place.
    api.set(0, 0, updated);
}

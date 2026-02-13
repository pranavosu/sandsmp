//! Fire element: rises upward and decays over time.

use crate::api::SandApi;
use crate::cell::{Cell, Species};

/// Update a Fire cell. Decrements lifetime, then attempts to rise.
pub fn update_fire(api: &mut SandApi) {
    let me = api.get(0, 0);

    // Decrement lifetime; extinguish when expired.
    if me.rb == 0 {
        api.set(0, 0, Cell::empty());
        return;
    }
    let mut updated = me;
    updated.rb = me.rb.saturating_sub(1);

    // Try to move up.
    let above = api.get(0, -1);
    if above.species == Species::Empty {
        api.set(0, 0, above);
        api.set(0, -1, updated);
        return;
    }

    // Diagonal up: pick direction based on generation parity.
    let gen = api.generation;
    let (dx1, dx2) = if gen.is_multiple_of(2) { (-1, 1) } else { (1, -1) };

    let diag1 = api.get(dx1, -1);
    if diag1.species == Species::Empty {
        api.set(0, 0, diag1);
        api.set(dx1, -1, updated);
        return;
    }

    let diag2 = api.get(dx2, -1);
    if diag2.species == Species::Empty {
        api.set(0, 0, diag2);
        api.set(dx2, -1, updated);
        return;
    }

    // Can't move; just update in place with decremented rb.
    api.set(0, 0, updated);
}

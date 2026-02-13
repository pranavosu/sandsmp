//! Water element: falls down, then diagonally, then spreads horizontally.

use crate::api::SandApi;
use crate::cell::Species;

/// Update a Water cell. Priority: down → diagonal down → horizontal.
pub fn update_water(api: &mut SandApi) {
    let below = api.get(0, 1);
    if below.species == Species::Empty {
        let me = api.get(0, 0);
        api.set(0, 0, below);
        api.set(0, 1, me);
        return;
    }

    // Diagonal down: pick direction based on generation parity.
    let gen = api.generation;
    let (dx1, dx2) = if gen.is_multiple_of(2) { (-1, 1) } else { (1, -1) };

    let diag1 = api.get(dx1, 1);
    if diag1.species == Species::Empty {
        let me = api.get(0, 0);
        api.set(0, 0, diag1);
        api.set(dx1, 1, me);
        return;
    }

    let diag2 = api.get(dx2, 1);
    if diag2.species == Species::Empty {
        let me = api.get(0, 0);
        api.set(0, 0, diag2);
        api.set(dx2, 1, me);
        return;
    }

    // Horizontal spread: same direction preference.
    let side1 = api.get(dx1, 0);
    if side1.species == Species::Empty {
        let me = api.get(0, 0);
        api.set(0, 0, side1);
        api.set(dx1, 0, me);
        return;
    }

    let side2 = api.get(dx2, 0);
    if side2.species == Species::Empty {
        let me = api.get(0, 0);
        api.set(0, 0, side2);
        api.set(dx2, 0, me);
    }
}

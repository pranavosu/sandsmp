//! Sand element: falls down, then diagonally; displaces Water by swapping.

use crate::api::SandApi;
use crate::cell::Species;

pub fn update_sand(api: &mut SandApi) {
    let below = api.get(0, 1);
    if below.species == Species::Empty {
        // Fall straight down
        let me = api.get(0, 0);
        api.set(0, 0, below);
        api.set(0, 1, me);
        return;
    }
    if below.species == Species::Water {
        // Displace water by swapping (sand is denser)
        let me = api.get(0, 0);
        api.set(0, 0, below);
        api.set(0, 1, me);
        return;
    }

    // Try diagonal, alternating direction to reduce lateral bias
    let gen = api.generation;
    let (dx1, dx2) = if gen.is_multiple_of(2) { (-1, 1) } else { (1, -1) };

    let diag1 = api.get(dx1, 1);
    if diag1.species == Species::Empty || diag1.species == Species::Water {
        let me = api.get(0, 0);
        api.set(0, 0, diag1);
        api.set(dx1, 1, me);
        return;
    }

    let diag2 = api.get(dx2, 1);
    if diag2.species == Species::Empty || diag2.species == Species::Water {
        let me = api.get(0, 0);
        api.set(0, 0, diag2);
        api.set(dx2, 1, me);
    }
}

//! Fire element: rises with random horizontal drift, spawns smoke on death.
//!
//! `rb` is the lifetime counter (higher = younger fire). The shader maps
//! `rb` to a color gradient: dark red → red → orange → yellow.
//! `ra` stores a per-particle random seed used for drift direction.
//!
//! When `rb` reaches 0, the fire cell is replaced with a Smoke particle
//! (with its own lifetime in `rb`).

use crate::api::SandApi;
use crate::cell::{Cell, Species};

/// Default lifetime when fire is placed by the player.
pub const DEFAULT_FIRE_LIFETIME: u8 = 120;

/// Smoke lifetime range: smoke lives 2–5× longer than fire for a lingering trail.
const SMOKE_LIFETIME_MIN: u8 = 80;
const SMOKE_LIFETIME_RANGE: u8 = 120; // max = MIN + RANGE = 200

/// One-in-N chance of horizontal drift each tick (lower = more drift).
const DRIFT_CHANCE: u8 = 2;

pub fn update_fire(api: &mut SandApi) {
    let me = api.get(0, 0);

    // Extinguish: spawn smoke when lifetime expires.
    if me.rb == 0 {
        let mut smoke = Cell::new(Species::Smoke);
        // Randomize smoke lifetime using generation + ra as cheap entropy.
        smoke.rb = SMOKE_LIFETIME_MIN.wrapping_add(api.generation.wrapping_mul(me.ra) % SMOKE_LIFETIME_RANGE);
        smoke.ra = me.ra; // inherit drift seed
        api.set(0, 0, smoke);
        return;
    }

    let mut updated = me;
    updated.rb = me.rb.saturating_sub(1);

    let gen = api.generation;

    // Random horizontal drift — makes fire flicker laterally.
    if gen % DRIFT_CHANCE == 0 {
        let dx: i32 = if me.ra % 2 == 0 { -1 } else { 1 };
        let side_up = api.get(dx, -1);
        if side_up.species == Species::Empty {
            api.set(0, 0, Cell::empty());
            api.set(dx, -1, updated);
            return;
        }
    }

    // Try to rise straight up.
    let above = api.get(0, -1);
    if above.species == Species::Empty {
        api.set(0, 0, Cell::empty());
        api.set(0, -1, updated);
        return;
    }

    // Try diagonal up, alternating direction.
    let (dx1, dx2) = if gen % 2 == 0 { (-1, 1) } else { (1, -1) };

    let diag1 = api.get(dx1, -1);
    if diag1.species == Species::Empty {
        api.set(0, 0, Cell::empty());
        api.set(dx1, -1, updated);
        return;
    }

    let diag2 = api.get(dx2, -1);
    if diag2.species == Species::Empty {
        api.set(0, 0, Cell::empty());
        api.set(dx2, -1, updated);
        return;
    }

    // Can't move — update in place with decremented rb.
    api.set(0, 0, updated);
}

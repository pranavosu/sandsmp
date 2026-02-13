//! Smoke element: candle-smoke two-phase behavior.
//!
//! **Laminar phase** (young, high `rb`): rises fast and straight.
//!
//! **Turbulent phase** (older, low `rb`): stalls heavily, drifts
//! randomly, and spreads out into a diffuse cloud.

use crate::api::SandApi;
use crate::cell::{Cell, Species};

/// `rb` below this → turbulent dispersal phase.
const TURBULENT_THRESHOLD: u8 = 120;

pub fn update_smoke(api: &mut SandApi) {
    let me = api.get(0, 0);

    if me.rb == 0 {
        api.set(0, 0, Cell::empty());
        return;
    }

    let mut updated = me;
    updated.rb = me.rb.saturating_sub(1);

    let gen = api.generation;
    let laminar = me.rb > TURBULENT_THRESHOLD;

    // ── Laminar: fast, straight rise ──
    if laminar {
        if gen.wrapping_add(me.ra).wrapping_mul(7) % 10 < 1 {
            api.set(0, 0, updated);
            return;
        }
        let above = api.get(0, -1);
        if above.species == Species::Empty {
            api.set(0, 0, Cell::empty());
            api.set(0, -1, updated);
            return;
        }
        let dir: i32 = if me.ra % 2 == 0 { -1 } else { 1 };
        for &d in &[dir, -dir] {
            if api.get(d, -1).species == Species::Empty {
                api.set(0, 0, Cell::empty());
                api.set(d, -1, updated);
                return;
            }
        }
        api.set(0, 0, updated);
        return;
    }

    // ── Turbulent: stall + random drift ──

    // Stall ~60%.
    let stall_roll = gen.wrapping_add(me.ra).wrapping_mul(7) % 10;
    if stall_roll < 6 {
        // Re-randomize drift while stalling.
        if gen.wrapping_add(me.ra) % 5 == 0 {
            updated.ra = updated.ra.wrapping_add(gen);
        }
        api.set(0, 0, updated);
        return;
    }

    let dir: i32 = if me.ra % 2 == 0 { -1 } else { 1 };

    // ~1-in-3 ticks: drift diagonally.
    if me.ra.wrapping_add(gen) % 3 == 0 {
        if api.get(dir, -1).species == Species::Empty {
            api.set(0, 0, Cell::empty());
            api.set(dir, -1, updated);
            return;
        }
    }

    // Straight up.
    if api.get(0, -1).species == Species::Empty {
        api.set(0, 0, Cell::empty());
        api.set(0, -1, updated);
        return;
    }

    // Fallback diagonals.
    for &d in &[dir, -dir] {
        if api.get(d, -1).species == Species::Empty {
            api.set(0, 0, Cell::empty());
            api.set(d, -1, updated);
            return;
        }
    }

    // Swap with older smoke above.
    let above = api.get(0, -1);
    if above.species == Species::Smoke && above.rb < me.rb {
        api.set(0, 0, above);
        api.set(0, -1, updated);
        return;
    }

    // Horizontal escape.
    if api.get(dir, 0).species == Species::Empty {
        api.set(0, 0, Cell::empty());
        api.set(dir, 0, updated);
        return;
    }

    // Stuck — flip drift.
    updated.ra ^= 1;
    api.set(0, 0, updated);
}

//! Fire element: rises steadily like a candle flame, spawns smoke on death.
//!
//! `rb` is the lifetime counter (higher = younger fire). The shader maps
//! `rb` to a color gradient: dark red → red → orange → yellow.
//! `ra` stores a per-particle random seed for slight flicker.
//!
//! Fire strongly prefers rising straight up, with only occasional tiny
//! lateral flicker — producing a steady, even column from the source.

use crate::api::SandApi;
use crate::cell::{Cell, Species};

/// Default lifetime when fire is placed by the player.
pub const DEFAULT_FIRE_LIFETIME: u8 = 120;

/// Smoke lifetime range: long enough for the turbulent phase to develop swirls.
const SMOKE_LIFETIME_MIN: u8 = 80;
const SMOKE_LIFETIME_RANGE: u8 = 120; // max = MIN + RANGE = 200

/// Fire below this rb has a random chance to convert to smoke each tick,
/// spreading the fire→smoke transition over several frames instead of
/// a hard cutoff.
const FADE_THRESHOLD: u8 = 10;

pub fn update_fire(api: &mut SandApi) {
    let me = api.get(0, 0);

    // Stochastic early death: when rb is low, each tick has an increasing
    // chance to convert to smoke. At rb=10 it's ~1-in-5, at rb=1 it's ~1-in-1.
    let should_die = me.rb == 0
        || (me.rb <= FADE_THRESHOLD
            && api.generation.wrapping_add(me.ra).wrapping_mul(3) % me.rb.max(1) == 0);

    if should_die {
        let mut smoke = Cell::new(Species::Smoke);
        smoke.rb = SMOKE_LIFETIME_MIN.wrapping_add(
            api.generation.wrapping_mul(me.ra) % SMOKE_LIFETIME_RANGE,
        );
        smoke.ra = me.ra;
        api.set(0, 0, smoke);

        // Spawn extra smoke into empty neighbors above for denser plumes.
        for &(dx, dy) in &[(-1, -1), (0, -1), (1, -1)] {
            let neighbor = api.get(dx, dy);
            if neighbor.species == Species::Empty {
                let mut extra = Cell::new(Species::Smoke);
                extra.rb = SMOKE_LIFETIME_MIN.wrapping_add(
                    api.generation
                        .wrapping_mul(me.ra.wrapping_add(dx as u8))
                        % SMOKE_LIFETIME_RANGE,
                );
                extra.ra = me.ra.wrapping_add(dx as u8);
                api.set(dx, dy, extra);
            }
        }
        return;
    }

    let mut updated = me;
    updated.rb = me.rb.saturating_sub(1);

    let gen = api.generation;

    // Primary: rise straight up — steady candle flame.
    let above = api.get(0, -1);
    if above.species == Species::Empty {
        api.set(0, 0, Cell::empty());
        api.set(0, -1, updated);
        return;
    }

    // Slight flicker: only ~1-in-6 ticks try a diagonal, keeps the flame tight.
    let flicker = gen.wrapping_add(me.ra).wrapping_mul(3) % 6 == 0;
    if flicker {
        let dx: i32 = if me.ra % 2 == 0 { -1 } else { 1 };
        let diag = api.get(dx, -1);
        if diag.species == Species::Empty {
            api.set(0, 0, Cell::empty());
            api.set(dx, -1, updated);
            return;
        }
    }

    // Blocked straight up and no flicker — try diagonals as fallback.
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

    // Can't move — age in place.
    api.set(0, 0, updated);
}

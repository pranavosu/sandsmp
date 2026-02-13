use crate::cell::Cell;
use crate::Grid;

pub struct SandApi<'a> {
    pub grid: &'a mut Grid,
    pub x: i32,
    pub y: i32,
    pub generation: u8,
}

impl<'a> SandApi<'a> {
    pub fn new(grid: &'a mut Grid, x: i32, y: i32, generation: u8) -> Self {
        SandApi { grid, x, y, generation }
    }

    /// Get cell at relative offset. Out-of-bounds returns Wall.
    pub fn get(&self, dx: i32, dy: i32) -> Cell {
        self.grid.get(self.x + dx, self.y + dy)
    }

    /// Set cell at relative offset. Out-of-bounds is a no-op.
    /// Stamps the clock field with current generation.
    pub fn set(&mut self, dx: i32, dy: i32, cell: Cell) {
        let mut stamped = cell;
        stamped.clock = self.generation;
        self.grid.set(self.x + dx, self.y + dy, stamped);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cell::Species;
    use proptest::prelude::*;

    fn arb_species() -> impl Strategy<Value = Species> {
        prop_oneof![
            Just(Species::Empty),
            Just(Species::Sand),
            Just(Species::Water),
            Just(Species::Wall),
            Just(Species::Fire),
        ]
    }

    fn arb_cell() -> impl Strategy<Value = Cell> {
        (arb_species(), any::<u8>(), any::<u8>(), any::<u8>()).prop_map(
            |(species, ra, rb, clock)| Cell { species, ra, rb, clock },
        )
    }

    // Feature: single-player-simulation-mvp, Property 4: SandApi get/set round trip with clock stamping
    // **Validates: Requirements 4.1, 4.2, 4.4**
    proptest! {
        #[test]
        fn prop_sandapi_get_set_round_trip_with_clock(
            base_x in 0i32..256,
            base_y in 0i32..256,
            dx in -128i32..128,
            dy in -128i32..128,
            cell in arb_cell(),
            generation in any::<u8>(),
        ) {
            let target_x = base_x + dx;
            let target_y = base_y + dy;
            // Only test in-bounds targets
            prop_assume!(target_x >= 0 && target_x < 256 && target_y >= 0 && target_y < 256);

            let mut grid = Grid::new(256, 256);
            let mut api = SandApi::new(&mut grid, base_x, base_y, generation);

            api.set(dx, dy, cell);
            let got = api.get(dx, dy);

            prop_assert_eq!(got.species, cell.species);
            prop_assert_eq!(got.ra, cell.ra);
            prop_assert_eq!(got.rb, cell.rb);
            prop_assert_eq!(got.clock, generation, "clock should be stamped to current generation");
        }
    }

    // Feature: single-player-simulation-mvp, Property 5: SandApi out-of-bounds boundary behavior
    // **Validates: Requirements 4.3**
    proptest! {
        #[test]
        fn prop_sandapi_out_of_bounds_boundary(
            base_x in 0i32..256,
            base_y in 0i32..256,
            dx in -512i32..512,
            dy in -512i32..512,
            cell in arb_cell(),
            generation in any::<u8>(),
        ) {
            let target_x = base_x + dx;
            let target_y = base_y + dy;
            // Only test out-of-bounds targets
            prop_assume!(target_x < 0 || target_x >= 256 || target_y < 0 || target_y >= 256);

            let mut grid = Grid::new(256, 256);
            let before: Vec<Cell> = grid.cells.clone();

            let mut api = SandApi::new(&mut grid, base_x, base_y, generation);

            // get returns Wall
            let got = api.get(dx, dy);
            prop_assert_eq!(got.species, Species::Wall);

            // set is a no-op
            api.set(dx, dy, cell);
            prop_assert_eq!(api.grid.cells.as_slice(), before.as_slice());
        }
    }
}


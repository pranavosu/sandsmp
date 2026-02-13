//! Per-element update functions dispatched from the tick loop.

mod fire;
pub(crate) mod ghost;
mod sand;
mod water;

use crate::api::SandApi;
use crate::cell::Species;

/// Dispatch to the appropriate element update function.
///
/// Wall and Empty are no-ops and should be skipped before calling this.
pub fn update_cell(species: Species, api: &mut SandApi) {
    match species {
        Species::Sand => sand::update_sand(api),
        Species::Water => water::update_water(api),
        Species::Fire => fire::update_fire(api),
        Species::Ghost => ghost::update_ghost(api),
        Species::Empty | Species::Wall => {}
    }
}

#[cfg(test)]
pub(crate) fn simulate_tick(grid: &mut crate::Grid) {
    grid.tick();
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cell::Cell;
    use crate::Grid;
    use proptest::prelude::*;

    /// Helper: count occurrences of each species in the grid.
    fn species_counts(grid: &Grid) -> [usize; 6] {
        let mut counts = [0usize; 6];
        for cell in &grid.cells {
            counts[cell.species as usize] += 1;
        }
        counts
    }

    /// Strategy: generate a grid filled with only Empty and Wall cells.
    fn arb_empty_wall_grid(size: usize) -> impl Strategy<Value = Grid> {
        proptest::collection::vec(
            prop_oneof![Just(Species::Empty), Just(Species::Wall)],
            size * size,
        )
        .prop_map(move |species_vec| {
            let mut grid = Grid::new(size, size);
            for (i, &sp) in species_vec.iter().enumerate() {
                grid.cells[i] = Cell::new(sp);
            }
            grid
        })
    }

    // Feature: single-player-simulation-mvp, Property 8: Immobile species grid invariant
    // **Validates: Requirements 3.6, 5.5, 5.6**
    proptest! {
        #[test]
        fn prop_immobile_species_grid_invariant(grid in arb_empty_wall_grid(16)) {
            let before: Vec<Cell> = grid.cells.clone();
            let mut grid = grid;
            simulate_tick(&mut grid);
            for (a, b) in before.iter().zip(grid.cells.iter()) {
                prop_assert_eq!(a.species, b.species);
                prop_assert_eq!(a.ra, b.ra);
                prop_assert_eq!(a.rb, b.rb);
            }
        }
    }

    // Feature: single-player-simulation-mvp, Property 9: Sand falls through Empty
    // **Validates: Requirements 5.1**
    proptest! {
        #[test]
        fn prop_sand_falls_through_empty(
            x in 0i32..16,
            y in 0i32..15,  // not bottom row, so y+1 is valid
        ) {
            let size = 16;
            let mut grid = Grid::new(size, size);
            grid.set(x, y, Cell::new(Species::Sand));

            simulate_tick(&mut grid);

            prop_assert_eq!(grid.get(x, y + 1).species, Species::Sand);
            prop_assert_eq!(grid.get(x, y).species, Species::Empty);
        }
    }

    // Feature: single-player-simulation-mvp, Property 12: Sand displaces Water by swapping
    // **Validates: Requirements 5.7**
    proptest! {
        #[test]
        fn prop_sand_displaces_water_by_swapping(
            x in 2i32..14,
            y in 1i32..14,
        ) {
            let size = 16;
            let mut grid = Grid::new(size, size);
            // Sand at (x, y), Water at (x, y+1).
            // Surround Water's escape routes with Wall so it can't move before
            // Sand gets to displace it. Water tries: down, diag-down, horizontal.
            grid.set(x, y, Cell::new(Species::Sand));
            grid.set(x, y + 1, Cell::new(Species::Water));
            // Block below and diagonals below
            grid.set(x, y + 2, Cell::new(Species::Wall));
            grid.set(x - 1, y + 2, Cell::new(Species::Wall));
            grid.set(x + 1, y + 2, Cell::new(Species::Wall));
            // Block horizontal and diagonal-down sides
            grid.set(x - 1, y + 1, Cell::new(Species::Wall));
            grid.set(x + 1, y + 1, Cell::new(Species::Wall));

            simulate_tick(&mut grid);

            // Sand should have displaced Water by swapping.
            prop_assert_eq!(grid.get(x, y + 1).species, Species::Sand);
            prop_assert_eq!(grid.get(x, y).species, Species::Water);
        }
    }

    // Feature: single-player-simulation-mvp, Property 13: Species conservation on movement
    // **Validates: Requirements 5.8**
    proptest! {
        #[test]
        fn prop_species_conservation_on_movement(
            cells in proptest::collection::vec(
                prop_oneof![
                    Just(Species::Empty),
                    Just(Species::Sand),
                    Just(Species::Water),
                    Just(Species::Wall),
                    Just(Species::Ghost),
                ],
                16 * 16,
            )
        ) {
            let size = 16;
            let mut grid = Grid::new(size, size);
            for (i, &sp) in cells.iter().enumerate() {
                grid.cells[i] = Cell::new(sp);
            }

            let before = species_counts(&grid);
            simulate_tick(&mut grid);
            let after = species_counts(&grid);

            prop_assert_eq!(before[Species::Empty as usize], after[Species::Empty as usize]);
            prop_assert_eq!(before[Species::Sand as usize], after[Species::Sand as usize]);
            prop_assert_eq!(before[Species::Water as usize], after[Species::Water as usize]);
            prop_assert_eq!(before[Species::Wall as usize], after[Species::Wall as usize]);
            prop_assert_eq!(before[Species::Ghost as usize], after[Species::Ghost as usize]);
        }
    }
}

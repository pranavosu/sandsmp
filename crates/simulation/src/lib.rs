//! Falling sand simulation engine.

pub mod api;
pub mod cell;
pub mod elements;

use cell::{Cell, Species};
use std::fmt;
use wasm_bindgen::prelude::*;

/// 2D grid of cells. Out-of-bounds reads return Wall, writes are no-ops.
#[derive(Debug)]
pub struct Grid {
    pub width: usize,
    pub height: usize,
    pub cells: Vec<Cell>,
    pub generation: u8,
}

impl Grid {
    #[must_use]
    pub fn new(width: usize, height: usize) -> Self {
        Self {
            width,
            height,
            cells: vec![Cell::empty(); width * height],
            generation: 0,
        }
    }

    #[must_use]
    pub fn in_bounds(&self, x: i32, y: i32) -> bool {
        x >= 0 && (x as usize) < self.width && y >= 0 && (y as usize) < self.height
    }

    #[must_use]
    pub fn get(&self, x: i32, y: i32) -> Cell {
        if self.in_bounds(x, y) {
            self.cells[y as usize * self.width + x as usize]
        } else {
            Cell::new(Species::Wall)
        }
    }

    pub fn set(&mut self, x: i32, y: i32, cell: Cell) {
        if self.in_bounds(x, y) {
            self.cells[y as usize * self.width + x as usize] = cell;
        }
    }

    /// Advance the simulation by one tick.
    ///
    /// Scans bottom-to-top, alternating horizontal direction each generation.
    /// Skips Empty/Wall cells and cells already updated this generation (clock == generation).
    pub fn tick(&mut self) {
        self.generation = self.generation.wrapping_add(1);
        let gen = self.generation;
        let w = self.width as i32;
        let h = self.height as i32;

        for y in (0..h).rev() {
            let x_range: Box<dyn Iterator<Item = i32>> = if gen.is_multiple_of(2) {
                Box::new(0..w)
            } else {
                Box::new((0..w).rev())
            };
            for x in x_range {
                let cell = self.get(x, y);
                if cell.species == Species::Empty || cell.species == Species::Wall {
                    continue;
                }
                if cell.clock == gen {
                    continue;
                }
                let species = cell.species;
                let mut sand_api = api::SandApi::new(self, x, y, gen);
                elements::update_cell(species, &mut sand_api);
            }
        }
    }
}

/// WASM-exported wrapper around [`Grid`] for browser consumption.
///
/// Maintains a separate species-only byte buffer (`species_buffer`) that is
/// synced after each `tick()`, suitable for direct GPU texture upload.
#[wasm_bindgen]
pub struct Universe {
    grid: Grid,
    /// One byte per cell (species only), length = width × height.
    species_buffer: Vec<u8>,
}

impl fmt::Debug for Universe {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("Universe")
            .field("grid", &self.grid)
            .field("species_buffer_len", &self.species_buffer.len())
            .finish()
    }
}

#[wasm_bindgen]
impl Universe {
    /// Create a new universe with the given dimensions, all cells empty.
    #[wasm_bindgen(constructor)]
    #[must_use]
    pub fn new(width: usize, height: usize) -> Self {
        let grid = Grid::new(width, height);
        let species_buffer = vec![Species::Empty as u8; width * height];
        Self {
            grid,
            species_buffer,
        }
    }

    /// Advance the simulation by one tick and sync the species buffer.
    pub fn tick(&mut self) {
        self.grid.tick();
        self.sync_species_buffer();
    }

    /// Paint a cell at `(x, y)` with the given species value.
    ///
    /// Out-of-bounds coordinates are silently ignored.
    pub fn set_cell(&mut self, x: usize, y: usize, species: u8) {
        if x >= self.grid.width || y >= self.grid.height {
            return;
        }
        let s = match species {
            0 => Species::Empty,
            1 => Species::Sand,
            2 => Species::Water,
            3 => Species::Wall,
            4 => Species::Fire,
            _ => return, // unknown species — ignore
        };
        let mut cell = Cell::new(s);
        // Fire starts with a lifetime counter so it doesn't vanish instantly.
        if s == Species::Fire {
            cell.rb = 120;
        }
        self.grid.set(x as i32, y as i32, cell);
    }

    /// Pointer to the species-only byte buffer for GPU texture upload.
    #[must_use]
    pub fn species_ptr(&self) -> *const u8 {
        self.species_buffer.as_ptr()
    }

    /// Grid width.
    #[must_use]
    pub fn width(&self) -> usize {
        self.grid.width
    }

    /// Grid height.
    #[must_use]
    pub fn height(&self) -> usize {
        self.grid.height
    }
}

impl Universe {
    /// Copy each cell's species byte into `species_buffer`.
    fn sync_species_buffer(&mut self) {
        for (i, cell) in self.grid.cells.iter().enumerate() {
            self.species_buffer[i] = cell.species as u8;
        }
    }
}


#[cfg(test)]
mod tests {
    use super::*;
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
            |(species, ra, rb, clock)| Cell {
                species,
                ra,
                rb,
                clock,
            },
        )
    }

    #[test]
    fn grid_new_initializes_all_empty() {
        let grid = Grid::new(256, 256);
        assert_eq!(grid.width, 256);
        assert_eq!(grid.height, 256);
        assert_eq!(grid.cells.len(), 65536);
        assert_eq!(grid.generation, 0);
        for cell in &grid.cells {
            assert_eq!(*cell, Cell::empty());
        }
    }

    #[test]
    fn grid_get_set_in_bounds() {
        let mut grid = Grid::new(256, 256);
        let sand = Cell::new(Species::Sand);
        grid.set(10, 20, sand);
        assert_eq!(grid.get(10, 20), sand);
    }

    #[test]
    fn grid_get_out_of_bounds_returns_wall() {
        let grid = Grid::new(256, 256);
        assert_eq!(grid.get(-1, 0).species, Species::Wall);
        assert_eq!(grid.get(0, -1).species, Species::Wall);
        assert_eq!(grid.get(256, 0).species, Species::Wall);
        assert_eq!(grid.get(0, 256).species, Species::Wall);
    }

    #[test]
    fn grid_set_out_of_bounds_is_noop() {
        let mut grid = Grid::new(256, 256);
        let before: Vec<Cell> = grid.cells.clone();
        grid.set(-1, 0, Cell::new(Species::Sand));
        grid.set(256, 0, Cell::new(Species::Sand));
        grid.set(0, -1, Cell::new(Species::Sand));
        grid.set(0, 256, Cell::new(Species::Sand));
        assert_eq!(grid.cells, before);
    }

    #[test]
    fn grid_in_bounds_checks() {
        let grid = Grid::new(256, 256);
        assert!(grid.in_bounds(0, 0));
        assert!(grid.in_bounds(255, 255));
        assert!(!grid.in_bounds(-1, 0));
        assert!(!grid.in_bounds(256, 0));
        assert!(!grid.in_bounds(0, -1));
        assert!(!grid.in_bounds(0, 256));
    }

    // Feature: single-player-simulation-mvp, Property 2: Grid in-bounds get/set round trip
    // **Validates: Requirements 2.3**
    proptest! {
        #[test]
        fn prop_grid_in_bounds_get_set_round_trip(
            x in 0i32..256,
            y in 0i32..256,
            cell in arb_cell(),
        ) {
            let mut grid = Grid::new(256, 256);
            grid.set(x, y, cell);
            let retrieved = grid.get(x, y);
            prop_assert_eq!(retrieved, cell);
        }
    }

    // Feature: single-player-simulation-mvp, Property 3: Grid out-of-bounds returns Wall
    // **Validates: Requirements 2.4**
    proptest! {
        #[test]
        fn prop_grid_out_of_bounds_returns_wall_and_unchanged(
            x in prop_oneof![(-1000i32..0), (256i32..1000)],
            y in prop_oneof![(-1000i32..0), (256i32..1000)],
            cell in arb_cell(),
        ) {
            let mut grid = Grid::new(256, 256);
            let before: Vec<Cell> = grid.cells.clone();

            let got = grid.get(x, y);
            prop_assert_eq!(got.species, Species::Wall);

            grid.set(x, y, cell);
            prop_assert_eq!(grid.cells, before);
        }
    }

    // Feature: single-player-simulation-mvp, Property 6: Generation counter wraps correctly
    // **Validates: Requirements 3.3**
    proptest! {
        #[test]
        fn prop_generation_counter_wraps_correctly(n in 1u32..1024) {
            let mut grid = Grid::new(16, 16);
            for _ in 0..n {
                grid.tick();
            }
            prop_assert_eq!(grid.generation, (n % 256) as u8);
        }
    }

    // Feature: single-player-simulation-mvp, Property 7: Clock-based double-update prevention
    // **Validates: Requirements 3.4**
    proptest! {
        #[test]
        fn prop_clock_prevents_double_update(
            x in 0i32..16,
            y in 0i32..15,  // not bottom row so Sand could fall
        ) {
            let mut grid = Grid::new(16, 16);

            // Place a Sand cell that would normally fall down (empty below).
            let mut sand = Cell::new(Species::Sand);
            // Pre-stamp the clock to the NEXT generation (generation starts at 0,
            // tick increments to 1 before scanning).
            sand.clock = 1;
            grid.set(x, y, sand);

            grid.tick();

            // The Sand cell should NOT have moved because its clock matched the
            // current generation, so the tick loop skipped it.
            prop_assert_eq!(grid.get(x, y).species, Species::Sand);
            prop_assert_eq!(grid.get(x, y + 1).species, Species::Empty);
        }
    }

    // Feature: single-player-simulation-mvp, Property 14: Species buffer matches grid state
    // **Validates: Requirements 6.5**
    proptest! {
        #[test]
        fn prop_species_buffer_matches_grid_state(
            placements in proptest::collection::vec(
                (0usize..256, 0usize..256, 0u8..5),
                0..50,
            ),
            ticks in 1u32..10,
        ) {
            let mut universe = Universe::new(256, 256);

            // Paint arbitrary cells.
            for &(x, y, species) in &placements {
                universe.set_cell(x, y, species);
            }

            // Run ticks — sync_species_buffer is called at the end of each tick().
            for _ in 0..ticks {
                universe.tick();
            }

            // After tick(), the species buffer must match the grid.
            let buf = &universe.species_buffer;
            let cells = &universe.grid.cells;
            prop_assert_eq!(buf.len(), cells.len());
            for i in 0..cells.len() {
                prop_assert_eq!(
                    buf[i],
                    cells[i].species as u8,
                    "mismatch at index {}: buffer={}, cell={}",
                    i, buf[i], cells[i].species as u8,
                );
            }
        }
    }

    // Feature: single-player-simulation-mvp, Property 15: Out-of-bounds set_cell is a no-op
    // **Validates: Requirements 6.6**
    proptest! {
        #[test]
        fn prop_out_of_bounds_set_cell_is_noop(
            x in 256usize..1024,
            y in 256usize..1024,
            species in 0u8..5,
        ) {
            let mut universe = Universe::new(256, 256);
            let cells_before: Vec<Cell> = universe.grid.cells.clone();

            universe.set_cell(x, y, species);

            prop_assert_eq!(universe.grid.cells, cells_before);
        }
    }
}

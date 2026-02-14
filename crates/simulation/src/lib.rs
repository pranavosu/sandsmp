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

        // Only do ghost work if ghosts exist on the grid.
        if self.has_ghosts() {
            self.move_ghosts(gen);
        }

        let w = self.width as i32;
        let h = self.height as i32;
        let scan_right = gen.is_multiple_of(2);

        for y in (0..h).rev() {
            if scan_right {
                for x in 0..w {
                    self.update_cell_at(x, y, gen);
                }
            } else {
                for x in (0..w).rev() {
                    self.update_cell_at(x, y, gen);
                }
            }
        }
    }

    /// Process a single cell during the tick scan.
    #[inline]
    fn update_cell_at(&mut self, x: i32, y: i32, gen: u8) {
        let cell = self.get(x, y);
        if cell.species == Species::Empty || cell.species == Species::Wall {
            return;
        }
        if cell.clock == gen {
            return;
        }
        let species = cell.species;
        let mut sand_api = api::SandApi::new(self, x, y, gen);
        elements::update_cell(species, &mut sand_api);
    }

    /// Move all ghost cells one step in a shared direction.
    ///
    /// Collects ghost positions, checks that every destination is empty,
    /// then performs the bulk swap. If any ghost cell is blocked, none move
    /// — this keeps the shape perfectly intact.
    fn move_ghosts(&mut self, gen: u8) {
        use crate::elements::ghost::{shared_direction, MOVE_DIVISOR};

        if gen % MOVE_DIVISOR != 0 {
            return;
        }

        let w = self.width as i32;
        let h = self.height as i32;

        // Collect all ghost cell positions with their group ID (ra).
        // Use a pre-allocated Vec to avoid repeated small allocations.
        let mut ghost_positions: Vec<(i32, i32, u8)> = Vec::new();
        for y in 0..h {
            for x in 0..w {
                let cell = self.get(x, y);
                if cell.species == Species::Ghost {
                    ghost_positions.push((x, y, cell.ra));
                }
            }
        }

        if ghost_positions.is_empty() {
            return;
        }

        // Collect unique group IDs.
        let mut groups: Vec<u8> = ghost_positions.iter().map(|&(_, _, g)| g).collect();
        groups.sort_unstable();
        groups.dedup();

        // Process each group independently.
        for group_id in groups {
            // Each group gets its own direction by mixing group_id into the hash.
            let (dx, dy) = shared_direction(gen, group_id);

            let group_cells: Vec<(i32, i32)> = ghost_positions
                .iter()
                .filter(|&&(_, _, g)| g == group_id)
                .map(|&(x, y, _)| (x, y))
                .collect();

            // Check that every destination is either empty or same-group ghost.
            let can_move = group_cells.iter().all(|&(x, y)| {
                let nx = x + dx;
                let ny = y + dy;
                if !self.in_bounds(nx, ny) {
                    return false;
                }
                let dest = self.get(nx, ny);
                dest.species == Species::Empty
                    || (dest.species == Species::Ghost && dest.ra == group_id)
            });

            if !can_move {
                continue;
            }

            // Sort so we process cells furthest in movement direction first.
            let mut positions = group_cells;
            positions.sort_by(|a, b| {
                let score_a: i32 = a.0 * dx + a.1 * dy;
                let score_b: i32 = b.0 * dx + b.1 * dy;
                score_b.cmp(&score_a)
            });

            for &(x, y) in &positions {
                let nx = x + dx;
                let ny = y + dy;
                let mut ghost_cell = self.get(x, y);
                ghost_cell.clock = gen;
                let dest_cell = self.get(nx, ny);
                self.set(x, y, dest_cell);
                self.set(nx, ny, ghost_cell);
            }
        }
    }

    /// Returns true if any ghost cell exists in the grid.
    fn has_ghosts(&self) -> bool {
        self.cells.iter().any(|c| c.species == Species::Ghost)
    }

    /// Update ghost eye cells so dark eyes shift toward the cursor
    /// (or the group's movement direction when no cursor is present).
    ///
    /// Each ghost group has two eye zones (left/right of center).
    /// Within each zone, a 2×2 block of cells is marked as active eyes
    /// (`RB_EYE`), positioned toward the look direction. The rest of
    /// the zone renders as body color.
    pub fn update_ghost_eyes(&mut self, cursor: Option<(i32, i32)>) {
        use crate::elements::ghost::{RB_EYE, RB_EYE_ZONE};

        let w = self.width as i32;
        let h = self.height as i32;

        // Collect ghost cells grouped by ra (group ID) using a fixed
        // 256-slot array instead of HashMap to avoid allocation.
        let mut group_data: [Vec<(i32, i32, u8)>; 256] =
            std::array::from_fn(|_| Vec::new());
        let mut has_any = false;
        for y in 0..h {
            for x in 0..w {
                let cell = self.get(x, y);
                if cell.species == Species::Ghost {
                    group_data[cell.ra as usize].push((x, y, cell.rb));
                    has_any = true;
                }
            }
        }

        if !has_any {
            return;
        }

        for cells in &group_data {
            if cells.is_empty() {
                continue;
            }
            // Compute group center.
            let (sum_x, sum_y, count) = cells.iter().fold((0i64, 0i64, 0i64), |(sx, sy, c), &(x, y, _)| {
                (sx + x as i64, sy + y as i64, c + 1)
            });
            if count == 0 {
                continue;
            }
            let cx = (sum_x / count) as i32;
            let cy = (sum_y / count) as i32;

            // Determine look direction: cursor if present, else center (neutral).
            let (look_dx, look_dy) = if let Some((mx, my)) = cursor {
                let dx = mx - cx;
                let dy = my - cy;
                (dx.signum(), dy.signum())
            } else {
                (0, 0)
            };

            // Collect eye-zone cells (rb == EYE_ZONE or EYE).
            let eye_cells: Vec<(i32, i32)> = cells
                .iter()
                .filter(|&&(_, _, rb)| rb == RB_EYE_ZONE || rb == RB_EYE)
                .map(|&(x, y, _)| (x, y))
                .collect();

            if eye_cells.is_empty() {
                continue;
            }

            // Split into left and right eye clusters based on x relative to center.
            let mut left_eye: Vec<(i32, i32)> = Vec::new();
            let mut right_eye: Vec<(i32, i32)> = Vec::new();
            for &(x, y) in &eye_cells {
                if x <= cx {
                    left_eye.push((x, y));
                } else {
                    right_eye.push((x, y));
                }
            }

            // For each eye cluster, place a 2×2 dark block shifted toward look direction.
            for eye_cluster in [&left_eye, &right_eye] {
                if eye_cluster.is_empty() {
                    continue;
                }

                // Find bounding box of this eye zone.
                let min_x = eye_cluster.iter().map(|&(x, _)| x).min().unwrap();
                let max_x = eye_cluster.iter().map(|&(x, _)| x).max().unwrap();
                let min_y = eye_cluster.iter().map(|&(_, y)| y).min().unwrap();
                let max_y = eye_cluster.iter().map(|&(_, y)| y).max().unwrap();

                let zone_w = max_x - min_x + 1;
                let zone_h = max_y - min_y + 1;

                // Eye block is 2×3. Compute its top-left corner within the zone.
                // Center of the zone, then offset by look direction, clamped to fit.
                let center_x = min_x + (zone_w - 2) / 2;
                let center_y = min_y + (zone_h - 3) / 2;

                let eye_x = (center_x + look_dx).max(min_x).min(max_x - 1);
                let eye_y = (center_y + look_dy).max(min_y).min(max_y - 2);

                // Build set of 2×3 eye positions.
                let eye_set: [(i32, i32); 6] = [
                    (eye_x, eye_y),
                    (eye_x + 1, eye_y),
                    (eye_x, eye_y + 1),
                    (eye_x + 1, eye_y + 1),
                    (eye_x, eye_y + 2),
                    (eye_x + 1, eye_y + 2),
                ];

                // Mark cells: eye positions get RB_EYE, rest get RB_EYE_ZONE.
                for &(x, y) in eye_cluster.iter() {
                    let mut cell = self.get(x, y);
                    cell.rb = if eye_set.contains(&(x, y)) {
                        RB_EYE
                    } else {
                        RB_EYE_ZONE
                    };
                    self.set(x, y, cell);
                }
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
    /// Two bytes per cell (species, rb), length = width × height × 2.
    /// Used by the GPU shader for color variation (fire gradient, smoke fade).
    cell_render_buffer: Vec<u8>,
    /// Monotonically increasing counter for ghost group IDs (1–255, wraps).
    next_ghost_group: u8,
    /// Cursor grid position for ghost eye tracking. `None` = no cursor visible.
    cursor: Option<(i32, i32)>,
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
        let cell_render_buffer = vec![0u8; width * height * 2];
        Self {
            grid,
            species_buffer,
            cell_render_buffer,
            next_ghost_group: 1,
            cursor: None,
        }
    }

    /// Advance the simulation by one tick and sync the render buffer.
    pub fn tick(&mut self) {
        self.grid.tick();
        // Only run expensive ghost eye tracking when ghosts exist.
        if self.grid.has_ghosts() {
            self.grid.update_ghost_eyes(self.cursor);
        }
        self.sync_render_buffers();
    }

    /// Set the cursor grid position for ghost eye tracking.
    pub fn set_cursor(&mut self, x: i32, y: i32) {
        self.cursor = Some((x, y));
    }

    /// Clear the cursor (ghosts revert to movement-direction facing).
    pub fn clear_cursor(&mut self) {
        self.cursor = None;
    }

    /// Paint a cell at `(x, y)` with the given species value.
    ///
    /// Non-empty elements only fill empty cells (no overwriting existing
    /// material). The eraser (species 0 / Empty) always overwrites.
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
            5 => Species::Ghost,
            6 => Species::Smoke,
            _ => return, // unknown species — ignore
        };

        // Eraser (Empty) always overwrites; other elements only fill empty cells.
        if s != Species::Empty
            && self.grid.get(x as i32, y as i32).species != Species::Empty
        {
            return;
        }

        let mut cell = Cell::new(s);
        // Sand uses rb for per-grain color variation (0–255).
        if s == Species::Sand {
            cell.rb = (x.wrapping_mul(137) ^ y.wrapping_mul(269)).wrapping_add(x.wrapping_add(y)) as u8;
        }
        // Fire starts with a lifetime counter so it doesn't vanish instantly.
        if s == Species::Fire {
            // Randomize lifetime using position as cheap entropy.
            cell.rb = 20_u8.wrapping_add(((x ^ y) % 30) as u8);
            cell.ra = (x.wrapping_mul(7) ^ y.wrapping_mul(13)) as u8;
        }
        // Water uses ra parity as persistent flow direction. Seed from
        // position so adjacent particles start with varied directions.
        if s == Species::Water {
            cell.ra = (x ^ y) as u8;
        }
        // Smoke starts with a lifetime for fade-out.
        if s == Species::Smoke {
            cell.rb = 80_u8.wrapping_add(((x ^ y) % 120) as u8);
            cell.ra = (x ^ y) as u8;
        }
        self.grid.set(x as i32, y as i32, cell);
    }

    /// Allocate a new ghost group ID (1–255, wraps past 0).
    pub fn alloc_ghost_group(&mut self) -> u8 {
        let id = self.next_ghost_group;
        self.next_ghost_group = self.next_ghost_group.wrapping_add(1);
        // Skip 0 so group 0 is never used (reserve for "no group").
        if self.next_ghost_group == 0 {
            self.next_ghost_group = 1;
        }
        id
    }

    /// Place a ghost cell with a specific group ID stored in `ra`.
    /// The `rb` field encodes the cell's visual role (body/eye/pupil).
    /// Only fills empty cells — existing material is not overwritten.
    pub fn set_ghost(&mut self, x: usize, y: usize, group: u8, rb: u8) {
        if x >= self.grid.width || y >= self.grid.height {
            return;
        }
        if self.grid.get(x as i32, y as i32).species != Species::Empty {
            return;
        }
        let mut cell = Cell::new(Species::Ghost);
        cell.ra = group;
        cell.rb = rb;
        self.grid.set(x as i32, y as i32, cell);
    }

    /// Pointer to the species-only byte buffer for GPU texture upload.
    #[must_use]
    pub fn species_ptr(&self) -> *const u8 {
        self.species_buffer.as_ptr()
    }

    /// Pointer to the 2-byte-per-cell render buffer (species, rb).
    ///
    /// Layout: `[species_0, rb_0, species_1, rb_1, ...]`
    /// Length: `width × height × 2` bytes. Upload as an `rg8uint` texture.
    #[must_use]
    pub fn cell_render_ptr(&self) -> *const u8 {
        self.cell_render_buffer.as_ptr()
    }

    #[must_use]
    pub fn width(&self) -> usize {
        self.grid.width
    }

    #[must_use]
    pub fn height(&self) -> usize {
        self.grid.height
    }
}

impl Universe {
    /// Sync both species buffer and cell render buffer in a single pass.
    fn sync_render_buffers(&mut self) {
        for (i, cell) in self.grid.cells.iter().enumerate() {
            let sp = cell.species as u8;
            self.species_buffer[i] = sp;
            self.cell_render_buffer[i * 2] = sp;
            self.cell_render_buffer[i * 2 + 1] = cell.rb;
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
            Just(Species::Ghost),
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
                (0usize..256, 0usize..256, 0u8..7),
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

    #[test]
    fn set_cell_does_not_overwrite_existing_element() {
        let mut universe = Universe::new(16, 16);
        // Place sand at (5, 5).
        universe.set_cell(5, 5, 1); // Sand
        assert_eq!(universe.grid.get(5, 5).species, Species::Sand);

        // Try to place water on top — should be ignored.
        universe.set_cell(5, 5, 2); // Water
        assert_eq!(universe.grid.get(5, 5).species, Species::Sand);
    }

    #[test]
    fn set_cell_eraser_overwrites_existing_element() {
        let mut universe = Universe::new(16, 16);
        universe.set_cell(5, 5, 1); // Sand
        assert_eq!(universe.grid.get(5, 5).species, Species::Sand);

        // Eraser (species 0) should clear it.
        universe.set_cell(5, 5, 0); // Empty
        assert_eq!(universe.grid.get(5, 5).species, Species::Empty);
    }

    #[test]
    fn set_cell_fills_empty_cells() {
        let mut universe = Universe::new(16, 16);
        // Empty cell should accept any element.
        universe.set_cell(3, 3, 2); // Water
        assert_eq!(universe.grid.get(3, 3).species, Species::Water);
    }

    #[test]
    fn set_ghost_does_not_overwrite_existing_element() {
        let mut universe = Universe::new(16, 16);
        universe.set_cell(5, 5, 1); // Sand
        assert_eq!(universe.grid.get(5, 5).species, Species::Sand);

        // Ghost placement on occupied cell should be ignored.
        universe.set_ghost(5, 5, 1, 0);
        assert_eq!(universe.grid.get(5, 5).species, Species::Sand);
    }
}

//! Regression test: water should level out next to solid obstacles.

#[cfg(test)]
mod tests {
    use crate::cell::{Cell, Species};
    use crate::Grid;

    /// Helper: find the topmost water y in each column.
    fn surface_levels(grid: &Grid) -> Vec<Option<i32>> {
        let w = grid.width as i32;
        let h = grid.height as i32;
        (0..w)
            .map(|x| (0..h).find(|&y| grid.get(x, y).species == Species::Water))
            .collect()
    }

    /// Helper: print a slice of the grid for debugging.
    fn dump(grid: &Grid, y_range: std::ops::Range<i32>) {
        for y in y_range {
            let mut row = String::new();
            for x in 0..grid.width as i32 {
                let c = grid.get(x, y);
                row.push(match c.species {
                    Species::Empty => '.',
                    Species::Water => '~',
                    Species::Wall => '#',
                    Species::Sand => 'S',
                    _ => '?',
                });
            }
            eprintln!("y={:2}: {}", y, row);
        }
    }

    /// Large-scale test: water pooled on both sides of a tall sand
    /// pyramid (64×64 grid). Each body should independently level.
    #[test]
    fn water_levels_beside_large_pyramid() {
        let w = 64;
        let h = 64;
        let mut grid = Grid::new(w, h);

        for x in 0..w as i32 {
            grid.set(x, 63, Cell::wall());
        }

        // Sand pyramid: center x=32, peak y=40, base y=62
        let peak_y = 40;
        let base_y = 62;
        for row in 0..=(base_y - peak_y) {
            let y = peak_y + row;
            let half = row as i32;
            for x in (32 - half).max(0)..=(32 + half).min(63) {
                grid.set(x, y, Cell::new(Species::Sand));
            }
        }

        // Water on the left: fill to the sand edge, 10 rows
        for y in 53..=62 {
            for x in 0..w as i32 {
                if grid.get(x, y).species != Species::Empty {
                    break;
                }
                let mut cell = Cell::new(Species::Water);
                cell.ra = (x as u8) ^ (y as u8);
                grid.set(x, y, cell);
            }
        }

        // Water on the right: 6 rows (less water = different level)
        for y in 57..=62 {
            for x in (0..w as i32).rev() {
                if grid.get(x, y).species != Species::Empty {
                    break;
                }
                let mut cell = Cell::new(Species::Water);
                cell.ra = (x as u8) ^ (y as u8);
                grid.set(x, y, cell);
            }
        }

        let initial_water = grid.cells.iter().filter(|c| c.species == Species::Water).count();

        for _ in 0..5000 {
            grid.tick();
        }

        let final_water = grid.cells.iter().filter(|c| c.species == Species::Water).count();
        assert_eq!(initial_water, final_water, "water count must be conserved");

        eprintln!("\n--- Pyramid test ---");
        dump(&grid, 50..64);

        let levels = surface_levels(&grid);

        // Check left and right bodies independently
        let left_y: Vec<i32> = levels[..20].iter().filter_map(|s| *s).collect();
        let right_y: Vec<i32> = levels[44..].iter().filter_map(|s| *s).collect();

        if !left_y.is_empty() {
            let min = *left_y.iter().min().unwrap();
            let max = *left_y.iter().max().unwrap();
            eprintln!("Left body: min={}, max={}, diff={}", min, max, max - min);
            assert!(max - min <= 1, "left water not level: diff={}", max - min);
        }

        if !right_y.is_empty() {
            let min = *right_y.iter().min().unwrap();
            let max = *right_y.iter().max().unwrap();
            eprintln!("Right body: min={}, max={}, diff={}", min, max, max - min);
            assert!(max - min <= 1, "right water not level: diff={}", max - min);
        }
    }

    /// Water pooled against a wall should level within ±1.
    #[test]
    fn water_levels_against_wall() {
        let w = 32;
        let h = 32;
        let mut grid = Grid::new(w, h);

        for x in 0..w as i32 {
            grid.set(x, 31, Cell::wall());
        }
        for y in 0..32 {
            grid.set(0, y, Cell::wall());
        }

        // Water stacked against the wall: 8 wide × 7 tall = 56 cells
        for x in 1..9 {
            for y in 24..=30 {
                let mut cell = Cell::new(Species::Water);
                cell.ra = (x as u8) ^ (y as u8);
                grid.set(x, y, cell);
            }
        }

        let initial_water = grid.cells.iter().filter(|c| c.species == Species::Water).count();

        for _ in 0..10000 {
            grid.tick();
        }

        let final_water = grid.cells.iter().filter(|c| c.species == Species::Water).count();
        assert_eq!(initial_water, final_water, "water count must be conserved");

        eprintln!("\n--- Wall test ---");
        dump(&grid, 26..32);

        let levels = surface_levels(&grid);
        let water_y: Vec<i32> = levels.iter().filter_map(|s| *s).collect();
        assert!(!water_y.is_empty(), "no water found");

        let min = *water_y.iter().min().unwrap();
        let max = *water_y.iter().max().unwrap();
        eprintln!("wall: min={}, max={}, diff={}", min, max, max - min);

        assert!(
            max - min <= 1,
            "water not level near wall: diff={}, surfaces={:?}",
            max - min, levels,
        );
    }
}

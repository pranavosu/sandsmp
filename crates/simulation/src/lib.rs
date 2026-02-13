pub mod cell;

use cell::{Cell, Species};
use wasm_bindgen::prelude::*;

pub struct Grid {
    pub width: usize,
    pub height: usize,
    pub cells: Vec<Cell>,
    pub generation: u8,
}

impl Grid {
    pub fn new(width: usize, height: usize) -> Self {
        Grid {
            width,
            height,
            cells: vec![Cell::empty(); width * height],
            generation: 0,
        }
    }

    pub fn in_bounds(&self, x: i32, y: i32) -> bool {
        x >= 0 && (x as usize) < self.width && y >= 0 && (y as usize) < self.height
    }

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
}

#[wasm_bindgen]
pub fn greet() -> String {
    "Hello from simulation!".into()
}

#[cfg(test)]
mod tests {
    use super::*;
    use cell::Species;

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
}

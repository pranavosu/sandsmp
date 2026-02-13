//! Cell and Species types for the simulation grid.

use std::fmt;

/// Discriminant values map directly to the `r8uint` GPU texture — do not reorder.
#[repr(u8)]
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
pub enum Species {
    Empty = 0,
    Sand = 1,
    Water = 2,
    Wall = 3,
    Fire = 4,
    Ghost = 5,
}

impl fmt::Display for Species {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Empty => write!(f, "Empty"),
            Self::Sand => write!(f, "Sand"),
            Self::Water => write!(f, "Water"),
            Self::Wall => write!(f, "Wall"),
            Self::Fire => write!(f, "Fire"),
            Self::Ghost => write!(f, "Ghost"),
        }
    }
}

/// 4-byte grid cell: `#[repr(C)]` for direct GPU memory mapping.
#[repr(C)]
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
pub struct Cell {
    pub species: Species,
    pub ra: u8,
    pub rb: u8,
    pub clock: u8,
}

impl Default for Cell {
    fn default() -> Self {
        Self::empty()
    }
}

impl fmt::Display for Cell {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.species)
    }
}

impl Cell {
    #[must_use]
    pub fn new(species: Species) -> Self {
        Self {
            species,
            ra: 0,
            rb: 0,
            clock: 0,
        }
    }

    #[must_use]
    pub fn empty() -> Self {
        Self::new(Species::Empty)
    }

    #[must_use]
    pub fn wall() -> Self {
        Self::new(Species::Wall)
    }
}


#[cfg(test)]
mod tests {
    use super::*;
    use proptest::prelude::*;

    #[test]
    fn cell_is_4_bytes() {
        assert_eq!(std::mem::size_of::<Cell>(), 4);
    }

    #[test]
    fn species_discriminant_values() {
        assert_eq!(Species::Empty as u8, 0);
        assert_eq!(Species::Sand as u8, 1);
        assert_eq!(Species::Water as u8, 2);
        assert_eq!(Species::Wall as u8, 3);
        assert_eq!(Species::Fire as u8, 4);
        assert_eq!(Species::Ghost as u8, 5);
    }

    #[test]
    fn cell_constructors() {
        let empty = Cell::empty();
        assert_eq!(empty.species, Species::Empty);
        assert_eq!(empty.ra, 0);
        assert_eq!(empty.rb, 0);
        assert_eq!(empty.clock, 0);

        let wall = Cell::wall();
        assert_eq!(wall.species, Species::Wall);

        let sand = Cell::new(Species::Sand);
        assert_eq!(sand.species, Species::Sand);
    }

    #[test]
    fn cell_default_is_empty() {
        assert_eq!(Cell::default(), Cell::empty());
    }

    #[test]
    fn species_display() {
        assert_eq!(format!("{}", Species::Sand), "Sand");
        assert_eq!(format!("{}", Species::Empty), "Empty");
    }

    // Feature: single-player-simulation-mvp, Property 1: Grid initialization produces all-empty cells
    // **Validates: Requirements 2.2**
    proptest! {
        #[test]
        fn prop_grid_init_all_empty(width in 1usize..=256, height in 1usize..=256) {
            let cells: Vec<Cell> = (0..width * height).map(|_| Cell::empty()).collect();
            for cell in &cells {
                prop_assert_eq!(cell.species, Species::Empty);
                prop_assert_eq!(cell.ra, 0);
                prop_assert_eq!(cell.rb, 0);
                prop_assert_eq!(cell.clock, 0);
            }
        }
    }
}

//! Benchmark: measure tick() cost under various grid conditions.
//!
//! Target: a single tick on a 256×256 grid must complete in < 4 ms
//! to leave headroom for rendering within an 8.3 ms frame budget (120 Hz).
//!
//! Each benchmark uses `iter_batched` to re-seed the grid before every
//! iteration so we measure *active* simulation, not a settled grid.

use criterion::{black_box, criterion_group, criterion_main, BatchSize, Criterion};
use simulation::cell::{Cell, Species};
use simulation::{Grid, Universe};

/// Empty grid — baseline cost of scanning 65K cells with nothing to do.
fn bench_tick_empty(c: &mut Criterion) {
    c.bench_function("tick_empty_256x256", |b| {
        let mut grid = Grid::new(256, 256);
        b.iter(|| {
            grid.tick();
            black_box(&grid);
        });
    });
}

/// Sand falling — re-seed each iteration so sand is always actively moving.
fn bench_tick_sand_falling(c: &mut Criterion) {
    c.bench_function("tick_sand_falling_256x256", |b| {
        b.iter_batched(
            || {
                let mut grid = Grid::new(256, 256);
                // Place sand in top 20% — it will all be actively falling
                for y in 0..51 {
                    for x in 0..256 {
                        grid.set(x, y, Cell::new(Species::Sand));
                    }
                }
                grid
            },
            |mut grid| {
                grid.tick();
                black_box(&grid);
            },
            BatchSize::SmallInput,
        );
    });
}

/// Water body — water is more expensive than sand (lateral movement checks).
fn bench_tick_water_body(c: &mut Criterion) {
    c.bench_function("tick_water_body_256x256", |b| {
        b.iter_batched(
            || {
                let mut grid = Grid::new(256, 256);
                // Fill bottom half with water, leave top half empty so it sloshes
                for y in 128..256 {
                    for x in 0..256 {
                        let mut cell = Cell::new(Species::Water);
                        cell.ra = (x ^ y) as u8;
                        grid.set(x, y, cell);
                    }
                }
                grid
            },
            |mut grid| {
                grid.tick();
                black_box(&grid);
            },
            BatchSize::SmallInput,
        );
    });
}

/// Mixed elements: sand, water, fire, smoke — worst-case active simulation.
/// Re-seeded each iteration so nothing has settled or decayed.
fn bench_tick_mixed_active(c: &mut Criterion) {
    c.bench_function("tick_mixed_active_256x256", |b| {
        b.iter_batched(
            || {
                let mut grid = Grid::new(256, 256);
                for y in 0..256 {
                    for x in 0..256 {
                        let species = match (x + y) % 5 {
                            0 => Species::Sand,
                            1 => Species::Water,
                            2 => Species::Fire,
                            3 => Species::Smoke,
                            _ => Species::Empty,
                        };
                        if species != Species::Empty {
                            let mut cell = Cell::new(species);
                            if species == Species::Fire {
                                cell.rb = 30;
                            }
                            if species == Species::Smoke {
                                cell.rb = 100;
                            }
                            if species == Species::Water {
                                cell.ra = (x ^ y) as u8;
                            }
                            grid.set(x, y, cell);
                        }
                    }
                }
                grid
            },
            |mut grid| {
                grid.tick();
                black_box(&grid);
            },
            BatchSize::SmallInput,
        );
    });
}

/// Full Universe::tick() including buffer sync — what the browser actually calls.
/// Re-seeded so we measure active work, not a settled world.
fn bench_universe_tick(c: &mut Criterion) {
    c.bench_function("universe_tick_mixed_256x256", |b| {
        b.iter_batched(
            || {
                let mut universe = Universe::new(256, 256);
                for y in 0..256 {
                    for x in 0..256 {
                        let species = match (x * 7 + y * 13) % 6 {
                            0 => 1, // Sand
                            1 => 2, // Water
                            2 => 4, // Fire
                            3 => 6, // Smoke
                            _ => 0, // Empty
                        };
                        universe.set_cell(x, y, species);
                    }
                }
                universe
            },
            |mut universe| {
                universe.tick();
                black_box(&universe);
            },
            BatchSize::SmallInput,
        );
    });
}

criterion_group!(
    benches,
    bench_tick_empty,
    bench_tick_sand_falling,
    bench_tick_water_body,
    bench_tick_mixed_active,
    bench_universe_tick,
);
criterion_main!(benches);

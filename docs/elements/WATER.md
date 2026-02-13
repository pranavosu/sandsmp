# Water simulation in falling sand games

**Water is the hardest element to simulate well in a falling sand game.** Sand obeys simple gravity rules — fall down, slide diagonally — and quickly reaches a stable state. Water must do all of that *plus* spread horizontally, equalize across containers, and interact with other fluids by density. Most implementations solve the easy parts (downward flow, horizontal spread) and accept fundamental compromises on the hard part (pressure-driven leveling). This report covers how real games — Sandspiel, Noita, and The Powder Toy — handle water, along with the major algorithmic approaches to the unsolved problems.

---

## Sand and water differ by exactly one rule

In cellular automata terms, the difference between sand and water is precisely **horizontal movement**. Sand checks two directions: straight down, then diagonally down. Water checks those same directions, then adds a pure sideways check. This single addition transforms the behavior from a granular solid that piles into pyramids to a liquid that fills containers.

The canonical movement priority for sand is: **(1)** move down if empty, **(2)** move diagonally down-left or down-right (randomized) if empty, **(3)** if sitting on a lighter fluid, swap positions. Sand never moves horizontally on its own. The canonical priority for water adds: **(3)** move left or right if empty, after exhausting all downward options. Most implementations randomize the left/right check order every tick to prevent directional bias from the grid's scan direction.

Here is the concrete pattern used across winter.dev, W-Shadow.com, and multiple open-source implementations:

```
function update_sand(x, y):
    dir = random_choice(-1, +1)
    if is_empty(x, y+1):       move to (x, y+1)       // fall down
    elif is_empty(x+dir, y+1): move to (x+dir, y+1)   // slide diagonal
    else: stay

function update_water(x, y):
    dir = random_choice(-1, +1)
    if is_empty(x, y+1):       move to (x, y+1)       // fall down
    elif is_empty(x+dir, y+1): move to (x+dir, y+1)   // diagonal down (preferred)
    elif is_empty(x-dir, y+1): move to (x-dir, y+1)   // diagonal down (other)
    elif is_empty(x+dir, y):   move to (x+dir, y)      // spread sideways (preferred)
    elif is_empty(x-dir, y):   move to (x-dir, y)      // spread sideways (other)
    else: stay
```

The `random_choice` for direction is critical. Without it, the left-to-right scan order of most simulation loops causes water to flow preferentially in one direction. Some implementations alternate the entire row's scan direction per frame instead of randomizing per cell. Noita randomizes or alternates the left/right check per pixel or per frame to combat this asymmetry.

One pixel per tick is the standard horizontal speed in most implementations. This means water in a wide container takes many frames to spread across — visually slow but stable. Velocity-based approaches (discussed below) allow multi-cell movement per tick for more dynamic flow.

---

## Sandspiel's water: neighbor checks plus a GPU fluid overlay

Sandspiel (by Max Bittker) stores each cell as a compact **32-bit struct** — species enum, two 8-bit registers (`ra` and `rb`), and a `clock` byte for preventing double-updates. The entire grid maps directly to a WebGL RGBA texture with zero memory copying, which is an elegant rendering optimization.

Sand's update function is straightforward:

```rust
pub fn update_sand(cell: Cell, mut api: SandApi) {
    let dx = api.rand_dir_2();  // returns -1, 0, or 1
    let nbr = api.get(0, 1);
    if nbr.species == Species::Empty {
        api.set(0, 0, EMPTY_CELL);
        api.set(0, 1, cell);
    } else if api.get(dx, 1).species == Species::Empty {
        api.set(0, 0, EMPTY_CELL);
        api.set(dx, 1, cell);
    } else if nbr.species == Species::Water || nbr.species == Species::Oil {
        api.set(0, 0, nbr);  // swap — sand sinks through fluid
        api.set(0, 1, cell);
    } else {
        api.set(0, 0, cell);
    }
}
```

Water's update is significantly more complex and reveals several clever design choices. It checks **four movement phases in strict priority order** using early returns: fall straight down, fall diagonally in a random direction, fall diagonally in the opposite direction, then spread horizontally. Two details stand out.

First, **water uses `cell.ra % 2` as a persistent horizontal flow direction**. The `ra` register normally stores visual grain data, but its parity bit determines whether a water particle prefers flowing left or right. This persistence prevents the jittery oscillation that occurs when direction is purely random each frame. Occasionally (1-in-20 chance during freefall), `ra` is re-randomized to prevent lockstep behavior across large water bodies.

Second, **water checks two cells horizontally** (one cell over and two cells over) during the spreading phase, allowing faster lateral flow than the one-cell-per-tick standard. This is a practical optimization for visual responsiveness in a small 300×300 grid.

Water also performs **density displacement**: when falling, it can swap positions with Oil (which is lighter), making oil float on water automatically. This displacement is hardcoded per species rather than using a general density value — Sand sinks through Water/Gas/Oil/Acid, Water sinks through Oil, and so on.

The most surprising aspect of Sandspiel is its **separate GPU-based Navier-Stokes fluid simulation** running in WebGL, adapted from Pavel Dobryakov's implementation. This provides wind vectors and pressure data that influence particle movement. Each species has a different wind sensitivity threshold (Gas at 5 is lightest, Oil at 50 is heaviest). Bittker has noted this fluid overlay is what makes Sandspiel's simulation "stand out" — the particle movement itself is purely cellular automata, but the wind layer adds physically convincing macro-scale flow behavior. The particle simulation alone does **not** solve pressure equalization or water leveling.

---

## Why water cannot find its level with local rules alone

The "water finding its level" problem is the fundamental unsolved challenge in falling sand fluid simulation. In a U-tube scenario — two connected vertical chambers joined by a horizontal pipe at the bottom — pouring water into one side should cause both sides to equalize. Real physics achieves this through hydrostatic pressure: the weight of the water column pushes fluid through the connecting pipe and up the other side.

**Cellular automata rules that only check immediate neighbors cannot drive water upward.** A water particle sitting in a full pipe below a water column has no empty neighbors below or beside it. It has no information about the water level fifty cells above. Even if it "knows" there's pressure, the cell above it is also full of water — there's nowhere to go. The information that one column is taller than another must propagate through the entire body of water to reach the bottom of the pipe, and even then, the particle at the bottom has no mechanism to push upward through occupied cells.

This locality constraint means naive implementations exhibit several artifacts. Water poured into one side of a U-tube stays on that side. **Water bodies form uneven "staircase" surfaces** because horizontal spreading is one pixel at a time — a pour point creates a peak that slowly flattens. Large water bodies never fully settle because surface particles continue oscillating left and right indefinitely, defeating dirty-rect optimization.

Multiple approaches exist to address this, each with significant tradeoffs.

---

## Five approaches to pressure and leveling

### The compression model: encoding pressure in mass

Tom Forsyth's seminal paper "Cellular Automata for Physical Modelling" describes the most elegant solution. Instead of treating water cells as binary (full or empty), **each cell stores a floating-point mass value**. Water is treated as *slightly compressible*: a cell at the bottom of a deep column holds slightly more mass than its capacity (e.g., **1–2% extra per layer of depth**). This tiny compression encodes pressure implicitly.

The key insight is the `get_stable_state_bottom` function, which determines how mass should distribute between two vertically adjacent cells:

```
MaxMass = 1.0;  MaxCompress = 0.02

get_stable_state_bottom(total_mass):
    if total_mass <= 1: return total_mass     // all goes to bottom
    if total_mass < 2*MaxMass + MaxCompress:
        return (MaxMass² + total_mass*MaxCompress) / (MaxMass + MaxCompress)
    else: return (total_mass + MaxCompress) / 2
```

In a static water body, cells at the top hold exactly 1.0, the next layer holds 1.01, then 1.02, and so on. When one column is taller, its bottom cells hold more mass than the adjacent column's bottom cells. The excess flows horizontally, then upward through the shorter column because cells can only hold slightly more than 1.0 — the excess pushes up. Communicating vessels work automatically. The W-Shadow.com implementation demonstrates this approach with complete source code.

The tradeoff is that **cells now store continuous values instead of discrete particles**, which complicates rendering (partial-fill cells need interpolation) and breaks the simple swap-based displacement model. Convergence is still limited to roughly one cell per frame, meaning large bodies take many frames to equalize.

### The Powder Toy's dual-grid pressure system

The Powder Toy takes a different approach: a **separate coarser pressure grid** overlaid on the particle grid. The particle grid runs at full pixel resolution (612×384), while pressure (`pv[][]`), velocity (`vx[][]`, `vy[][]`), and ambient heat (`hv[][]`) operate on **4×4 pixel blocks**. Pressure gradients generate velocity; velocity advects pressure. This creates a genuine fluid dynamics layer.

Each element has properties controlling its interaction with the air system — `Advection` (how much air carries the particle), `AirDrag` (how much the particle drags air), `AirLoss` (velocity damping), and `HotAir` (pressure generated by the element). Particles query the pressure grid via `pv[y/CELL][x/CELL]`, converting pixel coordinates to cell coordinates.

However, even this system doesn't fully solve water leveling. TPT includes a separate **`flood_water()` BFS function** that finds connected water bodies and redistributes water to equalize surface levels. This feature is **disabled by default** because it causes extreme lag with large water bodies. When enabled, it triggers with only a **1-in-200 chance per particle per frame** to throttle the computational cost. The BFS approach gives accurate leveling but is fundamentally expensive — O(n) per water body — and creates visually discontinuous "teleporting" of water particles.

### Horizontal velocity and momentum

Rather than solving pressure globally, some implementations give each water particle a **persistent velocity direction**. When a particle moves horizontally and hits an obstacle at the same height, it reverses its stored direction and pauses for one frame (preventing oscillation). This creates wave-like behavior and helps water distribute more naturally than pure random direction choice.

The Macuyiko blog's implementation stores a `lastvel` direction per pixel:

```
firstSide = pixel.lastvel   // +1 or -1
if bump_at_same_height:
    pixel.lastvel = -pixel.lastvel
    skip_this_frame          // prevents standing wave oscillation
```

A more aggressive velocity approach (demonstrated in jason.today's falling sand series) gives particles actual acceleration and multi-cell-per-frame movement:

```
particle.velocity += acceleration
updateCount = floor(abs(velocity)) + probabilistic_extra
for i in range(updateCount):
    if can_move: move one cell in velocity direction
    else: reset velocity; break
```

This allows water to move **up to 8 cells per frame**, making flow look dramatically more fluid. The tradeoff is increased complexity in collision handling and the risk of particles tunneling through thin walls if velocity exceeds wall thickness.

### BFS/flood-fill redistribution

The brute-force approach: periodically scan connected water bodies with breadth-first search, calculate the target water level (total water cells divided by container width), and teleport water from overfull columns to underfull ones. TPT's `flood_water()` implements exactly this. It works perfectly for static equalization but is **computationally prohibitive** for real-time simulation and produces unnatural instant redistribution rather than visible flow. Every implementation that uses this approach throttles it heavily.

### Column-based pressure counting

A simpler heuristic: for each water cell, count the number of water cells directly above it. Use this count as a proxy for pressure. Cells with higher pressure scores preferentially push water sideways or even upward. This is cheaper than full BFS but only works for simple vertical columns — it fails for diagonal or winding water paths where the "column above" doesn't accurately reflect the connected water body's height.

---

## Noita chose speed over physical accuracy

Noita's "Falling Everything" engine, built in custom C++, makes a deliberate architectural choice: **no pressure simulation at all**. Water falls down and spreads horizontally. It cannot rise through submerged connections. This is a known and accepted limitation — players have documented scenarios where lava or water fails to fill connected lower passages.

What makes Noita's water look convincing despite this limitation is a combination of techniques. The engine uses a **single-buffered, pixels-as-objects** approach (not a traditional double-buffered CA). Pixels move within a single grid array during the update step, processed bottom-up. Critically, **pixels can move up to 32 cells per frame** — a direct consequence of the multithreading architecture rather than a physics feature. This extended range means water flows rapidly through open channels using ray-cast-style obstacle checking.

When the player enters liquid, surrounding pixels are temporarily ejected into a **particle simulation with real velocity and gravity**. These displaced particles arc through the air and eventually settle back into the grid. This hybrid approach makes splashes and dynamic interactions look far more convincing than pure grid simulation, masking the absence of pressure physics.

Density displacement is simple: when a liquid pixel checks below and finds a lighter liquid, they swap. As Petri Purho explained: "To make liquids have different densities you just compare the densities when figuring out if you can go down (and then swap the pixels)." No intermediate state or complex calculation needed — the single-buffer approach makes swapping trivial.

Noita's performance architecture is its most impressive technical achievement. The world uses **512×512 chunks for storage** (about 12 active simultaneously), subdivided into **64×64 chunks for simulation**. Each chunk maintains a dirty rectangle tracking which pixels actually need updating — static materials are never processed. Multithreading uses a **four-pass checkerboard pattern**: each pass selects non-overlapping chunks, and each selected chunk can update pixels within its bounds plus 32 pixels outward. The cross-shaped update regions don't overlap between threads, eliminating the need for locks or atomics entirely.

---

## Water is the enemy of dirty-rect optimization

Dirty-rect optimization — only updating pixels that have recently changed — is the single biggest performance win in falling sand games. Sand benefits enormously: once a pile forms, its particles stop moving, and the dirty rect shrinks to nothing. **Water undermines this completely** because surface particles oscillate horizontally every frame, keeping the entire water body's chunk permanently active.

Several mitigation strategies exist. **Static flags** mark particles that haven't moved for N frames, skipping them until a neighbor changes. This works for interior water cells but surface cells resist settling. **Probabilistic updates** (TPT's 1/200 trigger rate for equalization) trade accuracy for performance. **Settling heuristics** detect when a particle has been moving horizontally without height change for many frames and force it to sleep. Noita's **32-pixel movement cap** bounds how far chunk activation can spread per frame.

The scan direction itself matters for performance. Processing left-to-right on every frame causes water to flow faster rightward because moved particles are encountered again by the advancing scan line. The `clock` field in Sandspiel (and equivalent frame-counter flags in other engines) prevents this double-movement, but directional bias still emerges in subtler ways. The standard fix is alternating scan direction per row, either randomly or by frame parity.

For rendering, Sandspiel's approach is notable: the cell array is passed directly to WebGL as an RGBA texture (each 32-bit Cell maps to one RGBA pixel) with zero memory copying, keeping render cost under 1ms regardless of how many cells are active.

---

## A complete water update function

Synthesizing across all studied implementations, here is a robust water update function incorporating the key patterns:

```
function update_water(x, y, cell):
    dir = persistent_direction(cell)   // from stored state, not random each frame
    
    // Phase 1: Gravity — fall down, displacing lighter fluids
    below = get(x, y+1)
    if below is EMPTY:
        move(x, y → x, y+1)
        return
    if below.density < cell.density and below.is_liquid:
        swap(x,y ↔ x,y+1)            // density displacement
        return
    
    // Phase 2: Diagonal fall (both directions)
    if get(x+dir, y+1) is EMPTY:
        move(x,y → x+dir, y+1)
        return
    if get(x-dir, y+1) is EMPTY:
        move(x,y → x-dir, y+1)
        return
    
    // Phase 3: Horizontal spread
    if get(x+dir, y) is EMPTY:
        move(x,y → x+dir, y)
        return
    if get(x-dir, y) is EMPTY:
        move(x,y → x-dir, y)
        return
    
    // Phase 4: Blocked — flip persistent direction for next frame
    cell.direction = -dir
    mark_static_candidate(x, y)
```

The persistent direction (stored in a register bit, as Sandspiel does with `ra % 2`) prevents oscillation. Flipping direction on blockage creates wave-like propagation. The density comparison in Phase 1 handles multi-fluid layering — water sinks below oil, sand sinks below water — using simple greater-than checks and swaps.

## Conclusion

The fundamental tension in falling sand water simulation is **locality versus global behavior**. Real water pressure is a global phenomenon — the level in one container depends on every connected container. Cellular automata are inherently local. Every solution to this mismatch involves either accepting the limitation (Noita), adding a separate global system (Powder Toy's pressure grid, BFS flood-fill), or encoding pressure implicitly in per-cell mass (Forsyth's compression model).

For most games, the pragmatic answer is Noita's: skip pressure, make water fall and spread quickly, use particle effects for visual dynamism, and design levels that don't expose the limitation. Sandspiel adds a GPU fluid overlay that provides macro-scale flow without solving the CA problem directly. The Powder Toy's dual-grid approach is the most physically complete but carries significant performance cost. The compression model is theoretically elegant but shifts the entire simulation from discrete particles to continuous fluid dynamics, which is a different genre of simulation entirely.

The most impactful single improvement to a naive water implementation is **persistent directional state per particle** — storing which way a water cell was last flowing and continuing in that direction until blocked. This simple addition, requiring just one bit of storage, transforms jittery oscillation into convincing wave-like spreading and is used in both Sandspiel and multiple independent implementations.
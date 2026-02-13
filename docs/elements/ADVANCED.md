# Advanced element simulation in falling sand games

**Fire, gas, electricity, and temperature are not materials — they're processes**, and simulating them as cell types in a discrete grid requires clever tricks that push cellular automata far beyond simple sand-and-water physics. Games like Noita, The Powder Toy (TPT), and Sandspiel each solve these problems differently, trading off between physical realism, emergent complexity, and performance. This report breaks down the specific implementation techniques behind 10 categories of advanced simulation, drawn from GDC talks, open-source code, and developer writeups.

The core insight across all these systems: **simple local rules, applied consistently to every cell, generate complexity that even developers don't anticipate**. Noita's Petri Purho describes discovering emergent scenarios hundreds of hours into development. The challenge is choosing which rules to implement, how to encode them efficiently, and where to cheat.

---

## Fire is a process pretending to be a particle

Fire is the single hardest element to get right in a falling sand game because it's not a substance — it's a chemical reaction. Every major implementation solves this differently, but all share a core pattern: **fire is a temporary cell type with a countdown lifetime that checks random neighbors for ignitable fuel**.

**Noita** treats fire as one of exactly four cell types (alongside `liquid`, `solid`, and `gas`). Fire is so fundamental to the engine that removing the fire material definition crashes the game on startup. Each fire cell carries properties like `fire_hp` (burn duration), `autoignition_temperature` (spontaneous ignition threshold), `generates_flames`, and `generates_smoke`. The spread algorithm is elegantly simple: each frame, a fire cell looks in a **random direction** and checks whether the adjacent pixel is flammable. Oil ignites; water does not. If fire tries to ignite water, it converts the water to steam instead. Wood burning works by waiting "until the fire has been burning long enough and then you destroy that pixel," as Purho described at GDC.

**The Powder Toy** implements fire as `TYPE_GAS` with `PROP_LIFE_DEC` (life decrements each frame) and `PROP_LIFE_KILL` (dies at life=0). Fire spawns with a life value of **120–259 frames** depending on its fuel source. The spread mechanic is more sophisticated than Noita's: TPT's ignition probability is `(Flammable + pressure × 10) / 1000` per neighbor per frame, meaning **higher air pressure increases flammability** — a physically motivated detail. When fire ignites a neighbor, the new fire's temperature is set to `base_fire_temp + Flammable/2`, so more flammable materials burn hotter. TPT also distinguishes fire from plasma (PLSM): fire heated above ~2500°C becomes plasma at ~10,000°C, which is far more destructive.

**The Cornell FPGA implementation** uses a particularly clean state-machine approach with four explicit fire states: `fire3 → fire2 → fire1 → fire0 → blank`. Different materials enter the chain at different points — oil becomes `fire1` immediately (fast burn), plant becomes `fire2` (medium), wax becomes `fire3` (slow). The key trick: `fire0` always becomes blank next frame, but **randomly injects a `fire1` into blank space above it**. This creates fire columns with an exponentially-decaying height distribution — tall flames are possible but increasingly rare, which looks natural.

### What separates convincing fire from orange sand

The difference is five specific techniques working together. First, **upward movement**: fire cells must be "lighter than air," swapping upward with empty space rather than falling. Second, **multiple fire states** with different colors create temporal variation — cycling through a palette of dark red (`#541e1e`) → red → orange → yellow (`#eecc09`) as a function of remaining lifetime. Third, **frequency modulation**: flickering accelerates as fuel depletes, using `sqrt(totalLife / remainingLife)` to control color-cycle speed. Fourth, **smoke generation on death**: when a fire particle expires, it spawns a smoke particle with 5–10× longer lifetime that fades in alpha as it rises slowly. Fifth, **randomized lifetimes** (e.g., `10 + 100 × random()` frames for generic fuel, 200–300 for wood) ensure no two fire particles behave identically. Sandspiel adds a sixth technique: a **GPU Navier-Stokes fluid simulation** running in GLSL shaders that makes smoke billow naturally by advecting particles through a velocity field, which is the single most visually distinctive feature of its fire.

---

## Gas needs pressure or randomness to avoid ceiling piles

The naive approach to gas — invert gravity so particles rise instead of fall — creates gas that behaves like upside-down sand, pooling on ceilings in neat pyramids. Three progressively sophisticated solutions exist.

**Inverted liquid rules** (Noita's approach) check up first, then left/right, mirroring liquid behavior. This is cheap and produces reasonable results for steam and smoke, but gas won't fill enclosed rooms evenly. Noita doesn't simulate air pressure at all — liquids and gases only move in their preferred direction, never pushed by pressure differentials. This is a deliberate tradeoff: Purho confirmed that "the game doesn't calculate pressure like that. It flows down, or sideways, it doesn't push upwards."

**Random walk diffusion** (Sandspiel's approach) moves gas particles to a random neighboring cell each frame. This naturally creates diffusion behavior — gas spreads uniformly to fill available space over time rather than piling up. The update function is remarkably simple: pick a random direction from all 8 neighbors, and if that cell is empty, swap. This converges toward uniform distribution within any container, though it's slow for large spaces.

**The Powder Toy's dual-grid pressure system** is the most physically realistic. TPT maintains a **separate air simulation grid at 4× lower resolution** (each air cell covers a 4×4 block of particle cells) with three float arrays: pressure (`pv`), x-velocity (`vx`), and y-velocity (`vy`). The air update algorithm runs four steps each frame: kernel-based diffusion (smoothing pressure and velocity between neighbors), advection (moving quantities along the velocity field using bilinear interpolation), pressure-to-velocity coupling (pressure gradients create velocity), and velocity-to-pressure coupling (velocity divergence creates pressure). Gas particles interact bidirectionally with this air grid — they're advected by the velocity field and also add pressure to it. The result: gas genuinely fills enclosed spaces through pressure equalization, flows through narrow gaps, and creates pressure waves from explosions. The algorithm was written by original developer Stanislaw Skowronek, and current TPT developers acknowledge parts of it are complex enough that they're not fully understood by the current team.

The element-level property `Diffusion` controls random movement (high for gases, low for solids), while `Advection` controls how much air velocity affects the particle, and `HotAir` controls how much pressure the element generates. TPT's BOYL (Boyle's Gas) explicitly simulates PV=nRT: it generates pressure proportional to its temperature, expanding when heated and contracting when cooled.

---

## Plants grow toward water, not light

Plant growth in falling sand games uses a simple but effective trick: **water adjacent to plant converts into plant**. Direction isn't explicitly programmed — it emerges from where water is available.

The Cornell implementation documents the clearest ruleset. Plants are immobile (wall-like). Each frame, water cells touching a plant cell have a probability of converting to plant: **100% for lateral neighbors, 25% for diagonal neighbors**. This probability difference prevents plants from growing in a perfect square pattern while biasing growth laterally. Growth rate is limited to exactly one pixel per frame by reading from the **unmodified previous frame** rather than the current frame being updated — without this constraint, a plant touching a water pool could propagate through the entire pool in a single frame.

**Sandspiel** adds a seed mechanic: seeds fall like sand until they land on a surface, then convert to immobile plant cells. The `ra` and `rb` registers (two bytes of per-cell state) store growth state and flower color. Plants burn when touched by fire, creating the signature Sandspiel gameplay loop where players build ecosystems of seeds, water sources, and oil, then watch fire cascade through vine networks.

The organic appearance emerges from the water-seeking rule plus stochastic diagonal growth. When water flows downward from a source above a plant, the plant grows upward toward it, creating tree-like structures. When water pools beside plants, lateral growth creates vine-like networks. No explicit tropism (light-following or gravity-sensing) is needed — **the interaction between water flow and growth probability creates realistic-looking organic forms**.

---

## Electricity travels as a temporary cell replacement

The Powder Toy's electrical simulation is built on a single clever mechanism: **sparks (SPRK) temporarily replace conductor cells, with the original material stored in a field called `ctype`**.

The SPRK lifecycle spans **8 frames**. When a conductor receives a spark, it becomes a SPRK particle with `ctype` set to the original element and `life` set to 4. During frames with life ≥ 3, SPRK propagates to neighboring conductors within the Moore neighborhood (3×3 grid). At life = 0, SPRK restores itself to the original conductor type and sets that conductor's `life` to 4 (cooldown). The restored conductor cannot receive SPRK again until its cooldown expires. This 4-active + 4-cooldown cycle creates a **consistent 8-frame timing base** that enables precise digital electronics.

Circuit logic emerges from three key conductor types. **PSCN (P-type silicon)** conducts to all conductors unconditionally. **NSCN (N-type silicon)** follows the receiving element's rules and cannot conduct to PSCN. This asymmetry creates **diode behavior**: signals flow PSCN→NSCN but not the reverse. **INST (instantaneous conductor)** propagates sparks through an entire connected wire in a single frame, only accepting input from PSCN and outputting to NSCN. Logic gates are built from these primitives:

- **NOT gate**: A battery (BTRY) provides continuous power through a path that NSCN can interrupt
- **AND gate**: Two signal paths must arrive at the same METL junction simultaneously
- **Diode**: Simple PSCN→NSCN junction enforcing one-way flow
- **SWCH (switch)**: Toggled on by PSCN, off by NSCN — only conducts when active
- **WIFI**: Wireless signal transmission with 100 temperature-dependent channels (one per 100K)

Advanced builders exploit **particle update order** (left-to-right, top-to-bottom by particle ID) for "subframe" techniques. Using CONV elements to reset conductor states before the normal cooldown completes, they achieve sparking every single frame instead of every 8, enabling dramatically faster computation. TPT also includes **WWLD (WireWorld)**, a complete cellular automaton embedded within the larger CA, using four states (empty, electron head, electron tail, conductor) with Game-of-Life-like transition rules.

---

## Temperature works very differently across games

This is where Noita and The Powder Toy diverge most dramatically. **Noita does not simulate per-cell temperature** — a fact that surprises many players. TPT does, and pays a performance cost for it.

**Noita's approach** uses material-type reactions rather than continuous thermal simulation. Phase transitions are defined in `materials.xml` as tag-based reactions: `[meltable] + [lava] → [meltable]_molten`, `[water] + fire → steam`. Biome-specific effects (water evaporating in Volcanic Cave, freezing in Ice Caves) are area-wide modifiers, not temperature propagation. You can levitate safely over lava lakes — only touching the orange pixels causes damage. The `autoignition_temperature` field exists in the material definition, but it appears to function as a threshold check against fire proximity rather than accumulated heat. This is a deliberate design decision: Noita trades physical accuracy for performance and gameplay clarity.

**The Powder Toy** stores temperature per-particle in Kelvin (range: ~0K to 9999K). Heat conduction is **probabilistic**: each frame, for each neighbor, there's a `HeatConduct/250` chance of temperature exchange, where `HeatConduct` ranges from 0 (perfect insulator) to 255 (maximum conductor). When exchange occurs, temperatures are averaged between the two particles. This probabilistic approach is cheaper than deterministic conduction because most particle pairs skip the calculation on any given frame — the average behavior converges to correct thermal diffusion over time.

Phase transitions use a **four-axis threshold table** per element: low/high temperature and low/high pressure. Water freezes to ice below 273.15K, boils to steam above 373K. Metal melts to lava above 1273K. The LAVA element uses `ctype` to remember its original material, enabling correct re-solidification — lava from melted copper re-freezes to copper, not generic stone. Some transitions are pressure-dependent: QRTZ's melting point increases by **10°C per unit of pressure**, and BMTL breaks under high pressure using a special transition handler.

**Performance implications** are significant. Per-cell temperature adds a float (4 bytes) per particle. TPT mitigates this by operating on sparse particles (not every pixel is filled) and using probabilistic conduction (skipping most pairs each frame). Tom Forsyth's authoritative game-dev paper on CA physical modeling recommends double-buffering temperature values (compute all `newTemp` values, then copy to `temp`) to prevent asymmetric propagation from scan-order bias. His convection hack is worth noting: **make upward heat conduction faster than downward** to simulate hot air rising without actually modeling fluid dynamics.

---

## Acid strength depletes through a hardness system

The Powder Toy's acid implementation is the most well-documented. Each ACID particle spawns with `life = 75`. Each corrosion event depletes life. Materials resist acid through a `Hardness` property ranging from 0 to 1000+: values of 0 or above 1000 mean immune (diamond, gold, platinum), while values 1–1000 corrode with probability inversely proportional to hardness. A key detail: **hardness values of 1–60 make the corrosion reaction exothermic**, generating `(60 - Hardness) × 7` degrees of heat. This means acid dissolving soft materials produces dangerous amounts of heat, which can trigger secondary reactions.

The general implementation pattern across games follows a consistent structure: acid flows like a liquid, checks neighbors each frame for corrodible materials, rolls against the material's resistance value, and on success destroys the neighbor while reducing its own strength. Some implementations produce gas or smoke byproducts. TPT adds CAUS (caustic gas), which dissolves almost everything and is produced when acid contacts water vapor — a 0.4% chance per frame creates a slow but dangerous secondary hazard.

---

## Explosions convert static terrain to falling debris

Noita's explosions are not pressure waves — they're **radial destruction events** that convert static materials into physics-enabled objects. The algorithm works in stages: first, evaluate all pixels within the blast radius against a durability threshold. Surviving materials stay; destroyed border pixels are **converted to "collapsing sand materials"** that suddenly obey gravity. The engine then searches for isolated terrain chunks that can be carved into shapes. If found, these become **Box2D rigid bodies** that fall with full physics simulation using a marching squares algorithm for shape extraction. Each pixel in a rigid body knows its parent body and local position; when a pixel is destroyed, the shape recalculates and potentially splits into multiple independent bodies.

This creates Noita's spectacular cascade effects: an explosion blasts through terrain, debris falls as sand particles, chunks of earth become rigid bodies that tumble and shatter on impact — potentially breaking more terrain and triggering secondary collapses. The system is entirely deterministic given the same inputs, yet produces endlessly varied destruction patterns.

**TPT handles explosions through its pressure system** — explosive elements generate large pressure spikes in the air grid, which propagate outward and destroy materials based on their strength. This is physically motivated but less visually dramatic than Noita's approach. For GPU-based implementations, explosions are particularly efficient: since shaders process in parallel, radial destruction can be applied across all affected pixels simultaneously in a single compute dispatch.

---

## Reactions layer declarative, procedural, and catalyst patterns

Sophisticated falling sand games don't use a single reaction system — they layer multiple approaches. **The Powder Toy uses at least five distinct reaction mechanisms**, each suited to different interaction types.

**Declarative phase transitions** are the simplest: each element defines four temperature/pressure thresholds that trigger automatic transformation. Water becomes ice below 273K and steam above 373K. Gas becomes oil under pressure above 6.0 and fire above 573K. These require zero custom code.

**Procedural update functions** handle complex reactions. Each element's `update()` function scans neighbors and checks for specific conditions. Hydrogen fusion triggers when HYGN exceeds 50 pressure and 2000°C, producing plasma, neutrons, photons, and noble gas while generating 50 pressure units and 4000°C — a chain reaction waiting to happen.

**The catalyst system** (PTNM/platinum) enables reactions that require a third element's presence without consuming it. Water vapor plus coal produces oil, but only above 200°C and 5 pressure, and only near platinum. This creates spatial constraints that enable interesting player constructions.

**The fire/combustion system** uses the semi-declarative `Flammable` property — a single integer per element that fire's update code checks probabilistically. **Neutron reactions** form their own category: neutrons passing through materials trigger nuclear-physics-inspired transformations (plutonium fissions, coal transmutes to wood, yeast becomes deadly yeast).

**Noita takes a different approach** with tag-based XML reactions: `[meltable] + [lava] → [meltable]_molten` covers all meltable materials with a single rule. Tags like `[water]`, `[lava]`, `[corrodible]` serve as wildcards, and each reaction has a probability controlling speed. Hidden alchemical recipes combine materials to produce magical liquids, adding a discovery layer.

---

## Emergent complexity arises from conservation and composability

The "wow" moments in falling sand games aren't designed — they emerge from interactions between simple rules. The key ingredients are **conservation** (particles aren't created or destroyed except through defined reactions), **stochasticity** (randomness in movement and reactions creates organic-looking behavior), and **composability** (every element pair can potentially interact).

Petri Purho's favorite example: "I killed an enemy that was above me, his body fell down and broke an oil lantern, the oil spilled on me and I was set ablaze. That had never happened to me before." This chain — physics body → container destruction → liquid spill → combustion → player damage — crosses four subsystems (rigid body physics, material destruction, liquid simulation, fire spread), none of which were designed to produce this specific outcome.

**Documented emergent chains** include fire cascades (fire ignites oil → oil fire spreads → ignites wood structures → structures collapse as rigid bodies → falling debris breaks more oil containers), mini water cycles (fire converts water to steam → steam rises → condenses back to water → rains down), acid gas pocket explosions (acid corroding materials produces flammable gas → gas rises and pools on ceilings → any spark triggers explosion), and suffocation loops (fire produces smoke → smoke fills enclosed spaces → creatures suffocate). In Sandspiel, players discovered perpetual ecosystems using clone sources, seeds, and oil — plants grow, fire consumes them, seeds regenerate, the cycle repeats indefinitely.

Max Bittker captured the principle precisely: "The behavior of any single element is very simple. The interactions *between* the elements and across the space is where the interesting complexity of the simulation unfolds." Purho adds an important design caveat: "It's easy to think that having a complex or highly realistic simulation will auto-magically result in interesting gameplay. Often, that's not the case." Noita deliberately avoids some realistic behaviors (IK-based enemy physics, fully collapsible buildings) because they produce chaos without fun.

---

## Performance scales through chunks, dirty rects, and probabilistic shortcuts

Complex element behaviors are computationally expensive. A 1920×1080 grid has over two million cells, each potentially requiring neighbor checks, temperature calculations, and reaction evaluations every frame. Three families of optimization make this tractable.

**Spatial partitioning with dirty rectangles** is the most impactful technique. Noita divides the world into **64×64 pixel chunks**, each maintaining a dirty rectangle tracking which pixels actually need updating. Quiescent regions (settled sand, static stone) require zero CPU time. When something moves in a chunk, only the dirty region within that chunk is iterated. This alone provides an order-of-magnitude speedup for typical game states where most of the world is static.

**Multithreading uses a checkerboard pattern** to avoid locks entirely. Noita processes chunks in 4 passes: each pass selects every-other chunk (like squares on a checkerboard), and each selected chunk can safely update pixels within its 64×64 area plus 32 pixels in each cardinal direction, forming cross-shaped safe zones. Since no two active zones overlap within a pass, threads operate without synchronization. Purho rejected per-pixel atomic operations as "too slow" and frame-counter approaches as requiring expensive synchronization.

**Data layout matters enormously.** Sandspiel's cell struct is exactly 32 bits — species (u8), two state registers (u8 each), and a clock byte — enabling **zero-copy upload to the GPU** as an RGBA texture. No position is stored; it's implicit from the array index. TPT maintains a `pmap[y][x]` array mapping pixel coordinates to particle IDs for O(1) neighbor lookups. The air simulation runs on a 4× coarser grid than particles. TPT's probabilistic heat conduction (`HeatConduct/250` chance per neighbor) is itself a performance optimization: instead of computing exact thermal diffusion for every pair every frame, random sampling converges to the correct average behavior while skipping most calculations.

Additional techniques include **alternating horizontal scan direction** per row to prevent directional bias (sand always piling left), bottom-to-top update order for correct gravity cascading, clock bits preventing double-updates when particles move with the scan direction, and rendering only modified pixels to GPU textures. Sandspiel's switch from size-optimized to speed-optimized WASM compilation (`-Oz` to `-O3`) provided a significant performance boost for only 18KB of additional binary size. The developer later regretted expanding the grid from 250×250 to 300×300, as many mobile devices couldn't maintain 60fps at the larger resolution — a reminder that in falling sand games, **resolution is the primary performance knob**.

---

## Conclusion

The deepest lesson from studying these systems is that the best falling sand simulations aren't the most physically accurate — they're the ones that choose the right abstractions. Noita skips per-cell temperature entirely and uses material-type reactions instead, gaining performance and gameplay clarity. TPT invests in a full pressure simulation at 4× lower resolution than its particle grid, enabling gas physics that no other falling sand game matches. Sandspiel offloads fluid dynamics to GPU shaders while keeping particle logic on the CPU in WASM, getting beautiful smoke effects without the complexity of a CPU pressure solver.

The element design pattern that emerges across all three games is remarkably consistent: **a compact per-cell data structure** (4–8 bytes), **per-element update functions** that read and write only local neighbors through a sandboxed API, **probabilistic rather than deterministic** interactions (which are both more realistic-looking and cheaper to compute), and **layered reaction systems** that combine declarative property tables with procedural special cases. Fire works because it has a lifetime, rises, spreads stochastically, and produces smoke. Gas works because it either uses random-walk diffusion or a coarse pressure grid. Plants work because water-to-plant conversion with probabilistic diagonal suppression creates organic branching without any explicit growth algorithm.

The most important architectural decisions aren't about individual elements but about the **infrastructure they share**: chunk-based spatial partitioning, dirty-rectangle tracking, the air/pressure grid resolution, and the data layout that determines whether your cell buffer can be uploaded to the GPU without copying. Get these foundations right, and individual elements become small, composable functions. Get them wrong, and no amount of clever element design will make the simulation feel alive.
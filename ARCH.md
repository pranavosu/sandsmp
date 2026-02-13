# Multiplayer falling sand: a complete technical architecture

**Run the simulation on the CPU in Rust/WASM, render with WebGPU, and synchronize via an authoritative server over WebTransport.** This is the clear winning architecture after analyzing Sandspiel's source code, WebGPU compute shader tradeoffs, multiplayer sandbox precedents (r/place, Minecraft, Noita), and bandwidth constraints. The core insight: GPU readback latency (16–50 ms async) makes pure-GPU simulation impractical for multiplayer state synchronization, while CPU simulation in Rust gives you deterministic state, instant memory access for networking, and the ability to share identical simulation code between server and client via a single Rust codebase.

---

## How Sandspiel works — and where to improve it

Max Bittker's Sandspiel uses a **4-byte Cell struct** packed into a flat array in WASM linear memory. Each cell stores `species: u8`, `ra: u8` (random register for visual grain/state), `rb: u8` (extra state), and `clock: u8` (double-update prevention). The grid is **300×300** (90K cells, ~352 KB), scanned left-to-right, top-to-bottom, with each element dispatched to a dedicated Rust update function via `match`. The `SandApi` abstraction provides relative-offset `get(dx, dy)` and `set(dx, dy, cell)` methods, hiding absolute position and boundary checks from element code.

The critical bridge between Rust and the browser is **zero-copy shared memory**: JavaScript creates a `Uint8Array` view over WASM linear memory and uploads it directly as a WebGL RGBA texture (4 bytes per cell maps perfectly to RGBA). This eliminates all serialization overhead. The rendering fragment shader then maps `species` and `ra` values to colors.

Three key limitations of Sandspiel's design matter for a multiplayer successor. First, it has **no dirty-rect optimization** — every cell is processed every tick, even in a settled world. Noita's 64×64 chunk system with dirty rectangles skips inactive regions entirely, which is essential for larger grids. Second, the **single-threaded sequential scan** prevents parallelism. Noita solves this with a checkerboard update pattern across chunks. Third, element interactions are **hand-coded per species pair**, leading to inconsistencies (dust sinks in water but floats on oil). A lookup-table approach scales better.

For this project, keep Sandspiel's proven cell format and SandApi pattern, but add Noita-style chunk management and a hybrid element system combining lookup tables with custom update functions.

---

## Why CPU simulation beats GPU compute for multiplayer

The decision between GPU compute shaders and CPU/WASM simulation is unambiguous for multiplayer. **GPU readback requires an asynchronous `mapAsync` call** that waits for all in-flight GPU work to complete, adding 1–3 frames of latency (16–50 ms). You cannot synchronously read GPU state. Since the server needs to extract simulation state every network tick to compute deltas and broadcast them, this latency is a dealbreaker.

Beyond latency, **cross-platform GPU determinism is not guaranteed**. WGSL does not promise bit-exact results across vendors (NVIDIA, AMD, Apple Silicon, Intel). For a game where small state differences cascade rapidly through chaotic physics, even tiny floating-point discrepancies between client and server would cause visible divergence within seconds. Integer-only Rust simulation on CPU is perfectly deterministic across all platforms.

The performance cost of CPU simulation is manageable. A **512×512 grid** (262K cells) with Sandspiel's 4-byte Cell struct takes ~1 MB. With dirty-rect optimization (only ~10–20% of cells active at any moment), simulation cost drops to **~2–4 ms per tick** in Rust/WASM — well within a 16 ms frame budget. Uploading the resulting grid to WebGPU as a texture costs ~256 KB per frame via `device.queue.writeTexture()`, consuming less than 1% of available PCIe bandwidth even on integrated GPUs.

The rendering pipeline itself is trivially fast: a single full-screen triangle with a fragment shader that samples the grid texture and looks up colors from a palette uniform. Total render cost: **~0.1 ms**. Use `r8uint` or `rgba8unorm` texture format depending on whether you need 1 or 4 bytes per cell on the GPU side.

```wgsl
@fragment
fn fs(@builtin(position) pos: vec4<f32>) -> @location(0) vec4<f32> {
    let grid_coord = vec2<i32>(pos.xy * uniforms.inv_screen_size * vec2<f32>(f32(GRID_W), f32(GRID_H)));
    let cell = textureLoad(grid_tex, grid_coord, 0);
    return color_table[cell.r]; // species → color lookup
}
```

The strongest argument for CPU simulation is **code sharing**: with `wgpu-rs`, the same Rust codebase compiles to a native server binary (headless, no GPU required) and to client-side WASM with WebGPU rendering. This eliminates the need to maintain parallel implementations.

---

## Cell data structure and element system design

The proven 4-byte cell format balances compactness with expressiveness:

```rust
#[repr(C)]
#[derive(Clone, Copy)]
struct Cell {
    species: u8,   // element type (0–255, supports 256 types)
    ra: u8,        // register A: visual variation, temperature, color variant
    rb: u8,        // register B: lifetime, extra state, velocity
    clock: u8,     // last-updated tick for double-move prevention
}
```

This struct is exactly 32 bits, enabling direct upload as an RGBA texture. The `clock` field prevents particles from being processed multiple times per tick — when a sand grain moves downward ahead of the scan line, its clock is stamped to the current generation and skipped when the scanner reaches its new position.

For the element system, use a **three-layer hybrid** that combines the best patterns from Sandspiel, The Powder Toy, and Noita:

**Layer 1 — Movement properties (bit flags)**:  Each element has movement flags that the engine processes generically. Sand gets `MOVE_DOWN | MOVE_DOWN_SIDE`. Water adds `MOVE_SIDE`. Gas gets `MOVE_UP | MOVE_UP_SIDE | MOVE_SIDE`. The engine handles gravity, flow, and density-based displacement without per-element code.

**Layer 2 — Interaction lookup table**: A `[Species][Species] → Option<Reaction>` table defines chemical reactions. Fire + Water → Steam. Acid + Metal → Empty. Lava + Water → Stone. This is **O(1) lookup**, cache-friendly for ≤32 element types (32×32 = 1024 entries), and trivially data-driven — load from a config file.

**Layer 3 — Custom update functions**: Complex behaviors (fire spreading probabilistically, plants growing toward light, electricity conducting through metal) get per-element update functions using the SandApi pattern. These run after movement and interactions.

```rust
struct ElementDef {
    density: u8,
    move_props: u8,        // bit flags
    flammable: bool,
    dissolvable: bool,
    color_base: [u8; 3],
    update_fn: fn(Cell, &mut SandApi),
}

static ELEMENTS: [ElementDef; 32] = [ /* ... */ ];
static REACTIONS: [[Option<Reaction>; 32]; 32] = [ /* ... */ ];
```

---

## Simulation update algorithm with chunk optimization

Use a **single-buffered, bottom-to-top scan** with Noita-style dirty-rect chunks. The grid is divided into **32×32 chunks** (for a 512×512 grid, that's 16×16 = 256 chunks). Each chunk tracks a dirty flag and a bounding rectangle of active cells. Only dirty chunks are iterated.

```rust
fn tick(world: &mut World) {
    world.generation = world.generation.wrapping_add(1);
    let gen = world.generation;
    // Alternate horizontal scan direction each frame to prevent L/R bias
    let scan_right = gen % 2 == 0;

    for chunk_y in (0..world.chunks_h).rev() {       // bottom chunks first
        for chunk_x in scan_order(world.chunks_w, scan_right) {
            let chunk = &world.chunks[chunk_y * world.chunks_w + chunk_x];
            if !chunk.dirty { continue; }

            let (min_x, min_y, max_x, max_y) = chunk.dirty_rect;
            chunk.dirty = false;  // will be re-dirtied if anything moves

            for y in (min_y..=max_y).rev() {          // bottom-to-top
                let x_range = if scan_right { min_x..=max_x } else { (min_x..=max_x).rev() };
                for x in x_range {
                    let cell = world.get(x, y);
                    if cell.species == EMPTY || cell.clock == gen { continue; }
                    
                    let mut api = SandApi::new(world, x, y, gen);
                    // Phase 1: Generic movement (gravity, flow, density displacement)
                    apply_movement(&ELEMENTS[cell.species as usize], cell, &mut api);
                    // Phase 2: Chemical interactions with neighbors
                    apply_interactions(cell, &mut api);
                    // Phase 3: Custom element behavior
                    (ELEMENTS[cell.species as usize].update_fn)(cell, &mut api);
                }
            }
        }
    }
}
```

When any cell changes, the engine marks both the source and destination chunks as dirty and expands their dirty rectangles. A settled world with no active particles costs nearly zero CPU time. For multithreading on the server (native Rust), adopt Noita's checkerboard pattern: process alternating chunks in parallel using `rayon`, with a **32-cell overlap buffer** ensuring no two threads write to the same memory. This is unnecessary in single-threaded WASM but gives the server significant headroom for larger worlds.

---

## Multiplayer architecture: authoritative server with optimistic client preview

The server runs the canonical simulation and is the single source of truth. Clients send draw commands and receive state deltas. This follows patterns proven by r/place (last-write-wins pixel authority), Minecraft (fixed-tick authoritative simulation), and every successful multiplayer sandbox.

**Input flow**: When a player draws, the client sends a `DrawCommand { x: u16, y: u16, radius: u8, material: u8 }` over a **reliable WebTransport stream**. The client simultaneously applies the draw locally as a semi-transparent preview. The server validates the command (bounds, rate limits, permissions), applies it to the canonical grid at the start of the next tick, then runs the simulation step.

**State broadcast**: After each server tick, compute a delta between the current and previous grid state. Encode only changed cells using **chunk-based XOR + run-length encoding**. Only dirty chunks are included. Send this delta to each client via **WebTransport datagrams** if the payload fits within ~1100 bytes (QUIC MTU), otherwise via a short-lived unidirectional stream. Clients apply the delta to their local grid copy, overwriting any optimistic preview.

**Conflict resolution is trivially last-write-wins**. Two players drawing on the same pixel simultaneously both send commands to the server, which processes them in arrival order. The simulation immediately transforms placed pixels (sand falls, water flows), making sub-frame conflicts invisible. No CRDTs or operational transforms needed — pixels are independent commutative values.

```
CLIENT                          SERVER                          CLIENT
  │                               │                               │
  │──DrawCommand(sand,150,200)──▶│                               │
  │  [apply local preview]        │                               │
  │                               │◀──DrawCommand(water,152,198)──│
  │                               │  [apply local preview]        │
  │                               │                               │
  │                               │──[validate + apply both]──    │
  │                               │──[run simulation tick]──      │
  │                               │──[compute delta]──            │
  │                               │                               │
  │◀────DeltaUpdate(tick=42)──────│──────DeltaUpdate(tick=42)────▶│
  │  [apply delta, clear preview] │  [apply delta, clear preview] │
```

---

## Network protocol and bandwidth analysis

Define a compact binary protocol with **little-endian encoding**. All messages use a 1-byte type header followed by a 2-byte payload length.

**Client → Server (reliable stream)**:
- `0x01 JOIN { name: str }` — session setup
- `0x03 DRAW { x: u16, y: u16, radius: u8, material: u8 }` — 6 bytes per draw action
- `0x05 CURSOR { x: u16, y: u16 }` — cursor position broadcast (can also use datagrams)

**Server → Client (datagrams for deltas, streams for snapshots)**:
- `0x10 WELCOME { player_id: u32, grid_w: u16, grid_h: u16, tick_rate: u8 }`
- `0x11 FULL_STATE { zstd_compressed_grid: bytes }` — on join or reconnect
- `0x20 DELTA { tick: u32, num_dirty_chunks: u8, chunks: [{ chunk_id: u8, rle_data: bytes }] }`
- `0x21 CURSORS { entries: [{ player_id: u8, x: u16, y: u16 }] }`

**Bandwidth estimates for a 512×512 grid at 20 Hz server tick rate**:

| Scenario | Changed cells/tick | Delta size (compressed) | Bandwidth/client |
|---|---|---|---|
| Mostly settled | ~500 (0.2%) | **~1–2 KB** | ~20–40 KB/s |
| Active play (2–4 players) | ~5,000 (2%) | **~5–15 KB** | ~100–300 KB/s |
| Heavy chaos (8 players) | ~20,000 (8%) | **~20–50 KB** | ~400 KB–1 MB/s |

For **8 concurrent players** with active simulation, total server egress is roughly **3–8 MB/s** — manageable on any modern server. To reduce bandwidth further, implement **priority-based chunk scheduling**: chunks near player cursors send at full tick rate, distant active chunks at ⅓ rate, inactive chunks only on change. This cuts average bandwidth by ~50%.

For initial join, a full 512×512 grid at 4 bytes/cell = 1 MB, which compresses to **~50–200 KB** with zstd depending on world complexity. Send this as a single reliable stream on connection.

A **256×256 grid** cuts all bandwidth numbers by 4× and is the safer choice for MVP. Scale up after profiling real-world usage.

---

## WebTransport server and Safari fallback

**Use `wtransport` (Rust, crates.io)** as the primary WebTransport server library. It wraps Quinn (the Rust QUIC implementation), provides an ergonomic async API with tokio, and supports both datagrams and bidirectional/unidirectional streams. The alternative `web-transport-quinn` from the moq-dev ecosystem offers a trait-based interface that abstracts over WebTransport and WebSocket, which simplifies fallback implementation.

**Safari has no WebTransport support as of February 2026**, though WebKit's inclusion of WebTransport in Interop 2026 signals it will ship sometime this year. For now, implement a **WebSocket fallback**:

```javascript
async function connect(url) {
    if (typeof WebTransport !== 'undefined') {
        const wt = new WebTransport(url);
        await wt.ready;
        return new WebTransportAdapter(wt); // wraps datagrams + streams
    }
    // Safari fallback: WebSocket with frame multiplexing
    const ws = new WebSocket(url.replace('https://', 'wss://'));
    return new WebSocketAdapter(ws); // emulates datagram/stream interface
}
```

On the server side, run both a WebTransport listener (via `wtransport`) and a WebSocket listener (via `tokio-tungstenite`) on separate ports. The `WebSocketAdapter` class on the client frames messages with a 1-byte type header and treats all data as reliable-ordered (losing the unreliable datagram benefit, but functionally correct). Since state deltas are small and WebSocket overhead is modest, Safari users will experience slightly higher latency but identical functionality.

Browser support as of early 2026: **Chrome (since v97), Firefox (since v114), Edge, Opera — all stable**. Safari is the sole holdout. Global coverage is **~82%** without fallback.

---

## Recommended tech stack and libraries

**Server (Rust, native binary)**:
```toml
[dependencies]
wtransport = "0.5"              # WebTransport server
tokio = { version = "1", features = ["full"] }
tokio-tungstenite = "0.24"      # WebSocket fallback
rayon = "1.10"                  # Parallel chunk simulation
zstd = "0.13"                   # Compression for snapshots
bincode = "2"                   # Binary serialization
```

**Shared simulation crate (Rust, compiles to native + WASM)**:
```toml
[lib]
crate-type = ["cdylib", "rlib"]  # cdylib for WASM, rlib for server

[dependencies]
wasm-bindgen = "0.2"            # WASM↔JS bridge (only on wasm32 target)
```

**Client (TypeScript + Rust/WASM)**:
- **Build tooling**: Vite with `vite-plugin-wasm` for WASM integration, `wasm-pack` to compile Rust to WASM
- **WebGPU**: Use the raw browser `navigator.gpu` API directly (no wrapper needed — the API is clean and well-typed with `@webgpu/types`)
- **UI framework**: Preact or vanilla TypeScript (keep it minimal; the game is a canvas, not a CRUD app)
- **Fallback**: `@moq/web-transport-ws` (npm) for WebSocket polyfill on Safari

**Project structure**:
```
sandspiel-multi/
├── crates/
│   ├── simulation/        # Shared simulation engine (Rust)
│   │   ├── src/
│   │   │   ├── lib.rs     # Grid, tick loop, chunk management
│   │   │   ├── cell.rs    # Cell struct, Species enum
│   │   │   ├── elements/  # Per-element update functions
│   │   │   ├── api.rs     # SandApi abstraction
│   │   │   └── delta.rs   # Delta encoding/decoding
│   │   └── Cargo.toml
│   ├── server/            # Multiplayer server (Rust, native)
│   │   ├── src/
│   │   │   ├── main.rs    # WebTransport + WS listener
│   │   │   ├── session.rs # Per-player session state
│   │   │   ├── room.rs    # Room management, tick loop
│   │   │   └── protocol.rs# Message encoding/decoding
│   │   └── Cargo.toml
│   └── client-wasm/       # WASM bindings for simulation
│       ├── src/lib.rs     # wasm-bindgen exports
│       └── Cargo.toml
├── client/                # TypeScript + WebGPU
│   ├── src/
│   │   ├── main.ts        # Entry point
│   │   ├── renderer.ts    # WebGPU pipeline setup + rendering
│   │   ├── network.ts     # WebTransport/WS connection + protocol
│   │   ├── input.ts       # Mouse/touch → draw commands
│   │   └── shaders/
│   │       └── grid.wgsl  # Vertex + fragment shaders
│   ├── index.html
│   ├── vite.config.ts
│   └── package.json
└── Cargo.toml             # Workspace root
```

---

## Project phases and concrete milestones

**Phase 1 — Single-player simulation MVP (2–3 weeks)**

Build the core simulation engine in Rust with 5 elements (Empty, Sand, Water, Wall, Fire). Target a **256×256 grid** running at 60 fps in the browser. Implement the 4-byte Cell struct, bottom-to-top scanning with clock-based double-move prevention, and the SandApi abstraction. Compile to WASM via `wasm-pack`. For rendering, set up a minimal WebGPU pipeline: create a `r8uint` texture, upload the species array each frame via `writeTexture()`, render a full-screen triangle with a color-lookup fragment shader. Wire up mouse input to paint elements. **Milestone: a playable single-player falling sand toy in the browser with 5 elements and WebGPU rendering.**

**Phase 2 — Element system expansion and chunk optimization (1–2 weeks)**

Add 10+ more elements (Lava, Acid, Plant, Oil, Steam, Ice, Stone, Wood, Metal, Smoke) using the three-layer hybrid system: movement bit-flags, interaction lookup table, custom update functions. Implement 32×32 dirty-rect chunks to skip inactive regions. Add visual polish: use the `ra` register for color variation per element, implement a proper color palette. Profile and optimize — target **512×512 at 60 fps** with dirty-rect optimization. **Milestone: rich element interactions with ~15 elements, 512×512 grid, smooth performance with chunk optimization.**

**Phase 3 — Networking foundation (2–3 weeks)**

Extract the simulation crate into a shared library that compiles for both `wasm32-unknown-unknown` and native targets. Build the server binary using `wtransport` + `tokio`. Implement the binary protocol (draw commands, delta updates, full-state snapshots). Build the delta encoder: XOR current state against previous state, then RLE-encode per dirty chunk. On the client, implement WebTransport connection with WebSocket fallback. Start with a simple flow: client sends draw commands → server applies and simulates → server broadcasts full state snapshots at 10 Hz (no delta compression yet). **Milestone: two browser windows connected to the same server, both seeing each other's drawings with the simulation running server-side.**

**Phase 4 — Efficient state synchronization (2 weeks)**

Replace full-state broadcasts with chunk-based delta encoding. Implement the priority-based chunk scheduling (high/medium/low frequency based on activity and player proximity). Add client-side optimistic preview for draw actions with server reconciliation. Implement cursor position broadcasting via datagrams. Add zstd compression for initial full-state transfer on join. Profile bandwidth usage and tune tick rate (target **20 Hz** server simulation, delta broadcasts at 15–20 Hz for active chunks). **Milestone: smooth multiplayer experience for 4+ simultaneous players with bandwidth under 200 KB/s per client.**

**Phase 5 — Polish, rooms, and deployment (2 weeks)**

Add room/lobby system (multiple independent worlds). Implement player count limits, rate limiting on draw commands, and basic anti-grief measures (cooldowns, undo). Add a UI for element selection, room creation, and player list. Set up TLS certificates (required for WebTransport — use Let's Encrypt). Deploy server on a VPS with a reverse proxy. Add reconnection logic with state catch-up (full snapshot + delta replay). **Milestone: publicly accessible multiplayer falling sand game with room support, deployed and playable.**

**Phase 6 — Advanced features (ongoing)**

Server-side multithreading via Noita's checkerboard pattern with `rayon` for larger grids (1024×1024). WebGPU compute shader post-processing effects (glow, fluid-like distortion). Persistent worlds saved to disk. Spectator mode. Mobile touch optimization. Custom element creation (Sandspiel Studio–style). World recording and playback.

---

## Key technical decisions summarized

| Decision | Choice | Rationale |
|---|---|---|
| Simulation target | **CPU (Rust/WASM)** | Deterministic, instant state access for networking, same code on server + client |
| Rendering | **WebGPU full-screen triangle + texture** | ~0.1 ms render cost, trivial 256 KB upload per frame |
| Grid size | **256×256 MVP → 512×512 production** | 256×256 proven safe for bandwidth; 512×512 feasible with dirty-rect optimization |
| Cell format | **4 bytes: species, ra, rb, clock** | Sandspiel-proven, maps to RGBA texture, 32-bit aligned |
| Update pattern | **Single-buffered, bottom-to-top, alternating L/R** | Noita + Sandspiel proven; no double-buffer overhead |
| Chunk size | **32×32 with dirty rects** | Balance between skip granularity and management overhead |
| Server authority | **Fully authoritative** | Sand physics is chaotic — client prediction diverges within frames |
| Draw handling | **Input forwarding + optimistic preview** | Low latency feel with server authority |
| Conflict resolution | **Last-write-wins** | Natural for pixel grids; simulation resolves conflicts via physics |
| Transport | **WebTransport primary, WebSocket fallback** | QUIC datagrams for low-latency deltas; WS for Safari |
| Server library | **wtransport (Rust)** | Performance, async tokio ecosystem, same language as simulation |
| Delta encoding | **Per-chunk XOR + RLE** | 95%+ compression for typical frames; ~5–15 KB per active tick |
| Tick rate | **20 Hz server sim, 60 fps client render** | Balances responsiveness with bandwidth |

This architecture is deliberately conservative where it matters (CPU simulation for determinism, authoritative server for correctness) and aggressive where the cost is low (WebGPU rendering, binary protocols, chunk-level optimization). Every major decision is grounded in production precedent: Sandspiel proved the cell format and WASM simulation, Noita proved the chunk system, r/place proved the networking model, and Minecraft proved the authoritative tick loop.
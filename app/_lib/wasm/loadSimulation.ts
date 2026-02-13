// Loads wasm-pack generated JS glue + .wasm from public/ at runtime,
// bypassing the bundler to avoid Turbopack .wasm resolution issues.

export interface SimulationExports {
  Universe: new (width: number, height: number) => SimulationUniverse;
  memory: WebAssembly.Memory;
}

export interface SimulationUniverse {
  tick(): void;
  set_cell(x: number, y: number, species: number): void;
  alloc_ghost_group(): number;
  set_ghost(x: number, y: number, group: number): void;
  species_ptr(): number;
  width(): number;
  height(): number;
  free(): void;
}

let wasmInstance: SimulationExports | null = null;
let wasmLoading: Promise<SimulationExports> | null = null;

export async function loadSimulation(): Promise<SimulationExports> {
  if (wasmInstance) return wasmInstance;

  // Deduplicate concurrent calls (e.g. React Strict Mode double-mount).
  if (wasmLoading) return wasmLoading;

  wasmLoading = (async () => {
    // Dynamic import that TS/bundler won't statically analyze
    const importFn = new Function('url', 'return import(url)') as (
      url: string
    ) => Promise<Record<string, unknown>>;

    const mod = await importFn('/simulation.js');
    const init = mod.default as (path: string) => Promise<{ memory: WebAssembly.Memory }>;
    const instance = await init('/simulation_bg.wasm');

    wasmInstance = {
      Universe: mod.Universe as new (width: number, height: number) => SimulationUniverse,
      memory: instance.memory,
    };

    return wasmInstance;
  })();

  return wasmLoading;
}

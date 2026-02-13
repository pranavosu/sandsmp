// Runtime loader for the simulation WASM module.
// Loads the wasm-pack generated JS glue and .wasm from public/ at runtime,
// bypassing the bundler entirely to avoid Turbopack .wasm resolution issues.

export interface SimulationExports {
  Universe: new (width: number, height: number) => SimulationUniverse;
  memory: WebAssembly.Memory;
}

export interface SimulationUniverse {
  tick(): void;
  set_cell(x: number, y: number, species: number): void;
  species_ptr(): number;
  width(): number;
  height(): number;
  free(): void;
}

let wasmInstance: SimulationExports | null = null;

export async function loadSimulation(): Promise<SimulationExports> {
  if (wasmInstance) return wasmInstance;

  // Use Function constructor to create a dynamic import that TypeScript
  // and the bundler won't try to statically analyze
  const importFn = new Function('url', 'return import(url)') as (
    url: string
  ) => Promise<Record<string, unknown>>;

  const mod = await importFn('/simulation.js');
  const init = mod.default as (path: string) => Promise<unknown>;
  await init('/simulation_bg.wasm');

  wasmInstance = {
    Universe: mod.Universe as new (width: number, height: number) => SimulationUniverse,
    memory: (mod as Record<string, unknown>).memory as WebAssembly.Memory,
  };

  return wasmInstance;
}

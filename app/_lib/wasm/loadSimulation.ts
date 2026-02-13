// Runtime loader for the simulation WASM module.
// Loads the wasm-pack generated JS glue and .wasm from public/ at runtime,
// bypassing the bundler entirely to avoid Turbopack .wasm resolution issues.

export interface SimulationExports {
  greet: () => string;
  memory: WebAssembly.Memory;
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
    greet: mod.greet as () => string,
    memory: (mod as Record<string, unknown>).memory as WebAssembly.Memory,
  };

  return wasmInstance;
}

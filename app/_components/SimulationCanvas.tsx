'use client';

import { useEffect, useRef, useState } from 'react';
import { loadSimulation, type SimulationUniverse } from '@/app/_lib/wasm/loadSimulation';
import { Renderer } from '@/app/_lib/renderer';
import { InputHandler } from '@/app/_lib/input';

const GRID_WIDTH = 256;
const GRID_HEIGHT = 256;

type Status = 'loading' | 'running' | 'error';

export default function SimulationCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [status, setStatus] = useState<Status>('loading');
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [selectedSpecies, setSelectedSpecies] = useState(1); // Sand
  const [brushRadius, setBrushRadius] = useState(2);

  // Refs for the frame loop so callbacks don't go stale
  const universeRef = useRef<SimulationUniverse | null>(null);
  const rendererRef = useRef<Renderer | null>(null);
  const inputRef = useRef<InputHandler | null>(null);
  const rafRef = useRef<number>(0);
  const memoryRef = useRef<WebAssembly.Memory | null>(null);

  useEffect(() => {
    inputRef.current?.setSpecies(selectedSpecies);
  }, [selectedSpecies]);

  useEffect(() => {
    inputRef.current?.setBrushRadius(brushRadius);
  }, [brushRadius]);

  const frameLoopRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    frameLoopRef.current = () => {
      const universe = universeRef.current;
      const renderer = rendererRef.current;
      const input = inputRef.current;
      const memory = memoryRef.current;
      if (!universe || !renderer || !input || !memory) return;

      const commands = input.flush();
      for (const cmd of commands) {
        universe.set_cell(cmd.x, cmd.y, cmd.species);
      }

      universe.tick();

      const ptr = universe.species_ptr();
      const speciesData = new Uint8Array(memory.buffer, ptr, GRID_WIDTH * GRID_HEIGHT);

      renderer.render(speciesData);

      rafRef.current = requestAnimationFrame(() => frameLoopRef.current?.());
    };
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let cancelled = false;

    async function init() {
      if (!navigator.gpu) {
        setErrorMsg('WebGPU is required. Please use a supported browser (Chrome 113+, Edge 113+).');
        setStatus('error');
        return;
      }

      try {
        const wasm = await loadSimulation();

        if (cancelled) return;

        const universe = new wasm.Universe(GRID_WIDTH, GRID_HEIGHT);
        universeRef.current = universe;
        memoryRef.current = wasm.memory;

        const renderer = await Renderer.create(canvas!, GRID_WIDTH, GRID_HEIGHT);
        if (cancelled) {
          universe.free();
          renderer.destroy();
          return;
        }
        rendererRef.current = renderer;

        const input = new InputHandler(canvas!, GRID_WIDTH, GRID_HEIGHT);
        inputRef.current = input;

        setStatus('running');

        rafRef.current = requestAnimationFrame(() => frameLoopRef.current?.());
      } catch (err) {
        if (cancelled) return;
        setErrorMsg(`Failed to initialize simulation: ${err instanceof Error ? err.message : String(err)}`);
        setStatus('error');
      }
    }

    init();

    return () => {
      cancelled = true;
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
      }
      rendererRef.current?.destroy();
      rendererRef.current = null;
      inputRef.current?.destroy();
      inputRef.current = null;
      universeRef.current = null;
      memoryRef.current = null;
    };
  }, []);

  return (
    <div>
      {status === 'error' && (
        <p role="alert" style={{ color: '#ef4444', marginBottom: '1rem' }}>
          {errorMsg}
        </p>
      )}

      {status === 'loading' && <p>Loading simulation…</p>}

      <canvas
        ref={canvasRef}
        width={GRID_WIDTH}
        height={GRID_HEIGHT}
        style={{
          width: '512px',
          height: '512px',
          imageRendering: 'pixelated',
          display: status === 'error' ? 'none' : 'block',
          cursor: 'crosshair',
          touchAction: 'none',
        }}
      />

      {status === 'running' && (
        <div style={{ marginTop: '0.75rem', display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
          {([
            { label: 'Sand', species: 1 },
            { label: 'Water', species: 2 },
            { label: 'Wall', species: 3 },
            { label: 'Fire', species: 4 },
          ] as const).map(({ label, species }) => (
            <button
              key={species}
              onClick={() => setSelectedSpecies(species)}
              aria-pressed={selectedSpecies === species}
              style={{
                padding: '0.4rem 0.8rem',
                border: selectedSpecies === species ? '2px solid #fff' : '1px solid #555',
                borderRadius: '4px',
                background: selectedSpecies === species ? '#333' : '#1a1a1a',
                color: '#eee',
                cursor: 'pointer',
              }}
            >
              {label}
            </button>
          ))}

          <label style={{ marginLeft: '1rem', display: 'flex', alignItems: 'center', gap: '0.4rem', color: '#ccc' }}>
            Brush
            <input
              type="range"
              min={0}
              max={10}
              value={brushRadius}
              onChange={(e) => setBrushRadius(Number(e.target.value))}
              style={{ width: '80px' }}
            />
            <span style={{ minWidth: '1.5rem' }}>{brushRadius}</span>
          </label>
        </div>
      )}
    </div>
  );
}

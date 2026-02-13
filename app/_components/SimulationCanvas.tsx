'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { loadSimulation, type SimulationUniverse } from '@/app/_lib/wasm/loadSimulation';
import { Renderer } from '@/app/_lib/renderer';
import { InputHandler } from '@/app/_lib/input';

const GRID_WIDTH = 256;
const GRID_HEIGHT = 256;

type Status = 'loading' | 'running' | 'error';

const ELEMENTS = [
  { label: 'Empty', species: 0, color: '#3d352c', shortcut: 'E' },
  { label: 'Sand', species: 1, color: '#dcc872', shortcut: 'S' },
  { label: 'Water', species: 2, color: '#4a8fd4', shortcut: 'W' },
  { label: 'Wall', species: 3, color: '#8a8a8a', shortcut: 'X' },
  { label: 'Fire', species: 4, color: '#e85d2a', shortcut: 'F' },
] as const;

const BRUSH_SIZES = [0, 1, 2, 4, 6, 10] as const;

export default function SimulationCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [status, setStatus] = useState<Status>('loading');
  const [errorMsg, setErrorMsg] = useState('');
  const [selectedSpecies, setSelectedSpecies] = useState(1);
  const [brushRadius, setBrushRadius] = useState(2);
  const [paused, setPaused] = useState(false);
  const [fps, setFps] = useState(0);

  const universeRef = useRef<SimulationUniverse | null>(null);
  const rendererRef = useRef<Renderer | null>(null);
  const inputRef = useRef<InputHandler | null>(null);
  const rafRef = useRef<number>(0);
  const memoryRef = useRef<WebAssembly.Memory | null>(null);
  const pausedRef = useRef(false);
  const fpsFrames = useRef(0);
  const fpsLastTime = useRef(performance.now());

  useEffect(() => { pausedRef.current = paused; }, [paused]);
  useEffect(() => { inputRef.current?.setSpecies(selectedSpecies); }, [selectedSpecies]);
  useEffect(() => { inputRef.current?.setBrushRadius(brushRadius); }, [brushRadius]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      const key = e.key.toUpperCase();
      for (const el of ELEMENTS) {
        if (el.shortcut === key) { setSelectedSpecies(el.species); return; }
      }
      if (key === ' ') { e.preventDefault(); setPaused(p => !p); }
      if (key === 'R') { handleReset(); }
      if (e.key === '[') setBrushRadius(r => Math.max(0, r - 1));
      if (e.key === ']') setBrushRadius(r => Math.min(10, r + 1));
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const handleReset = useCallback(() => {
    const universe = universeRef.current;
    if (!universe) return;
    // Pause the frame loop so it can't touch the old universe
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    const wid = universe.width();
    const hei = universe.height();
    // Detach ref BEFORE freeing so the loop can't race
    universeRef.current = null;
    universe.free();
    loadSimulation().then(wasm => {
      const newUniverse = new wasm.Universe(wid, hei);
      universeRef.current = newUniverse;
      memoryRef.current = wasm.memory;
      // Restart the frame loop
      rafRef.current = requestAnimationFrame(() => frameLoopRef.current?.());
    });
  }, []);

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

      if (!pausedRef.current) {
        universe.tick();
      }

      // Re-read memory.buffer AFTER tick() — WASM memory growth
      // detaches the old ArrayBuffer, so we must never cache it.
      const ptr = universe.species_ptr();
      const speciesData = new Uint8Array(memory.buffer, ptr, GRID_WIDTH * GRID_HEIGHT);
      renderer.render(speciesData);

      // FPS counter
      fpsFrames.current++;
      const now = performance.now();
      if (now - fpsLastTime.current >= 1000) {
        setFps(fpsFrames.current);
        fpsFrames.current = 0;
        fpsLastTime.current = now;
      }

      rafRef.current = requestAnimationFrame(() => frameLoopRef.current?.());
    };
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let cancelled = false;

    async function init() {
      if (!navigator.gpu) {
        setErrorMsg('WebGPU is required. Use Chrome 113+ or Edge 113+.');
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
        if (cancelled) { universe.free(); renderer.destroy(); return; }
        rendererRef.current = renderer;

        const input = new InputHandler(canvas!, GRID_WIDTH, GRID_HEIGHT);
        inputRef.current = input;

        setStatus('running');
        rafRef.current = requestAnimationFrame(() => frameLoopRef.current?.());
      } catch (err) {
        if (cancelled) return;
        setErrorMsg(`Init failed: ${err instanceof Error ? err.message : String(err)}`);
        setStatus('error');
      }
    }

    init();

    return () => {
      cancelled = true;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rendererRef.current?.destroy();
      rendererRef.current = null;
      inputRef.current?.destroy();
      inputRef.current = null;
      // Explicitly free the WASM Universe so the FinalizationRegistry
      // unregisters the pointer immediately. Without this, GC can free
      // the old Universe at an unpredictable time — corrupting the WASM
      // heap while a new Universe (from React Strict Mode re-mount) is
      // actively using it, causing intermittent "memory access out of bounds".
      universeRef.current?.free();
      universeRef.current = null;
      memoryRef.current = null;
    };
  }, []);

  return (
    <div style={styles.container}>
      {/* Canvas area */}
      <div style={styles.canvasWrapper}>
        {status === 'loading' && (
          <div style={styles.loadingOverlay}>
            <div style={styles.loadingText}>Loading simulation…</div>
            <div style={styles.loadingBar}>
              <div style={styles.loadingBarFill} />
            </div>
          </div>
        )}
        {status === 'error' && (
          <div style={styles.errorOverlay} role="alert">
            <div style={styles.errorIcon}>⚠</div>
            <div style={styles.errorText}>{errorMsg}</div>
          </div>
        )}
        <canvas
          ref={canvasRef}
          width={GRID_WIDTH}
          height={GRID_HEIGHT}
          style={{
            ...styles.canvas,
            display: status === 'error' ? 'none' : 'block',
          }}
        />
        {/* FPS badge */}
        {status === 'running' && (
          <div style={styles.fpsBadge}>
            FPS:{fps}
          </div>
        )}
      </div>

      {/* Sidebar */}
      {status === 'running' && (
        <div style={styles.sidebar}>
          {/* Playback controls */}
          <div style={styles.section}>
            <div style={styles.sectionLabel}>Playback</div>
            <div style={styles.playbackRow}>
              <button
                onClick={() => setPaused(p => !p)}
                style={styles.controlBtn}
                aria-label={paused ? 'Play' : 'Pause'}
                title="Space"
              >
                {paused ? '▶' : '❚❚'}
              </button>
              <button
                onClick={handleReset}
                style={styles.controlBtn}
                aria-label="Reset"
                title="R"
              >
                ↺
              </button>
            </div>
          </div>

          {/* Brush size */}
          <div style={styles.section}>
            <div style={styles.sectionLabel}>Brush</div>
            <div style={styles.brushRow}>
              {BRUSH_SIZES.map(size => (
                <button
                  key={size}
                  onClick={() => setBrushRadius(size)}
                  aria-pressed={brushRadius === size}
                  style={{
                    ...styles.brushDot,
                    background: brushRadius === size ? 'var(--text-primary)' : 'var(--text-muted)',
                    width: `${Math.max(8, 6 + size * 3)}px`,
                    height: `${Math.max(8, 6 + size * 3)}px`,
                    outline: brushRadius === size ? '2px solid var(--accent-gold)' : 'none',
                    outlineOffset: '2px',
                  }}
                  aria-label={`Brush size ${size}`}
                  title={`[ / ] to adjust`}
                />
              ))}
            </div>
          </div>

          {/* Elements */}
          <div style={styles.section}>
            <div style={styles.sectionLabel}>Elements</div>
            <div style={styles.elementsGrid}>
              {ELEMENTS.map(({ label, species, color, shortcut }) => (
                <button
                  key={species}
                  onClick={() => setSelectedSpecies(species)}
                  aria-pressed={selectedSpecies === species}
                  style={{
                    ...styles.elementBtn,
                    borderColor: selectedSpecies === species ? color : 'var(--border-warm)',
                    background: selectedSpecies === species
                      ? `${color}18`
                      : 'var(--bg-panel)',
                    boxShadow: selectedSpecies === species
                      ? `0 0 12px ${color}30, inset 0 0 20px ${color}10`
                      : 'none',
                  }}
                >
                  <span
                    style={{
                      ...styles.elementSwatch,
                      background: color,
                      boxShadow: `0 0 6px ${color}60`,
                    }}
                  />
                  <span style={styles.elementLabel}>{label}</span>
                  <span style={styles.elementShortcut}>{shortcut}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Info */}
          <div style={styles.infoSection}>
            <div style={styles.infoText}>
              Click & drag to paint
            </div>
            <div style={styles.infoText}>
              <span style={styles.kbd}>[ ]</span> brush size
              <span style={{ margin: '0 6px' }}>·</span>
              <span style={styles.kbd}>Space</span> pause
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    gap: '20px',
    alignItems: 'flex-start',
  },
  canvasWrapper: {
    position: 'relative',
    borderRadius: '6px',
    overflow: 'hidden',
    border: '2px solid #3d352c',
    boxShadow: '0 8px 32px rgba(0,0,0,0.5), 0 0 0 1px rgba(200,169,110,0.08)',
    background: '#0f0d0b',
    lineHeight: 0,
  },
  canvas: {
    width: '560px',
    height: '560px',
    imageRendering: 'pixelated',
    cursor: 'crosshair',
    touchAction: 'none',
  },
  loadingOverlay: {
    position: 'absolute',
    inset: 0,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    background: '#0f0d0b',
    gap: '16px',
    zIndex: 10,
  },
  loadingText: {
    fontFamily: "var(--font-pixel), monospace",
    fontSize: '14px',
    color: '#9c8e7c',
    letterSpacing: '1px',
  },
  loadingBar: {
    width: '120px',
    height: '4px',
    background: '#2a2520',
    borderRadius: '2px',
    overflow: 'hidden',
  },
  loadingBarFill: {
    width: '40%',
    height: '100%',
    background: '#c8a96e',
    borderRadius: '2px',
    animation: 'pulse 1.2s ease-in-out infinite',
  },
  errorOverlay: {
    position: 'absolute',
    inset: 0,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    background: '#0f0d0b',
    gap: '12px',
    padding: '32px',
    zIndex: 10,
  },
  errorIcon: {
    fontSize: '32px',
    opacity: 0.6,
  },
  errorText: {
    color: '#e85d2a',
    fontSize: '13px',
    textAlign: 'center',
    lineHeight: 1.5,
    maxWidth: '320px',
  },
  fpsBadge: {
    position: 'absolute',
    bottom: '8px',
    right: '8px',
    fontFamily: "var(--font-pixel), monospace",
    fontSize: '11px',
    color: '#6b5f52',
    background: 'rgba(15,13,11,0.7)',
    padding: '2px 6px',
    borderRadius: '3px',
    pointerEvents: 'none',
  },
  sidebar: {
    display: 'flex',
    flexDirection: 'column',
    gap: '20px',
    width: '160px',
    flexShrink: 0,
  },
  section: {
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
  },
  sectionLabel: {
    fontFamily: "var(--font-pixel), monospace",
    fontSize: '10px',
    color: '#6b5f52',
    textTransform: 'uppercase',
    letterSpacing: '2px',
  },
  playbackRow: {
    display: 'flex',
    gap: '6px',
  },
  controlBtn: {
    width: '36px',
    height: '36px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    border: '1px solid #3d352c',
    borderRadius: '6px',
    background: '#2a2520',
    color: '#e8ddd0',
    fontSize: '14px',
    cursor: 'pointer',
    transition: 'background 0.15s, border-color 0.15s',
  },
  brushRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '4px 0',
  },
  brushDot: {
    borderRadius: '50%',
    border: 'none',
    cursor: 'pointer',
    padding: 0,
    flexShrink: 0,
    transition: 'transform 0.12s',
  },
  elementsGrid: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  },
  elementBtn: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '7px 10px',
    border: '1px solid #3d352c',
    borderRadius: '6px',
    cursor: 'pointer',
    transition: 'all 0.15s',
    fontSize: '13px',
    color: '#e8ddd0',
  },
  elementSwatch: {
    display: 'inline-block',
    width: '10px',
    height: '10px',
    borderRadius: '2px',
    flexShrink: 0,
  },
  elementLabel: {
    flex: 1,
    fontFamily: "var(--font-body), sans-serif",
    fontSize: '13px',
  },
  elementShortcut: {
    fontFamily: "var(--font-pixel), monospace",
    fontSize: '9px',
    color: '#6b5f52',
    opacity: 0.7,
  },
  infoSection: {
    marginTop: 'auto',
    paddingTop: '16px',
    borderTop: '1px solid #2a2520',
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
  },
  infoText: {
    fontSize: '11px',
    color: '#6b5f52',
    lineHeight: 1.4,
  },
  kbd: {
    fontFamily: "var(--font-pixel), monospace",
    fontSize: '9px',
    padding: '1px 4px',
    border: '1px solid #3d352c',
    borderRadius: '3px',
    background: '#2a2520',
    color: '#9c8e7c',
  },
};

'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { loadSimulation, type SimulationUniverse } from '@/app/_lib/wasm/loadSimulation';
import { Renderer } from '@/app/_lib/renderer';
import { InputHandler } from '@/app/_lib/input';
import { ghostStamp, GHOST_SPECIES } from '@/app/_lib/stamps';
import { useTheme } from '@/app/_lib/useTheme';

const GRID_WIDTH = 256;
const GRID_HEIGHT = 256;

type Status = 'loading' | 'running' | 'error' | 'crashed';

const ELEMENTS = [
  { label: 'Eraser', species: 0, color: 'var(--el-empty)', rawColor: '#3d352c', shortcut: 'E' },
  { label: 'Sand', species: 1, color: 'var(--el-sand)', rawColor: '#dcc872', shortcut: 'S' },
  { label: 'Water', species: 2, color: 'var(--el-water)', rawColor: '#4a8fd4', shortcut: 'W' },
  { label: 'Wall', species: 3, color: 'var(--el-wall)', rawColor: '#8a8a8a', shortcut: 'X' },
  { label: 'Fire', species: 4, color: 'var(--el-fire)', rawColor: '#e85d2a', shortcut: 'F' },
  { label: 'Ghost', species: 5, color: '#f0f0f7', rawColor: '#f0f0f7', shortcut: 'G' },
  { label: 'Smoke', species: 6, color: '#7a7a7a', rawColor: '#7a7a7a', shortcut: 'K' },
] as const;

const BRUSH_SIZES = [0, 1, 2, 4, 6, 10] as const;

/** Refs bundle passed to the frame loop to avoid per-ref closures. */
interface SimRefs {
  universe: React.RefObject<SimulationUniverse | null>;
  renderer: React.RefObject<Renderer | null>;
  input: React.RefObject<InputHandler | null>;
  memory: React.RefObject<WebAssembly.Memory | null>;
  paused: React.RefObject<boolean>;
  raf: React.RefObject<number>;
  fpsFrames: React.RefObject<number>;
  fpsLastTime: React.RefObject<number>;
  setFps: (fps: number) => void;
  onError: (msg: string) => void;
}

/** Module-level frame loop — no hooks, no self-reference issues. */
function runFrame(refs: SimRefs) {
  const universe = refs.universe.current;
  const renderer = refs.renderer.current;
  const input = refs.input.current;
  const memory = refs.memory.current;
  if (!universe || !renderer || !input || !memory) return;

  try {
    const commands = input.flush();
    for (const cmd of commands) {
      if (cmd.species === GHOST_SPECIES) {
        const group = universe.alloc_ghost_group();
      const stampCmds = ghostStamp(cmd.x, cmd.y, GHOST_SPECIES, GRID_WIDTH, GRID_HEIGHT);
      for (const sc of stampCmds) {
        universe.set_ghost(sc.x, sc.y, group);
      }
    } else {
      universe.set_cell(cmd.x, cmd.y, cmd.species);
    }
  }

  if (!refs.paused.current) {
    universe.tick();
  }

  const ptr = universe.cell_render_ptr();
  const cellRenderData = new Uint8Array(memory.buffer, ptr, GRID_WIDTH * GRID_HEIGHT * 2);
  renderer.render(cellRenderData);
  } catch (e) {
    refs.universe.current = null;
    refs.onError(e instanceof Error ? e.message : String(e));
    return;
  }

  refs.fpsFrames.current!++;
  const now = performance.now();
  if (now - refs.fpsLastTime.current! >= 1000) {
    refs.setFps(refs.fpsFrames.current!);
    refs.fpsFrames.current = 0;
    refs.fpsLastTime.current = now;
  }

  refs.raf.current = requestAnimationFrame(() => runFrame(refs));
}

export default function SimulationCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [status, setStatus] = useState<Status>('loading');
  const [errorMsg, setErrorMsg] = useState('');
  const [selectedSpecies, setSelectedSpecies] = useState(1);
  const [brushRadius, setBrushRadius] = useState(2);
  const [paused, setPaused] = useState(false);
  const [fps, setFps] = useState(0);
  const { theme, toggle: toggleTheme } = useTheme();

  const universeRef = useRef<SimulationUniverse | null>(null);
  const rendererRef = useRef<Renderer | null>(null);
  const inputRef = useRef<InputHandler | null>(null);
  const rafRef = useRef<number>(0);
  const memoryRef = useRef<WebAssembly.Memory | null>(null);
  const pausedRef = useRef(false);
  const fpsFrames = useRef(0);
  const fpsLastTime = useRef(0);

  // Stable refs bundle for the module-level frame loop.
  const simRefs = useRef<SimRefs>({
    universe: universeRef,
    renderer: rendererRef,
    input: inputRef,
    memory: memoryRef,
    paused: pausedRef,
    raf: rafRef,
    fpsFrames,
    fpsLastTime,
    setFps,
    onError: (msg: string) => {
      setErrorMsg(msg);
      setStatus('crashed');
    },
  });

  useEffect(() => { pausedRef.current = paused; }, [paused]);
  useEffect(() => { inputRef.current?.setSpecies(selectedSpecies); }, [selectedSpecies]);
  useEffect(() => { inputRef.current?.setBrushRadius(brushRadius); }, [brushRadius]);
  useEffect(() => { inputRef.current?.setStampMode(selectedSpecies === GHOST_SPECIES); }, [selectedSpecies]);
  useEffect(() => { rendererRef.current?.setTheme(theme === 'light' ? 1 : 0); }, [theme]);

  const handleReset = useCallback(() => {
    const universe = universeRef.current;
    if (!universe) return;
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = 0;
    const wid = universe.width();
    const hei = universe.height();
    universeRef.current = null;
    universe.free();
    loadSimulation().then(wasm => {
      const newUniverse = new wasm.Universe(wid, hei);
      universeRef.current = newUniverse;
      memoryRef.current = wasm.memory;
      rafRef.current = requestAnimationFrame(() => runFrame(simRefs.current));
    });
  }, []);

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
      if (key === 'T') { toggleTheme(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [handleReset, toggleTheme]);

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

        const renderer = await Renderer.create(canvas!, GRID_WIDTH, GRID_HEIGHT);
        if (cancelled) {
          universe.free();
          renderer.destroy();
          return;
        }

        universeRef.current = universe;
        memoryRef.current = wasm.memory;
        rendererRef.current = renderer;

        // Apply stored theme immediately so first frame is correct
        const storedTheme = localStorage.getItem('falling-sand-theme');
        renderer.setTheme(storedTheme === 'light' ? 1 : 0);

        const input = new InputHandler(canvas!, GRID_WIDTH, GRID_HEIGHT);
        inputRef.current = input;

        setStatus('running');
        rafRef.current = requestAnimationFrame(() => runFrame(simRefs.current));
      } catch (err) {
        if (cancelled) return;
        setErrorMsg(`Init failed: ${err instanceof Error ? err.message : String(err)}`);
        setStatus('error');
      }
    }

    init();

    return () => {
      cancelled = true;
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = 0;
      }
      rendererRef.current?.destroy();
      rendererRef.current = null;
      inputRef.current?.destroy();
      inputRef.current = null;
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
        {status === 'crashed' && (
          <div style={styles.errorOverlay} role="alert">
            <div style={styles.errorIcon}>💥</div>
            <div style={styles.errorText}>Simulation crashed</div>
            <button
              onClick={() => window.location.reload()}
              style={styles.reloadBtn}
            >
              Reload
            </button>
          </div>
        )}
        <canvas
          ref={canvasRef}
          width={GRID_WIDTH}
          height={GRID_HEIGHT}
          style={{
            ...styles.canvas,
            display: (status === 'error' || status === 'crashed') ? 'none' : 'block',
          }}
        />
      </div>

      {/* FPS badge */}
      {status === 'running' && (
        <div style={styles.fpsBadge}>
          FPS:{fps}
        </div>
      )}

      {/* Sidebar */}
      {status === 'running' && (
        <div style={styles.sidebar}>
          {/* Theme toggle + Playback */}
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
              <div style={{ flex: 1 }} />
              <button
                onClick={toggleTheme}
                style={styles.themeToggle}
                aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
                title="T"
              >
                <span style={styles.themeToggleTrack}>
                  <span
                    style={{
                      ...styles.themeToggleThumb,
                      transform: theme === 'light' ? 'translateX(18px)' : 'translateX(0)',
                    }}
                  />
                  <span style={{
                    ...styles.themeToggleIcon,
                    left: '4px',
                    opacity: theme === 'dark' ? 1 : 0.3,
                  }}>
                    ☽
                  </span>
                  <span style={{
                    ...styles.themeToggleIcon,
                    right: '4px',
                    opacity: theme === 'light' ? 1 : 0.3,
                  }}>
                    ☀
                  </span>
                </span>
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
              {ELEMENTS.map(({ label, species, color, rawColor, shortcut }) => (
                <button
                  key={species}
                  onClick={() => setSelectedSpecies(species)}
                  aria-pressed={selectedSpecies === species}
                  style={{
                    ...styles.elementBtn,
                    borderColor: selectedSpecies === species ? rawColor : 'var(--border-warm)',
                    background: selectedSpecies === species
                      ? `${rawColor}18`
                      : 'var(--bg-panel)',
                    boxShadow: selectedSpecies === species
                      ? `0 0 12px ${rawColor}30, inset 0 0 20px ${rawColor}10`
                      : 'none',
                  }}
                >
                  <span
                    style={{
                      ...styles.elementSwatch,
                      background: color,
                      boxShadow: `0 0 6px ${rawColor}60`,
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
    border: '2px solid var(--border-warm)',
    boxShadow: 'var(--canvas-shadow)',
    background: 'var(--bg-canvas-surround)',
    lineHeight: 0,
    transition: 'border-color 0.35s, box-shadow 0.35s, background 0.35s',
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
    background: 'var(--bg-canvas-surround)',
    gap: '16px',
    zIndex: 10,
  },
  loadingText: {
    fontFamily: "var(--font-pixel), monospace",
    fontSize: '14px',
    color: 'var(--text-secondary)',
    letterSpacing: '1px',
  },
  loadingBar: {
    width: '120px',
    height: '4px',
    background: 'var(--bg-panel)',
    borderRadius: '2px',
    overflow: 'hidden',
  },
  loadingBarFill: {
    width: '40%',
    height: '100%',
    background: 'var(--accent-gold)',
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
    background: 'var(--bg-canvas-surround)',
    gap: '12px',
    padding: '32px',
    zIndex: 10,
  },
  errorIcon: {
    fontSize: '32px',
    opacity: 0.6,
  },
  errorText: {
    color: 'var(--el-fire)',
    fontSize: '13px',
    textAlign: 'center',
    lineHeight: 1.5,
    maxWidth: '320px',
  },
  reloadBtn: {
    marginTop: '8px',
    padding: '6px 18px',
    border: '1px solid var(--border-warm)',
    borderRadius: '6px',
    background: 'var(--bg-panel)',
    color: 'var(--text-primary)',
    fontSize: '13px',
    cursor: 'pointer',
    transition: 'background 0.15s, border-color 0.15s',
  },
  fpsBadge: {
    position: 'fixed',
    bottom: '12px',
    right: '12px',
    fontFamily: "var(--font-pixel), monospace",
    fontSize: '11px',
    color: 'var(--text-muted)',
    background: 'var(--fps-bg)',
    padding: '2px 6px',
    borderRadius: '3px',
    pointerEvents: 'none',
    zIndex: 50,
    transition: 'color 0.35s, background 0.35s',
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
    color: 'var(--text-muted)',
    textTransform: 'uppercase',
    letterSpacing: '2px',
    transition: 'color 0.35s',
  },
  playbackRow: {
    display: 'flex',
    gap: '6px',
    alignItems: 'center',
  },
  controlBtn: {
    width: '36px',
    height: '36px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    border: '1px solid var(--border-warm)',
    borderRadius: '6px',
    background: 'var(--bg-panel)',
    color: 'var(--text-primary)',
    fontSize: '14px',
    cursor: 'pointer',
    transition: 'background 0.15s, border-color 0.15s, color 0.35s',
  },
  themeToggle: {
    background: 'none',
    border: 'none',
    padding: 0,
    cursor: 'pointer',
    lineHeight: 0,
  },
  themeToggleTrack: {
    display: 'inline-flex',
    alignItems: 'center',
    position: 'relative' as const,
    width: '38px',
    height: '20px',
    borderRadius: '10px',
    background: 'var(--toggle-bg)',
    border: '1px solid var(--border-warm)',
    transition: 'background 0.35s, border-color 0.35s',
  },
  themeToggleThumb: {
    position: 'absolute' as const,
    top: '2px',
    left: '2px',
    width: '14px',
    height: '14px',
    borderRadius: '50%',
    background: 'var(--accent-gold)',
    transition: 'transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
    zIndex: 2,
  },
  themeToggleIcon: {
    position: 'absolute' as const,
    fontSize: '10px',
    transition: 'opacity 0.3s',
    zIndex: 1,
    lineHeight: '20px',
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
    border: '1px solid var(--border-warm)',
    borderRadius: '6px',
    cursor: 'pointer',
    transition: 'all 0.15s',
    fontSize: '13px',
    color: 'var(--text-primary)',
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
    color: 'var(--text-muted)',
    opacity: 0.7,
    transition: 'color 0.35s',
  },
  infoSection: {
    marginTop: 'auto',
    paddingTop: '16px',
    borderTop: '1px solid var(--bg-panel)',
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
    transition: 'border-color 0.35s',
  },
  infoText: {
    fontSize: '11px',
    color: 'var(--text-muted)',
    lineHeight: 1.4,
    transition: 'color 0.35s',
  },
  kbd: {
    fontFamily: "var(--font-pixel), monospace",
    fontSize: '9px',
    padding: '1px 4px',
    border: '1px solid var(--border-warm)',
    borderRadius: '3px',
    background: 'var(--bg-panel)',
    color: 'var(--text-secondary)',
    transition: 'background 0.35s, border-color 0.35s, color 0.35s',
  },
};

'use client';

export default function Error({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main
      style={{
        display: 'flex',
        height: '100dvh',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--gradient-bg)',
        flexDirection: 'column',
        gap: '16px',
      }}
    >
      <div style={{ fontSize: '32px', opacity: 0.6 }}>💥</div>
      <div
        style={{
          color: 'var(--el-fire)',
          fontSize: '13px',
          fontFamily: 'var(--font-pixel), monospace',
        }}
      >
        Something went wrong
      </div>
      <button
        onClick={() => reset()}
        style={{
          padding: '6px 18px',
          border: '1px solid var(--border-warm)',
          borderRadius: '6px',
          background: 'var(--bg-panel)',
          color: 'var(--text-primary)',
          fontSize: '13px',
          cursor: 'pointer',
          transition: 'background 0.35s, border-color 0.35s, color 0.35s',
        }}
      >
        Try again
      </button>
    </main>
  );
}

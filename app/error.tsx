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
        background: 'radial-gradient(ellipse at 50% 40%, #2a2520 0%, #1a1714 70%)',
        flexDirection: 'column',
        gap: '16px',
      }}
    >
      <div style={{ fontSize: '32px', opacity: 0.6 }}>💥</div>
      <div
        style={{
          color: '#e85d2a',
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
          border: '1px solid #3d352c',
          borderRadius: '6px',
          background: '#2a2520',
          color: '#e8ddd0',
          fontSize: '13px',
          cursor: 'pointer',
        }}
      >
        Try again
      </button>
    </main>
  );
}

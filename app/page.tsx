import SimulationLoader from './_components/SimulationLoader';

export default function Home() {
  return (
    <main
      style={{
        display: 'flex',
        height: '100dvh',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--gradient-bg)',
        transition: 'background 0.35s ease',
      }}
    >
      <SimulationLoader />
    </main>
  );
}

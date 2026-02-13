import SimulationLoader from './_components/SimulationLoader';

export default function Home() {
  return (
    <main style={{ padding: '1rem' }}>
      <h1 style={{ marginBottom: '0.75rem' }}>Falling Sand</h1>
      <SimulationLoader />
    </main>
  );
}

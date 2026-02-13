import SimulationLoader from './_components/SimulationLoader';

export default function Home() {
  return (
    <main
      style={{
        display: 'flex',
        height: '100dvh',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'radial-gradient(ellipse at 50% 40%, #2a2520 0%, #1a1714 70%)',
      }}
    >
      <SimulationLoader />
    </main>
  );
}

'use client';

import dynamic from 'next/dynamic';

const SimulationCanvas = dynamic(() => import('./SimulationCanvas'), {
  ssr: false,
  loading: () => <p>Loading simulation…</p>,
});

export default function SimulationLoader() {
  return <SimulationCanvas />;
}

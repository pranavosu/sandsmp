'use client';

import dynamic from 'next/dynamic';

const WasmTest = dynamic(() => import('./WasmTest'), {
  ssr: false,
  loading: () => <p>Loading simulation...</p>,
});

export default function SimulationLoader() {
  return <WasmTest />;
}

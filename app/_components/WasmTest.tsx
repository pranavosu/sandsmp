'use client';

import { useEffect, useState } from 'react';
import { loadSimulation } from '@/app/_lib/wasm/loadSimulation';

export default function WasmTest() {
  const [message, setMessage] = useState<string>('Loading WASM...');

  useEffect(() => {
    loadSimulation()
      .then((wasm) => setMessage(wasm.greet()))
      .catch((err) => setMessage(`WASM load failed: ${err}`));
  }, []);

  return <p>{message}</p>;
}

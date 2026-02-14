'use client';

import { useState, useEffect, useCallback } from 'react';

export type Theme = 'dark' | 'light';

const STORAGE_KEY = 'falling-sand-theme';

export function useTheme() {
  const [theme, setTheme] = useState<Theme>('light');

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY) as Theme | null;
    if (stored === 'light' || stored === 'dark') {
      setTheme(stored);
      document.documentElement.setAttribute('data-theme', stored);
    } else {
      document.documentElement.setAttribute('data-theme', 'light');
    }
  }, []);

  const toggle = useCallback(() => {
    setTheme(prev => {
      const next = prev === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      localStorage.setItem(STORAGE_KEY, next);
      return next;
    });
  }, []);

  return { theme, toggle } as const;
}

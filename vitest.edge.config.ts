import { defineConfig } from 'vitest/config';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  resolve: { alias: [{ find: 'jsr:@supabase/functions-js/edge-runtime.d.ts',
    replacement: fileURLToPath(new URL('./supabase/functions/_tests/runtime.ts', import.meta.url)) }] },
  test: { environment: 'node', include: ['supabase/functions/**/*.test.ts'],
    setupFiles: ['./supabase/functions/_tests/setup.ts'] },
});

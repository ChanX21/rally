import { defineConfig } from 'vitest/config';

// Pure AI contract/transport tests need neither PostgreSQL nor funded inference.
export default defineConfig({ test: { include: ['test/formation.test.ts', 'test/zero-g.test.ts'], testTimeout: 5000 } });

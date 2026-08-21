import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

import '@testing-library/jest-dom/vitest';

// @testing-library/react only auto-registers its own afterEach(cleanup)
// when it detects Vitest's `globals: true` mode — this config doesn't
// enable that (explicit imports everywhere else), so register it here
// instead, once, for every spec file.
afterEach(() => {
  cleanup();
});

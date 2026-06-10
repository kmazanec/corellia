import { loadDotEnv } from '../src/env.js';

// A developer's .env (e.g. DATABASE_URL) flows into the suite so the pg
// integration tests enable themselves; real environment variables still win.
loadDotEnv();

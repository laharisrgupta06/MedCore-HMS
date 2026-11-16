import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

// Integration tests read the repository-root .env (created from .env.example).
const envFile = resolve(__dirname, '../../../.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

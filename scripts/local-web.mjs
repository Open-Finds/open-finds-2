import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const command = process.argv[2];
if (!['dev', 'build', 'preview'].includes(command)) throw new Error('Use dev, build or preview.');
const root = fileURLToPath(new URL('../', import.meta.url));
const vite = fileURLToPath(new URL('../node_modules/vite/bin/vite.js', import.meta.url));
const args = command === 'dev' ? [] : [command];
args.push('--mode', 'local-preview');
if (command !== 'build') args.push('--host', '127.0.0.1', '--port', command === 'dev' ? '5173' : '4173', '--strictPort');
// Process-level values take precedence over Vite env files. This workflow
// cannot accidentally connect to a production URL from an existing .env file.
const child = spawn(process.execPath, [vite, ...args], { cwd: root, stdio: 'inherit', env: {
  ...process.env,
  VITE_SUPABASE_URL: 'http://127.0.0.1:54321',
  VITE_SUPABASE_ANON_KEY: 'local-preview-placeholder-not-a-credential',
  VITE_SENTRY_DSN: '', VITE_STRIPE_PUBLISHABLE_KEY: '', VITE_VAPID_PUBLIC_KEY: '',
  VITE_GOOGLE_SIGN_IN: 'false', VITE_FACEBOOK_SIGN_IN: 'false',
} });
child.on('error', (error) => { console.error(error.message); process.exitCode = 1; });
child.on('exit', (code) => { process.exitCode = code ?? 1; });

// Brief W1 Addendum S: shared by the contract test and the public e2e test.
// Paths from Cloudflare's reports of 14 Nov 2026 (aeo-demand-signals, aeo-popular-pages) and Addendum S.
export const PROBES = [
  '/.env', '/.env.local', '/.env.dev', '/.env.prod', '/portal/.env', '/.git/HEAD', '/.git/config', '/.aws/credentials',
  '/serviceAccountKey.json', '/gcp-key.json', '/firebase-credentials.json', '/firebase-adminsdk.json', '/Dockerfile',
  '/.terraform/terraform.tfstate', '/terraform.tfstate', '/index.php', '/phpinfo.php', '/wp-login.php', '/wp-admin/',
  '/wp-json', '/actuator', '/actuator/health', '/_ignition/health-check', '/_debugbar/open', '/telescope/requests',
  '/graphql', '/graphql/console', '/litellm/config', '/nacos/v1/auth', '/media../.env', '/api%2F.env',
  '/api/uploads/%2e%2e%2f%2e%2e%2f.env', '/proc/self/environ', '/values.yaml', '/docker-compose.yml', '/config.toml',
  '/backup.sql', '/debug.log', '/server.key', '/cert.pem', '/db.bak', '/.index.php.swp', '/config.json', '/package.json',
  '/next.config.js', '/next.config.mjs', '/credentials.js', '/__env.js', '/server-status', '/console', '/admin/api-tokens',
  '/api/env', '/api/v1/keys', '/api/v1/secrets', '/storage/logs/laravel.log', '/config/database.yml', '/ssl/private.key',
  '/userfiles/x', '/.vscode/sftp.json', '/.DS_Store', '/static..%5c..%5cwindows/win.ini',
]

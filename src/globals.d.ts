// Build-time constants injected by Vite `define` (see vite.config.ts).

/**
 * Default rysh-server base URL baked into the bundle at build time.
 * Controlled by the VITE_RYSH_SERVER_URL env var, which the Makefile sets:
 *   - `make build-prod` / `make deploy-prod` → "https://rysh.ai"
 *   - `make build-test` / `make deploy-test` → the local rysh-server
 * Defaults to "https://rysh.ai" when unset.
 */
declare const __RYSH_DEFAULT_SERVER_URL__: string;

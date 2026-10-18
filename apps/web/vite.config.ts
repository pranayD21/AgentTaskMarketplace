import { defineConfig, loadEnv } from "vite";
import path from "node:path";
import { fileURLToPath } from "node:url";
// Server-only JavaScript shared with isolated transport tests.
// @ts-expect-error JavaScript module has no declaration file.
import { createBuyerBridge } from "./server/buyer.mjs";

export default defineConfig(({mode}) => {
  const hosted = mode === 'hosted';
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const env = loadEnv(mode, path.join(root,'apps/web'), 'VITE_');
  const base = new URL(env.VITE_MARKETPLACE_BASE_URL || 'http://localhost:3000');
  base.pathname = '/mcp'; base.search = ''; base.hash = '';
  const middleware = hosted ? null : createBuyerBridge({endpoint:base.toString(),
    statePath:path.join(root,'.atm-state/buyer.json'),journalDir:path.join(root,'.atm-state/web-buyer'),
    budgetPath:path.join(root,'.atm-state/benchmark-api-budget.json'),policyPath:path.join(root,'.atm-state/web-buyer-policy.json')});
  return {
    base: hosted ? '/marketplace/' : '/',
    server: { host: "127.0.0.1", port: 5173, strictPort: true,
      fs:{deny:['.env','.env.*','*.{crt,pem,key}','**/.git/**','**/.atm-state/**']} },
    preview: { host: "127.0.0.1", port: 5173, strictPort: true },
    plugins:middleware ? [{name:'local-buyer-tester',configureServer(server){server.middlewares.use(middleware);},
      configurePreviewServer(server){server.middlewares.use(middleware);}}] : [],
  };
});

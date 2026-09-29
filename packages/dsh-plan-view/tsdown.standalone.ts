// Standalone client-bundle config for a plugin package OUTSIDE the harness
// workspace. The shared preset lives at deepseek-harness
// packages/client/tsdown.client.ts and — by contract — only serves packages
// under its own packages/*/* tree (workspaceManifest hard-scans that layout;
// ch14 dev-cookbook: 「生成它的 clientBundle preset 在
// packages/client/tsdown.client.ts，仓库外的包要自己复刻」). This file is that
// faithful replica for dsh-plan-view: same lazy-CJS factory artifact shape
// (window.__ModuleLoader__.load({id, factory})), same CJS/browser/format
// rules, same baseline externals. Keep it in sync with the preset when the
// harness face changes; PLATFORM_MODULES below is snapshotted against
// dsh 0.1.7-rc.2 (2026-09-29).
//
// Build: npx tsdown --config tsdown.standalone.ts

// No `import { defineConfig } from 'tsdown'` here on purpose: tsdown itself is
// not a dependency of this repo (built via `npx tsdown`), so a bare object
// export keeps the config loadable without resolving the package.

const ID = 'dsh-plan-view'

// PLATFORM_MODULES (shell module table) + this package's dsh.client.inject
// rows (package.json) — requested specifiers stay require()'d externals,
// everything else inlines into the bundle.
const EXTERNALS = new Set([
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-dockkit',
  // dsh.client.inject:
  '@deepseek-ai/dsh-client-runtime',
  '@deepseek-ai/dsh-client-locale',
])

export default {
  entry: { client: 'src/client/index.tsx' },
  outDir: 'lib',
  format: 'cjs',
  platform: 'browser',
  dts: false,
  sourcemap: true,
  clean: false,
  deps: {
    neverBundle: (specifier: string) => EXTERNALS.has(specifier),
    alwaysBundle: (specifier: string) => !EXTERNALS.has(specifier),
  },
  inputOptions: {
    resolve: {
      conditionNames: ['production', 'browser', 'import', 'module', 'default'],
    },
  },
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
    'import.meta.env.MODE': JSON.stringify('production'),
    'import.meta.env': JSON.stringify({ MODE: 'production' }),
  },
  outputOptions: {
    entryFileNames: 'client.js',
    chunkFileNames: 'client.[name].js',
    banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(ID)}, factory: (require) => {`,
    footer: 'return module.exports; } });',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
  },
}

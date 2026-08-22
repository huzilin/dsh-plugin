/**
 * Build the dsh-approve CLIENT half with the same tsdown client face the DSH
 * workspace uses (window.__ModuleLoader__.load closure artifact, externals via
 * the injected require, CSS Modules via lightningcss). The preset lives in
 * the harness checkout; the config imports it by absolute path so this package
 * stays outside the DSH workspace (published/linked standalone).
 */
import { clientBundle } from '/Users/huzilin/workdir/deepseek-harness/packages/client/tsdown.client.ts'

export default clientBundle('dsh-approve', ['src/client/index.ts'])
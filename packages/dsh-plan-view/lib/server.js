/**
 * dsh-plan-view — host-side Cordis entry.
 *
 * This plugin is CLIENT-only: it registers a Plan tab in the better-sidebar,
 * which lives entirely in `lib/client.js` (built by tsdown with the DSH
 * client face and loaded by the browser module system). The Node half has no
 * host-side logic, but the Cordis loader imports this entry via
 * `package.json main / exports["."]`, so it must exist and be side-effect
 * free — never import react or any browser-only module here.
 */
export const name = 'dsh-plan-view'

export function apply() {
  // No host-side behavior — the Plan tab is registered client-side.
}
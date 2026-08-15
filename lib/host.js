// Host half of dsh-model-picker: a no-op plugin. All behavior lives in the
// browser client half (lib/client.js, served through the ./client export).
// The Node-side loader imports this file as the package root entry, so it
// must stay Node-safe: no window/document access at module scope.
export const name = 'dsh-model-picker'

export const inject = []

export function apply() {
  // Intentionally empty: the composer model seat is contributed by the
  // client half over the web plugin loader.
}

# Repository Rules

## Required version increment

Every coherent change set must increment the Quickspeak version exactly once before it is considered complete. This applies to source code, styles, configuration, tests, documentation, and assets.

Use semantic versioning:

- Patch for fixes and small compatible changes.
- Minor for compatible feature additions.
- Major for incompatible changes.

Keep the same version in all of these locations:

- `package.json`
- `public/manifest.json`
- The `<title>` in `src/ui.html`, formatted as `Quickspeak vX.Y.Z`
- `package-lock.json`, if one is added to the repository

Do not make a separate version-only follow-up commit. Include the version increment in the same change set, then run `npm test` and `npm run build`. The version synchronization test must pass before the change is complete.

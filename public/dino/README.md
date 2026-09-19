# Locally Hosted Dinosaur Runner

`offline.js`, `offline-sprite-definitions.js`, and the two sprite PNGs are
unmodified Chromium resources from tag `98.0.4758.55`:

https://chromium.googlesource.com/chromium/src/+/refs/tags/98.0.4758.55/components/neterror/resources/

Copyright The Chromium Authors. Redistribution is covered by the accompanying
BSD-style `LICENSE`. This is the original runner, not a link to `chrome://dino`.

The four control SVGs are from `lucide-static@0.468.0`, distributed under the
accompanying `LUCIDE-LICENSE`.

`index.html` and `embed.js` provide the portal-specific wrapper, local assets,
accessible controls, and silent audio integration. No scores or candidate
data are sent anywhere. The parent iframe permits scripts only, without
same-origin privileges, top navigation, popups, forms, or storage access.

Maintenance is controlled by `src/lib/portal/maintenance.ts`. Both `/` and
`/login` return the maintenance screen before fetching candidate details.
Authentication routes, RLS, data ingestion and stored snapshots are unchanged.

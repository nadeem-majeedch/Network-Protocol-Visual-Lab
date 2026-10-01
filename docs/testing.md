# Testing

The test suite is layered the same way the code is: pure-model tests at the bottom, engine determinism in the middle, protocol behavior through real lab runs, UI component tests, and Playwright end-to-end against the production build.

## Commands

```bash
npm test        # Vitest: unit + integration + component tests
npm run e2e     # Playwright: end-to-end against `vite preview`
npm run lint    # ESLint (typescript-eslint + react-hooks)
npm run typecheck  # tsc --noEmit (strict)
npm run build   # tsc -p tsconfig.build.json && vite build
```

## Layers

### 1. Model tests (`tests/models.test.ts`)
MAC parsing/normalization/rejection, IPv4 validation, CIDR parsing, mask and network-address math, uint32 round-trips, and routing longest-prefix match including metric tie-breaks and "no default route" behavior.

### 2. Engine tests (`tests/engine.test.ts`)
- Topology validation passes for lab topologies.
- An ARP exchange produces the expected events and cache learning.
- **Determinism:** two engines from the same topology + script produce identical event logs and packet frames.
- **Serialization:** `JSON.parse(JSON.stringify(state)) === state`.
- **Reset:** running twice from the same engine yields equal results.

### 3. Protocol integration (`tests/protocols.test.ts`)
Every lab in the catalog runs against a real engine, asserting observable behavior: ARP broadcasts and unicast replies, TTL-zero drops with the right reason, DNS query/response pairs and resolved addresses, HTTP requests inside TCP segments, 200 responses with bodies, TCP state transitions toward `ESTABLISHED`, and visualization geometry derived from canonical state. A parameterized test executes **every** lab and requires at least one event.

### 4. Component tests (`tests/components.test.tsx`)
Testing Library against the React components: inspector empty state, layer visibility (ARP shows no TCP fields; HTTP shows Ethernet/IPv4/TCP/HTTP), expand/collapse with `aria-expanded`, and the Raw/Explain view switching.

### 5. End-to-end (`tests/e2e/app.spec.ts`)
Playwright loads the built app via `vite preview` and verifies: first paint with the default lab and **zero console errors**, Run populating timeline and packet chips, inspector opening from a packet selection, and lab navigation switching scenarios.

## Principles

- **Tests read canonical state.** Assertions target `NetworkState` (events, packets, caches) — the same data the UI consumes — not internals.
- **No weakened assertions.** When behavior was wrong, the code was fixed; the tests encode the *correct* protocol behavior.
- **Determinism is a spec.** The byte-identical-log test is the guardian of the "same inputs → same lesson" guarantee the classroom depends on.

## Continuous integration

`.github/workflows/deploy.yml` runs typecheck, lint, unit tests and build on every push to `main` before publishing to GitHub Pages, so a failing suite blocks deployment.

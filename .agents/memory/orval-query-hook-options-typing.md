---
name: Orval-generated query hook options typing quirk
description: Workaround for TS2741 on generated useGet* hooks' second options argument
---

Generated Orval React Query hooks (e.g. `useGetBacktest`) accept a second argument shaped like `{ query?: UseQueryOptions<...>, request?: ... }`. Passing `{ query: { enabled: someBoolean } }` can fail typecheck with `TS2741: Property 'queryKey' is missing`, even though the generated type signature shows `query` as optional/partial.

**Why:** Not yet root-caused (likely generic inference from the specific params object literal passed as the first argument, causing the options generic to resolve to a non-partial `UseQueryOptions`). Reproduced in `research-lab.tsx` with `useGetBacktest(params, { query: { enabled: hasData } })`.

**How to apply:** If you hit `TS2741 ... queryKey is missing` on a generated hook's options object, cast just that options object with `as any` (e.g. `{ query: { enabled: hasData } as any }`) rather than reshaping the call or fighting the generic — this preserves runtime behavior and unblocks typecheck. Revisit root cause only if it recurs across multiple hooks.

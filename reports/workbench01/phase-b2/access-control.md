# Preview access control

Phase B2 adds a narrow Express middleware for `/api/workbench/**`. It reads `WORKBENCH_PREVIEW_TOKEN` at request time, requires the strict `Authorization: Bearer <token>` form, hashes both values with SHA-256 and uses `timingSafeEqual` on equal-length digests.

Behavior is fail closed:

- missing or empty server configuration: HTTP 503, `WORKBENCH_PREVIEW_ACCESS_NOT_CONFIGURED`
- missing, malformed or wrong credential: HTTP 401, `WORKBENCH_PREVIEW_UNAUTHORIZED`
- correct credential: request continues to the unchanged Phase B1 route
- unrelated API routes: existing behavior is unchanged

The guard runs before CORS, JSON body parsing and Workbench route dispatch. Client responses contain a safe code and message. Credentials and internal stack traces are not returned.

The UI initially presents only an owner-access form. The token is entered manually, retained in `sessionStorage`, attached as a Bearer header, and removed by ending the preview session. It is never placed in a URL, report, source constant, Vite environment variable, or generated asset. Production bundle scans confirmed that neither the environment-variable name nor a test sentinel occurred in built frontend assets.

This is preview access control. It is not a production authentication, authorization, identity, or audit system. Railway must provide a high-entropy server-side secret and must keep the API and UI behind the same origin.

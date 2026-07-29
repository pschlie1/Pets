// Vercel serverless entry (committed so the `functions` pattern check passes
// before the build runs). The actual handler is bundled at build time by
// `npm run bundle:api` into apps/api/dist/serverless.cjs — a single
// self-contained CommonJS file — and pulled into the function via this
// statically-traceable require.
module.exports = require('../apps/api/dist/serverless.cjs').default;

import { Router } from 'express';
import express from 'express';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Interactive API documentation at /docs, rendered by a vendored Swagger UI
 * (swagger-ui-dist) — fully offline, no CDN, matching the demo's rule that
 * nothing breaks without a network. The canonical spec lives at
 * <repo root>/docs/openapi.yaml.
 */

const here = dirname(fileURLToPath(import.meta.url));
// Module-relative (src/routes → repo root) in dev; cwd-relative fallback for
// traced serverless bundles.
const specCandidates = [
  join(here, '..', '..', '..', '..', 'docs', 'openapi.yaml'),
  join(process.cwd(), 'docs', 'openapi.yaml'),
];
const specPath = specCandidates.find(existsSync) ?? specCandidates[0];

const require = createRequire(import.meta.url);
const swaggerDist = dirname(require.resolve('swagger-ui-dist/package.json'));

const PAGE = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Connected Care API — Documentation</title>
  <link rel="stylesheet" href="/docs/assets/swagger-ui.css" />
  <style>
    .topbar { display: none; }
    body { margin: 0; }
  </style>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="/docs/assets/swagger-ui-bundle.js"></script>
  <script src="/docs/assets/swagger-ui-standalone-preset.js"></script>
  <script>
    window.ui = SwaggerUIBundle({
      url: '/docs/openapi.yaml',
      dom_id: '#swagger-ui',
      presets: [SwaggerUIBundle.presets.apis],
      layout: 'BaseLayout',
      deepLinking: true,
      tryItOutEnabled: true,
    });
  </script>
</body>
</html>`;

export function docsRoutes(): Router {
  const r = Router();

  r.get('/docs', (_req, res) => {
    res.type('html').send(PAGE);
  });

  r.get('/docs/openapi.yaml', (_req, res) => {
    if (!existsSync(specPath)) {
      res.status(404).json({ error: { code: 'not_found', message: 'openapi.yaml not found on disk.' } });
      return;
    }
    res.type('text/yaml').sendFile(specPath);
  });

  r.use('/docs/assets', express.static(swaggerDist));

  return r;
}

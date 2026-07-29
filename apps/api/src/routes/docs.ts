import { Router } from 'express';
import express from 'express';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

/**
 * Interactive API documentation at /docs, rendered by a vendored Swagger UI
 * (swagger-ui-dist) — fully offline, no CDN. The canonical spec lives at
 * <repo root>/docs/openapi.yaml.
 *
 * Deliberately avoids import.meta so this module survives being bundled to
 * CommonJS for serverless deployment: everything resolves from process.cwd(),
 * which is the repo root in dev (root scripts), apps/api under `npm run dev`,
 * and the function root when deployed.
 */

const specCandidates = [
  join(process.cwd(), 'docs', 'openapi.yaml'),
  join(process.cwd(), '..', '..', 'docs', 'openapi.yaml'),
];
const specPath = specCandidates.find(existsSync) ?? specCandidates[0];

function resolveSwaggerDist(): string | null {
  try {
    const req = createRequire(join(process.cwd(), 'package.json'));
    return dirname(req.resolve('swagger-ui-dist/package.json'));
  } catch {
    return null;
  }
}
const swaggerDist = resolveSwaggerDist();

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

  if (swaggerDist) {
    r.use('/docs/assets', express.static(swaggerDist));
  }

  return r;
}

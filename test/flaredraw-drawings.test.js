import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { Hono } from 'hono';

test('Flaredraw drawing routes import shares to prevent 500 delete error', () => {
  const workerRoutes = readFileSync('worker/src/flaredraw/modules/drawings/routes.ts', 'utf8');
  assert.match(
    workerRoutes,
    /import\s+.*\{[^}]*drawings[^}]*shares[^}]*\}\s+from\s+['"][^'"]*schema(\.ts)?['"]/,
    'worker drawings routes must import shares from schema'
  );

  const serverRoutes = readFileSync('flaredraw/src/server/modules/drawings/routes.ts', 'utf8');
  assert.match(
    serverRoutes,
    /import\s+.*\{[^}]*drawings[^}]*shares[^}]*\}\s+from\s+['"][^'"]*schema(\.ts)?['"]/,
    'flaredraw server drawings routes must import shares from schema'
  );
});

test('Flaredraw drawings backend supports POST /batch-delete and project query', () => {
  const workerRoutes = readFileSync('worker/src/flaredraw/modules/drawings/routes.ts', 'utf8');
  assert.match(workerRoutes, /drawingRoutes\.post\('\/batch-delete'/, 'Must define POST /batch-delete');
  assert.match(workerRoutes, /c\.req\.query\('project'\)/, 'Must support project query parameter');
  assert.match(workerRoutes, /await\s+c\.env\.STORAGE\.delete/, 'Must delete r2Key from storage');
  assert.match(workerRoutes, /delete\(shares\)/, 'Must cascade delete shares');

  const serverRoutes = readFileSync('flaredraw/src/server/modules/drawings/routes.ts', 'utf8');
  assert.match(serverRoutes, /drawingRoutes\.post\('\/batch-delete'/, 'flaredraw must define POST /batch-delete');
});

test('Database schemas and migration declare project column on drawings table', () => {
  const workerSql = readFileSync('worker/schema.sql', 'utf8');
  assert.match(workerSql, /CREATE TABLE IF NOT EXISTS `drawings`[\s\S]*?`project` text DEFAULT 'default'/, 'worker/schema.sql must declare project column');

  const workerSchemaTs = readFileSync('worker/src/flaredraw/db/schema.ts', 'utf8');
  assert.match(workerSchemaTs, /project:\s*text\('project'\)\.default\('default'\)/, 'worker schema.ts must declare project column');

  const serverSchemaTs = readFileSync('flaredraw/src/server/db/schema.ts', 'utf8');
  assert.match(serverSchemaTs, /project:\s*text\('project'\)\.default\('default'\)/, 'server schema.ts must declare project column');
});

test('MCP tools declare and handle project parameter', () => {
  const workerMcp = readFileSync('worker/src/flaredraw/modules/mcp/server.ts', 'utf8');
  assert.match(workerMcp, /create_drawing[\s\S]*?project:\s*z\.string/, 'create_drawing must accept project parameter');
  assert.match(workerMcp, /create_diagram[\s\S]*?project:\s*z\.string/, 'create_diagram must accept project parameter');

  const serverMcp = readFileSync('flaredraw/src/server/modules/mcp/server.ts', 'utf8');
  assert.match(serverMcp, /create_drawing[\s\S]*?project:\s*z\.string/, 'flaredraw create_drawing must accept project parameter');
  assert.match(serverMcp, /create_diagram[\s\S]*?project:\s*z\.string/, 'flaredraw create_diagram must accept project parameter');
});

test('Client api-client.ts defines batchDelete and project types', () => {
  const apiClient = readFileSync('flaredraw/src/client/lib/api-client.ts', 'utf8');
  assert.match(apiClient, /project\?:\s*string\s*\|\s*null/, 'Drawing type must include project');
  assert.match(apiClient, /batchDelete:\s*\(ids:\s*string\[\]\)/, 'api.drawings must define batchDelete');
});

test('DashboardPage.tsx implements project capsules and batch management mode', () => {
  const dashboard = readFileSync('flaredraw/src/client/pages/DashboardPage.tsx', 'utf8');
  assert.match(dashboard, /projectList/, 'Must compute projectList for capsules');
  assert.match(dashboard, /batchMode/, 'Must maintain batchMode state');
  assert.match(dashboard, /selectedIds/, 'Must track selected drawing IDs');
  assert.match(dashboard, /api\.drawings\.batchDelete/, 'Must call api.drawings.batchDelete');
  assert.match(dashboard, /toast\.success/, 'Must notify user with toast on deletion');
});

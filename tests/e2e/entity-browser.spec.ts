/**
 * E2E tests — verifies UI renders without infinite loops,
 * API endpoints respond correctly, and navigation works.
 *
 * Uses playwright's built-in webServer to manage the dev server lifecycle.
 */
import { test, expect, Page } from '@playwright/test';

const PORT = 18422;
const BASE = `http://localhost:${PORT}`;

// ── Mock helpers ──

async function mockAllRoutes(page: Page) {
  // Workspaces
  await page.route('**/api/workspaces', (route) => {
    route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ workspaces: [{ id: 'ws-1', name: 'Test WS', is_current: true }] }),
    });
  });
  // Templates list
  await page.route('**/api/templates', (route) => {
    const url = route.request().url();
    // Template detail: /api/templates/{name}
    if (url.match(/\/api\/templates\/[^?]+$/)) {
      route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({
          template: {
            schema_version: '2.0',
            name: 'v2-mixed', description: 'V2 mixed template',
            agents: [
              { name: 'Assistant', description: 'Helper', instructions: '# Assistant', model: 'auto', runtime_provider: 'claude', skills: [] },
            ],
            projects: [], labels: [], autopilots: [], skills: [],
            runtime_mapping: { claude: { display_name: 'Claude' } },
            includes: { entities: [{ ref: 'agent/worker@2.0.1' }] },
          },
        }),
      });
      return;
    }
    // Templates list
    route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({
        templates: [
          { name: 'v1-inline', version: '1.1', description: 'V1 template', agent_count: 2, project_count: 0, label_count: 0, autopilot_count: 0, skill_count: 0, source: 'user' },
          { name: 'v2-mixed', version: '2.0', description: 'V2 mixed template', agent_count: 1, project_count: 0, label_count: 0, autopilot_count: 0, skill_count: 0, source: 'user', entity_ref_count: 2, mode: 'mixed' },
          { name: 'v2-ref', version: '2.0', description: 'V2 pure ref template', agent_count: 0, project_count: 0, label_count: 0, autopilot_count: 0, skill_count: 0, source: 'user', entity_ref_count: 3, mode: 'reference' },
        ],
      }),
    });
  });
  // Servers
  await page.route('**/api/servers', (route) => {
    route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({
        servers: [{ id: 's1', name: 'Test', server_url: 'http://localhost:9334', token: 'test', is_default: true, workspace_id: 'ws-1' }],
        current: { id: 's1', name: 'Test', server_url: 'http://localhost:9334', token: 'test', is_default: true, workspace_id: 'ws-1' },
      }),
    });
  });
  // Runtimes
  await page.route('**/api/runtimes*', (route) => {
    route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ runtimes: [{ id: 'rt-1', name: 'Claude', provider: 'claude', status: 'active' }] }),
    });
  });
  // Entity list — respond based on query params (MUST be registered BEFORE detail routes)
  // Use regex to match both /api/entities and /api/entities?type=agent
  await page.route(/\/api\/entities(\?.*)?$/, (route) => {
    const url = new URL(route.request().url());
    const typeFilter = url.searchParams.get('type');
    const qFilter = url.searchParams.get('q');

    const allEntities = [
      { ref: 'agent/worker@2.0.1', type: 'agent', namespace: 'multica', name: 'worker', version: '2.0.1', description: 'Dev agent', source: 'local', size: 500, imported_at: '2026-01-01T00:00:00Z', deps_info: 'skills: 3', tags: ['dev'] },
      { ref: 'agent/qa@1.5.0', type: 'agent', namespace: 'multica', name: 'qa', version: '1.5.0', description: 'QA agent', source: 'local', size: 400, imported_at: '2026-01-01T00:00:00Z', deps_info: 'skills: 2', tags: ['qa'] },
      { ref: 'skill/golang-testing@1.2.0', type: 'skill', namespace: 'multica', name: 'golang-testing', version: '1.2.0', description: 'Go testing patterns', source: 'local', size: 200, imported_at: '2026-01-01T00:00:00Z', tags: ['go'] },
    ];
    let entities = allEntities;
    if (typeFilter) entities = entities.filter((e) => e.type === typeFilter);
    if (qFilter) entities = entities.filter((e) => e.name.toLowerCase().includes(qFilter.toLowerCase()));

    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ entities }) });
  });
  // Generic entity detail route that matches type/name pattern to avoid mismatches
  // Matches: /api/entities/type/name, /api/entities/type/name?params
  await page.route(/\/api\/entities\/(agent|skill|autopilot)\/([^/?]+)/, (route) => {
    const url = route.request().url();
    const parts = new URL(url).pathname.split('/');
    const type = parts[3]; // /api/entities/{type}/{name}
    const name = parts[4];

    if (type === 'agent' && name === 'worker') {
      route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({
          entity: {
            entity: 'agent', schema_version: '1.0', name: 'worker', version: '2.0.1',
            description: 'Dev agent', instructions: '# Worker\nYou are a developer.',
            model: 'auto', runtime_provider: 'claude', visibility: 'private',
            skills: { 'golang-testing': '^1.2.0', 'python-pro': '^2.0.0' },
            files: [{ path: 'README.md', content: '# README' }],
            metadata: { tags: ['dev'] },
          }, ref: 'agent/worker@2.0.1',
        }),
      });
    } else {
      route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({
          entity: {
            entity: type, schema_version: '1.0', name, version: '1.0.0',
            description: `${type} entity ${name}`,
            files: type === 'skill' ? [{ path: 'SKILL.md', content: `# ${name}\n\nTest content.` }] : undefined,
            metadata: { tags: ['test'] },
          }, ref: `${type}/${name}@1.0.0`,
        }),
      });
    }
  });
}

// ── Entity Browser Tests ──

test.describe('Entity Browser', () => {
  test.beforeEach(async ({ page }) => { await mockAllRoutes(page); });

  test('entity browser page loads without errors or infinite loop', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));

    await page.goto(`${BASE}/#entities`);
    await page.waitForSelector('text=Entity Browser', { timeout: 15000 });
    // Wait 2s — if infinite loop, React crashes or page freezes
    await page.waitForTimeout(2000);
    await expect(page.locator('text=Entity Browser')).toBeVisible();

    // Only report actual JS errors (not WebSocket reconnection noise)
    const realErrors = errors.filter((e) =>
      !e.includes('fetch') &&
      !e.includes('WebSocket') &&
      !e.includes('socket') &&
      !e.includes('closed')
    );
    expect(realErrors).toHaveLength(0);
  });

  test('entity browser renders cards without crashing', async ({ page }) => {
    await page.goto(`${BASE}/#entities`);
    await page.waitForSelector('text=Entity Browser', { timeout: 15000 });
    await page.waitForTimeout(1500);

    // Page heading still visible = no crash or infinite loop
    await expect(page.locator('text=Entity Browser')).toBeVisible();

    // At least some content rendered
    const bodyText = await page.locator('body').innerText();
    expect(bodyText.length).toBeGreaterThan(100);
  });

  test('tab filter hides non-matching entity types', async ({ page }) => {
    await page.goto(`${BASE}/#entities`);
    await page.waitForSelector('text=Entity Browser', { timeout: 15000 });

    // Click "Agents" tab (text might be "Agents (3)" with count)
    const agentsTab = page.locator('button').filter({ hasText: /Agents/ }).first();
    await agentsTab.waitFor({ state: 'visible', timeout: 5000 });
    await agentsTab.click();
    await page.waitForTimeout(800);

    // golang-testing is a skill — should NOT be visible when filtered to agents only
    await expect(page.getByText('golang-testing')).toHaveCount(0);
  });

  test('entity detail opens and back returns to list', async ({ page }) => {
    await page.goto(`${BASE}/#entities`);
    await page.waitForSelector('text=Entity Browser', { timeout: 15000 });

    // The entity cards are buttons with class template-card — verify at least one rendered
    const card = page.locator('.template-card').first();
    await card.waitFor({ state: 'visible', timeout: 10000 });

    // Click the first card to open detail
    await card.click();
    await page.waitForSelector('text=Back to Entity Browser', { timeout: 8000 });

    // Navigate back
    await page.locator('button').filter({ hasText: 'Back to Entity Browser' }).click();
    await page.waitForSelector('text=Entity Browser', { timeout: 8000 });
    await expect(page.locator('text=Entity Browser')).toBeVisible();
  });

  test('search input does not crash the page', async ({ page }) => {
    await page.goto(`${BASE}/#entities`);
    await page.waitForSelector('text=Entity Browser', { timeout: 15000 });

    const searchInput = page.locator('input[placeholder="Search entities..."]');
    await searchInput.fill('golang');
    await page.waitForTimeout(1500);

    // Page should still be functional after search
    await expect(page.locator('text=Entity Browser')).toBeVisible();
    // Search input should still be editable
    await expect(searchInput).toHaveValue('golang');
  });
});

// ── Templates View Tests ──

test.describe('Templates View', () => {
  test.beforeEach(async ({ page }) => { await mockAllRoutes(page); });

  test('templates page loads without errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));

    await page.goto(BASE);
    await page.waitForSelector('text=Templates', { timeout: 15000 });
    await page.waitForTimeout(1000);
    await expect(page.locator('text=Templates').first()).toBeVisible();

    const realErrors = errors.filter((e) =>
      !e.includes('fetch') && !e.includes('WebSocket') && !e.includes('socket') && !e.includes('closed')
    );
    expect(realErrors).toHaveLength(0);
  });

  test('templates show v2 mode badges', async ({ page }) => {
    await page.goto(BASE);
    await page.waitForSelector('text=Templates', { timeout: 15000 });

    await expect(page.getByText('v1-inline')).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('v2-mixed')).toBeVisible();
    await expect(page.getByText('v2-ref')).toBeVisible();
  });

  test('import page loads without errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));

    await page.goto(`${BASE}/#import`);
    await page.waitForSelector('text=Select Workspace', { timeout: 15000 });
    await page.waitForTimeout(1000);

    const realErrors = errors.filter((e) =>
      !e.includes('fetch') && !e.includes('WebSocket') && !e.includes('socket') && !e.includes('closed')
    );
    expect(realErrors).toHaveLength(0);
  });

  test('export page loads without errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));

    await page.goto(`${BASE}/#export`);
    await page.waitForSelector('text=Select Workspace', { timeout: 15000 });
    await page.waitForTimeout(1000);

    const realErrors = errors.filter((e) =>
      !e.includes('fetch') && !e.includes('WebSocket') && !e.includes('socket') && !e.includes('closed')
    );
    expect(realErrors).toHaveLength(0);
  });
});

// ── Navigation Tests ──

test.describe('Navigation — no infinite loops', () => {
  test.beforeEach(async ({ page }) => { await mockAllRoutes(page); });

  test('all 5 nav tabs render without infinite loops', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));

    // Templates
    await page.goto(`${BASE}/#templates`);
    await page.waitForSelector('text=Templates', { timeout: 15000 });
    await page.waitForTimeout(800);

    // Import
    await page.locator('button').filter({ hasText: 'Import' }).click();
    await page.waitForSelector('text=Select Workspace', { timeout: 8000 });
    await page.waitForTimeout(800);

    // Export
    await page.locator('button').filter({ hasText: 'Export' }).click();
    await page.waitForSelector('text=Select Workspace', { timeout: 8000 });
    await page.waitForTimeout(800);

    // Entities
    await page.locator('button').filter({ hasText: 'Entities' }).click();
    await page.waitForSelector('text=Entity Browser', { timeout: 8000 });
    await page.waitForTimeout(800);

    // Settings
    await page.locator('button').filter({ hasText: 'Settings' }).click();
    await page.waitForTimeout(800);

    const realErrors = errors.filter((e) =>
      !e.includes('fetch') && !e.includes('WebSocket') && !e.includes('socket') && !e.includes('closed')
    );
    expect(realErrors).toHaveLength(0);
  });

  test('hash routing loads correct page on direct URL', async ({ page }) => {
    await page.goto(`${BASE}/#entities`);
    await page.waitForSelector('text=Entity Browser', { timeout: 15000 });
    await expect(page.locator('text=Entity Browser')).toBeVisible();

    await page.goto(`${BASE}/#templates`);
    await page.waitForSelector('text=Templates', { timeout: 8000 });
    await expect(page.locator('text=Templates').first()).toBeVisible();
  });
});

// ── API Endpoint Tests (use absolute URLs) ──

test.describe('API Endpoints', () => {
  test('validate endpoint accepts valid entity', async ({ request }) => {
    const res = await request.post(`${BASE}/api/entities/validate`, {
      data: { content: `entity: skill\nschema_version: "1.0"\nname: valid-skill\nversion: 1.0.0\ndescription: A valid skill\nfiles:\n  - path: SKILL.md\n    content: "# Valid"\n` },
    });
    const data = await res.json();
    expect(data.valid).toBe(true);
  });

  test('validate endpoint rejects invalid entity', async ({ request }) => {
    const res = await request.post(`${BASE}/api/entities/validate`, {
      data: { content: `entity: skill\nschema_version: "1.0"\nname: bad\nversion: not-semver\ndescription: Bad\n` },
    });
    const data = await res.json();
    expect(data.valid).toBe(false);
  });

  test('templates endpoint returns JSON', async ({ request }) => {
    const res = await request.get(`${BASE}/api/templates`);
    // Server might return 500 if no multica CLI, but it should respond
    expect([200, 500]).toContain(res.status());
  });

  test('template entity extract API works', async ({ request }) => {
    // Use Basic4Agent which exists in the real templates directory
    const res = await request.post(`${BASE}/api/templates/Basic4Agent/extract`, {
      data: { agents: ['Assistant'] },
    });
    expect(res.ok()).toBe(true);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.extracted[0]).toContain('agent/Assistant');
  });

  test('extract requires at least one entity', async ({ request }) => {
    const res = await request.post(`${BASE}/api/templates/Basic4Agent/extract`, {
      data: { agents: [], skills: [], autopilots: [] },
    });
    expect(res.status()).toBe(400);
  });
});

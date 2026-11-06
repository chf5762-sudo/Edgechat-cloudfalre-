// Comprehensive WorkBuddy & Antigravity Collaborative Shared Folder Pipeline Test
const BASE_URL = 'https://link.chf5762.cloudns.org';
const PASSCODE = '576257';

async function runTests() {
  console.log('=== Starting WorkBuddy & Antigravity Collaborative Pipeline Tests ===\n');
  const results = [];

  async function test(name, fn) {
    try {
      const res = await fn();
      results.push({ name, passed: true, res });
      console.log(`[PASS] ${name}`);
    } catch (err) {
      results.push({ name, passed: false, error: err.message });
      console.log(`[FAIL] ${name} -> ${err.message}`);
    }
  }

  let sharedFolderId = null;
  let testUploadedKey = null;
  let testFileTimestampName = null;

  // 1. System Auto-Initialization & Token Verification
  await test('1. Auto-initialize & query /api/storage/shares/agent-shared/files', async () => {
    const res = await fetch(`${BASE_URL}/api/storage/shares/agent-shared/files`);
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
    const data = await res.json();
    if (!data.success) throw new Error('data.success is not true');
    if (data.folder?.name !== 'agent-共享免密目录') throw new Error(`Expected folder name "agent-共享免密目录", got: ${data.folder?.name}`);
    sharedFolderId = data.folder.id;
    return data;
  });

  // 2. WorkBuddy simulation: Anonymous JSON Upload with Auto Timestamp & Project
  await test('2. WorkBuddy anonymous upload to project "EdgeChat" with auto timestamp', async () => {
    const testContent = `# WorkBuddy Test Report\nTimestamp: ${new Date().toISOString()}\nStatus: PASS\nAll verification suites executed.`;
    const res = await fetch(`${BASE_URL}/api/storage/shares/agent-shared/files`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        filename: 'wb_pipeline_report.md',
        content: testContent,
        project: 'EdgeChat',
      }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
    const data = await res.json();
    if (!data.success) throw new Error('data.success is not true');
    testUploadedKey = data.file.key;
    testFileTimestampName = data.file.filename;

    // Verify timestamp naming format: YYYYMMDD_HHmmss_wb_pipeline_report.md
    if (!/^\d{8}_\d{6}_wb_pipeline_report\.md$/.test(testFileTimestampName)) {
      throw new Error(`Filename does not match timestamp format: ${testFileTimestampName}`);
    }
    if (data.file.project !== 'EdgeChat') {
      throw new Error(`Expected project "EdgeChat", got: ${data.file.project}`);
    }
    return data;
  });

  // 3. Antigravity simulation: Anonymous GET Latest File (JSON)
  await test('3. Antigravity anonymous GET latest report from project "EdgeChat"', async () => {
    const res = await fetch(`${BASE_URL}/api/storage/shares/agent-shared/latest?project=EdgeChat`);
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
    const data = await res.json();
    if (!data.success) throw new Error('data.success is not true');
    if (!data.file) throw new Error('data.file is empty');
    if (data.file.key !== testUploadedKey) throw new Error(`Expected key ${testUploadedKey}, got ${data.file.key}`);
    if (!data.file.content?.includes('# WorkBuddy Test Report')) {
      throw new Error(`Decrypted content missing expected text: ${data.file.content}`);
    }
    return data;
  });

  // 4. Antigravity simulation: Anonymous GET Latest Raw Content
  await test('4. Antigravity anonymous GET latest raw content (?raw=1)', async () => {
    const res = await fetch(`${BASE_URL}/api/storage/shares/agent-shared/latest?project=EdgeChat&raw=1`);
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
    const text = await res.text();
    if (!text.includes('# WorkBuddy Test Report')) {
      throw new Error(`Raw content missing expected text: ${text}`);
    }
    return text;
  });

  // 4b. Multi-Project Global Latest Aggregation
  await test('4b. Multi-project aggregation & status badges from /api/storage/shares/agent-shared/latest', async () => {
    const res = await fetch(`${BASE_URL}/api/storage/shares/agent-shared/latest`);
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
    const data = await res.json();
    if (!data.success) throw new Error('data.success is not true');
    if (!data.overallLatest) throw new Error('data.overallLatest is missing');
    if (!data.file) throw new Error('data.file is missing for backwards compatibility');
    if (!Array.isArray(data.projects) || data.projects.length === 0) {
      throw new Error(`Expected non-empty projects array, got: ${JSON.stringify(data.projects)}`);
    }

    const edgeChatProj = data.projects.find(p => p.project === 'EdgeChat');
    if (!edgeChatProj) throw new Error('Project "EdgeChat" not found in projects array');
    if (!edgeChatProj.hasFiles || !edgeChatProj.latestFile) {
      throw new Error('Project "EdgeChat" expected to have files');
    }
    if (!edgeChatProj.badge) {
      throw new Error('Project "EdgeChat" missing status badge');
    }

    // Verify badge logic
    const hasCrown = data.projects.some(p => p.isOverallLatest && p.badge === '👑 全局最新');
    if (!hasCrown && data.overallLatest.project) {
      throw new Error('Expected at least one project to have 👑 全局最新 badge when overall latest has project');
    }

    return data;
  });

  // 5. Automatic Public Read via /files/:key without authentication
  await test('5. Automatic public access to /files/:key without credentials', async () => {
    if (!testUploadedKey) throw new Error('No uploaded key');
    const res = await fetch(`${BASE_URL}/files/${encodeURIComponent(testUploadedKey)}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
    const text = await res.text();
    if (!text.includes('# WorkBuddy Test Report')) {
      throw new Error(`Public read content mismatch: ${text}`);
    }
    return text;
  });

  // 6. Chronological Sorting: created_at DESC (newest first)
  await test('6. Listing files strictly ordered by created_at DESC', async () => {
    // Upload a second file to EdgeChat
    const secondContent = `# Second Report at ${Date.now()}`;
    await fetch(`${BASE_URL}/api/storage/shares/agent-shared/files`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        filename: 'second_report.md',
        content: secondContent,
        project: 'EdgeChat',
      }),
    });

    const res = await fetch(`${BASE_URL}/api/storage/shares/agent-shared/files?project=EdgeChat`);
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
    const data = await res.json();
    if (!data.files || data.files.length < 2) throw new Error(`Expected at least 2 files, got ${data.files?.length}`);

    // Check timestamps are descending
    for (let i = 0; i < data.files.length - 1; i++) {
      const t1 = new Date(data.files[i].createdAt || data.files[i].created_at).getTime();
      const t2 = new Date(data.files[i + 1].createdAt || data.files[i + 1].created_at).getTime();
      if (t1 < t2) throw new Error(`Files not ordered created_at DESC: ${t1} < ${t2}`);
    }
    return data;
  });

  // 7. Public HTML Share View & /s/agent-shared redirect with Project Status Board
  await test('7. Public HTML view and /s/agent-shared redirect with Project Status Board', async () => {
    // Test /s/agent-shared redirect
    const redirRes = await fetch(`${BASE_URL}/s/agent-shared`, { redirect: 'manual' });
    if (redirRes.status !== 302) throw new Error(`Expected 302 redirect for /s/agent-shared, got ${redirRes.status}`);
    const loc = redirRes.headers.get('location');
    if (!loc?.includes('/api/storage/share-view/agent-shared')) {
      throw new Error(`Expected redirect to share-view, got: ${loc}`);
    }

    // Test HTML view content & Status Board
    const htmlRes = await fetch(`${BASE_URL}/api/storage/share-view/agent-shared`);
    if (!htmlRes.ok) throw new Error(`HTTP ${htmlRes.status}: ${await htmlRes.text()}`);
    const html = await htmlRes.text();
    if (!html.includes('免密协作共享目录')) throw new Error('HTML view missing banner title');
    if (!html.includes('WorkBuddy & Antigravity 自动化协同流水线已激活')) {
      throw new Error('HTML view missing pipeline banner text');
    }
    if (!html.includes('各项目最新产物看板')) {
      throw new Error('HTML view missing Project Status Board title');
    }
    if (!html.includes('board-grid') || !html.includes('EdgeChat')) {
      throw new Error('HTML view missing project status board grid');
    }

    // Test filtered view with breadcrumb
    const filterRes = await fetch(`${BASE_URL}/api/storage/share-view/agent-shared?project=EdgeChat`);
    if (!filterRes.ok) throw new Error(`HTTP ${filterRes.status}: ${await filterRes.text()}`);
    const filterHtml = await filterRes.text();
    if (!filterHtml.includes('当前筛选项目') || !filterHtml.includes('查看全部项目')) {
      throw new Error('Filter view missing project breadcrumb or reset button');
    }

    return true;
  });

  // 8. Folder Locking & Protection against deletion / rename
  await test('8. Root folder lock: DELETE & PATCH /api/storage/folders/:id returns 403', async () => {
    if (!sharedFolderId) throw new Error('No shared folder ID');

    // Attempt delete
    const delRes = await fetch(`${BASE_URL}/api/storage/folders/${sharedFolderId}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${PASSCODE}` },
    });
    if (delRes.status !== 403) throw new Error(`Expected 403 Forbidden for deleting root folder, got ${delRes.status}`);
    const delJson = await delRes.json().catch(() => ({}));
    if (!delJson.error?.includes('不可删除')) throw new Error(`Unexpected error message: ${delJson.error}`);

    // Attempt rename
    const renameRes = await fetch(`${BASE_URL}/api/storage/folders/${sharedFolderId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${PASSCODE}`,
      },
      body: JSON.stringify({ name: 'Hacked_Folder_Name' }),
    });
    if (renameRes.status !== 403) throw new Error(`Expected 403 Forbidden for renaming root folder, got ${renameRes.status}`);
    const renameJson = await renameRes.json().catch(() => ({}));
    if (!renameJson.error?.includes('不可重命名')) throw new Error(`Unexpected error message: ${renameJson.error}`);

    return true;
  });

  // 9. MCP Tool Integration: storage_upload_file, storage_get_latest_file, storage_read_file
  await test('9. MCP collaborative storage tools call', async () => {
    // 9a. MCP storage_upload_file
    const uploadPayload = {
      jsonrpc: '2.0',
      id: 91,
      method: 'tools/call',
      params: {
        name: 'storage_upload_file',
        arguments: {
          filename: 'mcp_collab_report.md',
          content: '# MCP Collaborative Pipeline Report\nGenerated via Antigravity MCP server.',
          shareToken: 'agent-shared',
          project: 'MCP_Test_Project',
          autoTimestamp: true,
        },
      },
    };
    const uploadRes = await fetch(`${BASE_URL}/api/mcp/message`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
        'Authorization': `Bearer ${PASSCODE}`,
      },
      body: JSON.stringify(uploadPayload),
    });
    if (!uploadRes.ok) throw new Error(`MCP Upload HTTP ${uploadRes.status}`);
    const uploadData = await uploadRes.json();
    const uploadResult = JSON.parse(uploadData.result?.content?.[0]?.text || '{}');
    if (!uploadResult.uploaded) throw new Error(`MCP upload failed: ${JSON.stringify(uploadData)}`);
    const mcpKey = uploadResult.file?.key;

    // 9b. MCP storage_read_file
    const readPayload = {
      jsonrpc: '2.0',
      id: 92,
      method: 'tools/call',
      params: {
        name: 'storage_read_file',
        arguments: { key: mcpKey },
      },
    };
    const readRes = await fetch(`${BASE_URL}/api/mcp/message`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
        'Authorization': `Bearer ${PASSCODE}`,
      },
      body: JSON.stringify(readPayload),
    });
    if (!readRes.ok) throw new Error(`MCP Read HTTP ${readRes.status}`);
    const readData = await readRes.json();
    const readResult = JSON.parse(readData.result?.content?.[0]?.text || '{}');
    if (!readResult.file?.content?.includes('MCP Collaborative Pipeline Report')) {
      throw new Error(`MCP read content mismatch: ${JSON.stringify(readResult)}`);
    }

    // 9c. MCP storage_get_latest_file (with project)
    const latestPayload = {
      jsonrpc: '2.0',
      id: 93,
      method: 'tools/call',
      params: {
        name: 'storage_get_latest_file',
        arguments: {
          shareToken: 'agent-shared',
          project: 'MCP_Test_Project',
        },
      },
    };
    const latestRes = await fetch(`${BASE_URL}/api/mcp/message`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
        'Authorization': `Bearer ${PASSCODE}`,
      },
      body: JSON.stringify(latestPayload),
    });
    if (!latestRes.ok) throw new Error(`MCP Get Latest HTTP ${latestRes.status}`);
    const latestData = await latestRes.json();
    const latestResult = JSON.parse(latestData.result?.content?.[0]?.text || '{}');
    if (!latestResult.file?.content?.includes('MCP Collaborative Pipeline Report')) {
      throw new Error(`MCP get latest content mismatch: ${JSON.stringify(latestResult)}`);
    }

    // 9d. MCP storage_get_latest_file (without project: Multi-project aggregation)
    const globalPayload = {
      jsonrpc: '2.0',
      id: 94,
      method: 'tools/call',
      params: {
        name: 'storage_get_latest_file',
        arguments: {
          shareToken: 'agent-shared',
        },
      },
    };
    const globalRes = await fetch(`${BASE_URL}/api/mcp/message`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
        'Authorization': `Bearer ${PASSCODE}`,
      },
      body: JSON.stringify(globalPayload),
    });
    if (!globalRes.ok) throw new Error(`MCP Global Get Latest HTTP ${globalRes.status}`);
    const globalData = await globalRes.json();
    const globalResult = JSON.parse(globalData.result?.content?.[0]?.text || '{}');
    if (!Array.isArray(globalResult.projects) || globalResult.projects.length === 0) {
      throw new Error(`MCP global get latest missing projects array: ${JSON.stringify(globalResult)}`);
    }
    if (!globalResult.overallLatest) {
      throw new Error(`MCP global get latest missing overallLatest: ${JSON.stringify(globalResult)}`);
    }

    return true;
  });

  // 10. Dedicated Handoff REST Endpoints (/api/handoff/save, /api/handoff/new, /api/handoff/latest)
  let handoffTestKey = null;
  await test('10. Dedicated Handoff REST Endpoints (/api/handoff/save, latest, new)', async () => {
    // 10a. POST /api/handoff/save (JSON body, unauthenticated)
    const saveRes = await fetch(`${BASE_URL}/api/handoff/save`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        project: 'HandoffPipeSuite',
        filename: 'handoff_save_sample.md',
        content: '# Handoff Save Sample\nPipeline is fully functional.',
      }),
    });
    if (!saveRes.ok) throw new Error(`POST /api/handoff/save failed with HTTP ${saveRes.status}: ${await saveRes.text()}`);
    const saveData = await saveRes.json();
    if (!saveData.success || !saveData.file?.key) throw new Error(`POST /api/handoff/save invalid response: ${JSON.stringify(saveData)}`);
    if (!/^\d{8}_\d{6}_handoff_save_sample\.md$/.test(saveData.file.filename)) {
      throw new Error(`Filename missing auto-timestamp prefix: ${saveData.file.filename}`);
    }
    if (saveData.file.project !== 'HandoffPipeSuite') {
      throw new Error(`Expected project "HandoffPipeSuite", got ${saveData.file.project}`);
    }
    handoffTestKey = saveData.file.key;

    // 10b. POST /api/handoff/new (alias for save)
    const newSaveRes = await fetch(`${BASE_URL}/api/handoff/new`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        project: 'HandoffPipeSuite',
        filename: 'handoff_new_sample.md',
        content: '# Handoff New Sample\nSecond test report payload.',
      }),
    });
    if (!newSaveRes.ok) throw new Error(`POST /api/handoff/new failed with HTTP ${newSaveRes.status}: ${await newSaveRes.text()}`);
    const newSaveData = await newSaveRes.json();
    if (!newSaveData.success || !newSaveData.file?.key) throw new Error(`POST /api/handoff/new invalid response: ${JSON.stringify(newSaveData)}`);

    // 10c. GET /api/handoff/latest?project=HandoffPipeSuite
    const latestRes = await fetch(`${BASE_URL}/api/handoff/latest?project=HandoffPipeSuite`);
    if (!latestRes.ok) throw new Error(`GET /api/handoff/latest failed with HTTP ${latestRes.status}: ${await latestRes.text()}`);
    const latestData = await latestRes.json();
    if (!latestData.success || !latestData.file) throw new Error(`GET /api/handoff/latest invalid response: ${JSON.stringify(latestData)}`);
    if (!latestData.file.content?.includes('# Handoff New Sample')) {
      throw new Error(`GET /api/handoff/latest expected newest file content, got: ${latestData.file.content}`);
    }

    // 10d. GET /api/handoff/latest?project=HandoffPipeSuite&raw=1
    const rawRes = await fetch(`${BASE_URL}/api/handoff/latest?project=HandoffPipeSuite&raw=1`);
    if (!rawRes.ok) throw new Error(`GET /api/handoff/latest?raw=1 failed with HTTP ${rawRes.status}: ${await rawRes.text()}`);
    const rawText = await rawRes.text();
    if (!rawText.includes('# Handoff New Sample')) {
      throw new Error(`GET /api/handoff/latest?raw=1 content mismatch: ${rawText}`);
    }

    // 10e. GET /api/handoff/new (alias for latest)
    const aliasRes = await fetch(`${BASE_URL}/api/handoff/new?project=HandoffPipeSuite`);
    if (!aliasRes.ok) throw new Error(`GET /api/handoff/new failed with HTTP ${aliasRes.status}: ${await aliasRes.text()}`);
    const aliasData = await aliasRes.json();
    if (!aliasData.success || !aliasData.file) throw new Error(`GET /api/handoff/new invalid response: ${JSON.stringify(aliasData)}`);

    // 10f. GET /api/handoff/latest (without project: Multi-project aggregation)
    const aggRes = await fetch(`${BASE_URL}/api/handoff/latest`);
    if (!aggRes.ok) throw new Error(`GET /api/handoff/latest (aggregation) failed with HTTP ${aggRes.status}: ${await aggRes.text()}`);
    const aggData = await aggRes.json();
    if (!aggData.success || !aggData.overallLatest || !Array.isArray(aggData.projects)) {
      throw new Error(`GET /api/handoff/latest aggregation format mismatch: ${JSON.stringify(aggData)}`);
    }

    return true;
  });

  // 11. Dedicated Handoff MCP Tools (handoff_save & handoff_get_new)
  await test('11. Dedicated Handoff MCP Tools (handoff_save & handoff_get_new)', async () => {
    // 11a. MCP handoff_save
    const mcpSavePayload = {
      jsonrpc: '2.0',
      id: 111,
      method: 'tools/call',
      params: {
        name: 'handoff_save',
        arguments: {
          project: 'HandoffDedicatedMcp',
          filename: 'mcp_handoff_run.md',
          content: '# MCP Dedicated Handoff\nExecuted via handoff_save tool.',
          autoTimestamp: true,
        },
      },
    };
    const mcpSaveRes = await fetch(`${BASE_URL}/api/mcp/message`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
        'Authorization': `Bearer ${PASSCODE}`,
      },
      body: JSON.stringify(mcpSavePayload),
    });
    if (!mcpSaveRes.ok) throw new Error(`MCP handoff_save HTTP ${mcpSaveRes.status}`);
    const mcpSaveData = await mcpSaveRes.json();
    const saveResult = JSON.parse(mcpSaveData.result?.content?.[0]?.text || '{}');
    if (!saveResult.success || !saveResult.file?.key) {
      throw new Error(`MCP handoff_save failed: ${JSON.stringify(mcpSaveData)}`);
    }
    if (!/^\d{8}_\d{6}_mcp_handoff_run\.md$/.test(saveResult.file.filename)) {
      throw new Error(`MCP handoff_save filename missing timestamp: ${saveResult.file.filename}`);
    }

    // 11b. MCP handoff_get_new (JSON)
    const mcpGetPayload = {
      jsonrpc: '2.0',
      id: 112,
      method: 'tools/call',
      params: {
        name: 'handoff_get_new',
        arguments: {
          project: 'HandoffDedicatedMcp',
        },
      },
    };
    const mcpGetRes = await fetch(`${BASE_URL}/api/mcp/message`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
        'Authorization': `Bearer ${PASSCODE}`,
      },
      body: JSON.stringify(mcpGetPayload),
    });
    if (!mcpGetRes.ok) throw new Error(`MCP handoff_get_new HTTP ${mcpGetRes.status}`);
    const mcpGetData = await mcpGetRes.json();
    const getResult = JSON.parse(mcpGetData.result?.content?.[0]?.text || '{}');
    if (!getResult.success || !getResult.file?.content?.includes('# MCP Dedicated Handoff')) {
      throw new Error(`MCP handoff_get_new content mismatch: ${JSON.stringify(getResult)}`);
    }

    // 11c. MCP handoff_get_new (raw)
    const mcpRawPayload = {
      jsonrpc: '2.0',
      id: 113,
      method: 'tools/call',
      params: {
        name: 'handoff_get_new',
        arguments: {
          project: 'HandoffDedicatedMcp',
          raw: true,
        },
      },
    };
    const mcpRawRes = await fetch(`${BASE_URL}/api/mcp/message`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
        'Authorization': `Bearer ${PASSCODE}`,
      },
      body: JSON.stringify(mcpRawPayload),
    });
    if (!mcpRawRes.ok) throw new Error(`MCP handoff_get_new (raw) HTTP ${mcpRawRes.status}`);
    const mcpRawData = await mcpRawRes.json();
    const rawResultText = JSON.parse(mcpRawData.result?.content?.[0]?.text || '""');
    if (!String(rawResultText).includes('# MCP Dedicated Handoff')) {
      throw new Error(`MCP handoff_get_new (raw) text mismatch: ${rawResultText}`);
    }

    return true;
  });

  console.log('\n=== Collaborative Pipeline Test Results ===');
  const passedCount = results.filter(r => r.passed).length;
  console.log(`Passed: ${passedCount} / ${results.length}`);
  if (passedCount !== results.length) {
    console.log('Failed tests:', results.filter(r => !r.passed).map(r => r.name));
    process.exit(1);
  } else {
    console.log('🎉 ALL WORKBUDDY & ANTIGRAVITY COLLABORATIVE PIPELINE TESTS PASSED 100%!');
  }
}

runTests().catch(err => {
  console.error(err);
  process.exit(1);
});

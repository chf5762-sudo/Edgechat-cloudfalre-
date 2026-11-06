import assert from 'node:assert/strict';

const BASE_URL = process.env.BASE_URL || 'https://link.chf5762.cloudns.org';
const PASSCODE = process.env.PASSCODE || '576257';

async function testDrawings() {
  console.log(`=== Testing FlareDraw Drawings Features on ${BASE_URL} ===\n`);

  // 1. Authenticate with master passcode
  console.log('1. Authenticating with passcode...');
  const authRes = await fetch(`${BASE_URL}/api/auth/verify-passcode`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ passcode: PASSCODE }),
  });
  assert.equal(authRes.ok, true, 'Auth should succeed');
  const authCookie = authRes.headers.get('set-cookie');
  console.log('[PASS] Auth successful, cookie received');

  const headers = {
    'Cookie': authCookie || '',
    'Authorization': `Bearer ${PASSCODE}`,
    'Content-Type': 'application/json',
  };

  // 2. Create drawings with projects
  console.log('\n2. Testing Drawing creation with projects...');
  const drawing1Res = await fetch(`${BASE_URL}/api/drawings`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      title: 'EdgeChat Architecture ' + Date.now(),
      project: 'EdgeChat',
      elements: [{ id: 'el-1', type: 'rectangle', x: 10, y: 10, width: 100, height: 50 }],
    }),
  });
  assert.equal(drawing1Res.status, 201, 'Drawing 1 should be created');
  const d1 = await drawing1Res.json();
  console.log('[PASS] Created Drawing 1 with project EdgeChat, ID:', d1.id);

  const drawing2Res = await fetch(`${BASE_URL}/api/drawings`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      title: 'Default Project Drawing ' + Date.now(),
      elements: [{ id: 'el-2', type: 'ellipse', x: 20, y: 20, width: 80, height: 80 }],
    }),
  });
  assert.equal(drawing2Res.status, 201, 'Drawing 2 should be created');
  const d2 = await drawing2Res.json();
  console.log('[PASS] Created Drawing 2 with default project, ID:', d2.id);

  const drawing3Res = await fetch(`${BASE_URL}/api/drawings`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      title: 'Batch Target 1 ' + Date.now(),
      project: 'TestBatch',
    }),
  });
  assert.equal(drawing3Res.status, 201);
  const d3 = await drawing3Res.json();

  const drawing4Res = await fetch(`${BASE_URL}/api/drawings`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      title: 'Batch Target 2 ' + Date.now(),
      project: 'TestBatch',
    }),
  });
  assert.equal(drawing4Res.status, 201);
  const d4 = await drawing4Res.json();
  console.log('[PASS] Created Batch Target Drawings 3 and 4');

  // 3. Test project filtering and fallback
  console.log('\n3. Testing GET /api/drawings and project filtering...');
  const listAllRes = await fetch(`${BASE_URL}/api/drawings`, { headers });
  assert.equal(listAllRes.ok, true);
  const allData = await listAllRes.json();
  assert.ok(Array.isArray(allData.drawings), 'Drawings should be array');
  const found1 = allData.drawings.find(d => d.id === d1.id);
  assert.ok(found1, 'Drawing 1 should be in list');
  assert.equal(found1.project, 'EdgeChat');
  const found2 = allData.drawings.find(d => d.id === d2.id);
  assert.ok(found2, 'Drawing 2 should be in list');
  assert.equal(found2.project, 'default', 'Null/empty project should fallback to default');
  console.log('[PASS] All drawings returned with project field properly defaulted');

  // Test ?project=EdgeChat
  const listEdgeChatRes = await fetch(`${BASE_URL}/api/drawings?project=EdgeChat`, { headers });
  assert.equal(listEdgeChatRes.ok, true);
  const edgeChatData = await listEdgeChatRes.json();
  assert.ok(edgeChatData.drawings.some(d => d.id === d1.id), 'Drawing 1 must be present in EdgeChat filter');
  assert.ok(!edgeChatData.drawings.some(d => d.id === d2.id), 'Drawing 2 must NOT be in EdgeChat filter');
  console.log('[PASS] ?project=EdgeChat correctly filters drawings');

  // 4. Test Single Delete Bug (500 fix: shares defined)
  console.log('\n4. Testing Single Drawing Deletion (500 Bug Fix)...');
  const deleteRes = await fetch(`${BASE_URL}/api/drawings/${d1.id}`, {
    method: 'DELETE',
    headers,
  });
  assert.equal(deleteRes.status, 200, 'DELETE /:id should return 200 (not 500 error)');
  const deleteData = await deleteRes.json();
  assert.equal(deleteData.deleted, true, 'Deleted should be true');
  console.log('[PASS] Single delete succeeded without 500 reference error');

  // Confirm deleted
  const checkDeletedRes = await fetch(`${BASE_URL}/api/drawings/${d1.id}`, { headers });
  assert.equal(checkDeletedRes.status, 404, 'Deleted drawing should return 404');
  console.log('[PASS] Drawing confirmed removed from database');

  // 5. Test Batch Delete
  console.log('\n5. Testing Batch Delete POST /api/drawings/batch-delete...');
  const batchRes = await fetch(`${BASE_URL}/api/drawings/batch-delete`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ ids: [d3.id, d4.id] }),
  });
  assert.equal(batchRes.status, 200, 'Batch delete should return 200');
  const batchData = await batchRes.json();
  assert.equal(batchData.deleted, 2, 'Should report 2 deleted');
  assert.ok(batchData.ids.includes(d3.id) && batchData.ids.includes(d4.id));
  console.log('[PASS] Batch delete successfully deleted 2 drawings:', batchData.ids);

  // Confirm both batch deleted
  const checkBatch1 = await fetch(`${BASE_URL}/api/drawings/${d3.id}`, { headers });
  assert.equal(checkBatch1.status, 404);
  const checkBatch2 = await fetch(`${BASE_URL}/api/drawings/${d4.id}`, { headers });
  assert.equal(checkBatch2.status, 404);
  console.log('[PASS] Batch deleted drawings confirmed 404 in database');

  // 6. Test PATCH metadata project & title update
  console.log('\n6. Testing PATCH /api/drawings/:id project and title update...');
  const patchRes = await fetch(`${BASE_URL}/api/drawings/${d2.id}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({
      title: 'Renamed Drawing',
      project: 'PatchedProject',
    }),
  });
  assert.equal(patchRes.status, 200);
  const checkPatched = await fetch(`${BASE_URL}/api/drawings/${d2.id}`, { headers });
  const patchedData = await checkPatched.json();
  assert.equal(patchedData.drawing.title, 'Renamed Drawing');
  assert.equal(patchedData.drawing.project, 'PatchedProject');
  console.log('[PASS] PATCH successfully updated title and project');

  // Clean up d2
  await fetch(`${BASE_URL}/api/drawings/${d2.id}`, { method: 'DELETE', headers });
  console.log('[PASS] Cleaned up test drawing 2');

  console.log('\n🎉 ALL DRAWING FIXES, BATCH DELETE & PROJECT CLASSIFICATION VERIFIED SUCCESSFULLY!');
}

testDrawings().catch(err => {
  console.error('\n❌ Test failed:', err);
  process.exit(1);
});

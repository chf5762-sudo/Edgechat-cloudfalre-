// Comprehensive MCP Tools End-to-End Test Suite
const ENDPOINT = 'https://link.chf5762.cloudns.org/api/mcp/message';
const TOKEN = '576257';

async function callMcpTool(name, args = {}, id = 1) {
  const payload = {
    jsonrpc: '2.0',
    id,
    method: 'tools/call',
    params: {
      name,
      arguments: args,
    },
  };

  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream',
      'Authorization': `Bearer ${TOKEN}`,
    },
    body: JSON.stringify(payload),
  });

  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch (err) {
    return { ok: false, status: res.status, raw: text, error: 'JSON parse error: ' + err.message };
  }
  return { ok: res.ok, status: res.status, data: json };
}

async function runAllTests() {
  console.log('=== Starting End-to-End MCP 22 Tools Health Test ===\n');
  const results = [];
  let createdDrawingId = null;
  let createdShareId = null;
  let createdNoteId = null;
  let uploadedFileKey = null;
  let testFileName = 'mcp_test_doc_' + Date.now() + '.txt';

  async function test(name, fn) {
    try {
      const res = await fn();
      const isSuccess = res && !res.isError && (res.content ? !res.content[0]?.text?.startsWith('Error:') : true);
      results.push({ name, passed: isSuccess, res });
      console.log(`[${isSuccess ? 'PASS' : 'FAIL'}] ${name}`);
      if (!isSuccess) {
        console.log('   Details:', JSON.stringify(res));
      }
    } catch (err) {
      results.push({ name, passed: false, error: err.message });
      console.log(`[FAIL] ${name} -> Exception: ${err.message}`);
    }
  }

  // 1. read_guide
  await test('1. read_guide', async () => {
    const r = await callMcpTool('read_guide');
    return r.data?.result;
  });

  // 2. list_drawings
  await test('2. list_drawings', async () => {
    const r = await callMcpTool('list_drawings');
    return r.data?.result;
  });

  // 3. create_drawing
  await test('3. create_drawing', async () => {
    const r = await callMcpTool('create_drawing', {
      title: 'MCP Automated Health Drawing',
      elements: [
        {
          id: 'test-rect',
          type: 'rectangle',
          x: 100,
          y: 100,
          width: 150,
          height: 80,
          backgroundColor: '#e3fafc',
          strokeColor: '#1098ad',
          fillStyle: 'solid',
        },
        {
          id: 'test-txt',
          type: 'text',
          x: 120,
          y: 125,
          text: 'Normal Font Test',
          fontSize: 16,
          // omitted fontFamily -> should default to 2
        }
      ],
    });
    const parsed = JSON.parse(r.data?.result?.content?.[0]?.text || '{}');
    createdDrawingId = parsed.id || parsed.drawingId;
    return r.data?.result;
  });

  // 4. get_drawing
  await test('4. get_drawing', async () => {
    if (!createdDrawingId) throw new Error('No drawing ID');
    const r = await callMcpTool('get_drawing', { id: createdDrawingId });
    return r.data?.result;
  });

  // 5. update_drawing
  await test('5. update_drawing', async () => {
    if (!createdDrawingId) throw new Error('No drawing ID');
    const r = await callMcpTool('update_drawing', {
      id: createdDrawingId,
      title: 'MCP Automated Health Drawing (Updated)',
      elements: [
        {
          id: 'test-rect',
          type: 'rectangle',
          x: 100,
          y: 100,
          width: 200,
          height: 100,
          backgroundColor: '#d3f9d8',
          strokeColor: '#2b8a3e',
          fillStyle: 'solid',
        },
      ],
    });
    return r.data?.result;
  });

  // 6. share_drawing
  await test('6. share_drawing', async () => {
    if (!createdDrawingId) throw new Error('No drawing ID');
    const r = await callMcpTool('share_drawing', { id: createdDrawingId });
    const parsed = JSON.parse(r.data?.result?.content?.[0]?.text || '{}');
    createdShareId = parsed.shareId;
    return r.data?.result;
  });

  // 7. create_diagram
  await test('7. create_diagram', async () => {
    const r = await callMcpTool('create_diagram', {
      title: 'One-step Normal Font Diagram',
      elements: [
        {
          id: 'box-1',
          type: 'rectangle',
          x: 50,
          y: 50,
          width: 120,
          height: 60,
          backgroundColor: '#fff3bf',
          strokeColor: '#e67700',
          fillStyle: 'solid',
        },
        {
          id: 'text-1',
          type: 'text',
          x: 60,
          y: 65,
          text: 'Hello Normal Font',
          fontSize: 14,
        }
      ],
    });
    return r.data?.result;
  });

  // 8. delete_drawing
  await test('8. delete_drawing', async () => {
    if (!createdDrawingId) throw new Error('No drawing ID');
    const r = await callMcpTool('delete_drawing', { id: createdDrawingId });
    return r.data?.result;
  });

  // 9. create_note
  await test('9. create_note', async () => {
    const r = await callMcpTool('create_note', {
      title: 'MCP Health Test Note',
      content: '# MCP Note Title\nHealth test automated run.',
    });
    const parsed = JSON.parse(r.data?.result?.content?.[0]?.text || '{}');
    createdNoteId = parsed.id;
    return r.data?.result;
  });

  // 10. list_notes
  await test('10. list_notes', async () => {
    const r = await callMcpTool('list_notes');
    return r.data?.result;
  });

  // 11. get_note
  await test('11. get_note', async () => {
    if (!createdNoteId) throw new Error('No note ID');
    const r = await callMcpTool('get_note', { id: createdNoteId });
    return r.data?.result;
  });

  // 12. update_note
  await test('12. update_note', async () => {
    if (!createdNoteId) throw new Error('No note ID');
    const r = await callMcpTool('update_note', {
      id: createdNoteId,
      title: 'MCP Health Test Note (Updated)',
      content: '# Updated Content\nAll tests running green.',
    });
    return r.data?.result;
  });

  // 13. pin_note
  await test('13. pin_note', async () => {
    if (!createdNoteId) throw new Error('No note ID');
    const r = await callMcpTool('pin_note', {
      id: createdNoteId,
      isPinned: true,
    });
    return r.data?.result;
  });

  // 14. delete_note
  await test('14. delete_note', async () => {
    if (!createdNoteId) throw new Error('No note ID');
    const r = await callMcpTool('delete_note', { id: createdNoteId });
    return r.data?.result;
  });

  // 15. chat_list_channels
  await test('15. chat_list_channels', async () => {
    const r = await callMcpTool('chat_list_channels');
    return r.data?.result;
  });

  // 16. chat_list_users
  await test('16. chat_list_users', async () => {
    const r = await callMcpTool('chat_list_users');
    return r.data?.result;
  });

  // 17. chat_send_message
  await test('17. chat_send_message', async () => {
    const r = await callMcpTool('chat_send_message', {
      channelId: 'general', // supports channel name 'general'
      content: '[MCP Automated Test] 22 项 MCP 工具全覆盖测试运行验证。',
    });
    return r.data?.result;
  });

  // 18. chat_read_messages
  await test('18. chat_read_messages', async () => {
    const r = await callMcpTool('chat_read_messages', {
      channelId: 1, // supports numeric channel id
      limit: 5,
    });
    return r.data?.result;
  });

  // 19. storage_upload_file
  await test('19. storage_upload_file', async () => {
    const r = await callMcpTool('storage_upload_file', {
      filename: testFileName,
      content: 'EdgeChat MCP Storage Test Content ' + new Date().toISOString(),
      contentType: 'text/plain',
    });
    const parsed = JSON.parse(r.data?.result?.content?.[0]?.text || '{}');
    uploadedFileKey = parsed.file?.key;
    return r.data?.result;
  });

  // 20. storage_list_files
  await test('20. storage_list_files', async () => {
    const r = await callMcpTool('storage_list_files', { limit: 10 });
    return r.data?.result;
  });

  // 21. storage_get_file_info
  await test('21. storage_get_file_info', async () => {
    if (!uploadedFileKey) throw new Error('No uploaded file key');
    const r = await callMcpTool('storage_get_file_info', {
      key: uploadedFileKey,
    });
    return r.data?.result;
  });

  // 22. storage_delete_file
  await test('22. storage_delete_file', async () => {
    if (!uploadedFileKey) throw new Error('No uploaded file key');
    const r = await callMcpTool('storage_delete_file', {
      key: uploadedFileKey,
    });
    return r.data?.result;
  });

  console.log('\n=== Test Results Summary ===');
  const passedCount = results.filter(r => r.passed).length;
  console.log(`Passed: ${passedCount} / ${results.length}`);
  if (passedCount !== results.length) {
    console.log('Failed tests:', results.filter(r => !r.passed).map(r => r.name));
    process.exit(1);
  } else {
    console.log('🎉 ALL 22 MCP TOOLS PASSED SUCCESSFULLY (100%)!');
  }
}

runAllTests().catch(err => {
  console.error(err);
  process.exit(1);
});

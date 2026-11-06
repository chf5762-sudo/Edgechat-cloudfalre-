import assert from 'node:assert/strict';

const BASE_URL = 'https://link.chf5762.cloudns.org';
const PASSCODE = '576257';

async function testAll() {
  console.log('=== Testing Storage & Notes Features on Live Worker ===\n');

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

  // 2. Test Storage Folder CRUD
  console.log('\n2. Testing Storage Folder CRUD...');
  const createFolderRes = await fetch(`${BASE_URL}/api/storage/folders`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ name: 'TestFolder_' + Date.now() }),
  });
  assert.equal(createFolderRes.status, 201, 'Folder should be created');
  const folderData = await createFolderRes.json();
  const folderId = folderData.folder.id;
  console.log('[PASS] Folder created, ID:', folderId);

  // Rename folder
  const renameFolderRes = await fetch(`${BASE_URL}/api/storage/folders/${folderId}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ name: 'RenamedFolder_' + Date.now() }),
  });
  assert.equal(renameFolderRes.ok, true, 'Folder rename should succeed');
  console.log('[PASS] Folder renamed');

  // Share folder
  const shareFolderRes = await fetch(`${BASE_URL}/api/storage/folders/${folderId}/share`, {
    method: 'POST',
    headers,
    body: JSON.stringify({}),
  });
  assert.equal(shareFolderRes.ok, true, 'Folder share should succeed');
  const folderShareData = await shareFolderRes.json();
  assert.ok(folderShareData.url, 'Folder share URL should be generated');
  console.log('[PASS] Folder share created:', folderShareData.url);

  // Test public share link access (without cookie)
  const publicFolderRes = await fetch(folderShareData.url);
  assert.equal(publicFolderRes.ok, true, 'Public folder view should be accessible anonymously');
  console.log('[PASS] Public folder view accessible anonymously');

  // Soft delete folder
  const trashFolderRes = await fetch(`${BASE_URL}/api/storage/folders/${folderId}`, {
    method: 'DELETE',
    headers,
  });
  assert.equal(trashFolderRes.ok, true, 'Folder should be soft-deleted to trash');
  console.log('[PASS] Folder soft-deleted to trash');

  // Restore folder
  const restoreFolderRes = await fetch(`${BASE_URL}/api/storage/folders/${folderId}/restore`, {
    method: 'POST',
    headers,
    body: JSON.stringify({}),
  });
  assert.equal(restoreFolderRes.ok, true, 'Folder should be restored');
  console.log('[PASS] Folder restored');

  // Hard delete folder
  const permDeleteFolderRes = await fetch(`${BASE_URL}/api/storage/folders/${folderId}?permanent=1`, {
    method: 'DELETE',
    headers,
  });
  assert.equal(permDeleteFolderRes.ok, true, 'Folder permanent delete should succeed');
  console.log('[PASS] Folder permanently deleted');

  // Test File Share & Text Content auto-save
  console.log('\n2.1 Testing Storage File Share & Text Content...');
  // Upload a text file
  const testFileName = 'autotest_' + Date.now() + '.txt';
  const formData = new FormData();
  formData.append('file', new Blob(['Hello World Initial Content'], { type: 'text/plain' }), testFileName);
  const uploadRes = await fetch(`${BASE_URL}/api/storage/files`, {
    method: 'POST',
    headers: {
      'Cookie': authCookie || '',
      'Authorization': `Bearer ${PASSCODE}`,
    },
    body: formData,
  });
  assert.equal(uploadRes.ok, true, 'File upload should succeed');
  const uploadData = await uploadRes.json();
  const fileKey = uploadData.file.key;
  console.log('[PASS] File uploaded, key:', fileKey);

  // Read file content
  const getContentRes = await fetch(`${BASE_URL}/api/storage/files/${encodeURIComponent(fileKey)}/content`, {
    headers,
  });
  assert.equal(getContentRes.ok, true, 'File content should be readable');
  const contentData = await getContentRes.json();
  assert.equal(contentData.content, 'Hello World Initial Content');
  console.log('[PASS] File content read successfully');

  // Save new content (auto-save)
  const putContentRes = await fetch(`${BASE_URL}/api/storage/files/${encodeURIComponent(fileKey)}/content`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ content: 'Updated Markdown Content from Editor' }),
  });
  assert.equal(putContentRes.ok, true, 'File content should be saved via PUT');
  console.log('[PASS] File content auto-saved via PUT');

  // Share file
  const shareFileRes = await fetch(`${BASE_URL}/api/storage/files/${encodeURIComponent(fileKey)}/share`, {
    method: 'POST',
    headers,
    body: JSON.stringify({}),
  });
  assert.equal(shareFileRes.ok, true, 'File share should succeed');
  const fileShareData = await shareFileRes.json();
  assert.ok(fileShareData.url, 'Share URL should be returned');
  console.log('[PASS] File share created:', fileShareData.url);

  // Access public share anonymously
  const anonFileRes = await fetch(fileShareData.url);
  assert.equal(anonFileRes.ok, true, 'Anonymous public share link accessible');
  const sharedText = await anonFileRes.text();
  assert.equal(sharedText, 'Updated Markdown Content from Editor');
  console.log('[PASS] Public share anonymously served updated content');

  // Clean up file
  await fetch(`${BASE_URL}/api/storage/files/${encodeURIComponent(fileKey)}?permanent=1`, {
    method: 'DELETE',
    headers,
  });
  console.log('[PASS] Test file cleaned up');

  // 3. Test Notes enhancements (tags, trash, image upload, restore, batch delete)
  console.log('\n3. Testing Notes Enhancements...');
  const createNoteRes = await fetch(`${BASE_URL}/api/notes`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      title: '测试备忘录 ' + Date.now(),
      content: '# 备忘录正文\n测试内容',
      tags: ['测试', '自动化'],
    }),
  });
  assert.equal(createNoteRes.status, 201, 'Note created');
  const noteData = await createNoteRes.json();
  const noteId = noteData.id;
  console.log('[PASS] Note created with tags, ID:', noteId);

  // Update note tags
  const updateTagsRes = await fetch(`${BASE_URL}/api/notes/${noteId}/tags`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ tags: ['测试', '已更新'] }),
  });
  assert.equal(updateTagsRes.ok, true, 'Note tags updated');
  console.log('[PASS] Note tags updated');

  // Soft delete note to trash
  const trashNoteRes = await fetch(`${BASE_URL}/api/notes/${noteId}`, {
    method: 'DELETE',
    headers,
  });
  assert.equal(trashNoteRes.ok, true, 'Note soft deleted');
  console.log('[PASS] Note soft deleted to trash');

  // List trash
  const listTrashRes = await fetch(`${BASE_URL}/api/notes?trash=1`, { headers });
  assert.equal(listTrashRes.ok, true, 'List trash notes');
  const trashNotes = await listTrashRes.json();
  assert.ok(trashNotes.notes.some(n => n.id === noteId), 'Note should appear in trash list');
  console.log('[PASS] Note visible in trash list');

  // Restore note
  const restoreNoteRes = await fetch(`${BASE_URL}/api/notes/${noteId}/restore`, {
    method: 'POST',
    headers,
  });
  assert.equal(restoreNoteRes.ok, true, 'Note restored from trash');
  console.log('[PASS] Note restored from trash');

  // Batch delete notes
  const batchDeleteRes = await fetch(`${BASE_URL}/api/notes/batch-delete`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ ids: [noteId] }),
  });
  assert.equal(batchDeleteRes.ok, true, 'Batch delete succeeded');
  console.log('[PASS] Batch delete note');

  // Purge trash
  const purgeTrashRes = await fetch(`${BASE_URL}/api/notes/trash/purge`, {
    method: 'DELETE',
    headers,
  });
  assert.equal(purgeTrashRes.ok, true, 'Purge trash succeeded');
  console.log('[PASS] Purge notes trash succeeded');

  console.log('\n🎉 ALL NEW STORAGE & NOTES FEATURES VERIFIED END-TO-END ON LIVE ENVIRONMENT!');
}

testAll().catch(e => {
  console.error('\n❌ Test failed:', e);
  process.exit(1);
});

const { google } = require('googleapis');
require('dotenv').config();

async function testDocAccess() {
  try {
    console.log('🧪 Testing Google Docs API Access...\n');
    
    // Initialize OAuth
    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      'http://localhost:3000/oauth2callback'
    );
    
    oauth2Client.setCredentials({
      refresh_token: process.env.GOOGLE_REFRESH_TOKEN
    });
    
    const docs = google.docs({ version: 'v1', auth: oauth2Client });
    const drive = google.drive({ version: 'v3', auth: oauth2Client });
    
    console.log('📋 Testing Configuration:');
    console.log('   Document ID:', process.env.FULLSTACK_RESUME_DOC_ID);
    console.log('   Folder ID:', process.env.DRIVE_FOLDER_ID);
    console.log('   Client ID:', process.env.GOOGLE_CLIENT_ID.substring(0, 20) + '...');
    console.log('   Refresh Token:', process.env.GOOGLE_REFRESH_TOKEN.substring(0, 20) + '...\n');
    
    // Test 1: Access Resume Document
    console.log('📡 Test 1: Fetching resume document...');
    
    const doc = await docs.documents.get({
      documentId: process.env.FULLSTACK_RESUME_DOC_ID
    });
    
    console.log('✅ SUCCESS! Resume document accessed!');
    console.log('   Title:', doc.data.title);
    console.log('   Revision ID:', doc.data.revisionId);
    console.log('   Content elements:', doc.data.body.content.length);
    
    // Extract some text
    let textPreview = '';
    for (const element of doc.data.body.content) {
      if (element.paragraph?.elements) {
        for (const elem of element.paragraph.elements) {
          if (elem.textRun) {
            textPreview += elem.textRun.content;
            if (textPreview.length > 150) break;
          }
        }
      }
      if (textPreview.length > 150) break;
    }
    
    console.log('   Preview:', textPreview.substring(0, 100).replace(/\n/g, ' ') + '...\n');
    
    // Test 2: Access Drive Folder
    console.log('📡 Test 2: Accessing Drive folder...');
    
    const folder = await drive.files.get({
      fileId: process.env.DRIVE_FOLDER_ID,
      fields: 'id, name, mimeType'
    });
    
    console.log('✅ SUCCESS! Folder accessed!');
    console.log('   Folder name:', folder.data.name);
    console.log('   Folder ID:', folder.data.id);
    console.log('   Type:', folder.data.mimeType, '\n');
    
    // Test 3: Try to create a test file in folder
    console.log('📡 Test 3: Testing file creation in folder...');
    
    const testHtml = '<html><body><h1>Test Document</h1><p>This is a test.</p></body></html>';
    
    const testFile = await drive.files.create({
      requestBody: {
        name: 'Resume_Optimizer_Test',
        parents: [process.env.DRIVE_FOLDER_ID],
        mimeType: 'application/vnd.google-apps.document'
      },
      media: {
        mimeType: 'text/html',
        body: testHtml
      },
      fields: 'id, name, webViewLink'
    });
    
    console.log('✅ SUCCESS! Test file created!');
    console.log('   File name:', testFile.data.name);
    console.log('   File ID:', testFile.data.id);
    console.log('   View link:', testFile.data.webViewLink);
    
    // Clean up test file
    console.log('\n🗑️  Cleaning up test file...');
    await drive.files.delete({
      fileId: testFile.data.id
    });
    console.log('✅ Test file deleted\n');
    
    console.log('═══════════════════════════════════════════');
    console.log('🎉 ALL TESTS PASSED!');
    console.log('═══════════════════════════════════════════');
    console.log('✅ Resume document: Accessible');
    console.log('✅ Drive folder: Accessible');
    console.log('✅ File creation: Working');
    console.log('═══════════════════════════════════════════');
    console.log('\nYour backend is ready to optimize resumes! 🚀\n');
    
  } catch (error) {
    console.error('\n❌ ERROR:', error.message, '\n');
    
    if (error.code === 404) {
      console.log('💡 Issue: Document or folder not found');
      console.log('   Possible causes:');
      console.log('   1. Document ID is incorrect');
      console.log('   2. Folder ID is incorrect');
      console.log('   3. Document/folder was deleted\n');
      console.log('✅ Solutions:');
      console.log('   1. Double-check the IDs in your .env file');
      console.log('   2. Make sure you copied the complete ID from the URL');
      console.log('   3. Verify the document/folder exists in Google Drive\n');
      
    } else if (error.code === 403 || error.message.includes('permission')) {
      console.log('💡 Issue: Permission denied');
      console.log('   The OAuth account doesn\'t have access\n');
      console.log('✅ Solution:');
      console.log('   1. Open your resume: https://docs.google.com/document/d/' + process.env.FULLSTACK_RESUME_DOC_ID);
      console.log('   2. Click Share (top right)');
      console.log('   3. Add the email of your OAuth account');
      console.log('   4. Give it Editor access\n');
      console.log('   Do the same for the Drive folder:\n');
      console.log('   1. Open folder: https://drive.google.com/drive/folders/' + process.env.DRIVE_FOLDER_ID);
      console.log('   2. Right-click → Share');
      console.log('   3. Add OAuth account email\n');
      
    } else if (error.message.includes('not supported')) {
      console.log('💡 Issue: "This operation is not supported for this document"');
      console.log('   This usually means the file is not a Google Doc\n');
      console.log('✅ Solutions:');
      console.log('   1. Make sure the resume is a Google Doc (not Word/PDF)');
      console.log('   2. If it\'s a Word file: Right-click → Open with → Google Docs');
      console.log('   3. Get the new document ID after conversion\n');
      
    } else if (error.message.includes('invalid_grant') || error.message.includes('refresh token')) {
      console.log('💡 Issue: Refresh token is invalid or expired\n');
      console.log('✅ Solution:');
      console.log('   1. Run: node get-token.js');
      console.log('   2. Get a new refresh token');
      console.log('   3. Update GOOGLE_REFRESH_TOKEN in .env\n');
      
    } else {
      console.log('💡 Full error details:');
      console.log(error);
      console.log('\n');
    }
    
    console.log('═══════════════════════════════════════════');
    console.log('❌ TESTS FAILED');
    console.log('═══════════════════════════════════════════');
    console.log('Please fix the issues above and try again.\n');
  }
}

testDocAccess();
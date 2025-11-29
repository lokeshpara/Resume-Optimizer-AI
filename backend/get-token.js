const { google } = require('googleapis');
const readline = require('readline');
require('dotenv').config();

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  'http://localhost:3000/oauth2callback'
);

const SCOPES = [
  'https://www.googleapis.com/auth/documents',
  'https://www.googleapis.com/auth/drive'
];

const authUrl = oauth2Client.generateAuthUrl({
  access_type: 'offline',
  scope: SCOPES,
  prompt: 'consent',
  // Force account selection
  prompt: 'select_account consent'
});

console.log('\n🔐 Authorization URL:\n');
console.log(authUrl);
console.log('\n📋 Instructions:');
console.log('1. Open the URL above in your browser');
console.log('2. SELECT THE CORRECT GOOGLE ACCOUNT (not lokeshpara88@gmail.com)');
console.log('3. Click "Allow" to grant permissions');
console.log('4. Copy the CODE from the redirected URL');
console.log('5. Paste it below\n');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

rl.question('Enter the authorization code: ', (code) => {
  rl.close();
  
  oauth2Client.getToken(code, (err, token) => {
    if (err) {
      console.error('❌ Error retrieving access token:', err);
      return;
    }
    
    console.log('\n✅ Success! Your refresh token is:\n');
    console.log(token.refresh_token);
    console.log('\n📝 Copy this token and add it to your .env file as:');
    console.log('GOOGLE_REFRESH_TOKEN=' + token.refresh_token + '\n');
  });
});
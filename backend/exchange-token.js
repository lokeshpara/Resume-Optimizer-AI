const { google } = require('googleapis');
require('dotenv').config();

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  'http://localhost:3000/oauth2callback'
);

const authCode = process.argv[2];

if (!authCode) {
  console.error('❌ Please provide authorization code as argument');
  console.error('Usage: node exchange-token.js <auth_code>');
  process.exit(1);
}

oauth2Client.getToken(authCode, (err, token) => {
  if (err) {
    console.error('❌ Error exchanging token:', err.message);
    process.exit(1);
  }
  
  console.log('\n✅ SUCCESS! Your refresh token:\n');
  console.log(token.refresh_token);
  console.log('\n📝 Update your .env file with:\n');
  console.log('GOOGLE_REFRESH_TOKEN=' + token.refresh_token);
  console.log('\n');
  process.exit(0);
});

const { google } = require('googleapis');
require('dotenv').config();

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  'http://localhost:3000/oauth2callback'
);

oauth2Client.getToken('4/0ASc3gC0qCzg5DVkJ8umXfJnWXIxxQoI6g6scUuTEQnY40z7qPuQwf8oXeGm9S5lZNELCsw', (err, token) => {
  if (err) {
    console.error('❌ Error:', err.message);
    process.exit(1);
  }
  console.log('REFRESH_TOKEN=' + token.refresh_token);
  process.exit(0);
});

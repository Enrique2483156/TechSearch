console.log('updatetoken.js loaded');
import axios from 'axios';
import dotenv from 'dotenv'; 
dotenv.config();

const {
  CLIENT_ID,
  CLIENT_SECRET,
  REFRESH_TOKEN,
 
} = process.env;
// Returns a fresh or cached access token
export async function getCachedAccessToken(db) {
  // 1. Check DB for existing token
  const [rows] = await db.execute(`SELECT access_token, expires_at FROM zoho_tokens ORDER BY updated_at DESC LIMIT 1`);
  const now = Math.floor(Date.now() / 1000);

  if (
    rows.length > 0 && // token row exists
    rows[0].access_token && // token value exists
    typeof rows[0].expires_at === 'number' && // expiry valid
    rows[0].expires_at > now + 60 // token still valid for 60+ seconds
  ) {
    // Valid token found, return it
    return rows[0].access_token;
  }

  // 2. Token missing or expired -> refresh a new token
  const newTokenData = await getAccessToken();
  // console.log(newTokenData);

  // 3. Save new token with calculated expiry (Zoho tokens usually expire in 3600 seconds)
  const expiresAt = now + (newTokenData.expires_in || 3600);
  await db.execute(`INSERT INTO zoho_tokens (access_token, expires_at) VALUES (?, ?)`, [newTokenData.access_token || null, expiresAt ?? null]);
  return newTokenData.access_token;
}

// This calls your existing API call to Zoho to get new access token with refresh token
export async function getAccessToken() {
  const params = new URLSearchParams({
    refresh_token: REFRESH_TOKEN,
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    grant_type:' authorization_code'
    // grant_type: 'refresh_token'

  });

  try {
    const response = await axios.post(`https://accounts.zoho.com/oauth/v2/token?${params.toString()}`);
    return response.data; // return full data object with access_token & expires_in
  } catch (error) {
    console.error('Failed to refresh access token:', error.response?.data || error.message);
    throw error;
  }
}
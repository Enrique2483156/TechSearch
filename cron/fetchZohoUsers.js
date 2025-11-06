/** 
 * fetching CRM Users
 * 
*/
import axios from 'axios';
import dotenv from 'dotenv';
import { getCachedAccessToken, getDBConnection, writeEventLog } from '../helper.js';

dotenv.config();

const {
  ZOHO_ORG_ID, ZOHO_API_BASE            // we will also fallback to v2 automatically
} = process.env;

const now = new Date().toUTCString();
console.log('### ' + now + ' fetchZohoUsers.js loaded');

async function fetchAndSaveZohoUsers(accessToken, db) {
  if (!ZOHO_ORG_ID) {
    const msg = 'fetchZohoUsers.js Missing ZOHO_ORG_ID in env';
    writeEventLog(msg);
    console.error(msg);
    return;
  }

  const pageSize = 200;
  let page = 1;
  let zohoRequestCount = 0;
 while (true) {
    
    const url = `${ZOHO_API_BASE}/crm/v2/users?type=AllUsers&page=${page}&per_page=${pageSize}`;

    try {
      const response = await axios.get(url, {
        headers: {
          Authorization: `Zoho-oauthtoken ${accessToken}`,
          orgId: ZOHO_ORG_ID,
          Accept: 'application/json'
        }
      });
      
      zohoRequestCount++;
      
      const arr = response.data?.users || response.data?.data || [];
      if (!Array.isArray(arr) || arr.length === 0) {
        break; // nothing else to process
      }
 const mapped = arr
        .filter(u => u && u.id) // must have id
        .map(u => ({
          user_id: String(u.id).trim(),
          org_id: ZOHO_ORG_ID,
          email: (u.email || '').trim() || null,
          full_name:
            (u.full_name && u.full_name.trim()) ||
            [u.first_name, u.last_name].filter(Boolean).join(' ').trim() ||
            null,
          status: (u.status ?? u.user_status ?? '').toString() || null
        }));

      if (mapped.length > 0) {
        await saveZohoUsers(db, mapped, page);
      }
       const more = !!(response.data?.info?.more_records);
      if (!more && arr.length < pageSize) break;

      page++;
       } catch (error) {
      const errPayload = error.response?.data ? JSON.stringify(error.response.data) : error.message;
      writeEventLog(`fetchZohoUsers.js Failed to fetch CRM users on page ${page}: ${errPayload}`);
      console.error(`Failed to fetch CRM users on page ${page}:`, errPayload);
      break; // exit the loop on error (keeps behavior consistent with your style)
    }
  }
    console.log(`Total Zoho API requests made: ${zohoRequestCount}`);
}

async function saveZohoUsers(db, users, page) {
  
  const sql = `
    INSERT INTO zoho_users (user_id, org_id, email, full_name, status, last_checked)
    VALUES (?, ?, ?, ?, ?, NOW())
    ON DUPLICATE KEY UPDATE
      org_id       = VALUES(org_id),
      email        = VALUES(email),
      full_name    = VALUES(full_name),
      status       = VALUES(status),
      last_checked = NOW()
  `;

  let changedCount = 0;
   for (const u of users) {
    try {
      await db.execute(sql, [u.user_id, u.org_id, u.email, u.full_name, u.status]);
      changedCount++;
    } catch (err) {
      writeEventLog(`fetchZohoUsers.js Error saving CRM user ${u.user_id}: ${err.message}`);
      console.error('Error saving CRM user:', u.user_id, err.message);
      // keep going; do not break the whole batch on a single row error
    }
  }

  writeEventLog(`fetchZohoUsers.js Page: ${page} Total upserts: ${changedCount}`);
  console.log(`Page: ${page} Total upserts: ${changedCount}`);
}

// small test helper
async function fetchForTestZohoUsers(accessToken) {
  const url = `${ZOHO_API_BASE}/crm/v2/users?type=AllUsers&page=1&per_page=3`;
  try {
    const response = await axios.get(url, {
      headers: {
        Authorization: `Zoho-oauthtoken ${accessToken}`,
        orgId: ZOHO_ORG_ID,
        Accept: 'application/json'
      }
    });
    const arr = response.data?.users || response.data?.data || [];
    console.log('Fetched CRM users sample:', arr);
    return arr;
  } catch (error) {
    console.error('Failed to fetch CRM users sample:', error.response?.data || error.message);
    return [];
  }
}
async function main() {
  let db;
  try {
    db = getDBConnection();
    const accessToken = await getCachedAccessToken(db);
    if (!accessToken) throw new Error('No Zoho access token available');

    await fetchAndSaveZohoUsers(accessToken, db);
    // await fetchForTestZohoUsers(accessToken, db);

    const now = new Date().toUTCString();
    console.log('### ' + now + ' fetchZohoUsers.js Data save completed successfully.');
  } catch (error) {
    const now = new Date().toUTCString();
    writeEventLog(`!!! ${now} fetchZohoUsers.js Error in main process: ${error.message}`);
    console.error(`!!! ${now} Error in main process: ${error.message}`);
  } finally {
    if (db) await db.end();
  }
}

main();
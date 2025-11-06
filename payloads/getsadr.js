/** 
 * Old version, it's not usesed anywhere
 * Needs check it out (get SA)
 * add to cron and check for issues
 * fetching getRelatedRecords (List of Service Addresses) from FSM for Contacts
 */
import axios from 'axios';
import dotenv from 'dotenv';
import pLimit from 'p-limit';
import { getCachedAccessToken } from '../helper.js';
import { getDBConnection } from '../helper.js';
import fs from 'fs/promises';
// import pLimit from 'p-limit'; // install with: npm install p-limit
dotenv.config();

async function saveCheckpoint(index) {
  await fs.writeFile('checkpoint.txt', String(index), 'utf-8');
}

async function loadCheckpoint() {
  try {
    const data = await fs.readFile('checkpoint.txt', 'utf-8');
    return parseInt(data, 10);
  } catch {
    return 0; // Start from beginning if no checkpoint
  }
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Function to get contact IDs from DB MySQL
async function getFSMfromDB(db) {
    const [rows] = await db.execute('SELECT ZFSM_id FROM fsm_contacts where list_service_address IS NULL OR list_service_address = "" ');
    // console.log(rows);
    return rows.map(r => r.ZFSM_id);

}

async function getRelatedRecords(accessToken, ZFSM_id, db, relatedListApiName) {
    const pageSize = 200;
    let page = 1;
    let allRelatedRecords = [];
    const maxRetries = 3;

    while (true) {
        const url = `https://fsm.zoho.com/fsm/v1/Contacts/${ZFSM_id}/${relatedListApiName}?&page=${page}&per_page=${pageSize}`;
        let attempt = 0;
        while (attempt < maxRetries) {
            try {
                const response = await axios.get(url, {
                    headers: { Authorization: `Zoho-oauthtoken ${accessToken}` }
                });

                const data = response.data || {};

                const records = data.data || [];

                console.log(`Fetched ${records.length} contact Addresses for contact ${ZFSM_id} page ${page}`);

                if (records.length === 0) break;  // no more pages

                //  Collect records
                allRelatedRecords = allRelatedRecords.concat(records);
                page++;
                break; // success, exit retry loop
            }
            catch (err) {
               if (err.response && err.response.status === 429) {
                    // Rate limit hit - parse Retry-After or set default wait time
                    const retryAfterSec = parseInt(err.response.headers['retry-after']) || 30;
                    console.warn(`Rate limited. Waiting ${retryAfterSec} seconds before retrying contact ${ZFSM_id} page ${page} attempt ${attempt + 1}`);

                    await sleep(retryAfterSec * 1000);
                    attempt++;
                } else {
                    throw new Error(`Failed to fetch related records for contact ${ZFSM_id}: ${err.message}`);
                } 
            }
        }

        if (attempt === maxRetries) {
            throw new Error(`Max retries reached for contact ${ZFSM_id} page ${page}`);
        }
        if (page > 1 && allRelatedRecords.length === 0) {
            // No records found after retrying first page, probably stop
            break;
        }
    }
    if (allRelatedRecords.length > 0) {
        try {
            console.log("ZFSM_id");
            console.log(ZFSM_id);

            // console.log("allRelatedRecords");
            // console.log(allRelatedRecords);
            await updateRecords(db, allRelatedRecords, ZFSM_id);
            console.log(`Saved ${allRelatedRecords.length} related records for contact ${ZFSM_id}`);
        } catch (saveErr) {
            console.error(`Failed to save related records for contact ${ZFSM_id}: ${saveErr.message}`);
        }
    }
}

async function updateRecords(db, allRelatedRecords, ZFSM_id) {
    const sql = `UPDATE fsm_contacts SET list_service_address = ? WHERE ZFSM_id = ?`;
    try {
        let jsonString = JSON.stringify(allRelatedRecords);

        if (jsonString.startsWith('[') && jsonString.endsWith(']')) {
            jsonString = jsonString.slice(1, -1);
        }
        const [result] = await db.execute(sql, [jsonString, ZFSM_id]);

        if (result.affectedRows === 0) {
            console.warn(`No record updated for contact id ${ZFSM_id} - may not exist.`);
        } else {
            console.log(`Updated service_address lookup for contact id ${ZFSM_id}`);
        }
    } catch (err) {
        console.error(`Error updating service_address for contact id ${ZFSM_id}:`, err.message);
    }
}


async function updateFSMRelatedRecords(db, accessToken) {
    const relatedListApiName = 'Addresses';
    const ZFSM_ids = await getFSMfromDB(db);// 10 for test
    console.log('Contacts to process:', ZFSM_ids.length);

    //instead for loop 
    const limit = pLimit(5); //  max 10 concurrent fetch+update at once

    const tasks = ZFSM_ids.map(ZFSM_id =>
        limit(async () => {
            try {
                await getRelatedRecords(accessToken, ZFSM_id, db, relatedListApiName);
                console.log(`Processed related records for contact ${ZFSM_id}`);
            } catch (err) {
                console.error(`Error processing contact ${ZFSM_id}:`, err.message);
            }
        })
    );
    await Promise.all(tasks);


    console.log('All contacts processed.');
    // for (const ZFSM_id of ZFSM_ids) {
    //     try {
    //         await getRelatedRecords(accessToken, ZFSM_id, db, relatedListApiName);
    //         console.log(`Processed related records for contact ${ZFSM_id}`);
    //     } catch (err) {
    //         console.error(`Error processing contact ${ZFSM_id}:`, err.message);
    //     }
    // }

}

async function main() {
    let db;

    try {
        // Establish a connection to the MySQL database using helper function
        db = await getDBConnection();

        // Retrieve a valid Zoho CRM access token (cached or refreshed as needed)
        const accessToken = await getCachedAccessToken(db);
        console.log('Access token obtained.' + accessToken);

        // const contactId = "23940000000307012";
        // const fsmOnsiteTech = await getRelatedRecords(accessToken, contactId, db, relatedListApiName);

        // console.log(`Saving ${fsmOnsiteTech.length} FSM aervice address...`);

        await updateFSMRelatedRecords(db, accessToken);

        console.log('Data save completed successfully.');
    } catch (error) {
        console.error('Error in main process:', error.message);
    } finally {
        if (db) await db.end();
    }
}

main();
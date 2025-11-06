/** 
 * fetching techs's IDs from zoho crm and update DB fsm_tech
*/

import { getCachedAccessToken, getDBConnection, writeEventLog } from '../helper.js';

const now = new Date().toUTCString();
console.log('### ' + now + ' techCrmIds.js loaded');

async function fetchContactsCRM(accessToken) {
    let allContacts = [];
    let pageToken = null;
    let zohoRequestCount = 0;

    do {

        let url = 'https://www.zohoapis.com/crm/v8/FSM_Technicians?per_page=200&fields=id,FSM_Technician_ID';
        if (pageToken) {
            url += `&page_token=${pageToken}`;
        }

        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'Authorization': `Zoho-oauthtoken ${accessToken}`
            }
        });

        zohoRequestCount++;

        if (!response.ok) {
            const errorBody = await response.json();
            console.log(`Failed to fetch IDs from zoho crm: ${JSON.stringify(errorBody)}`)
            writeEventLog(`Failed to fetch IDs from zoho crm: ${JSON.stringify(errorBody)}`);
            throw new Error(`Failed to fetch IDs from zoho crm: ${JSON.stringify(errorBody)}`);
        }
        const data = await response.json();

        if (data.data && data.data.length) {
            allContacts = allContacts.concat(data.data);
        }

        pageToken = data.info?.next_page_token || null;


    } while (pageToken);

    console.log(`Total Zoho API requests made: ${zohoRequestCount}`);
    return allContacts;
}

async function updateSHIFTSOnsiteTechDB(employees, db) {
    if (!employees.length) {
        return;
    }

    const sqlUpdate = `
        UPDATE fsm_tech 
        SET ZCRM_Id = ? 
        WHERE id_tech = ?
    `;

    let changedCount = 0;

    for (const emp of employees) {
        const zfsm_id = emp.FSM_Technician_ID.trim().toLowerCase();
        if (!zfsm_id) continue;
        try {
            const [result] = await db.execute(sqlUpdate, [emp.id, zfsm_id]);
            if (result.affectedRows === 0) {
                // console.log(`No DB record found with zfsm_id ${zfsm_id} to update.`);
            } else {
                // console.log(`Updated DB record with zfsm_id ${zfsm_id}`);
            }
            changedCount++;
        } catch (err) {
            writeEventLog(`Failed to update record with zfsm_id ${zfsm_id}:`, err.message);
            console.error(`Failed to update record with zfsm_id ${zfsm_id}:`, err.message);
        }
    }
    writeEventLog(`Total updates: ${changedCount}`);
    console.log(`Total updates: ${changedCount}`);
}

async function main() {
    let db;
    try {
        db = getDBConnection();
        const accessToken = await getCachedAccessToken(db);
        const employees = await fetchContactsCRM(accessToken);
        await updateSHIFTSOnsiteTechDB(employees, db);

        const now = new Date().toUTCString();
        console.log('### ' + now + ' techCrmIds.js Data save completed successfully.');
    } catch (error) {
        const now = new Date().toUTCString();
        writeEventLog(`!!! ${now} techCrmIds.js Error in main process: ${error.message}`);
        console.error(`!!! ${now} techCrmIds.js Error in main process:, ${error.message}`);
    } finally {
        if (db) await db.end();
    }
}
main();
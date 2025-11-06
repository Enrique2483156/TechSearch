/**
 * get zoho Fsm contacts to DB
 */
import axios from 'axios';
import { getCachedAccessToken } from '../helper.js';
import { getDBConnection } from '../helper.js';
import { writeEventLog } from '../helper.js';

const now = new Date().toUTCString();
console.log('### ' + now + ' fetchFsmClients.js loaded');

async function fetchAndSaveContactsFSM(accessToken, db) {
    const pageSize = 200;
    let page = 1;
    let zohoRequestCount = 0;

    while (true) {

        const url = `https://fsm.zoho.com/fsm/v1/Contacts?&page=${page}&per_page=${pageSize}`;

        try {
            const response = await axios.get(url, {
                headers: { Authorization: `Zoho-oauthtoken ${accessToken}` }
            });
            zohoRequestCount++;
            const users = response.data.data || [];

            const validContacts = users.filter(data => data.Email && data.Email.trim() !== '');

            if (validContacts.length > 0) {
                await saveContactsFSM(db, validContacts, page);
            }

            if (users.length < pageSize) {
                break;
            }
            page++;
        } catch (error) {
            writeEventLog(`fetchFsmClients.js Failed to fetch FSM contacts on page ${page}: ${error.response?.datae}\n${error.message}`);
            break;
        }
    }
    console.log(`Total Zoho API requests made: ${zohoRequestCount}`);
}

async function saveContactsFSM(db, contacts, page) {
    const sql = `
    INSERT INTO fsm_contacts (ZFSM_id, email, ZBilling_Id, first_name, phone, service_address, ZCRM_Id, last_name, billing_address, payload, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
            email = VALUES(email),
            ZBilling_Id = VALUES(ZBilling_Id),
            first_name = VALUES(first_name),
            phone = VALUES(phone),
            service_address = VALUES(service_address),
            ZCRM_Id = VALUES(ZCRM_Id),
            last_name = VALUES(last_name),
            billing_address = VALUES(billing_address),
            payload = VALUES(payload),
            updated_at = VALUES(updated_at)
  `;

    let changedCount = 0;

    for (const contact of contacts) {

        try {

            const now = Math.floor(Date.now() / 1000);
            await db.execute(sql, [contact.id, contact.Email, contact.ZBilling_Id, contact.First_Name, contact.Phone, contact.Service_Address, contact.ZCRM_Id, contact.Last_Name, contact.Billing_Address, contact, now]);

            changedCount++;

        } catch (err) {

            writeEventLog(`fetchFsmClients.js Error saving FSM Contact records: ${contact} ${err.message}`);
            console.error('Error saving FSM contact:', err.message);
            break;
        }
    }
    writeEventLog(`Page: ${page} Total updates: ${changedCount}`);
    console.log(`Page: ${page} Total updates: ${changedCount}`);
}

async function fetchForTestContactsFSM(accessToken) {
    const url = 'https://fsm.zoho.com/fsm/v1/Contacts?per_page=10&page=1';

    try {
        const response = await axios.get(url, {
            headers: { Authorization: `Zoho-oauthtoken ${accessToken}` }
        });

        const users = response.data.data || [];
        
        console.log('Fetched field agents:', users);
        return users;

    } catch (error) {
        console.error('Failed to fetch FSM contacts:', error.response?.data || error.message);
        return [];
    }
}

async function main() {
    let db;
    try {
        db = getDBConnection();
        const accessToken = await getCachedAccessToken(db);
        await fetchAndSaveContactsFSM(accessToken, db);

        const now = new Date().toUTCString();
        console.log('### ' + now + ' fetchFsmClients.js Data save completed successfully.');
    } catch (error) {
        const now = new Date().toUTCString();
        writeEventLog(`!!! ${now} saveContactsCRM.js Error in main process: ${error.message}`);
        console.error(`!!! ${now} Error in main process:, ${error.message}`);
    } finally {
        if (db) await db.end();
    }
}

main();
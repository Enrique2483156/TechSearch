/**
 * Insert SA Contact From DB TO Zoho CRM Custom Module (Insert FSM records from fsm_tech table table to Zoho CRM Custom Module)
 */
// import axios from 'axios';
// import dotenv from 'dotenv';
// import pLimit from 'p-limit';
// import { buildContactAddress } from './helper.js';
import { getCachedAccessToken } from '../helper.js';
import { getDBConnection } from '../helper.js';
// import pLimit from 'p-limit'; // install with: npm install p-limit
// dotenv.config();

// Utility delay function (optional if you want to throttle API calls as well)
function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
//from string to json 
function fixListServiceAddress(rawString) {
    let fixed = rawString.trim();
    if (!fixed.startsWith('[') && !fixed.endsWith(']')) {
        fixed = '[' + fixed + ']';
    }
    fixed = fixed.replace(/}\s*{/g, '},{');
    return fixed;
}

function buildName(addr) {
    const parts = [];
    if (addr.Street_1) parts.push(addr.Street_1);
    if (addr.City) parts.push(addr.City);
    if (addr.State) parts.push(addr.State);
    if (addr.Zip_Code) parts.push(addr.Zip_Code);
    return parts.filter(Boolean).join(', ');
}

function isSameAddressById(a1, a2) {
    if (!a1 || !a2) return false;
    return a1.id === a2.id;
}

function filterExtraAddresses(listService, serviceAddress, billingAddress) {
    if (!Array.isArray(listService)) return [];
    return listService.filter(addr => {
        if (!addr || !addr.id) return false;
        if (isSameAddressById(addr, serviceAddress)) return false;
        if (isSameAddressById(addr, billingAddress)) return false;
        return true;
    });
}

async function getExistingServiceAddressIds(accessToken, fsmIds) {
    const existingIds = [];
    for (const id of fsmIds) {
        const criteria = `(FSM_Service_Address_ID:equals:${id})`;
        const url = `https://www.zohoapis.com/crm/v2/Service_Addresses/search?criteria=${encodeURIComponent(criteria)}`;
        const response = await fetch(url, {
            method: 'GET',
            headers: { 'Authorization': `Zoho-oauthtoken ${accessToken}` }
        });
        if (!response.ok) {
            const err = await response.json();
            console.error(`Zoho search API error for ID ${id}:`, err);
            continue; // или пробросить ошибку, если нужно
        }
        const data = await response.json();
        if (data.data && data.data.length > 0) {
            existingIds.push(id);
        }
        await delay(200);
    }
    return existingIds;
}

async function insertBatchToZoho(accessToken, records) {

    if (records.length === 0) return [];


    const fsmIds = records.map(r => r.FSM_Service_Address_ID).filter(id => id);


    const existingIds = await getExistingServiceAddressIds(accessToken, fsmIds);


    const newRecords = records.filter(r => !existingIds.includes(r.FSM_Service_Address_ID));

    if (newRecords.length === 0) {
        console.log('All records already exist in Zoho, skipping insert');
        return [];
    }
    const payload = { data: newRecords };
    console.log(payload);
    const response = await fetch('https://www.zohoapis.com/crm/v8/Service_Addresses', {
        method: 'POST',
        headers: {
            'Authorization': `Zoho-oauthtoken ${accessToken}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
    });

    if (!response.ok) {
        const err = await response.json();
        throw new Error(`Zoho API error: ${JSON.stringify(err)}`);
    }

    const resBody = await response.json();
    return resBody.data.map(d => d.details.id);
}

async function insertServiceAddressesToCRM(db, accessToken) {
    try {

        const query = `
            SELECT id, list_service_address, service_address, billing_address, ZCRM_Id 
            FROM fsm_contacts 
            WHERE list_service_address IS NOT NULL AND list_service_address != ''
        `;
        const [rows] = await db.execute(query);

        if (!rows.length) {
            console.log('No records with list_service_address found');
            return { message: 'No records to sync' };
        }

        for (const row of rows) {
            let listService;
            try {
                const fixedString = fixListServiceAddress(row.list_service_address);
                listService = JSON.parse(fixedString);
                if (!Array.isArray(listService)) {
                    console.error(`list_service_address is not array for id ${row.id}`);
                    continue;
                }
            } catch (e) {
                console.error(`Invalid JSON in list_service_address for id ${row.id}:`, e);
                continue;
            }

            let serviceAddress = null;
            try {
                serviceAddress = row.service_address ? JSON.parse(row.service_address) : null;
            } catch (e) {
                console.error(`Invalid JSON in service_address for id ${row.id}:`, e);
            }

            let billingAddress = null;
            try {
                billingAddress = row.billing_address ? JSON.parse(row.billing_address) : null;
            } catch (e) {
                console.error(`Invalid JSON in billing_address for id ${row.id}:`, e);
            }

            const extraAddresses = filterExtraAddresses(listService, serviceAddress, billingAddress);
            if (extraAddresses.length === 0) {
                console.log(`No extra addresses for contact id ${row.id}`);
                continue;
            } else {
                const contactId = row.ZCRM_Id || "";


                const records = extraAddresses.map(addr => ({
                    Name: buildName(addr),
                    Street: addr.Street_1 || "",
                    State: addr.State || "",
                    Zip: addr.Zip_Code ? addr.Zip_Code.toString() : "",
                    City: addr.City || "",
                    FSM_Service_Address_ID: addr.id || "",
                    Contact: contactId
                }));


                const batchSize = 100;
                for (let i = 0; i < records.length; i += batchSize) {
                    const batch = records.slice(i, i + batchSize);
                    console.log(batch);
                    try {
                        const createdIds = await insertBatchToZoho(accessToken, batch);
                        console.log(`Inserted service address batch IDs:`, createdIds);
                        // console.log(`Inserted service address batch IDs:`, i);
                    } catch (error) {
                        console.error(`Error inserting service address batch starting at index ${i}:`, error);
                        throw error;
                    }
                    await delay(1000);
                }
            }
        }
        console.log('All extra service addresses inserted successfully');
        return { message: 'Insert completed' };
    } catch (error) {
        console.error('Error in insertServiceAddressesToCRM:', error);
        throw error;
    }
}

async function insertServiceAddressesTest(db, accessToken) {
    try {
        const query = `SELECT id, list_service_address, service_address, billing_address, ZCRM_Id FROM fsm_contacts WHERE list_service_address IS NOT NULL AND list_service_address != '' LIMIT 100`;
        const result = await db.execute(query);
        const [rows] = result;
        // console.log(rows);

        if (!rows || rows.length === 0) {
            console.log('No records found in fsm_contacts');
            return { message: 'No records to sync' };
        }

        for (const row of rows) {
            // const row = rows[0];
            // console.log('Raw :', row);

            let listService;
            try {
                const fixedString = fixListServiceAddress(row.list_service_address);
                listService = JSON.parse(fixedString);
                if (!Array.isArray(listService)) {
                    throw new Error('list_service_address is not array after fix');
                }
            } catch (e) {
                throw new Error('Invalid JSON in list_service_address: ' + e.message);
            }
            // console.log(listService);
            let serviceAddress = null;
            try {
                serviceAddress = row.service_address ? JSON.parse(row.service_address) : null;
            } catch (e) {
                console.warn('Invalid JSON in service_address:', e.message);
            }

            let billingAddress = null;
            try {
                billingAddress = row.billing_address ? JSON.parse(row.billing_address) : null;
            } catch (e) {
                console.warn('Invalid JSON in billing_address:', e.message);
            }

            const extraAddresses = filterExtraAddresses(listService, serviceAddress, billingAddress);


            if (extraAddresses.length === 0) {
                console.log('No extra addresses to insert for contact id', row.id);
                // return { message: 'No extra addresses to insert' };
                continue;
            } else {

                // Создаем записи для Zoho CRM
                const records = extraAddresses.map(addr => ({
                    Name: buildName(addr),
                    Street: addr.Street_1 || "",
                    State: addr.State || "",
                    Zip: addr.Zip_Code ? addr.Zip_Code.toString() : "",
                    City: addr.City || "",
                    FSM_Service_Address_ID: addr.id || "",
                    Contact: row.ZCRM_Id || ""
                }));

                const payload = { data: records };
                console.log('Payload for Zoho:', payload);
                const response = await fetch('https://www.zohoapis.com/crm/v8/Service_Addresses', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Zoho-oauthtoken ${accessToken}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(payload)
                });

                console.log('Zoho API response status:', response.status);

                if (!response.ok) {
                    const errorBody = await response.json();
                    console.error('Zoho API error:', errorBody);
                    throw new Error('Failed to insert service addresses in Zoho CRM');
                }

                const responseBody = await response.json();
                const createdIds = responseBody.data.map(d => d.details.id);
                console.log('Successfully created service address records with IDs:', createdIds);

                // return { message: 'Inserted service addresses successfully', ids: createdIds };

            }
            console.log(`Inserted service addresses successfully: ${row.id}`);
        }

    } catch (error) {
        console.error('Error inserting service addresses:', error);
        throw error;
    }
}


async function main() {
    let db;
    try {
        db = getDBConnection();
        const accessToken = await getCachedAccessToken(db);

        await insertServiceAddressesToCRM(db, accessToken);


        // await insertServiceAddressesTest(db, accessToken);
    } catch (e) {
        console.error('Error in main:', e);
    } finally {
        if (db) await db.end();
    }
}

main();
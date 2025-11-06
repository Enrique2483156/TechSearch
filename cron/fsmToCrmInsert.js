/**
 * Insert FSM Tech From DB TO Zoho CRM Custom Module (Insert FSM records from fsm_tech table table to Zoho CRM Custom Module)
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


//this function for test only
async function insertFSMtoCRM(db, accessToken) {
    try {
        // Fetch only 10 records from fsm_tech
        const query = `SELECT payload FROM fsm_tech WHERE payload IS NOT NULL LIMIT 10`;
        const result = await db.execute(query);

        // Correctly extract rows from the result structure
        const rows = result[0];

        if (!rows || rows.length === 0) {
            console.log('No records found in fsm_tech');
            return { message: 'No records to sync' };
        }

        // Debug payload types
        // rows.forEach((row, idx) => {
        //     console.log(`Row ${idx} payload type:`, typeof row.payload, 'value:', row.payload ? row.payload.substring(0, 50) : row.payload);
        // })

        const buildRecord = (payloadJSON) => {
            if (!payloadJSON) {
                throw new Error('Empty or undefined payload encountered');
            }
            let pl;
            try {
                pl = JSON.parse(payloadJSON);
            } catch (e) {
                throw new Error('Invalid JSON in payload: ' + e.message);
            }

            return {
                Name: pl.first_name,
                FSM_Technician_ID: pl.id || "",
                Employee_ID: pl.employee_id || "",
                Email: pl.email || "",
                First_Name: pl.first_name || "",
                Last_Name: pl.last_name || "",
                Phone: pl.mobile || pl.phone || "",
                Street: pl.street || "",
                Zip_Code: pl.zip || "",
                City: pl.city || "",
                Layout: { id: '6685770000003061835' }
            };
        };

        // Filter only rows with string payload
        const validRows = rows.filter(row => typeof row.payload === 'string' && row.payload.trim() !== '');

        if (validRows.length === 0) {
            console.log('No valid records to insert');
            return { message: 'No valid records to insert' };
        }

        const records = validRows.map(row => buildRecord(row.payload));

        const payload = { data: records };
        console.log(payload);
        const response = await fetch('https://www.zohoapis.com/crm/v8/FSM_Technicians', {
            method: 'POST',
            headers: {
                'Authorization': `Zoho-oauthtoken ${accessToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        console.log(`Zoho API response status:`, response.status);

        if (!response.ok) {
            const errorBody = await response.json();
            console.error('Zoho API error:', errorBody);
            throw new Error('Failed to create FSM records in Zoho CRM');
        }

        const responseBody = await response.json();
        const createdIds = responseBody.data.map(d => d.details.id);
        console.log('Successfully created records with IDs:', createdIds);

        return { message: 'Inserted records successfully', ids: createdIds };

    } catch (error) {
        console.error('Error inserting FSM records:', error);
        throw error;
    }
}

async function insertFSMtoCRMForAll(db, accessToken) {
    try {
        // Fetch rows from your database for all
        const query = `SELECT * FROM fsm_tech WHERE payload IS NOT NULL and ZCRM_Id IS NULL`;
        const result = await db.execute(query);  // Adjust based on your DB lib; db.execute returns [rows, ...]
        
        const [rows] = Array.isArray(result) ? result : result[0]; //
        // const filteredRows = rows.filter(row => row.payload && row.payload.trim() !== '');//unncoment after zoho resolve issue
        const filteredRows = rows;
        
        if (!filteredRows.length) {
            // console.log('No records found in fsm_tech');
            return { message: 'No records to sync' };
        }
        // Parse payload and map to Zoho fields

        // unncoment it after zoho resolve the issue
        // Adjust these mappings to the actual Zoho field API names in CustomModule5
        // const buildRecord = (payloadJSON) => {
        //     // console.log(payloadJSON);
        //     if (!payloadJSON) {
        //         throw new Error('Empty or undefined payload encountered');
        //     }
        //     let item;
        //     try {
        //         item = JSON.parse(payloadJSON);
        //     } catch (e) {
        //         throw new Error('Invalid JSON in payload: ' + e.message);
        //     }
        //     console.log(item.id_tech);
        //     return {
        //         Name: ((item.first_name || "") + " " + (item.last_name || "")).trim(),
        //         FSM_Technician_ID: item.id_tech || "",
        //         Employee_ID: item.employee_id || "",
        //         Email: item.email || "",
        //         First_Name: item.first_name || "",
        //         Last_Name: item.last_name || "",
        //         // Phone: item.mobile || item.phone || "",
        //         Street: item.street || "",
        //         Zip_Code: item.zip || "",
        //         City: item.city || "",
        //         Layout: { id: '6685770000003061835' }
        //     };
        // };

        // remove it after zoho resolve the issue Build Zoho CRM records directly from DB fields (no payload parsing)
        const buildRecord = (row) => {
            return {
                Name: ((row.first_name || "") + " " + (row.last_name || "")).trim(),
                FSM_Technician_ID: row.id_tech || "",
                Employee_ID: row.employee_id || "",
                Email: row.email || "",
                First_Name: row.first_name || "",
                Last_Name: row.last_name || "",
                Phone: row.mobile || row.phone || "",
                Street: row.street || "",
                Zip_Code: row.zip ? row.zip.toString() : "",
                City: row.city || "",
                Layout: { id: '6685770000003061835' }
            };
        };

        // Build all records
        // const allRecords = filteredRows.map(row => buildRecord(row.payload));  turn on  it after zoho resolve issue with response from FSM
        const allRecords = filteredRows.map(row => buildRecord(row)); //turn off it after
        console.log(allRecords);
        // Batch records in max size 100 per Zoho API limit
        const batchSize = 100;

        for (let i = 0; i < allRecords.length; i += batchSize) {
            const batch = allRecords.slice(i, i + batchSize);
            const payload = { data: batch };
            //API call to Zoho CRM
            const response = await fetch('https://www.zohoapis.com/crm/v8/FSM_Technicians', {
                method: 'POST',
                headers: {
                    'Authorization': `Zoho-oauthtoken ${accessToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(payload)
            });

            // console.log(`Zoho API response status for batch ${i / batchSize + 1}:`, response.status);

            if (!response.ok) {
                // const errorBody = await response.json();
                // console.error('Zoho API error:', errorBody);
                throw new Error(`Failed to create records batch ${i / batchSize + 1}`);
            }

            const responseBody = await response.json();

            // Log created record IDs for tracking
            const createdIds = responseBody.data.map(d => d.details.id);
            // console.log(`Batch ${i / batchSize + 1}: Created records with IDs:`, createdIds);

            // Optional: throttle between batches (e.g. wait 1 second)
            await delay(1000);
        }
        console.log('All records inserted successfully');
        return { message: 'All records inserted successfully' };

    } catch (error) {
        console.error('Error inserting FSM records to zoho CRM:', error);
        throw error;  // Handle appropriately in your API endpoint or caller
    }
}



async function main() {
    let db; // Define DB connection variable in outer scope for use in try/finally
    try {
        // Establish a connection to the MySQL database using helper function
        db = getDBConnection();

        // Retrieve a valid Zoho CRM access token (cached or refreshed as needed)
        const accessToken = await getCachedAccessToken(db);
        // console.log('Access token obtained.' + accessToken);

        // Fetch all Contacts records from Zoho CRM using the access token
        await insertFSMtoCRMForAll(db, accessToken);
        // console.log('Data save completed successfully.');
    } catch (error) {
        // Catch and log any errors that occur during the entire sync process
        console.error('Error in main process:', error.message);
    } finally {
        // Ensure database connection is properly closed at the end of the process
        if (db) await db.end();
    }
}
main();


/**
 * Update FSM records from DB TO Zoho CRM Custom Module (from fsm_tech database table)
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


async function updateFSMtoCRMForAll(db, accessToken) {
    try {
        // Fetch rows from your database for all
        const query = `SELECT ZCRM_Id, payload FROM fsm_tech WHERE payload IS NOT NULL and ZCRM_Id IS NOT NULL`;
        // const result = await db.execute(query);  // Adjust based on your DB lib; db.execute returns [rows, ...]
        // const [rows] = Array.isArray(result) ? result : result[0]; // adjust if needed
        const [rows] = await db.execute(query);

        const filteredRows = rows.filter(row => row.payload && row.payload.trim() !== '');

        if (!filteredRows.length) {
            // console.log('No records found in fsm_tech');
            return { message: 'No records to sync' };
        }
        // Parse payload and map to Zoho fields
        // Adjust these mappings to the actual Zoho field API names in CustomModule5

        const buildRecord = (row) => {

            let item;
            try {
                item = JSON.parse(row.payload);
            } catch (e) {
                throw new Error('Invalid JSON in payload: ' + e.message);
            }

            const skillsArray = Array.isArray(item.Skills)
                ? item.Skills.map(skill => skill.name).filter(Boolean)
                : [];

            const record = {
                id: row.ZCRM_Id,
                FSM_Technician_ID: item.id || "",
                Employee_ID: item.employee_id || "",
                Email: item.email || "",
                First_Name: item.first_name || "",
                Last_Name: item.last_name || "",
                Phone: item.mobile || item.phone || "",
                Street: item.street || "",
                Zip_Code: item.zip || "",
                City: item.city || "",
                State: item.state || "",
                Status: item.status || "",
                Service_Resource_ID: item.Service_Resources?.id || "",
            };
            if (skillsArray.length > 0) {
                record.Skills = skillsArray;
            }

            return record;

        };

        // Build all records
        // console.log(filteredRows);
        // const allRecords = filteredRows.map(row => buildRecord(row.payload));
        const allRecords = filteredRows.map(row => buildRecord(row));

        // Batch records in max size 100 per Zoho API limit
        const batchSize = 100;

        for (let i = 0; i < allRecords.length; i += batchSize) {
            const batch = allRecords.slice(i, i + batchSize);
            const payload = { data: batch };
            //API call to Zoho CRM
            const response = await fetch('https://www.zohoapis.com/crm/v8/FSM_Technicians', {
                method: 'PUT',
                headers: {
                    'Authorization': `Zoho-oauthtoken ${accessToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(payload)
            });

            // console.log(`Zoho API response status for batch ${i / batchSize + 1}:`, response.status);

            if (!response.ok) {
                // const errorBody = await response.json();
                console.error('Zoho API error:', errorBody);
                throw new Error(`Failed to update records batch ${i / batchSize + 1}`);
            }

            const responseBody = await response.json();

            // Log created record IDs for tracking
            // const createdIds = responseBody.data.map(d => d.details.id);
            // console.log(`Batch ${i / batchSize + 1}: Created records with IDs:`, createdIds);

            // Optional: throttle between batches (e.g. wait 1 second)
            await delay(1000);
        }

        return { message: 'All records updated successfully' };

    } catch (error) {
        console.error('Error updating FSM records to zoho CRM:', error);
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

        await updateFSMtoCRMForAll(db, accessToken);

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

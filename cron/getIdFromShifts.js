/** 
 * fetching techs's zoho shifts ID and update DB fsm_tech
 */
import axios from 'axios'; 
import dotenv from 'dotenv';
import { getCachedAccessToken } from '../helper.js';
import { getDBConnection } from '../helper.js';
import { writeEventLog } from '../helper.js';

dotenv.config();

const {
ZOHO_ORG_ID_SHIFTS
} = process.env;
// get data from shifts 
// Get all employees
//curl https://shifts.zoho.com/api/v1/{org_id}/employees
//-H "Authorization: Zoho-oauthtoken 1000.41d9f2cfbd1b7a8f9e314b7aff7bc2d1.8fcc9810810a216793f385b9dd6e125f"
//status: active
//invite_status: accepted

// limit
// The number of entries to return per page. Default: 50 Max: 100
// page
// The page number to fetch. Default: 1
//"work_email": "john.peter@mail.com",
//"id": "12345",
 

async function updateSHIFTSOnsiteTechDB(employees, db) {
    if (!employees.length) {
        console.log('No employees to update in DB');
        return;
    }

    // SQL assumes you have unique email index on your DB table fsm_tech, and columns shifts_user_id and shifts_zuid exist:
    const sqlUpdate = `
        UPDATE fsm_tech 
        SET shifts_id = ?, shifts_zuid = ? 
        WHERE LOWER(email) = ?
    `;

    for (const emp of employees) {
        const email = emp.work_email.trim().toLowerCase();
        // console.log('email');
        // console.log(email);
        // console.log(emp.id);
        // console.log(emp.zuid);
        if (!email) continue;
        try {
            const [result] = await db.execute(sqlUpdate, [emp.id, emp.zuid, email]);
            if (result.affectedRows === 0) {
                console.log(`No DB record found with email ${email} to update.`);
            } else {

                // console.log(`Updated DB record with email ${email}`);
            }
        } catch (err) {
            writeEventLog(`getIdFromShifts.js Failed to update record with email ${email}: ${err.message}`);
        }
    }
}

async function fetchSHIFTSOnsiteTech(accessToken, db) {
    const pageSize = 50;
    let page = 1;
    // let allEmployees = [];

    while (true) {
        // make API call with pagination params from FSM
        const url = `https://shifts.zoho.com/api/v1/${ZOHO_ORG_ID_SHIFTS}/employees?status=active&invite_status=accepted&page=${page}&limit=${pageSize}`;
        // const url = `https://shifts.zoho.com/api/v1/${ZOHO_ORG_ID_SHIFTS}/employees?&page=${page}&limit=${pageSize}`;

        try {
            const response = await axios.get(url, {
                headers: { Authorization: `Zoho-oauthtoken ${accessToken}` }
            });
            const employees = response.data.employees || [];
            // console.log(`Fetched ${employees.length} employees on page ${page}`);

            // allEmployees = allEmployees.concat(employees);
            // console.log(employees);

            if (employees.length > 0) {
                // Last page or fewer employees
                await updateSHIFTSOnsiteTechDB(employees, db);
            }

            if (employees.length < pageSize) {
                break;
            }
            page++;
        } catch (error) {
            writeEventLog(`getIdFromShifts.js Failed to fetch FSM users from SHIFTS on page ${page}:  ${error.response?.datae}\n${error.message}`);
             console.error(`Failed to fetch FSM users on page ${page}:`, error.response?.data || error.message);
            break;
        }
    }
    console.log('fetchFSMOnsiteTech obtained');
}


async function main() { 
    let db; // Define DB connection variable in outer scope for use in try/finally
    try {
        // Establish a connection to the MySQL database using helper function
        db = getDBConnection();

        // Retrieve a valid Zoho CRM access token (cached or refreshed as needed)
        const accessToken = await getCachedAccessToken(db);
        console.log('Access token obtained.' + accessToken);

        // Fetch all Contacts records from Zoho CRM using the access token
        await fetchSHIFTSOnsiteTech(accessToken, db);

        console.log('Data save completed successfully.');
    } catch (error) {
        // Catch and log any errors that occur during the entire sync process
        console.error('Error in main process:', error.message);
    } finally {
        // Ensure database connection is properly closed at the end of the process
        if (db) await db.end();
    }
}

main();
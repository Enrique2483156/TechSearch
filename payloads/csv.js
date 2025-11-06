/** for import to shifts
*/

import axios from 'axios';
import dotenv from 'dotenv';
import mysql from 'mysql2/promise';
import pLimit from 'p-limit'; // install with: npm install p-limit
import { createObjectCsvWriter } from 'csv-writer';
dotenv.config();

const {
    CLIENT_ID,
    CLIENT_SECRET,
    REFRESH_TOKEN,

} = process.env;

async function getAccessToken() {
    const params = new URLSearchParams({
        refresh_token: REFRESH_TOKEN,
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        grant_type: 'refresh_token'
    });

    try {
        const response = await axios.post(`https://accounts.zoho.com/oauth/v2/token?${params.toString()}`);
        return response.data.access_token;
    } catch (error) {
        console.error('Failed to refresh access token:', error.response?.data || error.message);
        throw error;
    }
}
const csvWriter = createObjectCsvWriter({
    path: 'output.csv',
    header: [
        { id: 'first_name', title: 'First Name' },
        { id: 'last_name', title: 'Last Name' },
        { id: 'work_email', title: 'Work Email' },
        { id: 'mobile', title: 'Mobile' },
        { id: 'mobile_country_code', title: 'Mobile Country Code' },
        { id: 'timezone', title: 'Timezone' },
        { id: 'external_employee_id', title: 'Employee ID' },
        { id: 'city', title: 'City' },
        { id: 'state', title: 'State' },
        { id: 'street', title: 'Street Address 1' },
        { id: 'country', title: 'Country' }
       
    ],
});

// Map user data to your payload object
async function createShiftsUserCsv(user) {
    const payload = {
        first_name: user.first_name || '',
        last_name: user.last_name || '',
        work_email: user.email || '',
        mobile: user.mobile || user.phone || null,
        mobile_country_code: 'us',
        timezone: user.time_zone || 'America/New_York',
        external_employee_id: user.employee_id || null,
        city: user.city || null,
        state: user.state || null,
        street: user.street || null,
        country: user.country || null
        // Add other fields if needed
    };
    return payload;
}

// Process all users and write to CSV
async function createShiftsImportCsv(users) {
    const datacsv = await Promise.all(users.map(user => createShiftsUserCsv(user)));

    await csvWriter.writeRecords(datacsv);
    console.log('CSV file created successfully!');
    return datacsv;
}


async function fetchFSMOnsiteTech(accessToken) {
    const pageSize = 200; //200
    let page = 1;
    let allUsers = [];

    while (true) {
        // make API call with pagination params
        const url = `https://fsm.zoho.com/fsm/v1/users?skillinfo=true&page=${page}&per_page=${pageSize}`;
        // const url = `https://fsm.zoho.com/fsm/v1/users`;
        try {
            const response = await axios.get(url, {
                headers: { Authorization: `Zoho-oauthtoken ${accessToken}` }
            });
            const users = response.data.users || [];
            // console.log(users);
            allUsers = allUsers.concat(users);

            // If returned less than pageSize, last page reached
            if (users.length < pageSize) {
                break;
            }
            page++;
        } catch (error) {
            console.error(`Failed to fetch FSM users on page ${page}:`, error.response?.data || error.message);
            break;
        }
    }
    const fieldAgents = allUsers.filter(user => user.profile?.api_name?.trim() === "Onsite_Tech__C"&&user.status === 'active');
    //const fieldAgents = allUsers.filter(user => user.employee_id === '1498016'); //for certain tech for testing
    console.log(fieldAgents);
    // Filter Onsite_Tech__C profile users
    // const fieldAgents = allUsers.filter(user => user.profile?.api_name?.trim() === "Onsite_Tech__C");
    return fieldAgents;
}

async function main() {
    try {
        const accessToken = await getAccessToken();
        console.log('Access token obtained.' + accessToken);

        const fsmOnsiteTech = await fetchFSMOnsiteTech(accessToken);
        console.log(`Fetched ${fsmOnsiteTech.length} onsite tech users.`);

        await createShiftsImportCsv(fsmOnsiteTech);

    } catch (error) {
        console.error('Error in main process:', error.message);
    }
}

main();
/** 
 * fetching techs, count the shortest distants
 * 
*/

import axios from 'axios';
import { buildAddressFromParsedStreet, getCachedAccessToken, getDBConnection, getLatLongFromAddress, writeEventLog, normalizeString } from '../helper.js';

const now = new Date().toUTCString();
console.log('### ' + now + ' fsmTechToDb.js loaded');

async function fetchFSMOnsiteTech(accessToken, db) {
    const pageSize = 200;
    let page = 1;
    let zohoRequestCount = 0;

    while (true) {

        const url = `https://fsm.zoho.com/fsm/v1/users?skillInfo=true&page=${page}&per_page=${pageSize}`;

        try {
            const response = await axios.get(url, {
                headers: { Authorization: `Zoho-oauthtoken ${accessToken}` }
            });
            zohoRequestCount++;
            const users = response.data.users || [];

            const fieldAgents = users.filter(user => user.profile?.api_name?.trim() === "Onsite_Tech__C" && user.status === 'active');

            if (fieldAgents.length > 0) {
                await saveFSMOnsiteTech(db, fieldAgents, page);
            }

            if (users.length < pageSize) {
                break;
            }

            page++;
        } catch (error) {
            writeEventLog(`fsmTechToDb.js Failed to fetch FSM users on page ${page}: ${error.response?.datae}\n${error.message}`);
            break;
        }
    }
    console.log(`Total Zoho API requests made: ${zohoRequestCount}`);
}

async function saveFSMOnsiteTech(db, techs, page) {

    const sqlInsert = `
    INSERT INTO fsm_tech 
      (id_tech, employee_id, street, zip, city, full_name, last_name, first_name, email, profile_id, latitude, longitude, payload, skills, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;

    const sqlUpdatePartial = `
    UPDATE fsm_tech SET
      employee_id = ?,
      last_name = ?,
      first_name = ?,
      email = ?,
      profile_id = ?,
      payload = ?,
      skills = ?,
      updated_at = ?
    WHERE id_tech = ?
  `;
    const sqlUpdateGeo = `
    UPDATE fsm_tech SET
      latitude = ?,
      longitude = ?,
      updated_at = ?
    WHERE id_tech = ?
  `;
    const sqlUpdateFull = `
    UPDATE fsm_tech SET
      employee_id = ?,
      street = ?,
      zip = ?,
      city = ?,
      full_name = ?,
      last_name = ?,
      first_name = ?,
      email = ?,
      profile_id = ?,
      latitude = ?,
      longitude = ?,
      payload = ?,
      skills = ?,
      updated_at = ?
    WHERE id_tech = ?
  `;

    let insertCount = 0;
    let changedCount = 0;

    for (const tech of techs) {

        try {
            const address = buildAddressFromParsedStreet(tech.street, tech.city, tech.state, tech.zip);
            const now = Math.floor(Date.now() / 1000);
            const [existingRows] = await db.execute('SELECT * FROM fsm_tech WHERE id_tech = ?', [tech.id]);

            if (existingRows.length === 0) {
                const { latitude, longitude } = await getLatLongFromAddress(address);
                await db.execute(sqlInsert, [
                    tech.id,
                    tech.employee_id,
                    tech.street,
                    tech.zip,
                    tech.city,
                    tech.full_name,
                    tech.last_name,
                    tech.first_name,
                    tech.email,
                    tech.profile?.id,
                    latitude,
                    longitude,
                    JSON.stringify(tech),
                    tech.Skills,
                    now
                ]);
                insertCount++;
            } else {
                const existing = existingRows[0];
                const addressChanged =
                    normalizeString(existing.street) !== normalizeString(tech.street) ||
                    normalizeString(existing.city) !== normalizeString(tech.city) ||
                    normalizeString(existing.zip) !== normalizeString(tech.zip);

                if (addressChanged) {
                    console.log("address Changed" + tech.street);
                    const { latitude, longitude, error } = await getLatLongFromAddress(address);
                    if (error) {
                        writeEventLog(`Geocoding error for tech ${tech.id}: ${error}`);
                    }
                    await db.execute(sqlUpdateFull, [
                        tech.employee_id,
                        tech.street,
                        tech.zip,
                        tech.city,
                        tech.full_name,
                        tech.last_name,
                        tech.first_name,
                        tech.email,
                        tech.profile?.id,
                        latitude,
                        longitude,
                        JSON.stringify(tech),
                        tech.Skills,
                        now,
                        tech.id
                    ]);

                } else if (address) {
                    let latitude = existing.latitude;
                    let longitude = existing.longitude;

                    if (latitude == null || longitude == null) {
                        const result = await getLatLongFromAddress(address);
                        latitude = result.latitude;
                        longitude = result.longitude;
                        if (result.error) {
                            writeEventLog(`Geocoding error for tech ${tech.id}: ${result.error}`);
                        }
                        await db.execute(sqlUpdateGeo, [
                            latitude,
                            longitude,
                            now,
                            tech.id
                        ]);

                    } else {
                        await db.execute(sqlUpdatePartial, [
                            tech.employee_id,
                            tech.last_name,
                            tech.first_name,
                            tech.email,
                            tech.profile?.id,
                            JSON.stringify(tech),
                            tech.Skills,
                            now,
                            tech.id
                        ]);
                    }
                }
                changedCount++;
            }
        } catch (err) {
            writeEventLog(`fsmTechToDb.js Error saving FSM records: ${err.message}`);
            break;
        }
    }
    writeEventLog(`Page : ${page} Total updates: ${changedCount} Total inserts: ${insertCount}`);
    console.log(`Page : ${page} Total updates: ${changedCount}  Total inserts: ${insertCount}`);
}



async function testFSMOnsiteTech(db) {


    const tech = "23940000000369111";
    console.log(tech);
    const [existingRows] = await db.execute('SELECT * FROM fsm_tech WHERE id_tech = ?', [tech]);
    const existing = existingRows[0];
    const state = '';
    const existingAddress = buildAddressFromParsedStreet(existing.street, existing.city, state, existing.zip);
    console.log("existingAddress" + existingAddress.street);
    const street = existingAddress.street;
    console.log("existingAddress stret" + street);
    console.log(normalizeString(existing.street));


}


async function main() {
    let db;
    try {
        db = getDBConnection();

        const accessToken = await getCachedAccessToken(db);

        await fetchFSMOnsiteTech(accessToken, db);
        // await testFSMOnsiteTech(db);
        // testFSMOnsiteTech

        const now = new Date().toUTCString();
        console.log('### ' + now + ' fsmTechToDb.js Data save completed successfully.');
    } catch (error) {
        const now = new Date().toUTCString();
        writeEventLog(`!!! ${now} fsmTechToDb.js Error in main process: ${error.message}`);
        console.error(`!!! ${now}Error in main process:',${error.message}`);
    } finally {
        if (db) await db.end();
    }
}
main();


/** 
 * fetching timzone from SHIFTS
 * 
*/
import axios from 'axios';
import dotenv from 'dotenv';
import { getCachedAccessToken, getDBConnection, writeEventLog } from '../helper.js';

dotenv.config();

const { ZOHO_ORG_ID_SHIFTS } = process.env;

const now = new Date().toUTCString();
console.log('### ' + now + ' getTimezoneShifts.js loaded');

async function updateTechniciansTimezone() {
  let db;
  try {
    db = getDBConnection();
    const accessToken = await getCachedAccessToken(db);
    if (!accessToken) throw new Error('No Zoho access token available');

    const [techs] = await db.execute('SELECT id, shifts_id FROM fsm_tech WHERE shifts_id IS NOT NULL AND shifts_id <> ""');
    if (techs.length === 0) {
      console.log('No technicians with shifts_id found');
      return;
    }

    let zohoRequestCount = 0;

    for (const tech of techs) {
      try {

        const url = `https://shifts.zoho.com/api/v1/${ZOHO_ORG_ID_SHIFTS}/employees/${tech.shifts_id}`;
        const response = await axios.get(url, {
          headers: { Authorization: `Zoho-oauthtoken ${accessToken}` }
        });

        zohoRequestCount++;
        const employee = response.data;

        if (!employee) {
          // console.warn(`No employee data for shifts_id ${tech.shifts_id}`);
          continue;
        }

        const timezone = employee.timezone;
        if (!timezone) {
          // console.warn(`No timezone data for shifts_id ${tech.shifts_id}`);
          continue;
        }

        const [result] = await db.execute(
          'UPDATE fsm_tech SET time_zone = ? WHERE shifts_id = ?',
          [timezone, tech.shifts_id]
        );

        if (result.affectedRows === 0) {
          // console.log(`No DB record updated for shifts_id ${tech.shifts_id}`);
        } else {
          // console.log(`Updated timezone for shifts_id ${tech.shifts_id} to ${timezone}`);
        }
      } catch (innerErr) {
        writeEventLog(`Error updating timezone for shifts_id ${tech.shifts_id}: ${innerErr.message}`);
      }
    }

    console.log(`Total Zoho API requests made: ${zohoRequestCount}`);

    const now = new Date().toUTCString();
    console.log('### ' + now + ' getTimezoneShifts.js Technicians timezone update completed');

  } catch (error) {

    const now = new Date().toUTCString();
    writeEventLog(`!!! ${now} getTimezoneShifts.js Failed to update technicians timezone: ${error.message}`);
    console.error(`!!! ${now} getTimezoneShifts.js Failed to update technicians timezone:, ${error.message}`);

  } finally {
    if (db) await db.end();
  }
}

updateTechniciansTimezone();
/** 
 * fetching Contacts, from CRM, getting long and lat using https://maps.googleapis.com/maps/api/geocode/json
 * to do add update for lat and long if they are empty
*/
import { buildContactAddress, getCachedAccessToken, getDBConnection, getLatLongFromAddress, writeEventLog, normalizeString} from '../helper.js';

const now = new Date().toUTCString();
console.log('### ' + now + ' crmContactToDb.js loaded');

async function fetchContactsCRM(accessToken) {
    let allContacts = [];
    let pageToken = null;
    let zohoRequestCount = 0;

    do {
        
        let url = 'https://www.zohoapis.com/crm/v8/Contacts?per_page=200&fields=id,Last_Name,First_Name,Mailing_Street,Mailing_Zip,Mailing_City,Email';
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
            console.log(`Failed to fetch contacts: ${JSON.stringify(errorBody)}`)
            writeEventLog(`Failed to fetch contacts: ${JSON.stringify(errorBody)}`);
            throw new Error(`Failed to fetch contacts: ${JSON.stringify(errorBody)}`);
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

async function saveContactsCRM(db, contacts) {
    const sqlUpdatePartial = `
    UPDATE crm_contacts SET
      last_name = ?,
      first_name = ?,
      email = ?,
      updated_at = ?
    WHERE id_contact = ?
  `;
    const sqlUpdateFull = `
    UPDATE crm_contacts SET
      street = ?,
      zip = ?,
      city = ?,
      last_name = ?,
      first_name = ?,
      email = ?,
      latitude = ?,
      longitude = ?,
      updated_at = ?
    WHERE id_contact = ?
  `;
    const sqlInsert = `
    INSERT INTO crm_contacts (id_contact, street, zip, city, last_name, first_name, email, latitude, longitude, payload, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;

    let insertCount = 0;
    let changedCount = 0;

    for (const contact of contacts) {
        // console.log(contact);
        try {

            const address = buildContactAddress(contact, {
                street: 'Mailing_Street',
                city: 'Mailing_City',
                state: 'Mailing_State',
                zip: 'Mailing_Zip'
            });
            const now = Math.floor(Date.now() / 1000);

            const [existingRows] = await db.execute('SELECT * FROM crm_contacts WHERE id_contact = ?', [contact.id]);

            if (existingRows.length === 0) {

                const { latitude, longitude, error } = await getLatLongFromAddress(address);
                if (error) {
                    console.error('Geocoding error:', error);
                }

                await db.execute(sqlInsert, [
                    contact.id,
                    contact.Mailing_Street,
                    contact.Mailing_Zip,
                    contact.Mailing_City,
                    contact.Last_Name,
                    contact.First_Name,
                    contact.Email,
                    latitude,
                    longitude,
                    JSON.stringify(contact),
                    now
                ]);
                insertCount++;
            } else {
                const existing = existingRows[0];

                const addressChanged =
                    normalizeString(existing.street) !== normalizeString(contact.Mailing_Street) ||
                    normalizeString(existing.city) !== normalizeString(contact.Mailing_City) ||
                    normalizeString(existing.zip) !== normalizeString(contact.Mailing_Zip);


                if (addressChanged) {

                    const { latitude, longitude, error } = await getLatLongFromAddress(address);
                    if (error) {
                        console.error('Geocoding error:', error);
                    }
                    await db.execute(sqlUpdateFull, [
                        contact.Mailing_Street,
                        contact.Mailing_Zip,
                        contact.Mailing_City,
                        contact.Last_Name,
                        contact.First_Name,
                        contact.Email,
                        latitude,
                        longitude,
                        now,
                        contact.id,
                    ]);
                } else {
                    await db.execute(sqlUpdatePartial, [
                        contact.Last_Name,
                        contact.First_Name,
                        contact.Email,
                        now,
                        contact.id,
                    ]);
                }
                changedCount++;
            }
        } catch (err) {
            
            writeEventLog(`saveContactsCRM.js Error saving Contact records: ${contact} ${err.message}`);
            console.error('Error saving saveContactsCRM:', err.message);
            break;
        }
    }
    writeEventLog(`Total updates: ${changedCount} Total inserts: ${insertCount}`);
    console.log(`Total updates: ${changedCount}  Total inserts: ${insertCount}`);
}

async function main() {
    let db;
    try {
        db = getDBConnection();
        const accessToken = await getCachedAccessToken(db);
        const crmContacts = await fetchContactsCRM(accessToken);
        await saveContactsCRM(db, crmContacts);

        const now = new Date().toUTCString();
        console.log('### ' + now + ' saveContactsCRM.js Data save completed successfully.');
    } catch (error) {
        const now = new Date().toUTCString();
        writeEventLog(`!!! ${now} saveContactsCRM.js Error in main process: ${error.message}`);
        console.error(`!!! ${now} Error in main process:, ${error.message}`);
    } finally {
        if (db) await db.end();
    }
}
main();
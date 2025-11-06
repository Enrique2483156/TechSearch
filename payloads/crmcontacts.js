/** OLD version 
 * add to cron and check it out on issues
* fetching contacts and update missing long lat from zoho crm to db
*/
import axios from 'axios';
import dotenv from 'dotenv';
import pLimit from 'p-limit';
import { buildContactAddress } from '../helper.js';
import { getCachedAccessToken } from '../helper.js';
import { getDBConnection, getLatLongFromAddress, normalizeString } from '../helper.js';
// import pLimit from 'p-limit'; // install with: npm install p-limit
dotenv.config();
/*
To do:
search by zipcode, email, name (clients) and the nearest techs (mesurment change km to miles count in minute and check by route)
store into the db zoho crm contacts, synch prefered techs to contact into zoho crm contacts
create cron task for fetching zoho fsm tech and zoho crm contacts (if new add or update if exist)
schedule synch for zoho fsm tech
*/


// async function getLatLongFromAddress(address) {
//     if (!address) return { latitude: null, longitude: null };
//     const url = 'https://maps.googleapis.com/maps/api/geocode/json';
//     try {
//         const response = await axios.get(url, {
//             params: {
//                 address: address,
//                 key: GOOGLE_API_KEY
//             }
//         });

//         if (response.data.status === 'OK' && response.data.results.length > 0) {
//             const location = response.data.results[0].geometry.location;
//             return { latitude: location.lat, longitude: location.lng };
//         } else {
//             console.warn('Geocoding API returned no results for address:', address);
//             return { latitude: null, longitude: null };
//         }
//     } catch (error) {
//         console.error('Geocoding API error:', error.message);
//         return { latitude: null, longitude: null };
//     }
// }

async function fetchContactsCRM(accessToken) {
    let allContacts = [];
    let pageToken = null;

    do {
        // Build URL with or without page_token
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

        if (!response.ok) {
            const errorBody = await response.json();
            throw new Error(`Failed to fetch contacts: ${JSON.stringify(errorBody)}`);
        }
        const data = await response.json();

        if (data.data && data.data.length) {
            allContacts = allContacts.concat(data.data);
        }
        // Check for next page token
        pageToken = data.info?.next_page_token || null;
        // console.log(pageToken);

    } while (pageToken);

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
            }
        } catch (err) {
            console.log(contact);
            console.error('Error saving saveContactsCRM:', err.message);
            break;
        }
    }
    // console.log(newUsers);
}


// Your existing getRelatedRecords function
// async function getRelatedRecords(accessToken, contactId, relatedListApiName) {
//     const url = `https://www.zohoapis.com/crm/v8/Contacts/${contactId}/${relatedListApiName}?fields=Service_Addresses`;
//     const response = await fetch(url, {
//         headers: { 'Authorization': `Zoho-oauthtoken ${accessToken}` }
//     });

//     if (!response.ok) {
//         const errorBody = await response.text();
//         throw new Error(`HTTP error ${response.status}: ${errorBody}`);
//     }

//     const text = await response.text();

//     if (!text) {
//         // Empty response body, return empty array
//         return [];
//     }

//     try {
//         const data = JSON.parse(text);
//         return data.data || [];
//     } catch (err) {
//         // JSON parse error: log and throw more descriptive error
//         throw new Error(`Failed to parse JSON for contact ${contactId}: ${err.message} - Raw response: ${text}`);
//     }
// }

// async function getRelatedRecordsForManyContacts(accessToken, contactIds, relatedListApiName, concurrency = 5) {
//     const limit = pLimit(concurrency);
//     const promises = contactIds.map(id =>
//         limit(async () => {
//             try {

//                 const relatedData = await getRelatedRecords(accessToken, id, relatedListApiName);
//                 // console.log(id);
//                 if (!relatedData || relatedData.length === 0) {
//                     return { id_contact: id, service_address: [] };
//                 }
//                 return { id_contact: id, service_address: relatedData };
//             } catch (e) {
//                 console.error(`Error fetching related records for contact ${id}:`, e.message);
//                 return null;
//             }
//         })
//     );

//     const results = await Promise.all(promises);
//     return results.filter(r => r !== null);
// }

// // Function to get contact IDs from MySQL
// async function getContactIdsFromDB(db) {
//     // const connection = await mysql.createConnection(dbConfig);

//     try {
//         const [rows] = await db.execute('SELECT id_contact FROM crm_contacts');
//         // console.log(rows);
//         return rows.map(r => r.id_contact);

//     } finally {
//         await db.end();
//     }
// }

// async function saveServiceAddressesCRM(db, relatedRecordsArrays) {
//     const sql = `UPDATE crm_contacts SET service_address = ? WHERE id_contact = ?`;
//     for (const contact of relatedRecordsArrays) {
//         try {
//             const serviceAddresses = contact.service_address;
//             if (!serviceAddresses || serviceAddresses.length === 0) {
//                 console.warn(`No service addresses for contact id ${contact.id_contact}; skipping update.`);
//                 continue;
//             }
//             const serviceAddressId = serviceAddresses[0].id;  // Assuming 'id' is the lookup key

//             const [result] = await db.execute(sql, [serviceAddressId, contact.id_contact]);

//             if (result.affectedRows === 0) {
//                 console.warn(`No record updated for contact id ${contact.id_contact} - may not exist.`);
//             } else {
//                 console.log(`Updated service_address lookup for contact id ${contact.id_contact}`);
//             }
//         } catch (err) {
//             console.error(`Error updating service_address for contact id ${contact.id_contact}:`, err.message);
//         }
//     }
// }

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function updateMissingLatLong(db) {
    const selectSql = `
        SELECT id_contact, street, zip, city FROM crm_contacts
        WHERE latitude IS NULL OR longitude IS NULL
    `;

    const updateSql = `
        UPDATE crm_contacts SET latitude = ?, longitude = ?, updated_at = ?
        WHERE id_contact = ?
    `;

    const [rows] = await db.execute(selectSql);

    const batchSize = 50;
    const delayBetweenBatchesMs = 20 * 1000; // 1 minute

    for (let i = 0; i < rows.length; i += batchSize) {
        const batch = rows.slice(i, i + batchSize);

        for (const row of batch) {
            try {
                const address = buildContactAddress(row, {
                    street: 'street',
                    city: 'city',
                    zip: 'zip'
                });

                const { latitude, longitude } = await getLatLongFromAddress(address);
                if (latitude !== null && longitude !== null) {
                    const now = Math.floor(Date.now() / 1000);
                    await db.execute(updateSql, [latitude, longitude, now, row.id_contact]);
                    console.log(`Updated lat/long for contact ${row.id_contact}`);
                } else {
                    console.warn(`Could not geocode address for contact ${row.id_contact}: ${address}`);
                }
            } catch (err) {
                console.error(`Error updating lat/long for contact ${row.id_contact}:`, err.message);
            }
        }

        if (i + batchSize < rows.length) {
            console.log(`Waiting 1 minute before next batch...`);
            await delay(delayBetweenBatchesMs);
        }
    }
}

async function main() {
    const relatedListApiName = 'Service_Addresses'; // The API name of the related list/module to fetch for each contact
    let db; // Define DB connection variable in outer scope for use in try/finally

    try {
        // Establish a connection to the MySQL database using helper function
        db = getDBConnection();

        // Retrieve a valid Zoho CRM access token (cached or refreshed as needed)
        const accessToken = await getCachedAccessToken(db);
        console.log('Access token obtained.' + accessToken);

        // Fetch all Contacts records from Zoho CRM using the access token
        const crmContacts = await fetchContactsCRM(accessToken);

        // // Save the fetched contacts into the local database (insert new or update existing)
        await saveContactsCRM(db, crmContacts);

        // // Update latitude and longitude for contacts missing these values by geocoding their addresses
        // await updateMissingLatLong(db);

        // // Retrieve the contact IDs stored in the local database to use for fetching related records
        // const contactIds = await getContactIdsFromDB(db);
        // console.log(`Fetched ${contactIds.length} contact IDs from DB`);

        // // Fetch related records (e.g., Service Addresses) for the specified contacts from Zoho CRM
        // // `concurrency` parameter limits parallel fetch requests for rate limiting and performance
        // const relatedRecordsArrays = await getRelatedRecordsForManyContacts(accessToken, contactIds, relatedListApiName, 5);

        // // Save the fetched related records (e.g. service_address lookup IDs) back into the local database
        // await saveServiceAddressesCRM(db, relatedRecordsArrays);

        // // Log how many contacts had related records processed
        // console.log('Fetched related records for contacts:', relatedRecordsArrays.length);

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


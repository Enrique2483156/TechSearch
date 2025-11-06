/** 
 * fetching new Access Token 
*/
import { getCachedAccessToken } from '../helper.js';
import { getDBConnection } from '../helper.js';

const now = new Date().toUTCString();
console.log('### ' + now + ' runner.js loaded');

async function run() {
    let db;
    try {
        db = getDBConnection();
        await getCachedAccessToken(db);
        const now = new Date().toUTCString();
        console.log('### ' + now + ' accessToken obtained');

    } catch (error) {
        const now = new Date().toUTCString();
        writeEventLog(`!!! ${now} runner.js Error running token refresh: ${error.message}`);
        console.error(`!!! ${now} runner.js Error running token refresh', ${error.message}`);
 
    } finally {
        if (db) await db.end();
    }
}
run();
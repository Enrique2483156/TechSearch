/** 
 * fetching skills from FSM
 * 
*/
import axios from 'axios';
import { getCachedAccessToken, getDBConnection, writeEventLog } from '../helper.js';

const now = new Date().toUTCString();
console.log('### ' + now + ' getSkillsFsmToDb.js loaded');

async function getSkillsFSM(accessToken, db) {
  const pageSize = 50;
  let page = 1;
  let zohoRequestCount = 0;
 
  while (true) {

    const url = `https://fsm.zoho.com/fsm/v1/Skills?&page=${page}&per_page=${pageSize}`;

    try {
      const response = await axios.get(url, {
        headers: { Authorization: `Zoho-oauthtoken ${accessToken}` }
      });
      zohoRequestCount++;
      const skills = response.data.data || []; 

      // const validSkills = users.filter(data => data.Email && data.Email.trim() !== '');
      const moreRecords = response.data.info?.more_records;

      if (skills.length > 0) {
        await saveSkillsFSM(db, skills, page);
      }

      if (!moreRecords) {
        break;
      }

      if (skills.length < pageSize) {
        break;
      }
      page++;
    } catch (error) {
      writeEventLog(`getSkillsFsmToDb.js Failed to fetch FSM Skills on page ${page}: ${error.response?.datae}\n${error.message}`);
      break;
    }
  }

  console.log(`Total Zoho API requests made: ${zohoRequestCount}`);
}

async function saveSkillsFSM(db, skills, page) {
  const sql = `
    INSERT INTO skills_fsm (skill_id, skill_name, description, updated_at)
    VALUES (?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
            skill_name = VALUES(skill_name),
            description = VALUES(description),
            updated_at = VALUES(updated_at) 
  `;

  let changedCount = 0;

  for (const skill of skills) { 
     
    try {
      
      const now = Math.floor(Date.now() / 1000);
      await db.execute(sql, [skill.id, skill.Name, skill.Description, now]);
       
      changedCount++;

    } catch (err) {

      writeEventLog(`getSkillsFsmToDb.js Error saving FSM Contact records: ${contact} ${err.message}`);
      console.error('Error saving FSM skills:', err.message);
      break;
    }
  }
  writeEventLog(`Page: ${page} Total updates: ${changedCount}`);
  console.log(`Page: ${page} Total updates: ${changedCount}`);
}

async function main() {
  let db;
  try {
    db = getDBConnection();
    const accessToken = await getCachedAccessToken(db);
    await getSkillsFSM(accessToken, db);

    const now = new Date().toUTCString();
    console.log('### ' + now + ' getSkillsFsmToDb.js Data save completed successfully.');
  } catch (error) {
    const now = new Date().toUTCString();
    writeEventLog(`!!! ${now} getSkillsFsmToDb.js Error in main process: ${error.message}`);
    console.error(`!!! ${now} Error in main process:, ${error.message}`);
  } finally {
    if (db) await db.end();
  }
}

main();
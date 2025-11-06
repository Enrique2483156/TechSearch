/**
 * cron/generateAccessKey.js
 *
 * Скрипт для периодической генерации временных ключей (accessKey)
 * для всех пользователей в базе и обновления их в Zoho CRM.
 * запуск раз в час через cron.
 */

import crypto from 'crypto';
import { getDBConnection, getCachedAccessToken } from '../helper.js';

// Генерация случайного ключа — длина 48 символов hex (24 байта)
function generateKey() {
  return crypto.randomBytes(24).toString('hex');
}

// Отправка ключа в Zoho CRM в кастомное поле пользователя
async function sendKeyToZohoCRM(userId, key, accessToken) {
  // Заменить URL и поле на актуальные для твоей CRM
  const url = `https://www.zohoapis.com/crm/v2/Users/${userId}`;
  const body = {
    data: [
      {
        Custom_Access_Key_Field: key  // надо создать api name in Zoho CRM
      }
    ]
  };

  const response = await fetch(url, {
    method: 'PUT',
    headers: {
      'Authorization': `Zoho-oauthtoken ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to update Zoho CRM: ${error}`);
  }
}

// Основная функция генерации ключей и обновления в Zoho CRM
async function generateAndSaveKeys() {
  const db = getDBConnection();

  // Получить токен Zoho API (твоя функция, чтобы брать или обновлять access token)
  const accessToken = await getCachedAccessToken(db);

  // Получить всех уникальных user_id и org_id, для которых надо обновить ключи
  const [users] = await db.execute('SELECT DISTINCT user_id, org_id FROM access_keys');

  for (const { user_id, org_id } of users) {
    const newKey = generateKey();
    const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000); // +2 часа

    // Вставляем или обновляем ключ в таблице access_keys
    await db.execute(
      `INSERT INTO access_keys (user_id, org_id, key, expires_at)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE key = VALUES(key), expires_at = VALUES(expires_at)`,
      [user_id, org_id, newKey, expiresAt]
    );

    // Обновляем ключ в Zoho CRM
    try {
      await sendKeyToZohoCRM(user_id, newKey, accessToken);
      console.log(`Updated access key for user ${user_id}`);
    } catch (err) {
      console.error(`Failed to update Zoho CRM for user ${user_id}:`, err.message);
    }
  }
}

// Запуск скрипта
generateAndSaveKeys()
  .then(() => {
    console.log('Access keys generation completed');
    process.exit(0);
  })
  .catch((err) => {
    console.error('Error generating keys:', err);
    process.exit(1);
  });
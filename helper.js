// console.log('helper.js loaded');
import axios from 'axios';
import dotenv from 'dotenv';
import mysql from 'mysql2/promise';
import dayjs from 'dayjs';  // npm install dayjs
import fs from 'fs';
import path from 'path';

dotenv.config();

const {
  CLIENT_ID,
  CLIENT_SECRET,
  REFRESH_TOKEN,
  MYSQL_HOST,
  MYSQL_USER,
  MYSQL_PASSWORD,
  MYSQL_DATABASE,
  GOOGLE_API_KEY
} = process.env;

const pool = mysql.createPool({
  host: MYSQL_HOST,
  user: MYSQL_USER,
  password: MYSQL_PASSWORD,
  database: MYSQL_DATABASE,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

export function getDBConnection() {
  
  return pool;
}

export async function apiFetch(url, options = {}) {
  if (!options.headers) options.headers = {};

  options.headers['X-User-Id'] = window.appUserId;
  options.headers['X-Org-Id'] = window.appOrgId;
  options.headers['X-Access-Key'] = window.appAccessKey;

  return fetch(url, options);
}


export function normalizeString(str) {
  // console.log(str);
  if (str === null || str === undefined) return '';
  return String(str).trim().toLowerCase();
}

export function writeEventLog(message) {
  const logDir = path.resolve(process.cwd(), 'logs');
  const logFile = path.join(logDir, 'app.log');

  // Ensure logs directory exists
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }

  const timeStamp = new Date().toISOString();
  // const logLine = `[${timeStamp}] ${message}\n`;
  let logMessage;
  if (typeof message === 'object' && message !== null) {
    try {
      logMessage = JSON.stringify(message, null, 2); // pretty print JSON
    } catch (e) {
      // fallback if serialization fails
      logMessage = String(message);
    }
  } else {
    logMessage = String(message);
  }
  const logLine = `[${timeStamp}] ${logMessage}\n`;
  fs.appendFile(logFile, logLine, (err) => {
    if (err) {
      console.error('Failed to write log:', err);
    }
  });
}

export function buildFullAddress({ street, city, state, zip }) {
  const parts = [];

  if (street) parts.push(street);
  if (city) parts.push(city);
  if (state) parts.push(state);
  if (zip) parts.push(zip);

  return parts.join(', ');
}
export function buildContactAddress(contact, fieldMap = {}) {
  /*
  fieldMap example:
  {
      street: 'Mailing_Street',
      city: 'Mailing_City',
      state: 'Mailing_State',
      zip: 'Mailing_Zip'
  }
  */
  const street = contact[fieldMap.street] || '';
  const city = contact[fieldMap.city] || '';
  const state = contact[fieldMap.state] || '';
  const zip = contact[fieldMap.zip] || '';

  return buildFullAddress({ street, city, state, zip });
}

export function buildAddressFromParsedStreet(street, city, state, zip) {
  // Parse the street string: first part before comma
  let streetLine1 = '';
  
  if (street) {
    const parts = street.split(',').map(p => p.trim()).filter(Boolean);
    streetLine1 = parts.length > 0 ? parts[0] : street;
  }
  // console.log("buildAddressFromParsedStreet"+streetLine1);

  // Use buildFullAddress to combine all parts
  return buildFullAddress({
    street: streetLine1,
    city: city || '',
    state: state || '',
    zip: zip || ''
  });
}

export async function getLatLongFromAddress(address) {
  if (!address) return { latitude: null, longitude: null };
  const url = 'https://maps.googleapis.com/maps/api/geocode/json';
  try {
    const response = await axios.get(url, {
      params: {
        address: address,
        key: GOOGLE_API_KEY
      }
    });

    if (response.data.status === 'OK' && response.data.results.length > 0) {
      const location = response.data.results[0].geometry.location;
      return { latitude: location.lat, longitude: location.lng, error: null };
    } else {

      // console.warn('Geocoding API returned no results for address:', address);
      return { latitude: null, longitude: null, error: response.data.error_message || response.data.status };

    }
  } catch (error) {
    // console.error('Geocoding API error:', error.message);
    return { latitude: null, longitude: null, error: error.message };
  }
}


export async function getLatLngByZip(zip) {
  if (!zip) return { latitude: null, longitude: null, error: 'Zip code is empty' };
  const apiKey = GOOGLE_API_KEY;
  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(zip)}&key=${apiKey}`;

  try {
    const response = await axios.get(url);
    const data = response.data;

    if (data.status !== 'OK') {
      console.log(`Google API error: ${data.status}`);
      return { latitude: null, longitude: null, error: `Google API error: ${data.status}` };
    }

    if (!data.results || data.results.length === 0) {
       console.log(`No results found for the given zip code`);
      return { latitude: null, longitude: null, error: 'No results found for the given zip code' };
    }

    const { lat, lng } = data.results[0].geometry.location;
    return { latitude: lat, longitude: lng, error: null };
  } catch (error) {
    console.log(`${ error.message} Unknown error`);
    return { latitude: null, longitude: null, error: error.message || 'Unknown error' };
  }
}


// Returns a fresh or cached access token
export async function getCachedAccessToken(db) {
  // check DB for existing token
  const [rows] = await db.execute(`SELECT access_token, expires_at FROM zoho_tokens ORDER BY updated_at DESC LIMIT 1`);
  const now = Math.floor(Date.now() / 1000);

  if (
    rows.length > 0 && // token row exists
    rows[0].access_token && // token value exists
    typeof rows[0].expires_at === 'number' && // expiry valid
    rows[0].expires_at > now + 60 // token still valid for 60+ seconds
  ) {
    // valid token found, return it
    return rows[0].access_token;
  }

  // token missing or expired -> refresh a new token
  const newTokenData = await getAccessToken();
  // console.log(newTokenData);

  // save new token with calculated expiry (Zoho tokens usually expire in 3600 seconds)
  const expiresAt = now + (newTokenData.expires_in || 3600);
  await db.execute(`INSERT INTO zoho_tokens (access_token, expires_at) VALUES (?, ?)`, [newTokenData.access_token || null, expiresAt ?? null]);
  return newTokenData.access_token;
}

export async function getAccessToken() {
  const params = new URLSearchParams({
    refresh_token: REFRESH_TOKEN,
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    grant_type: 'refresh_token'
  });

  try {
    const response = await axios.post(`https://accounts.zoho.com/oauth/v2/token?${params.toString()}`);
    // console.log(response.data);
    return response.data; // return full data object with access_token & expires_in
  } catch (error) {
    // console.error('Failed to refresh access token:', error.response?.data || error.message);
    writeEventLog(`Failed to refresh access token: ${error.response?.data} || ${error.message}`);
    throw error;
  }
}

// ----###--- Get current Zoho user --- it might be used for security
export async function getCurrentZohoUser(accessToken) {
  // console.log(accessToken);
  const { data } = await axios.get(
    "https://www.zohoapis.com/crm/v2/users?type=CurrentUser",
    {
      headers: { Authorization: `Zoho-oauthtoken ${accessToken}` },
    }
  );

  if (!data.users || data.users.length === 0) {
    throw new Error("No current Zoho user found");
  }

  return data.users[0]; // contains {id, email, full_name, ...}
}

export function deg2rad(deg) {
  return deg * (Math.PI / 180);
}

export function rad2deg(rad) {
  return rad * (180 / Math.PI);
}

export function getBoundingBox(lat, lng, radiusKm) {
  const earthKm = 6371;
  const maxLat = lat + rad2deg(radiusKm / earthKm);
  const minLat = lat - rad2deg(radiusKm / earthKm);
  const maxLng = lng + rad2deg(radiusKm / earthKm / Math.cos(deg2rad(lat)));
  const minLng = lng - rad2deg(radiusKm / earthKm / Math.cos(deg2rad(lat)));
  return { minLat, maxLat, minLng, maxLng };
}

export function haversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371; // km
  const dLat = deg2rad(lat2 - lat1);
  const dLon = deg2rad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) *
    Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const m = R * c;
  // console.log('haversineDistance');
  // console.log('m');
  // console.log(m);
  return R * c;
}

/**
 * Get driving distances and durations using Google Routes API
 * @param {number} origLat 
 * @param {number} origLng 
 * @param {Array} dests - array of objects with latitude & longitude props
 */
export async function getDrivingDistanceAndDuration(origLat, origLng, dests) {
  if (dests.length === 0) return [];

  const requestBody = {
    origins: dests.length > 0 ? [
      {
        waypoint: {
          location: {
            latLng: {
              latitude: origLat,
              longitude: origLng,
            }
          }
        }
      }
    ] : [],

    destinations: dests.map(d => ({
      waypoint: {
        location: {
          latLng: {
            latitude: d.latitude,
            longitude: d.longitude,
          }
        }
      }
    })),

    travelMode: "DRIVE",
    routingPreference: "TRAFFIC_AWARE",
  };

  const url = `https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix?key=${GOOGLE_API_KEY}`;
  const headers = {
    'Content-Type': 'application/json',
    'X-Goog-FieldMask': 'originIndex,destinationIndex,distanceMeters,duration,condition,status'
  };

  try {
    const response = await axios.post(url, requestBody, { headers });
    const data = response.data;

    if (!Array.isArray(data)) {
      throw new Error('Unexpected response format: expected array');
    }

    return data.map(elem => {
      if (
        elem.status === 'OK' ||
        (elem.status && elem.status.code === 200) ||
        !elem.status ||
        (typeof elem.status === 'object' && Object.keys(elem.status).length === 0)
      ) {
        const durationSeconds = parseInt(elem.duration.replace('s', ''), 10);
        // console.log('distanceMeters' + elem.distanceMeters);
        // console.log('distanceMiles' + elem.distanceMeters/1609.34);
        return {
          distance_miles: elem.distanceMeters / 1609.34,
          duration_minutes: durationSeconds / 60,
        };
      }
      return null;
    });

  } catch (error) {
    console.error('Error from Routes API:', error.message);
    throw error;
  }
}

export async function fetchShiftsAvailability(accessToken, orgId, shiftsIds) {
  const startDate = dayjs().format('YYYY-MM-DD');               // today
  const endDate = dayjs().add(14, 'day').format('YYYY-MM-DD');  // two weeks from now

  // const url = `https://shifts.zoho.com/api/v1/${orgId}/availability?start_date=${startDate}&end_date=${endDate}`; //weird, it should work but not, check it out
  const url = `https://shifts.zoho.com/api/v1/${orgId}/availability`;
  // console.log(shiftsIds);
  // console.log(accessToken);
  writeEventLog(`shiftsIds ${shiftsIds}`);
  writeEventLog(`accessToken ${accessToken}`);
  try {
    const response = await axios.get(url, {
      headers: { Authorization: `Zoho-oauthtoken ${accessToken}` },
      params: {
        start_date: startDate,
        end_date: endDate,
        employees: shiftsIds.join(',')
      }  // batch multiple user IDs if API supports
    });

    // console.log(response.data.availability);
    // Response format assumed to be:
    // { availability: { user_id: [...availabilityEntries] } }
    const availability = response.data.availability;
    console.log(availability);
    // Normalize availability: if object (no date params), convert to flat array
    if (Array.isArray(availability)) {
      writeEventLog(`shifts availability array:  ${availability}`);
      return availability;  // already array from API with date params
    } else if (availability && typeof availability === 'object') {
      // availability is object keyed by employee_id: flatten to array
      writeEventLog(`shifts availability object:  ${Object.values(availability).flat()}`);
      return Object.values(availability).flat();
    } else {
      // fallback empty array
      writeEventLog('shifts availability empty');
      return [];
    }
  } catch (err) {
    writeEventLog(`Error fetching Shifts availability: ${JSON.stringify(err.response?.data)} || ${err.message}`);
    // console.error('Error fetching Shifts availability:', err.response?.data || err.message);
    return [];
  }
}


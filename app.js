/*
1. searching techs by the shortest distance using lat and long the adress the typed in the input and adresses techs in db
2. creation a record in zphp crm by clicking a button create an order

*/

import express from 'express';
import path from 'path';
import helmet from 'helmet';
import fs from 'fs';
import moment from 'moment-timezone';
import tzlookup from 'tz-lookup';

import { getCachedAccessToken, getBoundingBox, haversineDistance, getDrivingDistanceAndDuration, getLatLngByZip, fetchShiftsAvailability, getDBConnection, writeEventLog } from './helper.js';

// import { verifyToken } from './helper.js'; // adjust path if needed

const app = express();

app.disable('x-powered-by');


app.use(helmet({
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
}));
// for get parameters in url 
// app.use('/api', (req, res, next) => {
//   const apiKey = req.headers['x-api-key'];
//   const userId = req.headers['x-user-id'];
//   const role = req.headers['x-user-role'];
//   const orgId = req.headers['x-org-id'];
//   if (apiKey !== process.env.API_KEY) return res.status(403).send('Forbidden');
//   if (!userId || !role || !orgId) return res.status(403).send('Missing user data');

//   next();
// });

// app.use('/api', (req, res, next) => {
//   console.log('HEADERS:', req.headers); // leave it for test show real headers
//   next();
// });
// app.use('/api', (req, res, next) => {
//   const referer = req.headers.referer || '';
//   
//   const origin = req.headers.origin || '';
//   if (!referer.includes('zoho.com') && !origin.includes('zoho.com')) {
//     return res.status(403).send('Forbidden: API can only be accessed inside Zoho CRM');
//   }
//   next();
// });



app.use(helmet.contentSecurityPolicy({
  useDefaults: true,
  directives: {
    defaultSrc: ["'self'"],
    scriptSrc: ["'self'"],
    connectSrc: ["'self'", "https://*.zoho.com"],
    imgSrc: ["'self'", "data:"],
    styleSrc: ["'self'", "'unsafe-inline'"],
    objectSrc: ["'none'"],
    frameAncestors: ["'self'", "https://crm.zoho.com", "https://*.zoho.com"],
    baseUri: ["'self'"],
    formAction: ["'self'"]
  }
}));

app.use((req, res, next) => {
  res.setHeader('Content-Security-Policy', "frame-ancestors 'self' https://crm.zoho.com https://*.zoho.com");
  res.removeHeader('X-Frame-Options');
  next();
});

// Add JSON body parser middleware
app.use(express.json());

app.use('/api', async (req, res, next) => {
  const userId = req.header('X-User-Id');
  const orgId  = req.header('X-Org-Id');
   if (!userId || !orgId) {
    return res.status(400).json({ error: 'Missing X-User-Id or X-Org-Id' });
  }
  const db = getDBConnection();
  const [rows] = await db.execute('SELECT * FROM zoho_users WHERE user_id=? and org_id=? LIMIT 1', [userId, orgId]);
  if (!rows.length) return res.status(403).json({ error: 'User not allowed' });
  req.user = { userId, orgId };
  next();
});

app.get(['/', '/index.html'], (req, res) => {
  const referer = req.headers.referer || '';
  const origin = req.headers.origin || '';
  if (!(referer.includes('zoho.com') || origin.includes('zoho.com'))) {
    return res.status(403).send('Forbidden: 403');
  }

  const indexPath = path.join(process.cwd(), 'public', 'index.html');
  if (fs.existsSync(indexPath)) {
    return res.sendFile(indexPath);
  } else {
    return res.status(404).send('Not Found');
  }
});

// Here it serves the public static files as usual
app.use(express.static(path.join(process.cwd(), 'public')));

// Serve Bootstrap CSS files from node_modules under /css/bootstrap 
app.use('/js/bootstrap', express.static(path.join(process.cwd(), 'node_modules/bootstrap/dist/js')));
app.use('/css/bootstrap', express.static(path.join(process.cwd(), 'node_modules/bootstrap/dist/css')));

// middleware for search contact
app.post('/api/search-contacts', async (req, res) => {
  const db = getDBConnection();
  const { latitude, longitude, zip, radiusKm } = req.body;
  console.log(radiusKm);

  if (!zip && (typeof latitude !== 'number' || typeof longitude !== 'number')) {
    return res.status(400).json({ error: 'Provide either zip or valid latitude/longitude' });
  }
  if (zip && typeof zip !== 'string') {
    return res.status(400).json({ error: 'Zip must be a string' });
  }

  try {
    let rows;
    if (zip && zip.trim() !== '') {
      [rows] = await db.execute(
        `SELECT * FROM crm_contacts WHERE zip = ?`,
        [zip.trim()]
      );
      rows = rows.slice(0, 3);
    } else {
      const bbox = getBoundingBox(latitude, longitude, radiusKm);

      const [queryRows] = await db.execute(
        `SELECT * FROM crm_contacts WHERE (latitude BETWEEN ? AND ? AND longitude BETWEEN ? AND ?) OR (latitude = ? AND longitude = ?) LIMIT 10`,
        [bbox.minLat, bbox.maxLat, bbox.minLng, bbox.maxLng, latitude, longitude]
      );

      const filteredSorted = queryRows
        .map(row => ({
          ...row,
          distanceKm: haversineDistance(latitude, longitude, row.latitude, row.longitude),
        }))
        .filter(row => row.distanceKm !== null && row.distanceKm <= radiusKm)
        .sort((a, b) => a.distanceKm - b.distanceKm);

      rows = filteredSorted.slice(0, 3);
    }

    const nowUtc = moment.utc();

    for (const contact of rows) {
      try {
        if (typeof contact.latitude === 'number' && typeof contact.longitude === 'number') {
          const tz = tzlookup(contact.latitude, contact.longitude);
          contact.timezone = tz;
          contact.localTime = nowUtc.tz(tz).format('hh:mm A z'); // Пример: 04:30 PM EDT
        } else {
          contact.timezone = null;
          contact.localTime = 'N/A';
        }
      } catch (e) {
        contact.timezone = null;
        contact.localTime = 'N/A';
      }
    }
    return res.json(rows);

  } catch (err) {
    console.error('Error searching clients:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// middleware for search technicians
app.post('/api/search-technicians', async (req, res) => {
  const db = getDBConnection();
  const accessToken = await getCachedAccessToken(db);
  let { latitude, longitude, zip, radiusKm, skills } = req.body;
  try {

    // If zipcode provided, search by zipcode only, ignoring lat-lng:
    if (zip && zip.trim() !== '') {
      // console.log(zip);
      const center = await getLatLngByZip(zip.trim());

      if (center.error) {

        console.error('Geocoding failed:', center.error);

        return res.status(400).json({ error: center.error });

      } else {

        latitude = center.latitude;
        longitude = center.longitude;
      }
    }
    // console.log('latitude');
    // console.log(latitude);
    // If no zipcode or empty, require lat/lng to search
    if (typeof latitude !== 'number' || typeof longitude !== 'number') {
      // console.log(center);
      writeEventLog(`latitude and longitude must be numbers: ${latitude} ${longitude}`);
      // return res.status(400).json({ error: 'latitude and longitude must be numbers' });
    }

    // Bounding box search by lat/lng
    const bbox = getBoundingBox(latitude, longitude, radiusKm);
    
    const [rows] = await db.execute(
      `SELECT * FROM fsm_tech WHERE latitude IS NOT NULL AND longitude IS NOT NULL AND ((latitude BETWEEN ? AND ? AND longitude BETWEEN ? AND ?) OR (latitude = ? AND longitude = ?))`,
      [bbox.minLat, bbox.maxLat, bbox.minLng, bbox.maxLng, latitude, longitude]
    );
    if (!rows || rows.length === 0) {
      console.log('No technicians found for the specified location');
      return res.status(404).json({ error: 'No technicians found for the specified location' });
    }

    let filteredRows = rows;
    if (Array.isArray(skills) && skills.length > 0) {
      filteredRows = rows.filter(tech => {
        if (!tech.skills) return false;
        let techSkills = [];
        try {
          techSkills = JSON.parse(tech.skills);
        } catch (e) {
          return false;
        }
        const techSkillNames = techSkills.map(s => s.name.toLowerCase());
        return skills.some(skill => techSkillNames.includes(skill.toLowerCase()));
      });
    }
    // console.log(radiusKm);
    // Calculate haversine distance & filter
    const sortedByHaversine = filteredRows
      .map(tech => ({
        ...tech,
        distanceKm: haversineDistance(latitude, longitude, tech.latitude, tech.longitude),
      }))
      .filter(tech => tech.distanceKm <= radiusKm)
      .sort((a, b) => a.distanceKm - b.distanceKm);

    if (sortedByHaversine.length === 0) {
      writeEventLog('No routeable technicians found near location');
      // console.log("No routeable technicians found near location");
      // return res.status(404).json({ error: 'No routeable technicians found near location' });
    }

    // Limit to top 10 and get driving info as before... it could be configurated on frontend
    const top5Candidates = sortedByHaversine.slice(0, 10);
    const routesInfo = await getDrivingDistanceAndDuration(latitude, longitude, top5Candidates);

    const candidatesWithRouteInfo = top5Candidates.map((tech, idx) => {
      const route = routesInfo[idx];
      console.log(route);
      if (!route) return null;
      return {
        ...tech,
        distance_miles: route.distance_miles,
        duration_minutes: route.duration_minutes,
      };
    }).filter(x => x !== null);
    if (candidatesWithRouteInfo.length === 0) {
      console.log("No routeable technicians found");
      // return res.status(404).json({ error: 'No routeable technicians found' });
    }

    // Fetch shifts availability for these technicians
    const orgId = process.env.ZOHO_ORG_ID_SHIFTS;
    const shiftsIds = candidatesWithRouteInfo
      .map(c => c.shifts_id)
      .filter(id => id); // filter out falsy/null shifts_id
    // console.log('shiftsIds');
    // console.log(shiftsIds);
    const availabilityData = await fetchShiftsAvailability(accessToken, orgId, shiftsIds);

    writeEventLog(`availabilityData ${availabilityData}  `);
    // console.log(availabilityData);

    const availabilityMap = {};

    // group availability entries by employee_id
    availabilityData.forEach(entry => {
      const empId = entry.employee_id;
      if (!availabilityMap[empId]) {
        availabilityMap[empId] = [];
      }
      availabilityMap[empId].push(entry);
    });

    // then merge with candidates by their shifts_id (assuming shifts_id === employee_id)
    const finalCandidates = candidatesWithRouteInfo.map(tech => ({
      ...tech,
      availability: availabilityMap[tech.shifts_id] || [],
    }));

    // Sort by shortest driving time
    finalCandidates.sort((a, b) => a.duration_minutes - b.duration_minutes);

    // Return top 10 technicians (all selected)
    res.json(finalCandidates);

  } catch (error) {
    // console.error('Error in search:', error);
    writeEventLog(`Error in search: ${error}`);
    // res.status(500).json({ error: 'Internal server error' });
  }
});

// create CRM order using native fetch
app.post('/api/create-crm-order', async (req, res) => {
  const db = getDBConnection();
  const accessToken = await getCachedAccessToken(db);
  const { technicianId, technicianName, contactId } = req.body;
  console.log(technicianId);
  // const accessToken = await getCachedAccessToken(db);
  // const accessToken = await getAccessToken();
  if (!technicianId || !technicianName) {
    return res.status(400).json({ message: 'technicianId and technicianName are required' });
  }

  if (!accessToken) {
    return res.status(500).json({ message: 'Zoho API token not configured' });
  }
  const dealNamePrefix = 'Gos';
  const randomSixDigit = Math.floor(100000 + Math.random() * 900000).toString();
  const dealName = dealNamePrefix + randomSixDigit;
  const orderData = {
    data: [
      {
        Deal_Name: dealName,
        Stage: 'Qualification',       
        Contact_Name: contactId,
        Description: "Create from Web tub",
        Preferred_Technician: technicianId,
        Pipeline: "Services and Parts Pipeline",
        Layout: {
          id: '6685770000001962069'

        }  
      }
    ]
  };
  // const layoutId = 6685770000001962069;   ?lar_id=${layoutId}
  try {
    const url = 'https://www.zohoapis.com/crm/v8/Deals';
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Zoho-oauthtoken ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(orderData),
    });

    console.log('Zoho API response status:', response.status);

    if (!response.ok) {
      const errorBody = await response.json();
      console.error('Zoho API error:', errorBody);
      return res.status(500).json({ message: 'Failed to create order in Zoho CRM', details: errorBody });
    }

    const responseBody = await response.json();
    return res.json({ id: responseBody.data[0].details.id, message: 'Order created' });
  } catch (error) {
    console.error('Error creating CRM order:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

// create a record Lead or Contact
app.post('/api/create-contact-lead', async (req, res) => {
  const db = getDBConnection();
  const accessToken = await getCachedAccessToken(db);
  const {
    type,
    firstName,
    lastName,
    contactType,
    zipcode,
    email,
    street,
    city,
    state,
    country
  } = req.body;

  if (!type || !['contact', 'lead'].includes(type)) {
    return res.status(400).json({ error: 'Invalid type' });
  }

  if (!firstName || !lastName) {
    return res.status(400).json({ error: 'First Name and Last Name are required' });
  }

  if (type === 'contact') {
    if (!email) return res.status(400).json({ error: 'Email is required for Contact' });
    // Optional: validate email format with regex server-side too
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }
    if (!contactType) return res.status(400).json({ error: 'Contact Type is required' });
    if (!zipcode) return res.status(400).json({ error: 'Zip Code is required' });
    if (!street || !city || !state || !country) {
      return res.status(400).json({ error: 'Complete address is required' });
    }
  }

  let apiPayload;
  let nameModule;

  if (type === 'contact') {
    nameModule = 'Contacts';
    apiPayload = {
      data: [
        {
          First_Name: firstName,
          Last_Name: lastName,
          Email: email || '',
          Contact_Type: contactType || '',
          Mailing_Street: street || '',
          Mailing_City: city || '',
          Mailing_Country: country || '',
          Mailing_State: state || '',
          Mailing_Zip: zipcode || '',
          layouts: {
            id: '6685770000000091033'
          }
        }
      ]
    };
  } else if (type === 'lead') {
    nameModule = 'Leads';
    apiPayload = {
      data: [
        {
          First_Name: firstName,
          Last_Name: lastName,
          Lead_Status: "New",
          Street: street || '',
          City: city || '',
          State: state || '',
          Country: country || '',
          layouts: {
            id: '6685770000000091055'
          }
        }
      ]
    };
  } else {
    return res.status(400).json({ error: 'Invalid type' });
  }
  // console.log(nameModule);
  try {
    const url = `https://www.zohoapis.com/crm/v8/${nameModule}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Zoho-oauthtoken ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(apiPayload),
    });

    if (!response.ok) {
      const errorBody = await response.json();
      console.error('Zoho API error:', errorBody);
      return res.status(response.status).json({ error: 'Failed to create record', details: errorBody });
    }

    const responseBody = await response.json();
    return res.json({ id: responseBody.data[0].details.id, message: `${type} created successfully` });

  } catch (error) {
    console.error('Error creating record:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }

});

// get a list of skills
app.get('/api/skills', async (req, res) => {
  const db = getDBConnection();
  try {
    const [rows] = await db.execute('SELECT skill_name FROM skills_fsm ORDER BY id ASC'); 
    const skills = rows.map(row => row.skill_name);
    console.log(skills);
    res.json({ skills });
  } catch (err) {
    console.error('Error fetching skills from DB:', err);
    res.status(500).json({ error: 'Failed to fetch skills' });
  }
});

app.listen(3000, () => console.log('Server listening on port 3000'));
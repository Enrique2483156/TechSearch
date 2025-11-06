// console.log('ui.js loaded, searchTechnicians function active');
export function renderTechnicians(technicians) {
  const list = document.getElementById('technicians-list');
  list.innerHTML = '';

  if (technicians.length === 0) {
    list.innerHTML = '<p class="text-muted">No technicians found in the area.</p>';
    return;
  }

  function safeTimeZone(tz) {
    try { new Intl.DateTimeFormat('en-US', { timeZone: tz }).format(0); return tz; }
    catch { return 'UTC'; }
  }

  function getLocalParts(date, timeZone) {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone, hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    }).formatToParts(date);
    const map = {};
    for (const { type, value } of parts) map[type] = value;
    return {
      year: +map.year, month: +map.month, day: +map.day,
      hour: +map.hour, minute: +map.minute, second: +map.second
    };
  }

  function tzOffsetMs(date, timeZone) {
    const p = getLocalParts(date, timeZone);
    const asLocalUtcMs = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    return asLocalUtcMs - date.getTime();
  }

  function utcFromLocalYMD(y, m, d, timeZone) {
    const approxUtc = Date.UTC(y, m - 1, d, 0, 0, 0);
    const offset = tzOffsetMs(new Date(approxUtc), timeZone);
    return new Date(approxUtc - offset);
  }

  function nextLocalMidnightUTC(date, timeZone) {
    const p = getLocalParts(date, timeZone);
    const approxNext = Date.UTC(p.year, p.month - 1, p.day + 1, 0, 0, 0);
    const offset = tzOffsetMs(new Date(approxNext), timeZone);
    return new Date(approxNext - offset);
  }

  function formatTimeInZone(date, timeZone) {
    return new Intl.DateTimeFormat('en-US', {
      timeZone, hour: 'numeric', minute: '2-digit', hour12: true
    }).format(date);
  }

  function formatDateLabel(y, m, d, timeZone) {
    const midnightUTC = utcFromLocalYMD(y, m, d, timeZone);
    return new Intl.DateTimeFormat('en-US', {
      timeZone, weekday: 'short', month: 'short', day: 'numeric'
    }).format(midnightUTC).replace(',', ' •');
  }

  function getTimeZoneAbbr(date, timeZone) {
    // Extract short zone name like CDT
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone, timeZoneName: 'short'
    }).formatToParts(date);
    return parts.find(p => p.type === 'timeZoneName')?.value ?? timeZone;
  }

  function groupAvailabilityByDate(availability, timeZone) {
    const tz = safeTimeZone(timeZone);
    const grouped = {};

    (availability || []).forEach(av => {
      let start = new Date(av.start_time);
      const end = new Date(av.end_time);
      // console.log(av.start_time);
      // console.log(timeZone);
      while (start < end) {
        const p = getLocalParts(start, tz);
        const y = p.year, m = p.month, d = p.day;

        const boundary = nextLocalMidnightUTC(start, tz);
        const segEnd = boundary < end ? boundary : end;

        // subtract 1 ms to avoid “12:00 AM” at midnight
        const displayEnd = new Date(segEnd.getTime() - 1);

        const sStr = formatTimeInZone(start, tz);
        const eStr = formatTimeInZone(displayEnd, tz);
        const slot = `${sStr}-${eStr}`; // keep AM/PM always

        const key = `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        if (!grouped[key]) grouped[key] = { y, m, d, slots: [] };
        grouped[key].slots.push(slot);

        start = segEnd;
      }
    });

    return grouped;
  }

  function renderAvailabilityCards(availability, timeZone) {
    const grouped = groupAvailabilityByDate(availability, timeZone);
    const keys = Object.keys(grouped).sort();
    if (!keys.length) return '<em class="text-muted">No availability data</em>';

    // get abbreviation once using "now" in zone
    const tzAbbr = getTimeZoneAbbr(new Date(), safeTimeZone(timeZone));

    return keys.map(k => {
      const { y, m, d, slots } = grouped[k];
      const title = formatDateLabel(y, m, d, safeTimeZone(timeZone));
      const slotSpans = slots.length
        ? slots.map(s => `<span class="slot">${s}</span>`).join('')
        : `<span class="slot slot-unavail">Unavailable</span>`;
      return `
      <div class="p-2 border border-light-subtle rounded-3">
        <p class="m-1 fw-bold">${title}</p>
        ${slotSpans} <span class="text-muted small">(${tzAbbr})</span>
      </div>
    `;
    }).join('');
  }



  function renderSkills(skillsStr) {
    if (!skillsStr) return '<em class="text-muted">No skills</em>';
    let skillsArray;
    try {
      skillsArray = JSON.parse(skillsStr);
    } catch (e) {
      // return '<em class="text-danger">Invalid skills data</em>';
    }

    // if (!Array.isArray(skillsArray) || skillsArray.length === 0) {
    //   return '<em class="text-muted">No skills</em>';
    // }

    return skillsArray.map(s => `<span class="skills">${s.name}</span>`).join(' ');
  }

  // Create table and header
  const table = document.createElement('table');
  table.className = 'table align-middle mb-0 shadow-none table-borderless';

  table.innerHTML = `
    <thead>
      <tr>
         <th class="section-label" colspan="2" style="max-width:200px;">Technician</th>
          <th class="section-label">Zip</th>
          <th class="section-label">Distance (miles)</th>
          <th class="section-label">Est. Time (min)</th>
          <th class="section-label">Location</th>
      </tr>
    </thead>
    <tbody></tbody>
  `;

  const tbody = table.querySelector('tbody');

  technicians.forEach(tech => {
    const row = document.createElement('tr');
    row.className = 'table-light border border-0';

    // <td class="align-middle">${tech.street || 'N/A'}, ${tech.zip || ''}</td> if street comtains zip it will display doble zip
    row.innerHTML = `
     <td class="text-center">
      <div class="form-check d-flex justify-content-center align-items-center">
        <input class="form-check-input" type="radio" name="selected-tech" value="${tech.ZCRM_Id}" id="tech-${tech.ZCRM_Id}">
      </div>
    </td>
    
    <td class="text-color-td"><label for="tech-${tech.ZCRM_Id}" class="mb-0 cursor-pointer"><strong>${tech.full_name}</strong></label></td>
    <td class="text-color-td"><strong>${tech.zip || 'N/A'}</strong></td>
    <td class="text-color-td"><strong>${tech.distance_miles != null ? tech.distance_miles.toFixed(2) : '0'}</strong></td>
    <td class="text-color-td"><strong>${tech.duration_minutes != null ? tech.duration_minutes.toFixed(0) : '0'}</strong></td>
    <td class="text-color-td"><strong>${tech.street || 'N/A'}</strong></td>
    
    `;
    // Detail row for summary + availability cards
    const detailRow = document.createElement('tr');
    detailRow.innerHTML = `
    <td colspan="6">
      <div class="d-flex g-4">
        <div class="p-2" style="width: 250px;">
          <div class="mb-2">Summary</div>
          <ul class="mb-0 text-muted list-group list-group-flush border-0 p-0">
            <li class="list-group-item border-0 p-0">Skills: </li>
            <li class="list-group-item border-0 p-0"> ${renderSkills(tech.skills)}</li>
            <li class="list-group-item border-0 p-0">Max driving distance: ${tech.distance_miles != null ? tech.distance_miles.toFixed(2) : '0'}</li>
            <li class="list-group-item border-0 p-0">Est. time to job: ${tech.duration_minutes != null ? tech.duration_minutes.toFixed(0) : '0'}</li>
            <li class="list-group-item border-0 p-0">Notes: </li>
          </ul>
        </div>
        <div class="flex-grow-1 p-2">
          <div class="overflow-auto gap-3 pb-2">
            <div class="d-flex justify-content-between align-items-center mb-2">
              <div>Availability • next 2 weeks</div>
            </div>
            <div style="grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));" class="d-grid gap-2">
              ${renderAvailabilityCards(tech.availability, tech.time_zone, tech.full_name)}
            </div>
          </div>
        </div>
      </div>
    </td>
  `;

    tbody.appendChild(row);
    tbody.appendChild(detailRow);
  });

  list.appendChild(table);

  // Event delegation for radios
  list.querySelectorAll('input[name="selected-tech"]').forEach(radio => {
    radio.addEventListener('change', () => {
      showCreateOrderButton();
    });
  });

  hideCreateOrderButton(); // Initially hide button on search load
}

export function renderContacts(contacts) {
  const list = document.getElementById('contacts-list');
  list.innerHTML = '';

  if (contacts.length === 0) {
    list.innerHTML = '<p class="text-muted">No Clients found by the criteria.</p>';
    return;
  }

  const table = document.createElement('table');
  table.className = 'table align-middle table-borderless table-hover mb-0 shadow-none';

  table.innerHTML = `
    <thead>
      <tr>
        <th colspan="2" class="section-label">Address</th> 
        <th class="section-label">Zip</th> 
        <th class="section-label">Email</th>  
        <th class="section-label">Name</th>  
        <th class="section-label">Local Time</th>
      </tr>
    </thead>
    <tbody></tbody>
  `;

  const tbody = table.querySelector('tbody');

  contacts.forEach(contact => {
    const row = document.createElement('tr');

    row.innerHTML = `
      <td class="align-middle text-center">
        <div class="form-check d-flex justify-content-center align-items-center">
            <input class="form-check-input" type="radio" name="selected-contact" value="${contact.id_contact}" id="contact-${contact.id_contact}">
        </div>
      </td>
      <td class="align-middle text-color-td fw-bold"><label for="contact-${contact.id_contact}" class="mb-0 cursor-pointer">${contact.street}</label></td> 
      <td class="align-middle text-color-td fw-bold">${contact.zip || ''}</td>
      <td class="align-middle text-color-td fw-bold"><a href="mailto:${contact.email}">${contact.email}</a></td>
      <td class="align-middle text-color-td fw-bold">${contact.first_name} ${contact.last_name}</td>
      <td class="align-middle text-color-td fw-bold" ><span class="contact-local-time" data-timezone="${contact.timezone || ''}" id="local-time-${contact.id_contact}">${contact.localTime || ''}</span></td>
      
      
    `;

    tbody.appendChild(row);
  });
  list.appendChild(table);

  //  list.querySelectorAll('input[name="selected-contact"]').forEach(radio => {
  //   radio.addEventListener('change', () => {
  //     showCreateOrderButton();
  //   });
  // });

}

export function showCreateOrderButton() {
  const container = document.getElementById('create-order-container');
  if (container) container.classList.remove('d-none');
}

export function hideCreateOrderButton() {
  const container = document.getElementById('create-order-container');
  if (container) container.classList.add('d-none');
}

export function startContactClocks() {
  const elements = document.querySelectorAll('.contact-local-time');

  function updateClocks() {
    const now = new Date();
    elements.forEach(el => {
      const tz = el.getAttribute('data-timezone');
      if (!tz) return;

      try {
        const timeString = now.toLocaleTimeString('en-US', {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: true,
          timeZone: tz,
          timeZoneName: 'short'
        });
        el.textContent = timeString;
      } catch (e) {
        el.textContent = 'N/A';
      }
    });
  }

  updateClocks();
  setInterval(updateClocks, 1000);
}
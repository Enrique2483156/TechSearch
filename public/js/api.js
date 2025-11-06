// api.js
// console.log('api.js loaded, searchTechnicians function active');
// const params = new URLSearchParams(window.location.search);
// const userId = params.get('uid');
// const role = params.get('role');
// const orgId = params.get('org');
// console.log(userId);
import { selectedLat, selectedLng } from './autocomplete.js';
import { apiFetch } from './helper.js';

export async function searchTechnicians({ zipcode = '', skills = [] } = {}) {

  // console.log('Calling fetch with URL:', '/api/search-technicians');
  const radiusKm = 99;  // <== default search radius in kilometers
  const body = {
    zip: zipcode,
    latitude: selectedLat,
    longitude: selectedLng,
    radiusKm: radiusKm,
    skills: skills
  };

  Object.keys(body).forEach(key => {
    if (
      body[key] === null ||
      body[key] === '' ||
      (Array.isArray(body[key]) && body[key].length === 0)
    ) {
      delete body[key];
    }
  });

  try {
    const response = await apiFetch('/api/search-technicians', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const errorData = await response.json();
      showToast('error', errorData.error || 'Server error');
      return [];
    }
    return await response.json();

  } catch (error) {
    // alert('Failed to fetch technicians: ' + error.message);
    // writeEventLog(`Failed to fetch technicians: ${error.message}\n${error.stack}`);
    return [];
  }
}

export async function searchContacts({ zipcode = '' } = {}) {
  // console.log('Calling fetch with URL:', '/api/search-contacts');
  // define radiusKm here or make it configurable for example on frontend
  const radiusKm = 1;

  const body = {
    zip: zipcode,
    latitude: selectedLat,
    longitude: selectedLng,
    radiusKm: radiusKm
  };

  Object.keys(body).forEach(key => {
    if (body[key] === null || body[key] === '') {
      delete body[key];
    }
  });

  try {
    const response = await apiFetch('/api/search-contacts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!response.ok) throw new Error(`Server error: ${response.statusText}`);

    return await response.json();

  } catch (error) {
    // alert('Failed to fetch technicians: ' + error.message);
    // writeEventLog(`Failed to fetch technicians: ${error.message}\n${error.stack}`);
    return [];
  }
}

function showToast(type, message) {
  let toastEl, toastBody;

  if (type === 'success') {
    toastEl = document.getElementById('successToast');
    toastBody = document.getElementById('successToastBody');
  } else {
    toastEl = document.getElementById('errorToast');
    toastBody = document.getElementById('errorToastBody');
  }

  toastBody.textContent = message;

  const toast = new bootstrap.Toast(toastEl);
  toast.show();
}
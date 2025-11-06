// main.js
// console.log('main.js loaded, searchTechnicians function active');

// const params = new URLSearchParams(window.location.search);
// const userId = params.get('uid');//6685770000000521001
// const role = params.get('role');
// const orgId = params.get('org');//882080969


import { loadUrlContext, apiFetch} from './helper.js';
import { initAutocomplete } from './autocomplete.js';
import { searchTechnicians, searchContacts } from './api.js';
import { renderTechnicians, renderContacts, hideCreateOrderButton } from './ui.js';
import { startContactClocks } from './ui.js';

// import { writeEventLog } from './helper.js';
loadUrlContext();

window.onload = () => {

  if (window.self === window.top || !document.referrer.includes('https://crm.zoho.com')) {
    document.body.innerHTML = 'Access denied — open only inside Zoho CRM';
    return
  }
  let searchAutocomplete = null;
  if (typeof google === 'object' && typeof google.maps === 'object') {
    searchAutocomplete = initAutocomplete('autocompleteSearch');

    const inputCreate = document.getElementById('autocompleteCreate');

    let autocompleteCreateInstance = null;

    inputCreate.addEventListener('focus', () => {
      // console.log(inputCreate);
      if (!autocompleteCreateInstance) {
        autocompleteCreateInstance = initAutocomplete('autocompleteCreate');


        autocompleteCreateInstance.addListener('place_changed', () => {
          const place = autocompleteCreateInstance.getPlace();

          if (!place.address_components) {
            console.error('No address components found');
            return;
          }
          let postalCode = '';
          place.address_components.forEach(component => {
            if (component.types.includes('postal_code')) {
              postalCode = component.long_name;
            }
          });

          if (postalCode) {
            document.getElementById('zipcodeCreate').value = postalCode;
          } else {
            document.getElementById('zipcodeCreate').value = '';
          }
        });
      }
    });
    // console.log(autocompleteCreate);
  }

  // Parses a Google place address string into components: street, city, state, postalCode, country
  function parseGooglePlaceAddress(address) {
    // Example input: "310 West Inverrary Lane, Deerfield, IL 60015, USA"
    const parts = address.split(',').map(s => s.trim());
    const result = {
      street: '',
      city: '',
      state: '',
      postalCode: '',
      country: '',
    };
    // If address is too short, return whole string as street
    if (parts.length < 2) {
      result.street = address;
      return result;
    }
    //  country
    result.country = parts[parts.length - 1];
    // state and optional postal code
    const stateZip = parts[parts.length - 2];
    const stateZipParts = stateZip.split(' ').filter(Boolean);

    if (stateZipParts.length === 2) {
      // Format like "IL 60015"
      result.state = stateZipParts[0];
      result.postalCode = stateZipParts[1];
    } else if (stateZipParts.length === 1) {
      // Format like "IL"
      result.state = stateZipParts[0];
    } else {
      // Unexpected format, assign whole string to state
      result.state = stateZip;
    }

    // city if exists
    if (parts.length >= 3) {
      result.city = parts[parts.length - 3];
    }

    //  street address
    result.street = parts.slice(0, parts.length - 3).join(', ');

    return result;
  }
  function escapeHTML(s) {
    return String(s).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }
  const addressInput = document.getElementById('autocompleteSearch');
  const zipcodeInput = document.getElementById('zipcode');
  const resetBtn = document.getElementById('resetSearch');

  const deselectAllCheckbox = document.getElementById('deselectAllSkills');
  const skillsDropdownMenu = document.getElementById('skillsDropdownMenu');
  const selectedSkillsPills = document.getElementById('selectedSkillsPills');

  async function loadSkillsAndRenderMenu() {
    if (!skillsDropdownMenu) {
      console.warn('[skills] #skillsDropdownMenu not found');
      return;
    }
    // console.log('[skills] fetching /api/skills ...');
    try {
      const resp = await apiFetch('/api/skills', { headers: { 'Accept': 'application/json' } });
      if (!resp.ok) throw new Error('Failed to fetch skills');
      const data = await resp.json();
      const skills = Array.isArray(data.skills) ? data.skills : [];
      
      const firstLi = skillsDropdownMenu.querySelector('li:first-child');
      skillsDropdownMenu.innerHTML = '';
      if (firstLi) skillsDropdownMenu.appendChild(firstLi);

      skills.forEach(name => {
        const li = document.createElement('li');
        li.innerHTML = `
          <label class="dropdown-item">
            <input type="checkbox" class="form-check-input me-1" value="${escapeHTML(name)}">
            ${escapeHTML(name)}
          </label>
        `;
        skillsDropdownMenu.appendChild(li);
      });

      updatePills();
     
    } catch (err) {
      console.error('[skills] error:', err);
    }
  }

  function updatePills() {
    const checkedBoxes = skillsDropdownMenu.querySelectorAll('input[type=checkbox]:checked:not(#deselectAllSkills)');
    selectedSkillsPills.innerHTML = '';

    if (checkedBoxes.length === 0) {
      selectedSkillsPills.innerHTML = '<span class="text-muted">No skills selected</span>';
      return;
    }

    checkedBoxes.forEach(cb => {
      const skill = cb.value;
      const pill = document.createElement('span');
      pill.className = 'badge bg-primary d-flex align-items-center';
      pill.style.fontSize = '0.75rem';
      pill.style.userSelect = 'none';
      pill.textContent = skill;

      const closeBtn = document.createElement('button');
      closeBtn.type = 'button';
      closeBtn.className = 'btn-close btn-close-white btn-sm ms-2';
      closeBtn.setAttribute('aria-label', 'Remove skill');
      closeBtn.style.cursor = 'pointer';
      closeBtn.onclick = function () {
        cb.checked = false;
        updatePills();
        deselectAllCheckbox.checked = false;
      };

      pill.appendChild(closeBtn);
      selectedSkillsPills.appendChild(pill);
    });
  }

  function validateZipcode(zipcode) {
    const zipRegex = /^\d{5}(-\d{4})?$/;
    return zipRegex.test(zipcode);
  }

  deselectAllCheckbox.addEventListener('change', () => {
    if (deselectAllCheckbox.checked) {
      const skillCheckboxes = skillsDropdownMenu.querySelectorAll('input[type=checkbox]:not(#deselectAllSkills)');
      skillCheckboxes.forEach(cb => cb.checked = false);
      updatePills();
    }
  });

  skillsDropdownMenu.addEventListener('change', function (e) {
    if (e.target && e.target.type === 'checkbox' && e.target.id !== 'deselectAllSkills') {
      if (e.target.checked) {
        deselectAllCheckbox.checked = false;
      }
      updatePills();
    }
  });

  updatePills(); 

  loadSkillsAndRenderMenu();

  function setReadOnly(input, isReadOnly) {
    input.readOnly = isReadOnly;
    if (isReadOnly) {
      input.classList.add('bg-light');
      input.classList.remove('is-invalid');
    } else {
      input.classList.remove('bg-light');
    }
  }

  const createRecordModal = document.getElementById('createRecordModal');
  

  if (createRecordModal) {
    // console.log(createRecordModal);
    createRecordModal.addEventListener('show.bs.modal', () => {
      // Get the current search address from search input
      const createModalBtn = document.getElementById('open-create-modal-btn');
      const modalAddressInput = document.getElementById('autocompleteCreate');
      const zipcodeInput = document.getElementById('zipcodeCreate');
      const searchAddress = document.getElementById('autocompleteSearch').value.trim();
      const addressFromData = createModalBtn ? createModalBtn.getAttribute('data-address') : null;
      const address = addressFromData || searchAddress || '';

      if (modalAddressInput) {
        modalAddressInput.value = address;
      }

      if (zipcodeInput) {
        if (address) {
          const addressFields = parseGooglePlaceAddress(address);
          zipcodeInput.value = addressFields.postalCode || '';
        } else {
          zipcodeInput.value = '';
        }
      }

    });
  }

  addressInput.addEventListener('input', () => {
    setReadOnly(zipcodeInput, addressInput.value.trim() !== '');
  });

  zipcodeInput.addEventListener('input', () => {
    setReadOnly(addressInput, zipcodeInput.value.trim() !== '');
  });

  function validateCreateRecordForm() {
    const type = document.querySelector('input[name="recordType"]:checked').value;
    const firstName = document.getElementById('firstName').value.trim();
    const lastName = document.getElementById('lastName').value.trim();

    if (!firstName) {
      showToast('error', 'First Name is required');
      return false;
    }
    if (!lastName) {
      showToast('error', 'Last Name is required');
      return false;
    }
    
    if (type === 'contact') {
      const email = document.getElementById('email').value.trim();
      const address = document.getElementById('autocompleteCreate').value.trim();
      const zipcode = document.getElementById('zipcodeCreate').value.trim();
      const contactType = document.getElementById('contactType').value;

      if (!email) {
        showToast('error', 'Email is required for Contact');
        return false;
      }
      // Basic email format check
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        showToast('error', 'Invalid email format');
        return false;
      }

      if (!address) {
        showToast('error', 'Full Address is required for Contact');
        return false;
      }
      // Zip code can be auto-extracted from address (it already parses it), but fallback check:
      if (!zipcode) {
        showToast('error', 'Zip Code is required for Contact');
        return false;
      }

      if (!contactType) {
        showToast('error', 'Contact Type is required');
        return false;
      }
    }

    return true;
  }

  resetBtn.addEventListener('click', () => {
    addressInput.value = '';
    zipcodeInput.value = '';
    setReadOnly(addressInput, false);
    setReadOnly(zipcodeInput, false);

    skillsDropdownMenu.querySelectorAll('input[type=checkbox]').forEach(cb => cb.checked = false);
    deselectAllCheckbox.checked = false;

    updatePills();

    addressInput.focus();

    const openCreateModalBtn = document.getElementById('open-create-modal-btn');
    if (openCreateModalBtn) {
      openCreateModalBtn.classList.add('d-none');
    }
    const modalElement = document.getElementById('createRecordModal');
    const bsModal = bootstrap.Modal.getInstance(modalElement);
    if (bsModal) {
      bsModal.hide();
    }
    // const createOrderContainer = document.getElementById('create-order-container');
    // if (createOrderContainer) {
    //   createOrderContainer.classList.add('d-none');
    // }
    const createForm = document.getElementById('createRecordForm');
    if (createForm) {
      createForm.reset();
    }

  });

  const createOrderBtn = document.getElementById('create-order-btn');
  createOrderBtn.addEventListener('click', async () => {
    // console.log(createOrderBtn);
    const selectedRadio = document.querySelector('input[name="selected-tech"]:checked');
    const selectedRadioContact = document.querySelector('input[name="selected-contact"]:checked');
    if (!selectedRadio) {
      // writeEventLog('Please select a technician first.');
      // alert('Please select a technician first.');
      showToast('error', 'Please select a Technician');
      return;
    }
    if (!selectedRadioContact) {
      // writeEventLog('Please select a technician first.');
      // alert('Please select a technician first.');
      showToast('error', 'Please select a Contact');
      return;
    }
    const technicianId = selectedRadio.value;
    const contactId = selectedRadioContact.value;
    const technicianLabel = selectedRadio.nextElementSibling;
    const technicianName = technicianLabel ? technicianLabel.querySelector('strong').innerText : 'Technician';
    // console.log(technicianId);
    try {
      const response = await apiFetch('/api/create-crm-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ technicianId, technicianName, contactId }),
      });

      const data = await response.json();
      // console.log(data);

      if (!response.ok) {
        showToast('error', result.message || 'Failed to create record.');
        const errorData = await response.json();
        throw new Error(errorData.message || 'Failed to create CRM order');
      }
      showToast('success', 'Record created successfully!');

      // alert(`CRM order created successfully! Order ID: ${data.id}`);
      // writeEventLog(`CRM order created successfully! Order ID: ${data.id}`);
      hideCreateOrderButton();
    } catch (err) {
      // alert('Error creating CRM order: ' + err.message);
      // writeEventLog(`Error creating CRM order: ${err.message}\n${err.stack}`);
    }
  });

  //logic for searching contacts if do not use the button, leave it just in case
  // async function onClientSearch() {
  //   const address = document.getElementById('autocomplete').value.trim();
  //   const zipcode = document.getElementById('zipcode').value.trim();
  //   const email = document.getElementById('email').value.trim();
  //   // const name = document.getElementById('name').value.trim();
  //   console.log(address);
  //   if (!address && !zipcode && !email) {
  //     // Optionally clear clients list or do nothing if no input
  //     return;
  //   }

  //   const clients = await searchClients({ address, zipcode, email });
  //   renderClients(clients); // Implement UI rendering for clients
  // }

  // Attach debounced handler to client search inputs may be it si not good idea, it just shold work bt clicking a button
  // const clientInputs = ['autocomplete', 'zipcode', 'email' /*, 'name' */];
  // clientInputs.forEach(id => {
  //   const input = document.getElementById(id);
  //   if (input) {
  //     input.addEventListener('input', debounce(onClientSearch, 3000)); // 500ms debounce
  //   }
  // });
  //end 

  document.getElementById('search-btn').addEventListener('click', async () => {
    const addressValue = document.getElementById('autocompleteSearch').value.trim();
    const zipcodeValue = document.getElementById('zipcode').value.trim();

    if (zipcodeValue && !validateZipcode(zipcodeValue)) {
      showToast('error', 'Invalid ZIP code format.');
      return;
    }

    const checkedSkills = Array.from(document.querySelectorAll('#skillsDropdownMenu input[type=checkbox]:checked'))
      .map(cb => cb.value);

    if (!addressValue && !zipcodeValue && checkedSkills.length > 0) {
      showToast('error', 'Please enter address or zip code to search technicians by skills.');
      return;
    }

    if (!addressValue && !zipcodeValue && checkedSkills.length === 0) {
      showToast('error', 'Please enter address or zip code to search.');
      return;
    }

    // const email = document.getElementById('email').value.trim(); //if there is will be search by an email
    try {
      const technicians = await searchTechnicians({ zipcode: zipcodeValue, skills: checkedSkills });
      const contacts = await searchContacts({ zipcode: zipcodeValue });
      renderContacts(contacts);
      startContactClocks();
      renderTechnicians(technicians);
      updateUIAfterContactSearch(contacts);
    } catch (err) {
      showToast('error', 'Error during search: ' + err.message);
    }
  });

  //  show Create Order or Create Contact/Lead button & form based on contacts search result
  function updateUIAfterContactSearch(contactsFound) {
    // console.log(contactsFound);
    const createOrderContainer = document.getElementById('create-order-container');
    const openCreateModalBtn = document.getElementById('open-create-modal-btn');

    if (contactsFound.length > 0) {
      // Contact(s) found: show create order button only
      createOrderContainer.classList.remove('d-none');
      openCreateModalBtn.classList.add('d-none');
      openCreateModalBtn.removeAttribute('data-address');
    } else {
      // No contacts found: show button to open create contact/lead modal
      createOrderContainer.classList.add('d-none');
      openCreateModalBtn.classList.remove('d-none');
      const place = searchAutocomplete.getPlace();
      // console.log(place);
      if (!place || !place.formatted_address) {
        // showToast('error', 'Address is invalid or incomplete.');
        return;
      }
      openCreateModalBtn.setAttribute('data-address', place.formatted_address);
    }
  }

  //  placeholder for form submission handling
  document.getElementById('createRecordForm').addEventListener('submit', async e => {
    e.preventDefault();

    if (!validateCreateRecordForm()) return;

    const type = document.querySelector('input[name="recordType"]:checked').value;
    const firstName = e.target.firstName.value.trim();
    const lastName = e.target.lastName.value.trim();
    let data = {};
    if (type === 'contact') {
      data = {
        type,
        firstName,
        lastName
      };
      data.contactType = e.target.contactType.value
      data.zipcode = e.target.zipcodeCreate.value.trim();
      data.email = e.target.email.value.trim();
      let address = e.target.autocompleteCreate.value.trim();
      const addressFields = parseGooglePlaceAddress(address);
      data.street = addressFields.street;
      data.city = addressFields.city;
      data.state = addressFields.state;
      data.country = addressFields.country;

    } else if (type === 'lead') {

      data = {
        type,
        firstName,
        lastName
      };
      let address = e.target.autocompleteCreate.value;
      if (address) {
        address = address.trim();
        const addressFields = parseGooglePlaceAddress(address);
        data.street = addressFields.street;
        data.city = addressFields.city;
        data.state = addressFields.state;
        data.country = addressFields.country;
      }
    }

    try {
      const response = await apiFetch('/api/create-contact-lead', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });

      const result = await response.json();
      // console.log(result);
      if (!response.ok) {
        showToast('error', result.message || 'Failed to create record.');
        // document.getElementById('formMessage').textContent = result.message || 'Failed to create record.';
        return;
      }

      
      showToast('success', 'Record created successfully!');
      // document.getElementById('formMessage').textContent = result.message || 'Failed to create record.';
      var modalElement = document.getElementById('createRecordModal');
      var bsModal = bootstrap.Modal.getInstance(modalElement);
      bsModal.hide();
      //  close modal, maybe do a refresh contacts list, tech list
      // trigger refresh of contacts list & UI update as needed

    } catch (err) {
      // document.getElementById('formMessage').textContent = 'Error: ' + err.message;
      showToast('error', err.message || 'Failed to create record.');
    }
  });

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
};
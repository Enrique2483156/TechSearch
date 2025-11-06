// autocomplete.js
// import { writeEventLog } from './helper.js';
// console.log('au.js loaded, searchTechnicians function active');
export let selectedLat = null;
export let selectedLng = null;

export function initAutocomplete(id) {
  const input = document.getElementById(id);
  if (!input) return null;

  const autocompleteInstance = new google.maps.places.Autocomplete(input, {
    types: ['address'],
    componentRestrictions: { country: 'us' }
  });

  autocompleteInstance.addListener('place_changed', () => {
    const place = autocompleteInstance.getPlace();
    if (!place.geometry) {
      // handle no details available (helper.js)
      return;
    }
    selectedLat = place.geometry.location.lat();
    selectedLng = place.geometry.location.lng();
    console.log('Selected:', place.formatted_address, selectedLat, selectedLng);
    
  });
// console.log(input);
  return autocompleteInstance;
}
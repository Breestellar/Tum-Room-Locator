var map = L.map('map').setView([-4.0385, 39.6680], 16);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '© OpenStreetMap contributors'
}).addTo(map);

// Layer for markers
let markersLayer = L.layerGroup().addTo(map);

// Fetch buildings data
fetch('/api/buildings')
  .then(res => res.json())
  .then(data => {
    data.forEach(b => {
      var marker = L.marker([b.lat, b.lng]).addTo(map)
        .bindPopup(`<b>${b.name}</b><br><button onclick="showRooms(${b.id})">View Rooms</button>`);
    });
  });

// Fetch rooms for a building
function showRooms(buildingId) {
  fetch(`/api/rooms/${buildingId}`)
    .then(res => res.json())
    .then(rooms => {
      var list = rooms.map(r => `<b>${r.name}</b> (Floor ${r.floor})`).join('<br>');
      L.popup()
        .setLatLng(map.getCenter())
        .setContent(list)
        .openOn(map);
    });
}
// Search for a building
function searchBuilding() {
    let query = document.getElementById('searchInput').value;

    fetch(`/api/search?q=${query}`)
        .then(response => response.json())
        .then(data => {

            if (data.length === 0) {
                alert("No results found");
                return;
            }

            // Clear old markers
            markersLayer.clearLayers();

            data.forEach(place => {
                let marker = L.marker([place.latitude, place.longitude])
                    .addTo(markersLayer)
                    .bindPopup(`<b>${place.name}</b><br>${place.campus_name}`);

                // Zoom to first result
                map.setView([place.latitude, place.longitude], 17);
            });

        })
        .catch(error => console.error(error));
}
// Reset map view
function resetMap() {
    map.setView([-4.0385, 39.6680], 16);
}

//Handle search suggestions
const input = document.getElementById('searchInput');
const suggestionsBox = document.getElementById('suggestions');

input.addEventListener('input', function () {
    let query = input.value;
    let campus = document.getElementById('campusSelect').value;

    if (query.length < 2) {
        suggestionsBox.innerHTML = "";
        suggestionsBox.classList.add('hidden');
        return;
    }

    fetch(`/api/search?q=${query}`)
        .then(res => res.json())
        .then(data => {

            if (data.length === 0) {
                suggestionsBox.innerHTML = "<p class='p-2'>No results</p>";
                suggestionsBox.classList.remove('hidden');
                return;
            }

            suggestionsBox.innerHTML = data.map(b => `
                <div class="p-2 hover:bg-gray-100 cursor-pointer"
                    onclick="selectBuilding(${b.latitude}, ${b.longitude}, '${b.name}')">
                    ${b.name} <span class="text-gray-500 text-sm">(${b.campus_name})</span>
                </div>
            `).join('');

            suggestionsBox.classList.remove('hidden');
        });
});

// Handle building selection from suggestions
function selectBuilding(lat, lng, name) {
    suggestionsBox.classList.add('hidden');

    map.setView([lat, lng], 18);

    L.marker([lat, lng])
        .addTo(map)
        .bindPopup(name)
        .openPopup();
}
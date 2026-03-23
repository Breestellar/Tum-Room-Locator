var map = L.map('map').setView([-4.0435, 39.6682], 16);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '© OpenStreetMap contributors'
}).addTo(map);

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

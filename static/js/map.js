// =======================
// MAP INITIALIZATION
// =======================
const map = L.map('map').setView([-4.0385, 39.6680], 16);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap contributors'
}).addTo(map);

// Layers
let markersLayer = L.layerGroup().addTo(map);
let routeLayers = [];

// =======================
// GLOBAL STATE
// =======================
let userMarker = null;
let accuracyCircle = null;
let watchId = null;
let currentDestination = null;
let lastPosition = null;
let lastRoutePoint = null;

// =======================
// LOAD BUILDINGS (INITIAL)
// =======================
fetch('/api/buildings')
    .then(res => res.json())
    .then(data => {
        data.forEach(b => {
            L.marker([b.lat, b.lng])
                .addTo(markersLayer)
                .bindPopup(`<b>${b.name}</b>`);
        });
    });

// =======================
// SEARCH SYSTEM
// =======================
const input = document.getElementById('searchInput');
const suggestionsBox = document.getElementById('suggestions');

// LIVE SUGGESTIONS
input.addEventListener('input', () => {
    let query = input.value.trim();

    if (query.length < 2) {
        suggestionsBox.classList.add('hidden');
        return;
    }

    fetch(`/api/search?q=${query}`)
        .then(res => res.json())
        .then(data => {

            if (!data.length) {
                suggestionsBox.innerHTML = "<p class='p-2'>No results</p>";
                suggestionsBox.classList.remove('hidden');
                return;
            }

            suggestionsBox.innerHTML = data.map(b => `
                <div class="p-3 hover:bg-gray-100 cursor-pointer border-b"
                    onclick="selectBuilding(${b.lat}, ${b.lng}, '${b.name}', '${b.campus_name}')">

                    <div class="font-semibold">${b.name}</div>
                    <div class="text-sm text-gray-500">${b.campus_name}</div>
                </div>
            `).join('');

            suggestionsBox.classList.remove('hidden');
        });
});

// ENTER = SELECT FIRST RESULT
input.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        e.preventDefault();
        let first = suggestionsBox.querySelector('div');
        if (first) first.click();
    }
});

// =======================
// SELECT BUILDING
// =======================
function selectBuilding(lat, lng, name, campus) {

    suggestionsBox.classList.add('hidden');

    // Save recent
    saveRecent({ name, campus, lat, lng });

    currentDestination = { lat, lng };

    // Clear markers
    markersLayer.clearLayers();

    // Add destination marker
    L.marker([lat, lng])
        .addTo(markersLayer)
        .bindPopup(`
            <b>${name}</b><br>${campus}<br><br>
            <button onclick="startDirections(${lat}, ${lng})"
                class="bg-green-600 text-white px-3 py-1 rounded">
                Directions
            </button>
        `)
        .openPopup();

    map.setView([lat, lng], 18);
}

// =======================
// USER LOCATION (BLUE DOT)
// =======================
function updateUserLocation(lat, lng, accuracy) {

    if (userMarker) map.removeLayer(userMarker);
    if (accuracyCircle) map.removeLayer(accuracyCircle);

    userMarker = L.circleMarker([lat, lng], {
        radius: 8,
        color: '#2563eb',
        fillColor: '#3b82f6',
        fillOpacity: 1
    }).addTo(map);

    accuracyCircle = L.circle([lat, lng], {
        radius: accuracy,
        color: '#3b82f6',
        fillOpacity: 0.1
    }).addTo(map);
}

// =======================
// SMOOTH GPS (ANTI-JUMP)
// =======================
function smoothPosition(newLat, newLng) {
    if (!lastPosition) {
        lastPosition = [newLat, newLng];
        return lastPosition;
    }

    const alpha = 0.2;

    let lat = lastPosition[0] + alpha * (newLat - lastPosition[0]);
    let lng = lastPosition[1] + alpha * (newLng - lastPosition[1]);

    lastPosition = [lat, lng];
    return lastPosition;
}

// =======================
// START DIRECTIONS
// =======================
function startDirections(destLat, destLng) {

    currentDestination = { lat: destLat, lng: destLng };

    if (!navigator.geolocation) {
        alert("Geolocation not supported");
        return;
    }

    navigator.geolocation.getCurrentPosition(pos => {

        let [lat, lng] = smoothPosition(
            pos.coords.latitude,
            pos.coords.longitude
        );

        updateUserLocation(lat, lng, pos.coords.accuracy);

        drawRoute(lat, lng, destLat, destLng);

        startLiveTracking();

    }, () => {
        alert("Enable location to navigate");
    });
}

// =======================
// LIVE TRACKING + REROUTE
// =======================
function startLiveTracking() {

    if (watchId) navigator.geolocation.clearWatch(watchId);

    watchId = navigator.geolocation.watchPosition(pos => {

        let [lat, lng] = smoothPosition(
            pos.coords.latitude,
            pos.coords.longitude
        );

        updateUserLocation(lat, lng, pos.coords.accuracy);

        if (!currentDestination) return;

        let current = [lat, lng];

        if (!lastRoutePoint || map.distance(current, lastRoutePoint) > 20) {
            drawRoute(lat, lng, currentDestination.lat, currentDestination.lng);
            lastRoutePoint = current;
        }

    }, null, {
        enableHighAccuracy: true,
        maximumAge: 1000
    });
}

// =======================
// ROUTING (OSRM)
// =======================
function drawRoute(startLat, startLng, endLat, endLng) {

    const url = `https://router.project-osrm.org/route/v1/foot/${startLng},${startLat};${endLng},${endLat}?alternatives=true&overview=full&geometries=geojson`;

    fetch(url)
        .then(res => res.json())
        .then(data => {

            if (!data.routes || !data.routes.length) {
                alert("No route found");
                return;
            }

            // Clear old routes
            routeLayers.forEach(layer => map.removeLayer(layer));
            routeLayers = [];

            // Sort routes (best first)
            data.routes.sort((a, b) => {
                if (a.duration === b.duration) return a.distance - b.distance;
                return a.duration - b.duration;
            });

            data.routes.forEach((route, index) => {

                let layer = L.geoJSON(route.geometry, {
                    style: {
                        color: index === 0 ? 'green' : 'gray',
                        weight: index === 0 ? 6 : 4,
                        opacity: index === 0 ? 1 : 0.6
                    }
                }).addTo(map);

                routeLayers.push(layer);

                layer.on('click', () => highlightRoute(index));

                // Show ETA
                if (index === 0) {
                    let duration = Math.round(route.duration / 60);
                    let distance = (route.distance / 1000).toFixed(2);

                    L.popup()
                        .setLatLng([endLat, endLng])
                        .setContent(`🚶 ${duration} min (${distance} km)`)
                        .openOn(map);
                }
            });

            map.fitBounds(routeLayers[0].getBounds());
        });
}

// =======================
// SWITCH ROUTES
// =======================
function highlightRoute(selectedIndex) {
    routeLayers.forEach((layer, i) => {
        layer.setStyle({
            color: i === selectedIndex ? 'green' : 'gray',
            weight: i === selectedIndex ? 6 : 4,
            opacity: i === selectedIndex ? 1 : 0.6
        });
    });
}

// =======================
// RECENTS SYSTEM
// =======================
function saveRecent(place) {

    let recents = JSON.parse(localStorage.getItem("recentSearches")) || [];

    recents = recents.filter(r => r.name !== place.name);

    recents.unshift(place);
    recents = recents.slice(0, 5);

    localStorage.setItem("recentSearches", JSON.stringify(recents));

    renderRecents();
}

function renderRecents() {

    let recents = JSON.parse(localStorage.getItem("recentSearches")) || [];
    let container = document.getElementById("recentList");

    if (!container) return;

    container.innerHTML = recents.map(r => `
        <div class="p-2 hover:bg-gray-100 cursor-pointer"
            onclick="selectBuilding(${r.lat}, ${r.lng}, '${r.name}', '${r.campus}')">

            <div class="font-medium">${r.name}</div>
            <div class="text-sm text-gray-500">${r.campus}</div>
        </div>
    `).join('');
}

renderRecents();

// =======================
// RESET MAP
// =======================
function resetMap() {
    map.setView([-4.0385, 39.6680], 16);
    markersLayer.clearLayers();
}
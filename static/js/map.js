// GLOBAL VARIABLES
let selectedRouteIndex = 0;
let currentRoutes = [];
let navigating = false;
let destination = null;
let currentStepIndex = 0;
let steps = [];
let lastSpokenStep = -1;
let arrivalThreshold = 20; // meters

// Walking speed (meters per second)
const WALKING_SPEED = 1.4;

// MAP INITIALIZATION
let map = L.map('map').setView([-4.0385, 39.6680], 16);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap contributors'
}).addTo(map);

let markersLayer = L.layerGroup().addTo(map);
let routeLayers = [];

// STATE
let userMarker = null;
let accuracyCircle = null;
let watchId = null;
let lastPosition = null;

// LOAD BUILDINGS
fetch('/api/buildings')
    .then(res => res.json())
    .then(data => {
        data.forEach(b => {
            L.marker([b.lat, b.lng])
                .addTo(markersLayer)
                .bindPopup(`<b>${b.name}</b>`);
        });
    });

// SEARCH
const input = document.getElementById('searchInput');
const suggestionsBox = document.getElementById('suggestions');

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

            suggestionsBox.innerHTML = data.map(item => {

                let title = item.room_name
                    ? `${item.room_name} (Room)`
                    : `${item.building_name} (Building)`;

                let subtitle = item.room_name
                    ? `${item.building_name} • Floor ${item.floor || 'N/A'}`
                    : `Building`;

                return `
                    <div class="p-3 hover:bg-gray-100 cursor-pointer border-b"
                        onclick="selectLocation(
                            ${item.building_id},
                            ${item.lat},
                            ${item.lng},
                            '${item.building_name}',
                            '${item.room_name || ''}',
                            '${item.floor || ''}'
                        )">

                        <div class="font-semibold">${title}</div>
                        <div class="text-sm text-gray-500">${subtitle}</div>
                    </div>
                `;
            }).join('');

            suggestionsBox.classList.remove('hidden');
        });
});

// SELECT LOCATION
function selectLocation(buildingId, lat, lng, buildingName, roomName, floor) {

    suggestionsBox.classList.add('hidden');

    // Use building name if no room
    let displayName = roomName
        ? `${roomName} (${buildingName})`
        : buildingName;

    destination = {
        lat,
        lng,
        name: displayName
    };

    markersLayer.clearLayers();

    L.marker([lat, lng])
        .addTo(markersLayer)
        .bindPopup(`
            <b>${displayName}</b>
            ${floor ? `<br>Floor: ${floor}` : ''}
        `)
        .openPopup();

    map.setView([lat, lng], 18);

    getUserLocation((userLat, userLng) => {
        getRoute(userLat, userLng, lat, lng);
    });

    saveRecent({
        buildingId,
        name: buildingName,
        lat,
        lng,
        roomName,
        floor
    });
}

// USER LOCATION
function getUserLocation(callback) {
    navigator.geolocation.getCurrentPosition(pos => {

        let [lat, lng] = smoothPosition(
            pos.coords.latitude,
            pos.coords.longitude
        );

        updateUserLocation(lat, lng, pos.coords.accuracy);
        callback(lat, lng);

    }, () => alert("Enable location"));
}

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

// SMOOTH GPS
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

// ROUTING

function getRoute(startLat, startLng, endLat, endLng) {

    const url = `https://router.project-osrm.org/route/v1/foot/${startLng},${startLat};${endLng},${endLat}?alternatives=true&overview=full&geometries=geojson&steps=true`;

    fetch(url)
        .then(res => res.json())
        .then(data => {

            if (!data.routes.length) return alert("No route");

            currentRoutes = data.routes;
            renderRoutes();
            openDirectionsPanel();
        });
}

// DRAW ROUTES
function renderRoutes() {

    routeLayers.forEach(l => map.removeLayer(l));
    routeLayers = [];

    const optionsDiv = document.getElementById("routeOptions");
    optionsDiv.innerHTML = "";

    currentRoutes.forEach((route, index) => {

        let coords = route.geometry.coordinates.map(c => [c[1], c[0]]);

        let layer = L.polyline(coords, {
            color: index === 0 ? 'green' : 'gray',
            weight: 5
        }).addTo(map);

        routeLayers.push(layer);

        // ✅ REALISTIC ETA
        let duration = Math.round(route.distance / WALKING_SPEED / 60);
        let distance = (route.distance / 1000).toFixed(2);

        let btn = document.createElement("div");
        btn.className = "p-2 border rounded cursor-pointer";

        btn.innerHTML = `
            <div>Route ${index + 1}</div>
            <div class="text-sm">${duration} min • ${distance} km</div>
        `;

        btn.onclick = () => selectRoute(index);
        optionsDiv.appendChild(btn);
    });

    map.fitBounds(routeLayers[0].getBounds());
    updateETA(0);
}

// SELECT ROUTE
function selectRoute(index) {

    selectedRouteIndex = index;

    routeLayers.forEach((l, i) => {
        l.setStyle({ color: i === index ? 'green' : 'gray' });
    });

    updateETA(index);
}

// ETA
function updateETA(index) {

    let route = currentRoutes[index];

    let duration = Math.round(route.distance / WALKING_SPEED / 60);
    let distance = (route.distance / 1000).toFixed(2);

    document.getElementById("etaBox").innerText =
        `🚶 ${duration} min (${distance} km)`;
}

// VOICE NAVIGATION
function speak(text) {

    if (!('speechSynthesis' in window)) {
        console.warn("Speech not supported");
        return;
    }

    window.speechSynthesis.cancel(); // 🔥 prevents stacking

    let speech = new SpeechSynthesisUtterance(text);
    speech.lang = "en-US";
    speech.rate = 1;

    window.speechSynthesis.speak(speech);
}

// PANEL CONTROL
function openDirectionsPanel() {
    document.getElementById("directionsPanel").classList.remove("hidden");
}

function closeDirections() {
    document.getElementById("directionsPanel").classList.add("hidden");
}

// START NAVIGATION
document.getElementById("startNavBtn").onclick = function () {

    if (!currentRoutes.length) return;

    navigating = true;

    steps = currentRoutes[selectedRouteIndex].legs[0].steps;
    currentStepIndex = 0;
    lastSpokenStep = -1;

    speak("Navigation started");

    startLiveTracking();
};


// LIVE TRACKING

function startLiveTracking() {

    if (watchId) navigator.geolocation.clearWatch(watchId);

    watchId = navigator.geolocation.watchPosition(pos => {

        let [lat, lng] = smoothPosition(
            pos.coords.latitude,
            pos.coords.longitude
        );

        updateUserLocation(lat, lng, pos.coords.accuracy);

        if (!navigating || !destination || !steps.length) return;

        let userPos = L.latLng(lat, lng);


        // ARRIVAL CHECK
        let dest = L.latLng(destination.lat, destination.lng);
        let distToDest = userPos.distanceTo(dest);

        if (distToDest < arrivalThreshold) {
            speak("You have arrived at your destination");
            stopNavigation();
            resetMap();
            return;
        }

        // CURRENT STEP
        let step = steps[currentStepIndex];
        let stepCoords = step.geometry.coordinates;
        let nextPoint = L.latLng(stepCoords[stepCoords.length - 1][1], stepCoords[stepCoords.length - 1][0]);

        let distToStep = userPos.distanceTo(nextPoint);

        // VOICE TRIGGER
        if (distToStep < 15 && currentStepIndex !== lastSpokenStep) {

            speak(step.maneuver.instruction);
            lastSpokenStep = currentStepIndex;

            currentStepIndex++;
        }

        // SMART REROUTE
        let routeLine = routeLayers[selectedRouteIndex];
        let closest = routeLine.getLatLngs().reduce((prev, curr) => {
            return userPos.distanceTo(curr) < userPos.distanceTo(prev) ? curr : prev;
        });

        let deviation = userPos.distanceTo(closest);

        if (deviation > 30) {

            document.getElementById("rerouteNotice").classList.remove("hidden");

            getRoute(lat, lng, destination.lat, destination.lng);

            setTimeout(() => {
                document.getElementById("rerouteNotice").classList.add("hidden");
            }, 1500);
        }

    }, null, { enableHighAccuracy: true });
}

// RECENTS
function saveRecent(place) {

    let recents = JSON.parse(localStorage.getItem("recentSearches")) || [];

    recents = recents.filter(r => r.name !== place.name);

    recents.unshift({
        buildingId: place.buildingId || null,
        name: place.name,
        lat: place.lat,
        lng: place.lng,
        roomName: place.roomName || '',
        floor: place.floor || ''
    });
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
            onclick="selectLocation(
                ${r.buildingId},
                ${r.lat},
                ${r.lng},
                '${r.name}',
                '${r.roomName}',
                '${r.floor}'
            )">
            <div class="font-medium">${r.name}</div>
            <div class="text-sm text-gray-500">
                ${r.roomName ? `Room • Floor ${r.floor}` : 'Building'}
            </div>
        </div>
    `).join('');
}

renderRecents();

// RESET
function resetMap() {

    map.setView([-4.0385, 39.6680], 16);

    markersLayer.clearLayers();

    routeLayers.forEach(l => map.removeLayer(l));
    routeLayers = [];

    currentRoutes = [];
    selectedRouteIndex = 0;
    destination = null;

    document.getElementById("routeOptions").innerHTML = "";
    document.getElementById("etaBox").innerText = "";

    closeDirections();

    if (watchId) {
        navigator.geolocation.clearWatch(watchId);
        watchId = null;
    }

    if (userMarker) map.removeLayer(userMarker);
    if (accuracyCircle) map.removeLayer(accuracyCircle);

    userMarker = null;
    accuracyCircle = null;

    let reroute = document.getElementById("rerouteNotice");
    if (reroute) reroute.classList.add("hidden");
}
// GLOBAL VARIABLES
let selectedRouteIndex = 0;
let currentRoutes = [];
let navigating = false;
let navigationPaused = false;
let routeCache = {};
let selectedPlace = null;
let selectedRoomInstructions = "";
let selectedFloor = "";
let selectedBuilding = "";
let destination = null;
let currentStepIndex = 0;
let steps = [];
let lastInstructionTime = 0;
let lastSpokenStep = -1;
let arrivalThreshold = 30; // meters
let selectedStartPlace = null;

const input = document.getElementById("searchInput");
const suggestionsBox = document.getElementById("suggestions");
const WALKING_SPEED = 1.4;
const startModeSelect = document.getElementById("startModeSelect");
const startSearchBox = document.getElementById("startSearchBox");
const startSearchInput = document.getElementById("startSearchInput");
const startSuggestions = document.getElementById("startSuggestions");

// MAP INITIALIZATION
let map = L.map("map").setView([-4.0385, 39.668], 16);
window.map = map;

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: "© OpenStreetMap",
}).addTo(map);

let markersLayer = L.layerGroup().addTo(map);
let routeLayers = [];

const defaultMarkerIcon = new L.Icon.Default();

const selectedMarkerIcon = L.divIcon({
  className: "selected-location-marker",
  html: `
    <div style="
      background:#16a34a;
      color:white;
      inline-size:34px;
      block-size:34px;
      border-radius:999px;
      display:flex;
      align-items:center;
      justify-content:center;
      border:3px solid white;
      box-shadow:0 4px 12px rgba(0,0,0,.35);
      font-weight:bold;">
      📍
    </div>
  `,
  iconSize: [34, 34],
  iconAnchor: [17, 34],
});

// STATE
let userMarker = null;
let accuracyCircle = null;
let watchId = null;
let lastPosition = null;

function loadLocationFromUrl() {
  const params = new URLSearchParams(window.location.search);

  const lat = params.get("lat");
  const lng = params.get("lng");
  const name = params.get("name");
  const building = params.get("building");
  const floor = params.get("floor");
  const instructions = params.get("instructions");

  if (!lat || !lng || !name) return;

  const latNum = parseFloat(lat);
  const lngNum = parseFloat(lng);

  if (Number.isNaN(latNum) || Number.isNaN(lngNum)) return;

  const place = {
    buildingId: null,
    lat: latNum,
    lng: lngNum,
    buildingName: building || name,
    roomName: name,
    floor: floor || "",
    instructions: instructions || "",
    displayName: name,
  };

  selectedPlace = place;

  destination = {
    lat: latNum,
    lng: lngNum,
    name: name,
  };

  selectedRoomInstructions = instructions || "";
  selectedFloor = floor || "";
  selectedBuilding = building || name;

  markersLayer.clearLayers();

  L.marker([latNum, lngNum], { icon: selectedMarkerIcon })
    .addTo(markersLayer)
    .bindPopup(`<b>${name}</b>`)
    .openPopup();

  map.setView([latNum, lngNum], 18);

  showPlaceInfo(place);
}

loadLocationFromUrl();

// SEARCH
input.addEventListener("input", () => {
  let query = input.value.trim();

  if (query.length < 2) {
    suggestionsBox.classList.add("hidden");
    return;
  }

  fetch(`/api/search?q=${query}`)
    .then((res) => res.json())
    .then((data) => {
      if (!data.length) {
        suggestionsBox.innerHTML =
          "<p class='p-2 text-gray-400'>Searching...</p>";
        suggestionsBox.innerHTML = `
          <div class="p-4 text-sm text-gray-500">
            <p class="font-medium text-gray-700">No results found</p>
            <p>Try searching another building, room, or facility name.</p>
          </div>
        `;
        suggestionsBox.classList.remove("hidden");
        return;
      }

      suggestionsBox.innerHTML = "";

      data.forEach((item) => {
        let div = document.createElement("div");
        div.className =
          "p-4 hover:bg-green-50 cursor-pointer border-b transition";
        let title = item.room_name
          ? `${item.room_name} (Room)`
          : `${item.building_name} (Building)`;

        let subtitle = item.room_name
          ? `${item.building_name} • Floor ${item.floor || "N/A"}`
          : `${item.location_type || "location"}${item.has_rooms ? " • Has rooms" : " • No rooms"}`;

        div.innerHTML = `
          <div class="flex items-start gap-3">
            <div class="text-green-600 text-lg">
              ${
                item.room_name
                  ? "🚪"
                  : item.location_type === "gate"
                    ? "🚪"
                    : item.location_type === "parking"
                      ? "🅿️"
                      : item.location_type === "office"
                        ? "🏢"
                        : item.location_type === "facility"
                          ? "📍"
                          : "🏫"
              }
            </div>
            <div>
              <div class="font-semibold text-gray-800">${title}</div>
              <div class="text-sm text-gray-500">${subtitle}</div>
            </div>
          </div>
        `;

        div.addEventListener("click", () => {
          selectLocation(
            item.building_id,
            item.lat,
            item.lng,
            item.building_name,
            item.room_name || "",
            item.floor || "",
            item.instructions || "",
            item.room_id || null,
            item.location_type || "building",
            item.has_rooms ?? true,
          );
        });

        suggestionsBox.appendChild(div);
      });

      suggestionsBox.classList.remove("hidden");
    });
});

// LOG SEARCHES
function logSearch(place) {
  fetch("/api/log-search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      location_name: place.displayName,
      building_id: place.buildingId,
      room_id: place.roomId || null,
    }),
  }).catch((error) => console.warn("Search log failed:", error));
}

// SELECT LOCATION
function selectLocation(
  buildingId,
  lat,
  lng,
  buildingName,
  roomName,
  floor,
  instructions,
  roomId = null,
  locationType = "building",
  hasRooms = true,
) {
  suggestionsBox.classList.add("hidden");

  selectedStartPlace = null;

  if (startModeSelect) startModeSelect.value = "current";
  if (startSearchBox) startSearchBox.classList.add("hidden");
  if (startSearchInput) startSearchInput.value = "";
  if (startSuggestions) startSuggestions.classList.add("hidden");

  const displayName = roomName ? `${roomName} (${buildingName})` : buildingName;

  selectedPlace = {
    buildingId,
    roomId,
    lat,
    lng,
    buildingName,
    roomName,
    floor,
    instructions,
    displayName,
    locationType,
    hasRooms,
  };

  destination = {
    lat,
    lng,
    name: displayName,
  };

  selectedRoomInstructions = instructions;
  selectedFloor = floor;
  selectedBuilding = buildingName;

  markersLayer.clearLayers();

  L.marker([lat, lng], { icon: selectedMarkerIcon })
    .addTo(markersLayer)
    .bindPopup(`<b>${displayName}</b>`)
    .openPopup();

  map.setView([lat, lng], 18);

  showPlaceInfo(selectedPlace);

  saveRecent({
    buildingId,
    roomId,
    name: buildingName,
    lat,
    lng,
    roomName,
    floor,
  });

  logSearch(selectedPlace);
}

// PLACE INFO PANEL
function showPlaceInfo(place) {
  const panel = document.getElementById("placeInfoPanel");
  const title = document.getElementById("placeTitle");
  const type = document.getElementById("placeType");
  const badge = document.getElementById("placeBadge");
  const details = document.getElementById("placeDetails");

  title.textContent = place.roomName ? place.roomName : place.buildingName;

  type.textContent = place.roomName
    ? `Room located in ${place.buildingName}`
    : `${place.locationType || "Campus location"}`;

  badge.textContent = place.roomName
    ? "Room"
    : place.locationType || "Location";
  details.innerHTML = place.roomName
    ? `
        <div class="bg-gray-50 border rounded-xl p-3">
          <p><strong>Building:</strong> ${place.buildingName}</p>
          <p><strong>Floor:</strong> ${place.floor || "N/A"}</p>
        </div>

        <div class="bg-green-50 border border-green-100 rounded-xl p-3">
          <p class="font-semibold text-green-700 mb-1">Room Guidance</p>
          <p>${place.instructions || "No room instructions added yet."}</p>
        </div>
      `
    : `
        <div class="bg-gray-50 border rounded-xl p-3">
          <p><strong>Location:</strong> Technical University of Mombasa</p>
          <p><strong>Type:</strong> ${place.locationType || "Location"}</p>
          <p><strong>Rooms:</strong> ${place.hasRooms ? "Available" : "No rooms added"}</p>
        </div>

        <div class="bg-green-50 border border-green-100 rounded-xl p-3">
          <p>Select Directions to calculate the walking route.</p>
        </div>
      `;

  panel.classList.remove("hidden");
}

function closePlaceInfo() {
  document.getElementById("placeInfoPanel").classList.add("hidden");
}

// DIRECTIONS
function showDirectionsForSelectedPlace() {
  if (!selectedPlace) {
    alert("Please select a destination first.");
    return;
  }

  openDirectionsPanel();

  const routeOptions = document.getElementById("routeOptions");
  const etaBox = document.getElementById("etaBox");

  routeOptions.innerHTML = `
    <div class="p-3 bg-gray-50 border rounded-lg">
      <div class="font-semibold text-gray-700">Calculating best route...</div>
      <div class="text-sm text-gray-500 mt-1">Please wait.</div>
    </div>
  `;

  etaBox.innerText = "Preparing route...";

  const timeout = setTimeout(() => {
    etaBox.innerText = "Route is taking longer than expected.";
  }, 10000);

  if (startModeSelect && startModeSelect.value === "building") {
    if (!selectedStartPlace) {
      if (timeout) clearTimeout(timeout);

      routeOptions.innerHTML = `
        <div class="p-3 bg-yellow-50 border border-yellow-200 rounded-lg text-yellow-700">
          Please choose a valid starting building from the suggestions.
        </div>
      `;

      etaBox.innerText = "Starting point required.";
      return;
    }

    updateUserLocation(selectedStartPlace.lat, selectedStartPlace.lng, 10);

    getRouteSmart(
      selectedStartPlace.lat,
      selectedStartPlace.lng,
      selectedPlace.lat,
      selectedPlace.lng,
      timeout,
    );

    return;
  }

  etaBox.innerText = "Getting your current location...";

  getUserLocation((userLat, userLng) => {
    getRouteSmart(
      userLat,
      userLng,
      selectedPlace.lat,
      selectedPlace.lng,
      timeout,
    );
  });
}

function startNavigationFromInfo() {
  showDirectionsForSelectedPlace();

  setTimeout(() => {
    const btn = document.getElementById("startNavBtn");
    if (btn) btn.click();
  }, 1200);
}

function toggleStartSearch() {
  if (!startModeSelect || !startSearchBox) return;

  selectedStartPlace = null;

  if (startModeSelect.value === "building") {
    startSearchBox.classList.remove("hidden");
    startSearchInput.focus();
  } else {
    startSearchBox.classList.add("hidden");
    startSearchInput.value = "";
    startSuggestions.classList.add("hidden");
  }
}

if (startSearchInput) {
  startSearchInput.addEventListener("input", () => {
    const query = startSearchInput.value.trim();

    selectedStartPlace = null;

    if (query.length < 2) {
      startSuggestions.classList.add("hidden");
      return;
    }

    fetch(`/api/building-search?q=${encodeURIComponent(query)}`)
      .then((res) => res.json())
      .then((data) => {
        if (!data.length) {
          startSuggestions.innerHTML = `
            <div class="p-3 text-sm text-gray-500">
              No building found
            </div>
          `;
          startSuggestions.classList.remove("hidden");
          return;
        }

        startSuggestions.innerHTML = "";

        data.forEach((building) => {
          const div = document.createElement("div");
          div.className = "p-3 hover:bg-green-50 cursor-pointer border-b";

          div.innerHTML = `
            <div class="font-semibold text-gray-800">🏢 ${building.name}</div>
            <div class="text-sm text-gray-500">Use as starting point</div>
          `;

          div.addEventListener("click", () => {
            selectedStartPlace = building;
            startSearchInput.value = building.name;
            startSuggestions.classList.add("hidden");
          });

          startSuggestions.appendChild(div);
        });

        startSuggestions.classList.remove("hidden");
      });
  });
}

// USER LOCATION
function getUserLocation(callback) {
  if (!navigator.geolocation) {
    alert("Geolocation is not supported by this browser.");
    return;
  }

  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;
      const accuracy = pos.coords.accuracy;

      updateUserLocation(lat, lng, accuracy);
      callback(lat, lng, accuracy);
    },
    (error) => {
      if (error.code === error.PERMISSION_DENIED) {
        alert("Location permission was denied. Please allow location access.");
      } else if (error.code === error.POSITION_UNAVAILABLE) {
        alert("Your location is unavailable. Turn on GPS/location services.");
      } else if (error.code === error.TIMEOUT) {
        alert(
          "Location request timed out. Try again outside or with GPS enabled.",
        );
      } else {
        alert("Could not get your location.");
      }
    },
    {
      enableHighAccuracy: true,
      timeout: 20000,
      maximumAge: 0,
    },
  );
}

function centerOnUserLocation() {
  getUserLocation((lat, lng, accuracy) => {
    map.setView([lat, lng], 18);

    alert(`Current location found. Accuracy: ±${Math.round(accuracy)} meters`);
  });
}

// UPDATE USER LOCATION
function updateUserLocation(lat, lng, accuracy) {
  if (userMarker) map.removeLayer(userMarker);
  if (accuracyCircle) map.removeLayer(accuracyCircle);

  userMarker = L.circleMarker([lat, lng], {
    radius: 8,
    color: "#2563eb",
    fillColor: "#3b82f6",
    fillOpacity: 1,
  }).addTo(map);

  accuracyCircle = L.circle([lat, lng], {
    radius: accuracy,
    color: "#3b82f6",
    fillOpacity: 0.1,
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
function getRoute(startLat, startLng, endLat, endLng, timeout = null) {
  let key = `${startLat},${startLng}-${endLat},${endLng}`;

  if (routeCache[key]) {
    if (timeout) clearTimeout(timeout);
    currentRoutes = routeCache[key];
    renderRoutes();
    openDirectionsPanel();
    return;
  }

  fetch(
    `https://router.project-osrm.org/route/v1/foot/${startLng},${startLat};${endLng},${endLat}?steps=true&geometries=geojson&overview=full`,
  )
    .then((res) => res.json())
    .then((data) => {
      if (timeout) clearTimeout(timeout);

      if (!data.routes || !data.routes.length) {
        document.getElementById("routeOptions").innerHTML = `
          <div class="p-3 bg-red-50 border border-red-200 rounded-lg text-red-600">
            No route found. Try again or use direct campus direction.
          </div>
        `;
        return;
      }

      routeCache[key] = data.routes;
      currentRoutes = data.routes;
      renderRoutes();
      openDirectionsPanel();
    })
    .catch(() => {
      if (timeout) clearTimeout(timeout);

      document.getElementById("routeOptions").innerHTML = `
        <div class="p-3 bg-red-50 border border-red-200 rounded-lg text-red-600">
          Could not load route. Please check your internet connection.
        </div>
      `;
    });
}

function getRouteSmart(startLat, startLng, endLat, endLng, timeout = null) {
  const distance = getDistance(startLat, startLng, endLat, endLng);

  routeLayers.forEach((layer) => map.removeLayer(layer));
  routeLayers = [];

  if (distance <= 25) {
    if (timeout) clearTimeout(timeout);
    drawDirectRoute(startLat, startLng, endLat, endLng, distance);
    return;
  }

  if (distance > 1000) {
    if (timeout) clearTimeout(timeout);
    showExternalRouteOption(startLat, startLng, endLat, endLng, distance);
    return;
  }

  getRoute(startLat, startLng, endLat, endLng, timeout);
}

function showExternalRouteOption(startLat, startLng, endLat, endLng, distance) {
  const walkingMinutes = Math.round(distance / WALKING_SPEED / 60);
  const km = (distance / 1000).toFixed(2);

  document.getElementById("routeOptions").innerHTML = `
    <div class="p-3 border rounded-lg bg-green-50">
      <div class="font-semibold">Long-distance route</div>
      <div class="text-sm text-gray-600">${walkingMinutes} min • ${km} km estimated walk</div>
      <p class="text-xs text-gray-500 mt-2">
        This location is far from campus. Open Google Maps for accurate road directions.
      </p>

      <a target="_blank"
         href="https://www.google.com/maps/dir/${startLat},${startLng}/${endLat},${endLng}"
         class="block mt-3 bg-green-600 text-white text-center py-2 rounded-lg">
         Open in Google Maps
      </a>
    </div>
  `;

  document.getElementById("etaBox").innerText =
    `Estimated walking time: ${walkingMinutes} min (${km} km)`;

  openDirectionsPanel();
}

// DISTANCE
function getDistance(lat1, lon1, lat2, lon2) {
  const R = 6371e3;
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);

  return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

// DIRECT ROUTE
function drawDirectRoute(lat1, lng1, lat2, lng2, distance) {
  const layer = L.polyline(
    [
      [lat1, lng1],
      [lat2, lng2],
    ],
    {
      color: "green",
      weight: 5,
      dashArray: "8, 8",
    },
  ).addTo(map);

  routeLayers.push(layer);

  const duration = Math.max(1, Math.round(distance / WALKING_SPEED / 60));
  const km = (distance / 1000).toFixed(2);

  currentRoutes = [
    {
      distance: distance,
      duration: duration * 60,
      geometry: {
        coordinates: [
          [lng1, lat1],
          [lng2, lat2],
        ],
      },
      legs: [
        {
          steps: [],
        },
      ],
    },
  ];

  document.getElementById("routeOptions").innerHTML = `
    <div class="p-3 border rounded-lg bg-green-50">
      <div class="font-semibold">Direct campus route</div>
      <div class="text-sm text-gray-600">${duration} min • ${km} km</div>
    </div>
  `;

  document.getElementById("etaBox").innerText =
    `Walking estimate: ${duration} min (${km} km)`;

  openDirectionsPanel();
  map.fitBounds(layer.getBounds());
}

// RENDER ROUTES
function renderRoutes() {
  routeLayers.forEach((l) => map.removeLayer(l));
  routeLayers = [];

  const optionsDiv = document.getElementById("routeOptions");
  optionsDiv.innerHTML = "";

  currentRoutes.forEach((route, index) => {
    let coords = route.geometry.coordinates.map((c) => [c[1], c[0]]);

    let layer = L.polyline(coords, {
      color: index === 0 ? "green" : "gray",
      weight: 5,
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
    l.setStyle({ color: i === index ? "green" : "gray" });
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
  if (!("speechSynthesis" in window)) {
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

  // RESUME
  if (navigationPaused) {
    navigating = true;
    navigationPaused = false;

    speak("Navigation resumed");
    startLiveTracking();

    this.innerText = "Stop Navigation";
    return;
  }

  // START
  if (!navigating) {
    navigating = true;

    steps = currentRoutes[selectedRouteIndex].legs[0].steps;
    currentStepIndex = 0;
    lastSpokenStep = -1;

    speak(
      `Navigation started to ${destination.name}. Follow the highlighted route.`,
    );
    startLiveTracking();

    this.innerText = "Stop Navigation";
    return;
  }

  // STOP
  stopNavigation();
};

// LIVE TRACKING

function startLiveTracking() {
  if (watchId) navigator.geolocation.clearWatch(watchId);

  watchId = navigator.geolocation.watchPosition(
    (pos) => {
      let [lat, lng] = smoothPosition(
        pos.coords.latitude,
        pos.coords.longitude,
      );

      updateUserLocation(lat, lng, pos.coords.accuracy);

      if (!navigating || !destination || !steps.length) return;

      let userPos = L.latLng(lat, lng);

      // ARRIVAL CHECK
      let dest = L.latLng(destination.lat, destination.lng);
      let distToDest = userPos.distanceTo(dest);

      if (distToDest < arrivalThreshold) {
        speak(`You have arrived at ${destination.name}.`);
        stopNavigation();
        showRoomGuidance();
        return;
      }

      // CURRENT STEP
      let step = steps[currentStepIndex];
      let stepCoords = step.geometry.coordinates;
      let nextPoint = L.latLng(
        stepCoords[stepCoords.length - 1][1],
        stepCoords[stepCoords.length - 1][0],
      );

      let distToStep = userPos.distanceTo(nextPoint);

      // VOICE TRIGGER
      if (step && step.maneuver && currentStepIndex !== lastSpokenStep) {
        const instruction = step.maneuver.instruction || "Continue straight";
        const roundedDistance = Math.round(distToStep);

        if (distToStep <= 80 && Date.now() - lastInstructionTime > 7000) {
          speak(`In ${roundedDistance} meters, ${instruction}`);
          lastInstructionTime = Date.now();
        }

        if (distToStep <= 15) {
          speak(instruction);
          lastSpokenStep = currentStepIndex;
          currentStepIndex++;
        }
      }

      // SMART REROUTE
      let routeLine = routeLayers[selectedRouteIndex];
      let closest = routeLine.getLatLngs().reduce((prev, curr) => {
        return userPos.distanceTo(curr) < userPos.distanceTo(prev)
          ? curr
          : prev;
      });

      let deviation = userPos.distanceTo(closest);

      if (deviation > 50) {
        document.getElementById("rerouteNotice").classList.remove("hidden");

        getRoute(lat, lng, destination.lat, destination.lng);

        setTimeout(() => {
          document.getElementById("rerouteNotice").classList.add("hidden");
        }, 1500);
      }
      let lastRerouteTime = 0;

      if (deviation > 50 && Date.now() - lastRerouteTime > 5000) {
        lastRerouteTime = Date.now();
        getRoute(lat, lng, destination.lat, destination.lng);
      }
    },
    null,
    { enableHighAccuracy: true },
  );
}

function stopNavigation() {
  navigating = false;
  navigationPaused = true;

  //Stop GPS Tracking
  if (watchId) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
  }

  //Stop Voice Assistant
  window.speechSynthesis.cancel();

  document.getElementById("startNavBtn").innerText = "Resume Navigation";
}

function showRoomGuidance() {
  let infoBox = document.getElementById("roomInfo");

  infoBox.innerHTML = `
        <div class="p-4 bg-white border rounded-lg shadow-lg mt-2">

            <h3 class="font-bold text-lg text-green-700">
                📍 You’ve arrived at ${selectedBuilding}
            </h3>

            <div class="mt-3 flex items-center gap-2">
                <span class="px-3 py-1 bg-blue-100 text-blue-700 rounded-full text-sm">
                    Floor ${selectedFloor || "N/A"}
                </span>
            </div>

            <div class="mt-4">
                <p class="font-semibold text-gray-700 mb-2">Next Steps:</p>

                <ol class="list-decimal ml-5 text-sm text-gray-600 space-y-1">
                    <li>Enter the building</li>
                    <li>Proceed to Floor ${selectedFloor || "N/A"}</li>
                    <li>${selectedRoomInstructions || "Follow signage to your room"}</li>
                </ol>
            </div>

            <div class="mt-4 text-xs text-gray-400">
                Tip: Look for signage inside the building for faster navigation
            </div>

        </div>
    `;
}

// RECENTS
function saveRecent(place) {
  const locationName = place.roomName
    ? `${place.roomName} (${place.name})`
    : place.name;

  if (window.IS_LOGGED_IN) {
    fetch("/api/recents", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        building_id: place.buildingId || null,
        room_id: place.roomId || null,
        location_name: locationName,
      }),
    }).catch((error) => console.warn("Recent save failed:", error));

    return;
  }

  let recents = JSON.parse(localStorage.getItem("recentSearches")) || [];

  recents = recents.filter((r) => r.name !== place.name);

  recents.unshift({
    buildingId: place.buildingId || null,
    roomId: place.roomId || null,
    name: place.name,
    lat: place.lat,
    lng: place.lng,
    roomName: place.roomName || "",
    floor: place.floor || "",
  });

  recents = recents.slice(0, 5);

  localStorage.setItem("recentSearches", JSON.stringify(recents));

  renderRecents();
}

function renderRecents() {
  let container = document.getElementById("recentList");

  if (!container) return;

  if (window.IS_LOGGED_IN) {
    fetch("/api/recents")
      .then((res) => res.json())
      .then((recents) => {
        if (!recents.length) {
          container.innerHTML = `
            <p class="text-gray-500 text-sm">No recent locations yet.</p>
          `;
          return;
        }

        container.innerHTML = recents
          .map(
            (r) => `
              <div class="p-2 hover:bg-gray-100 cursor-pointer border-b">
                <div class="font-medium">${r.location_name}</div>
                <div class="text-sm text-gray-500">Recent location</div>
              </div>
            `,
          )
          .join("");
      })
      .catch(() => {
        container.innerHTML = `
          <p class="text-red-500 text-sm">Could not load recents.</p>
        `;
      });

    return;
  }

  let recents = JSON.parse(localStorage.getItem("recentSearches")) || [];

  container.innerHTML = recents
    .map(
      (r) => `
        <div class="p-2 hover:bg-gray-100 cursor-pointer"
            onclick="selectLocation(
                ${r.buildingId},
                ${r.lat},
                ${r.lng},
                '${r.name}',
                '${r.roomName}',
                '${r.floor}',
                ''
            )">
            <div class="font-medium">${r.roomName || r.name}</div>
            <div class="text-sm text-gray-500">
                ${r.roomName ? `Room • Floor ${r.floor || "N/A"}` : "Location"}
            </div>
        </div>
    `,
    )
    .join("");
}

renderRecents();

// RESET
function resetMap() {
  map.setView([-4.0385, 39.668], 16);

  markersLayer.clearLayers();

  routeLayers.forEach((l) => map.removeLayer(l));
  routeLayers = [];

  currentRoutes = [];
  selectedRouteIndex = 0;
  destination = null;

  document.getElementById("routeOptions").innerHTML = "";
  document.getElementById("etaBox").innerText = "";

  closePlaceInfo();
  input.value = "";
  suggestionsBox.classList.add("hidden");

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

const urlParams = new URLSearchParams(window.location.search);

const lat = urlParams.get("lat");
const lng = urlParams.get("lng");
const name = urlParams.get("name");

if (lat && lng) {
  const latNum = parseFloat(lat);
  const lngNum = parseFloat(lng);

  map.setView([latNum, lngNum], 18);

  L.marker([latNum, lngNum])
    .addTo(markersLayer)
    .bindPopup(`<b>${name}</b>`)
    .openPopup();

  selectedPlace = {
    buildingName: name,
    lat: latNum,
    lng: lngNum,
  };

  showPlaceInfo(selectedPlace);
}

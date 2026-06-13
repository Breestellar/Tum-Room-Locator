// Map setup and user location

map = L.map("map").setView([-4.0385, 39.668], 16);
window.map = map;

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: "© OpenStreetMap",
}).addTo(map);

markersLayer = L.layerGroup().addTo(map);

selectedMarkerIcon = L.divIcon({
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
    roomId: null,
    lat: latNum,
    lng: lngNum,
    buildingName: building || name,
    roomName: name,
    floor: floor || "",
    instructions: instructions || "",
    displayName: name,
    locationType: "building",
    hasRooms: true,
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

function smoothPosition(newLat, newLng) {
  if (!lastPosition) {
    lastPosition = [newLat, newLng];
    return lastPosition;
  }

  const alpha = 0.2;

  const lat = lastPosition[0] + alpha * (newLat - lastPosition[0]);
  const lng = lastPosition[1] + alpha * (newLng - lastPosition[1]);

  lastPosition = [lat, lng];
  return lastPosition;
}
loadLocationFromUrl();

// Auto-open building passed from admin "View" link
const preloadEl = document.getElementById("preloadBuilding");
if (preloadEl) {
  const b = {
    lat: parseFloat(preloadEl.dataset.lat),
    lng: parseFloat(preloadEl.dataset.lng),
    name: preloadEl.dataset.name,
    locationType: preloadEl.dataset.type,
    hasRooms: preloadEl.dataset.hasRooms === "1",
  };
}

// Directions, routing, voice, live tracking

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
      clearTimeout(timeout);

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

function getRoute(startLat, startLng, endLat, endLng, timeout = null) {
  const key = `${startLat},${startLng}-${endLat},${endLng}`;

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

  getRoute(startLat, startLng, endLat, endLng, timeout);
}

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
      legs: [{ steps: [] }],
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

function renderRoutes() {
  routeLayers.forEach((layer) => map.removeLayer(layer));
  routeLayers = [];

  const optionsDiv = document.getElementById("routeOptions");
  optionsDiv.innerHTML = "";

  currentRoutes.forEach((route, index) => {
    const coords = route.geometry.coordinates.map((c) => [c[1], c[0]]);

    const layer = L.polyline(coords, {
      color: index === 0 ? "green" : "gray",
      weight: 5,
    }).addTo(map);

    routeLayers.push(layer);

    const duration = Math.round(route.distance / WALKING_SPEED / 60);
    const distance = (route.distance / 1000).toFixed(2);

    const btn = document.createElement("div");
    btn.className = "p-2 border rounded cursor-pointer";

    btn.innerHTML = `
      <div>Route ${index + 1}</div>
      <div class="text-sm">${duration} min • ${distance} km</div>
    `;

    btn.onclick = () => selectRoute(index);
    optionsDiv.appendChild(btn);
  });

  if (routeLayers[0]) {
    map.fitBounds(routeLayers[0].getBounds());
  }

  updateETA(0);
}

function selectRoute(index) {
  selectedRouteIndex = index;

  routeLayers.forEach((layer, i) => {
    layer.setStyle({ color: i === index ? "green" : "gray" });
  });

  updateETA(index);
}

function updateETA(index) {
  const route = currentRoutes[index];

  if (!route) return;

  const duration = Math.round(route.distance / WALKING_SPEED / 60);
  const distance = (route.distance / 1000).toFixed(2);

  document.getElementById("etaBox").innerText =
    `🚶 ${duration} min (${distance} km)`;
}

function speak(text) {
  if (!("speechSynthesis" in window)) {
    console.warn("Speech not supported");
    return;
  }

  window.speechSynthesis.cancel();

  const speech = new SpeechSynthesisUtterance(text);
  speech.lang = "en-US";
  speech.rate = 1;

  window.speechSynthesis.speak(speech);
}

function openDirectionsPanel() {
  document.getElementById("directionsPanel").classList.remove("hidden");
}

function closeDirections() {
  document.getElementById("directionsPanel").classList.add("hidden");
}

const startNavBtn = document.getElementById("startNavBtn");

if (startNavBtn) {
  startNavBtn.onclick = function () {
    if (!currentRoutes.length) return;

    if (navigationPaused) {
      navigating = true;
      navigationPaused = false;

      speak("Navigation resumed");
      startLiveTracking();

      this.innerText = "Stop Navigation";
      return;
    }

    if (!navigating) {
      navigating = true;

      steps = currentRoutes[selectedRouteIndex].legs[0].steps || [];
      currentStepIndex = 0;
      lastSpokenStep = -1;

      speak(
        `Navigation started to ${destination.name}. Follow the highlighted route.`,
      );
      startLiveTracking();

      this.innerText = "Stop Navigation";
      return;
    }

    stopNavigation();
  };
}

function startLiveTracking() {
  if (watchId) navigator.geolocation.clearWatch(watchId);

  watchId = navigator.geolocation.watchPosition(
    (pos) => {
      const [lat, lng] = smoothPosition(
        pos.coords.latitude,
        pos.coords.longitude,
      );

      updateUserLocation(lat, lng, pos.coords.accuracy);

      if (!navigating || !destination) return;

      const userPos = L.latLng(lat, lng);
      const dest = L.latLng(destination.lat, destination.lng);
      const distToDest = userPos.distanceTo(dest);

      if (distToDest < arrivalThreshold) {
        speak(`You have arrived at ${destination.name}.`);
        stopNavigation();
        showRoomGuidance();
        return;
      }

      if (!steps.length) return;

      const step = steps[currentStepIndex];
      if (!step || !step.geometry || !step.geometry.coordinates) return;

      const stepCoords = step.geometry.coordinates;
      const nextPoint = L.latLng(
        stepCoords[stepCoords.length - 1][1],
        stepCoords[stepCoords.length - 1][0],
      );

      const distToStep = userPos.distanceTo(nextPoint);

      if (step.maneuver && currentStepIndex !== lastSpokenStep) {
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
    },
    null,
    { enableHighAccuracy: true },
  );
}

function stopNavigation() {
  navigating = false;
  navigationPaused = true;

  if (watchId) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
  }

  window.speechSynthesis.cancel();

  const btn = document.getElementById("startNavBtn");
  if (btn) btn.innerText = "Resume Navigation";
}

function showRoomGuidance() {
  const infoBox = document.getElementById("roomInfo");

  if (!infoBox) return;

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
    </div>
  `;
}

// Search, suggestions, selected place info

if (input) {
  input.addEventListener("input", () => {
    const query = input.value.trim();

    if (query.length < 2) {
      suggestionsBox.classList.add("hidden");
      return;
    }

    fetch(`/api/search?q=${encodeURIComponent(query)}`)
      .then((res) => res.json())
      .then((data) => {
        if (!data.length) {
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
          const div = document.createElement("div");
          div.className =
            "p-4 hover:bg-green-50 cursor-pointer border-b transition";

          const title = item.room_name
            ? `${item.room_name} (Room)`
            : `${item.building_name} (${item.location_type || "Location"})`;

          const subtitle = item.room_name
            ? `${item.building_name} • Floor ${item.floor || "N/A"}`
            : `${item.location_type || "location"}${
                item.has_rooms ? " • Has rooms" : " • No rooms"
              }`;

          const icon = item.room_name
            ? "🚪"
            : item.location_type === "gate"
              ? "🚪"
              : item.location_type === "parking"
                ? "🅿️"
                : item.location_type === "office"
                  ? "🏢"
                  : item.location_type === "facility"
                    ? "📍"
                    : "🏫";

          div.innerHTML = `
            <div class="flex items-start gap-3">
              <div class="text-green-600 text-lg">${icon}</div>
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
}

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

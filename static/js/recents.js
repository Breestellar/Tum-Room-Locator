// Map recents save/render

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
        lat: place.lat || null,
        lng: place.lng || null,
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
    lat: place.lat || null,
    lng: place.lng,
    roomName: place.roomName || "",
    floor: place.floor || "",
  });

  recents = recents.slice(0, 5);

  localStorage.setItem("recentSearches", JSON.stringify(recents));

  renderRecents();
}

function renderRecents() {
  const container = document.getElementById("recentList");

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

  const recents = JSON.parse(localStorage.getItem("recentSearches")) || [];

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

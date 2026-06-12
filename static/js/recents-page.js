document.addEventListener("DOMContentLoaded", () => {
  const list = document.getElementById("recentList");
  const emptyState = document.getElementById("emptyState");

  if (!list) return;

  fetch("/api/recents")
    .then((res) => res.json())
    .then((recents) => {
      if (!recents.length) {
        emptyState.classList.remove("hidden");
        return;
      }

      list.innerHTML = "";

      recents.forEach((item) => {
        const div = document.createElement("div");
        div.className =
          "p-4 bg-gray-50 border rounded-lg hover:bg-gray-100 transition";

        div.innerHTML = `
          <div class="flex justify-between items-center gap-3">
            <div>
              <h4 class="font-semibold text-gray-800">${item.location_name}</h4>
              <p class="text-sm text-gray-500">
                Recently visited
              </p>
            </div>

            <a href="/map?lat=${item.lat}&lng=${item.lng}&name=${encodeURIComponent(item.location_name)}"
                class="bg-green-600 text-white px-3 py-1 rounded text-sm hover:bg-green-700">
              Open Map
            </a>
          </div>
        `;

        list.appendChild(div);
      });
    })
    .catch(() => {
      list.innerHTML = `
        <p class="text-red-500 text-sm">
          Could not load recent locations.
        </p>
      `;
    });
});

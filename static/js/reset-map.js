// Reset map state

function resetMap() {
  map.setView([-4.0385, 39.668], 16);

  markersLayer.clearLayers();

  routeLayers.forEach((layer) => map.removeLayer(layer));
  routeLayers = [];

  currentRoutes = [];
  selectedRouteIndex = 0;
  destination = null;
  selectedPlace = null;

  const routeOptions = document.getElementById("routeOptions");
  const etaBox = document.getElementById("etaBox");

  if (routeOptions) routeOptions.innerHTML = "";
  if (etaBox) etaBox.innerText = "";

  closePlaceInfo();

  if (input) input.value = "";
  if (suggestionsBox) suggestionsBox.classList.add("hidden");

  closeDirections();

  if (watchId) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
  }

  if (userMarker) map.removeLayer(userMarker);
  if (accuracyCircle) map.removeLayer(accuracyCircle);

  userMarker = null;
  accuracyCircle = null;

  const reroute = document.getElementById("rerouteNotice");
  if (reroute) reroute.classList.add("hidden");
}

// Shared map state

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
let arrivalThreshold = 30;
let selectedStartPlace = null;

let map = null;
let markersLayer = null;
let routeLayers = [];

let userMarker = null;
let accuracyCircle = null;
let watchId = null;
let lastPosition = null;

const WALKING_SPEED = 1.4;

const input = document.getElementById("searchInput");
const suggestionsBox = document.getElementById("suggestions");
const startModeSelect = document.getElementById("startModeSelect");
const startSearchBox = document.getElementById("startSearchBox");
const startSearchInput = document.getElementById("startSearchInput");
const startSuggestions = document.getElementById("startSuggestions");

let selectedMarkerIcon = null;

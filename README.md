Tum Room Locator

Tum Room Locator is a campus navigation system designed to solve a simple but frustrating problem: people know the building they want, but don’t know how to get there efficiently.

Most campus maps only show locations. This project focuses on guiding users in real time — providing step-by-step directions, live tracking, and automatic rerouting when they go off course.

The Problem

Navigating a university campus can be inefficient, especially for new students and visitors.

* New students often get lost moving between buildings
* Visitors struggle to understand the layout
* Existing maps are static and lack interaction
* There is no system that provides real-time, location-aware directions within campus

The Solution

Tum Room Locator provides a navigation experience similar to standard map applications, but tailored for a campus environment.

It enables users to:

* Get real-time walking directions from their current location
* Follow step-by-step navigation instructions
* Receive automatic route updates if they deviate
* Use voice guidance for hands-free navigation

 Key Features

1.  Real-Time Route Navigation - Computes walking routes dynamically based on the user’s current position using a routing engine.

2. Smart Rerouting - Detects when a user moves off the planned path and recalculates a new route automatically.

3. Voice-Guided Navigation - Delivers step-based instructions triggered by proximity using the browser’s speech capabilities.

4. Live GPS Tracking - Tracks user movement in real time with smoothing to reduce sudden jumps in location updates.

5. Admin Map Interface - Allows buildings and locations to be added directly through an interactive map interface.

Tech Stack 

Backend

* Python (Flask)
* RESTful API design
* MySQL database

Frontend

* Vanilla JavaScript
* Leaflet for map rendering
* Tailwind CSS for styling

Routing

* OSRM (Open Source Routing Machine)

Browser APIs

* Geolocation API for live tracking
* Web Speech API for voice instructions

System Design Notes

* Navigation is based on route segments returned by the routing engine
* Instructions are triggered using distance thresholds
* GPS smoothing is applied to improve tracking stability
* Backend endpoints handle building, room, and search queries

Target Users

* New university students
* Campus visitors

 Why This Project Matters

This project focuses on solving a real usability problem rather than just displaying data.

It demonstrates:

* Integration of backend and frontend systems
* Use of external routing services
* Handling of real-time location data
* Practical user experience considerations such as rerouting and voice guidance

Setup Instructions

```bash
git clone https://github.com/Breestellar/Tum-Room-Locator.git
cd Tum-Room-Locator

pip install -r requirements.txt
python app.py
```

Future Improvements

* Indoor navigation support
* Multi-floor routing
* Mobile application version
* Offline navigation support

 Contact

For questions or collaboration, feel free to reach out.

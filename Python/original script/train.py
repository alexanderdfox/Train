from datetime import datetime, timedelta

# Define trains with departure time, speed, distance, number of cars, and car length (m)
trains = [
	{"name": "A", "departure": "08:00", "speed": 80, "distance": 240, "cars": 8, "car_length": 20},
	{"name": "B", "departure": "08:30", "speed": 60, "distance": 240, "cars": 10, "car_length": 25},
	{"name": "C", "departure": "09:00", "speed": 100, "distance": 240, "cars": 6, "car_length": 18},
	{"name": "D", "departure": "09:15", "speed": 90, "distance": 240, "cars": 12, "car_length": 22},
]

# Minimum safe distance in meters between trains outside crossing points
SAFE_DISTANCE = 100  # meters

# Crossing points in km (trains can safely intersect here)
CROSSINGS = [60, 120, 180, 220]

# Convert string departure time to datetime and calculate train lengths
for train in trains:
	train["departure_time"] = datetime.strptime(train["departure"], "%H:%M")
	train["arrival_time"] = train["departure_time"] + timedelta(hours=train["distance"] / train["speed"])
	train["length"] = train["cars"] * train["car_length"] / 1000  # meters to km

# Simulation step: 1 minute
step = timedelta(minutes=1)
current_time = min(train["departure_time"] for train in trains)
end_time = max(train["arrival_time"] for train in trains)

print("Simulating train movements with crossing points...\n")

while current_time <= end_time:
	positions = {}
	for train in trains:
		if current_time >= train["departure_time"] and current_time <= train["arrival_time"]:
			# Distance traveled = speed * time_elapsed
			time_elapsed = (current_time - train["departure_time"]).total_seconds() / 3600
			distance_traveled = train["speed"] * time_elapsed
			positions[train["name"]] = distance_traveled
	
	# Check for collisions
	train_names = list(positions.keys())
	for i in range(len(train_names)):
		for j in range(i + 1, len(train_names)):
			t1, t2 = train_names[i], train_names[j]
			
			# Calculate gap considering train lengths
			gap = abs(positions[t1] - positions[t2]) - (trains[i]["length"] + trains[j]["length"])
			
			# Check if gap is less than SAFE_DISTANCE and not at a crossing
			near_crossing = any(abs(positions[t1] - c) < 0.01 and abs(positions[t2] - c) < 0.01 for c in CROSSINGS)
			if gap * 1000 < SAFE_DISTANCE and not near_crossing:
				print(f"⚠️  WARNING: Trains {t1} and {t2} are too close at {current_time.strftime('%H:%M')} "
					  f"(gap = {gap*1000:.1f} m)")
	
	current_time += step

print("\nSimulation complete.")

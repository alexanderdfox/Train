import geopandas as gpd
from shapely.geometry import LineString
from shapely.ops import unary_union
import svgwrite

# 1️⃣ Load rail network (replace with your shapefile or GeoJSON)
rail_gdf = gpd.read_file("Texas_Railroads_-7795182449699974634.geojson")  # or .shp

# 2️⃣ Merge all lines to a single geometry for intersection calculation
all_lines = unary_union(rail_gdf.geometry)

# 3️⃣ Find intersections (rail-rail crossings)
crossings = []
for i, line1 in enumerate(rail_gdf.geometry):
	for j, line2 in enumerate(rail_gdf.geometry):
		if i >= j:
			continue  # avoid double-checking
		if line1.crosses(line2):
			crossings.append(line1.intersection(line2))

# 4️⃣ Prepare SVG canvas
minx, miny, maxx, maxy = rail_gdf.total_bounds
width, height = 2000, 1200  # adjust as needed
scale_x = width / (maxx - minx)
scale_y = height / (maxy - miny)

dwg = svgwrite.Drawing("rail_crossings.svg", size=(width, height))
def project(pt):
	# simple linear projection
	x, y = pt
	return ((x - minx) * scale_x, height - (y - miny) * scale_y)

# 5️⃣ Draw rail lines
for line in rail_gdf.geometry:
	if isinstance(line, LineString):
		points = [project(pt) for pt in line.coords]
		dwg.add(dwg.polyline(points, stroke="black", fill="none", stroke_width=1))

# 6️⃣ Draw crossing points
for cross in crossings:
	x, y = project((cross.x, cross.y))
	dwg.add(dwg.circle(center=(x, y), r=5, fill="red"))

# 7️⃣ Save SVG
dwg.save()
print(f"SVG saved with {len(crossings)} rail-rail crossings!")

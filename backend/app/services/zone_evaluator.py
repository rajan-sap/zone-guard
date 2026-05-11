import json
from shapely.geometry import Point, Polygon


def point_in_zone(cx: float, cy: float, polygon_points_json: str) -> bool:
    """
    Check if normalized centroid (cx, cy) falls within the zone polygon.
    polygon_points_json: JSON string of [[x1,y1],[x2,y2],...] normalized 0-1
    """
    try:
        points = json.loads(polygon_points_json)
        if len(points) < 3:
            return False
        polygon = Polygon(points)
        return polygon.contains(Point(cx, cy))
    except Exception:
        return False

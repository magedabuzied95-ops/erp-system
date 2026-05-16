const toRadians = (value) => (Number(value) * Math.PI) / 180;

export const haversineDistanceMeters = (lat1, lon1, lat2, lon2) => {
  const fromLat = Number(lat1);
  const fromLon = Number(lon1);
  const toLat = Number(lat2);
  const toLon = Number(lon2);

  if ([fromLat, fromLon, toLat, toLon].some((value) => !Number.isFinite(value))) {
    return Number.NaN;
  }

  const earthRadius = 6371000;
  const deltaLat = toRadians(toLat - fromLat);
  const deltaLon = toRadians(toLon - fromLon);
  const a =
    Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
    Math.cos(toRadians(fromLat)) * Math.cos(toRadians(toLat)) *
      Math.sin(deltaLon / 2) * Math.sin(deltaLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return earthRadius * c;
};

export default haversineDistanceMeters;

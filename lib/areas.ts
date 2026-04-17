export function getHotelArea(city: string, lat: number, lng: number): string {
  if (!lat || !lng || (lat === 0 && lng === 0)) return "";

  if (city === "Mussoorie") {
    if (lat >= 30.472) return "Landour";
    if (lng >= 78.075) return "Happy Valley";
    if (lng <= 78.058) return "Kempty Road";
    if (lat >= 30.455) return "Mall Road";
    return "Library Chowk";
  }

  if (city === "Rishikesh") {
    if (lat >= 30.125) return "Tapovan";
    if (lat >= 30.112 && lng >= 78.31) return "Laxman Jhula";
    if (lat >= 30.100 && lng >= 78.30) return "Ram Jhula";
    if (lat >= 30.093) return "Swarg Ashram";
    return "Main Town";
  }

  if (city === "Shimla") {
    if (lat >= 31.112) return "Jakhu Hill";
    if (lng < 77.155) return "Sanjauli";
    if (lat >= 31.102) return "Mall Road";
    return "Chhota Shimla";
  }

  if (city === "Manali") {
    if (lat >= 32.268) return "Old Manali";
    if (lat >= 32.235) return "Mall Road";
    return "Naggar Road";
  }

  if (city === "Dehradun") {
    if (lat >= 30.335 && lng >= 78.048) return "Rajpur Road";
    if (lat >= 30.318) return "Clock Tower";
    return "Haridwar Road";
  }

  if (city === "Dhanaulti") {
    if (lat >= 30.52) return "Forest Zone";
    return "Main Market";
  }

  return "";
}

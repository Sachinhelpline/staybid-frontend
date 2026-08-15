/**
 * Price Spine Occupancy Calculation (Pure JavaScript)
 *
 * Exported as both CommonJS and ES Module.
 * Used by: app/api/cron/price-spine/route.ts (TypeScript import)
 * Used by: tests/price-spine-occupancy.test.js (Node require)
 */

/**
 * Calculate total occupied rooms for a single date.
 *
 * @param {Array<{ci: number, co: number, numRooms: number}>} windows - Bid occupancy windows
 * @param {number} dateMs - Date in milliseconds (checked as [ci, co) interval)
 * @returns {number} SUM(bid.numRooms) for all bids overlapping the date
 *
 * A bid overlaps [date, date+1) if: bid.checkIn <= date AND date < bid.checkOut
 */
function calculateOccupancyForDate(windows, dateMs) {
  let occupied = 0;
  for (const w of windows) {
    if (w.ci <= dateMs && dateMs < w.co) {
      occupied += w.numRooms;
    }
  }
  return occupied;
}

module.exports = { calculateOccupancyForDate };

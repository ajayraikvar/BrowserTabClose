const assert = require("node:assert/strict");

function isWithinSchedule(site, date) {
  if (!site.fromTime || !site.toTime) return true;
  const currentMinutes = date.getHours() * 60 + date.getMinutes();
  const [fromHours, fromMinutes] = site.fromTime.split(":").map(Number);
  const [toHours, toMinutes] = site.toTime.split(":").map(Number);
  const from = fromHours * 60 + fromMinutes;
  const to = toHours * 60 + toMinutes;
  if (from === to) return true;
  return from < to
    ? currentMinutes >= from && currentMinutes < to
    : currentMinutes >= from || currentMinutes < to;
}

const day = { fromTime: "09:00", toTime: "18:00" };
assert.equal(isWithinSchedule(day, new Date(2026, 7, 29, 9, 0)), true);
assert.equal(isWithinSchedule(day, new Date(2026, 7, 29, 17, 59)), true);
assert.equal(isWithinSchedule(day, new Date(2026, 7, 29, 18, 0)), false);
assert.equal(isWithinSchedule(day, new Date(2026, 7, 29, 8, 59)), false);

const overnight = { fromTime: "23:00", toTime: "07:00" };
assert.equal(isWithinSchedule(overnight, new Date(2026, 7, 29, 23, 0)), true);
assert.equal(isWithinSchedule(overnight, new Date(2026, 7, 30, 2, 0)), true);
assert.equal(isWithinSchedule(overnight, new Date(2026, 7, 30, 6, 59)), true);
assert.equal(isWithinSchedule(overnight, new Date(2026, 7, 30, 7, 0)), false);
assert.equal(isWithinSchedule(overnight, new Date(2026, 7, 29, 22, 59)), false);

console.log("Schedule tests passed");

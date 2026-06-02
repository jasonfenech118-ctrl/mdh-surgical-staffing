// Tests for shift pattern input logic
// Run with: node tests/shift-pattern.test.js

let passed = 0;
let failed = 0;

function assert(description, condition) {
  if (condition) {
    console.log(`  ✓ ${description}`);
    passed++;
  } else {
    console.error(`  ✗ ${description}`);
    failed++;
  }
}

function assertEqual(description, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    console.log(`  ✓ ${description}`);
    passed++;
  } else {
    console.error(`  ✗ ${description}`);
    console.error(`      expected: ${JSON.stringify(expected)}`);
    console.error(`      actual:   ${JSON.stringify(actual)}`);
    failed++;
  }
}

// Inline the functions under test (extracted from index.html)
function parseRosterAssignment(value) {
  if (!value) return { type: null, code: null };
  const clean = String(value).trim().toUpperCase().replace(/\s+/g, "");
  if (!clean) return { type: null, code: null };
  if (/^[AMNRO]+$/.test(clean)) return { type: "pattern", code: clean };
  return { type: null, code: null, invalid: true };
}

function validateShiftPatternInput(raw) {
  const clean = String(raw || "").trim().toUpperCase().replace(/\s+/g, "");
  return /^[AMNRO]+$/.test(clean);
}

const SHIFT_CODE_DEFS = {
  A: { label: "All Day",  start: "07:00", end: "19:00" },
  M: { label: "Morning",  start: "07:00", end: "14:00" },
  N: { label: "Night",    start: "19:00", end: "07:00" },
  R: { label: "Rest",     start: null,    end: null },
  O: { label: "Off",      start: null,    end: null },
};

function shiftPatternForDate(pattern, startDate, targetDate) {
  const start = new Date(startDate);
  const target = new Date(targetDate);
  const diffMs = target - start;
  const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays < 0) return null;
  return pattern[diffDays % pattern.length];
}

// ── parseRosterAssignment ──────────────────────────────────────────────────
console.log("\nparseRosterAssignment:");

assertEqual("empty string → null type",
  parseRosterAssignment(""),
  { type: null, code: null }
);

assertEqual("null → null type",
  parseRosterAssignment(null),
  { type: null, code: null }
);

assertEqual("valid 'AAOO' → pattern type",
  parseRosterAssignment("AAOO"),
  { type: "pattern", code: "AAOO" }
);

assertEqual("lowercase 'aaoo' normalises to uppercase",
  parseRosterAssignment("aaoo"),
  { type: "pattern", code: "AAOO" }
);

assertEqual("all 5 codes 'AMNRO' → valid",
  parseRosterAssignment("AMNRO"),
  { type: "pattern", code: "AMNRO" }
);

assertEqual("single code 'A' → valid",
  parseRosterAssignment("A"),
  { type: "pattern", code: "A" }
);

assertEqual("single code 'N' → valid",
  parseRosterAssignment("N"),
  { type: "pattern", code: "N" }
);

assertEqual("'NNOO' → valid night pattern",
  parseRosterAssignment("NNOO"),
  { type: "pattern", code: "NNOO" }
);

assertEqual("invalid char 'D' → null type + invalid flag",
  parseRosterAssignment("DDO"),
  { type: null, code: null, invalid: true }
);

assertEqual("invalid char 'X' → null type",
  parseRosterAssignment("AAXO"),
  { type: null, code: null, invalid: true }
);

assertEqual("whitespace is trimmed before validation",
  parseRosterAssignment("  AAOO  "),
  { type: "pattern", code: "AAOO" }
);

// ── validateShiftPatternInput ──────────────────────────────────────────────
console.log("\nvalidateShiftPatternInput:");

assert("'AAOO' is valid", validateShiftPatternInput("AAOO"));
assert("'AMNRO' is valid", validateShiftPatternInput("AMNRO"));
assert("'NNNOO' is valid", validateShiftPatternInput("NNNOO"));
assert("'MR' is valid", validateShiftPatternInput("MR"));
assert("empty string is invalid", !validateShiftPatternInput(""));
assert("'DDO' (legacy D code) is invalid", !validateShiftPatternInput("DDO"));
assert("'AAXO' (unknown X) is invalid", !validateShiftPatternInput("AAXO"));
assert("lowercase 'aaoo' is valid (normalised)", validateShiftPatternInput("aaoo"));

// ── SHIFT_CODE_DEFS ────────────────────────────────────────────────────────
console.log("\nShift code definitions:");

assert("A has correct label", SHIFT_CODE_DEFS.A.label === "All Day");
assert("A starts at 07:00", SHIFT_CODE_DEFS.A.start === "07:00");
assert("A ends at 19:00",   SHIFT_CODE_DEFS.A.end   === "19:00");
assert("M has correct label", SHIFT_CODE_DEFS.M.label === "Morning");
assert("M starts at 07:00", SHIFT_CODE_DEFS.M.start === "07:00");
assert("M ends at 14:00",   SHIFT_CODE_DEFS.M.end   === "14:00");
assert("N has correct label", SHIFT_CODE_DEFS.N.label === "Night");
assert("N starts at 19:00", SHIFT_CODE_DEFS.N.start === "19:00");
assert("N ends at 07:00",   SHIFT_CODE_DEFS.N.end   === "07:00");
assert("R has correct label", SHIFT_CODE_DEFS.R.label === "Rest");
assert("R has no start time", SHIFT_CODE_DEFS.R.start === null);
assert("O has correct label", SHIFT_CODE_DEFS.O.label === "Off");
assert("O has no start time", SHIFT_CODE_DEFS.O.start === null);

// ── shiftPatternForDate ────────────────────────────────────────────────────
console.log("\nshiftPatternForDate:");

const pattern = ["A","A","O","O"];
const start = "2026-06-01";

assertEqual("day 0 (start date) → first code 'A'",
  shiftPatternForDate(pattern, start, "2026-06-01"), "A"
);
assertEqual("day 1 → second code 'A'",
  shiftPatternForDate(pattern, start, "2026-06-02"), "A"
);
assertEqual("day 2 → third code 'O'",
  shiftPatternForDate(pattern, start, "2026-06-03"), "O"
);
assertEqual("day 3 → fourth code 'O'",
  shiftPatternForDate(pattern, start, "2026-06-04"), "O"
);
assertEqual("day 4 → wraps to first code 'A'",
  shiftPatternForDate(pattern, start, "2026-06-05"), "A"
);
assertEqual("day 7 → index 3 → 'O'",
  shiftPatternForDate(pattern, start, "2026-06-08"), "O"
);
assertEqual("date before start → null",
  shiftPatternForDate(pattern, start, "2026-05-31"), null
);

// Single-code pattern
const singlePattern = ["R"];
assertEqual("single-code pattern repeats indefinitely",
  shiftPatternForDate(singlePattern, start, "2026-06-30"), "R"
);

// AMNRO pattern
const fivePattern = ["A","M","N","R","O"];
assertEqual("AMNRO day 0 → A", shiftPatternForDate(fivePattern, start, "2026-06-01"), "A");
assertEqual("AMNRO day 1 → M", shiftPatternForDate(fivePattern, start, "2026-06-02"), "M");
assertEqual("AMNRO day 2 → N", shiftPatternForDate(fivePattern, start, "2026-06-03"), "N");
assertEqual("AMNRO day 3 → R", shiftPatternForDate(fivePattern, start, "2026-06-04"), "R");
assertEqual("AMNRO day 4 → O", shiftPatternForDate(fivePattern, start, "2026-06-05"), "O");
assertEqual("AMNRO day 5 → A (wrap)", shiftPatternForDate(fivePattern, start, "2026-06-06"), "A");

// ── rosterAssignmentValueFromStaff ────────────────────────────────────────
console.log("\nrosterAssignmentValueFromStaff (logic parity):");

function rosterAssignmentValueFromStaff(staff) {
  if (staff.roster_pattern_code) return String(staff.roster_pattern_code).toUpperCase();
  const groupCode = staff.roster_code || staff.roster_name || staff.roster_group;
  if (staff.roster_group_template_id || looksLikeMandatoryRoster(groupCode)) return String(groupCode || "").toUpperCase();
  return "";
}

function looksLikeMandatoryRoster(value) {
  const v = String(value || "").toLowerCase().replace(/\s+/g, "").replaceAll("_", "");
  return ["roster1","roster2","roster3","roster4","roster5","r1","r2","r3","r4","r5"].includes(v);
}

assertEqual("staff with roster_pattern_code returns it uppercased",
  rosterAssignmentValueFromStaff({ roster_pattern_code: "aaoo" }), "AAOO"
);
assertEqual("staff with no pattern returns empty string",
  rosterAssignmentValueFromStaff({}), ""
);

// Round-trip: parse the value returned by rosterAssignmentValueFromStaff
const staffValue = rosterAssignmentValueFromStaff({ roster_pattern_code: "AMNR" });
assertEqual("round-trip: rosterAssignmentValueFromStaff → parseRosterAssignment",
  parseRosterAssignment(staffValue),
  { type: "pattern", code: "AMNR" }
);

// ── Summary ────────────────────────────────────────────────────────────────
console.log(`\n${"─".repeat(50)}`);
console.log(`Tests: ${passed + failed}  Passed: ${passed}  Failed: ${failed}`);
if (failed > 0) {
  console.error(`\n${failed} test(s) failed.`);
  process.exit(1);
} else {
  console.log("\nAll tests passed.");
}

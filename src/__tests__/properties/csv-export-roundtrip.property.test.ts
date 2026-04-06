import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { exportAttendanceCsv } from "@/lib/attendance";
import type { AttendanceRecord } from "@/types";

/**
 * Property 5: CSV export round-trip
 *
 * For any set of attendance records, exporting to CSV and parsing the CSV
 * back should produce records with identical field values for: date, person,
 * login time, logout time, total hours, break minutes, and output note.
 *
 * **Validates: Requirements 1.5**
 */

// --- CSV Parser ---

function parseCsv(csv: string): string[][] {
  const rows: string[][] = [];
  let i = 0;
  while (i < csv.length) {
    const fields: string[] = [];
    // Parse one row
    while (i < csv.length && csv[i] !== "\n") {
      if (csv[i] === '"') {
        // Quoted field
        i++; // skip opening quote
        let val = "";
        while (i < csv.length) {
          if (csv[i] === '"') {
            if (i + 1 < csv.length && csv[i + 1] === '"') {
              val += '"';
              i += 2;
            } else {
              i++; // skip closing quote
              break;
            }
          } else {
            val += csv[i];
            i++;
          }
        }
        fields.push(val);
      } else {
        // Unquoted field
        let end = i;
        while (end < csv.length && csv[end] !== "," && csv[end] !== "\n") {
          end++;
        }
        fields.push(csv.slice(i, end));
        i = end;
      }
      if (i < csv.length && csv[i] === ",") {
        i++; // skip comma
        // Trailing comma → empty last field
        if (i >= csv.length || csv[i] === "\n") {
          fields.push("");
        }
      }
    }
    if (i < csv.length && csv[i] === "\n") i++;
    rows.push(fields);
  }
  return rows;
}

// --- Helpers ---

function makeRecord(o: Partial<AttendanceRecord>): AttendanceRecord {
  return {
    userId: "u1", date: "2025-06-15", loginTime: null, logoutTime: null,
    totalHours: 0, breakMinutes: 0, outputNote: null, ...o,
  };
}

function fmtTs(ts: number): string {
  return new Date(ts * 1000).toISOString();
}

// --- Arbitraries (all constants/small enums to avoid memory issues) ---

const recordArb: fc.Arbitrary<AttendanceRecord> = fc.tuple(
  fc.constantFrom("u1", "u2", "u3"),
  fc.constantFrom("2025-01-10", "2025-06-15", "2024-12-01"),
  fc.boolean(),
  fc.integer({ min: 0, max: 1600 }),
  fc.integer({ min: 0, max: 480 }),
  fc.constantFrom(null, "done", "note, with comma", 'has "quotes"', "has\nnewline", 'all ",\n"'),
  fc.integer({ min: 1577836800, max: 1735689600 }),
  fc.integer({ min: 3600, max: 36000 }),
).map(([userId, date, hasSess, hrCents, brk, note, login, offset]) =>
  makeRecord({
    userId, date,
    loginTime: hasSess ? login : null,
    logoutTime: hasSess ? login + offset : null,
    totalHours: hrCents / 100,
    breakMinutes: brk,
    outputNote: note,
  }),
);

const nameArb = fc.constantFrom("Alice", "Bob", 'O"Brien, James', "Smith, Jane");

const HEADER = ["date", "person", "login_time", "logout_time", "total_hours", "break_minutes", "output_note"];

// --- Tests ---

describe("Property 5: CSV export round-trip", () => {
  it("CSV always has a header row with the correct columns", () => {
    fc.assert(
      fc.property(fc.array(recordArb, { maxLength: 3 }), (records) => {
        const rows = parseCsv(exportAttendanceCsv(records));
        expect(rows[0]).toEqual(HEADER);
      }),
      { numRuns: 50 },
    );
  });

  it("number of data rows equals number of input records", () => {
    fc.assert(
      fc.property(fc.array(recordArb, { maxLength: 3 }), (records) => {
        const rows = parseCsv(exportAttendanceCsv(records));
        expect(rows.length - 1).toBe(records.length);
      }),
      { numRuns: 50 },
    );
  });

  it("empty records produce only the header row", () => {
    const rows = parseCsv(exportAttendanceCsv([]));
    expect(rows).toEqual([HEADER]);
  });

  it("each row contains the correct date, person name, and numeric values", () => {
    fc.assert(
      fc.property(
        fc.tuple(recordArb, fc.array(nameArb, { minLength: 3, maxLength: 3 })),
        ([record, names]) => {
          const userNames: Record<string, string> = { u1: names[0], u2: names[1], u3: names[2] };
          const rows = parseCsv(exportAttendanceCsv([record], userNames));
          const row = rows[1];

          expect(row[0]).toBe(record.date);
          expect(row[1]).toBe(userNames[record.userId]);
          expect(row[2]).toBe(record.loginTime !== null ? fmtTs(record.loginTime) : "");
          expect(row[3]).toBe(record.logoutTime !== null ? fmtTs(record.logoutTime) : "");
          expect(row[4]).toBe(record.totalHours.toFixed(2));
          expect(row[5]).toBe(Math.round(record.breakMinutes).toString());
          expect(row[6]).toBe(record.outputNote ?? "");
        },
      ),
      { numRuns: 50 },
    );
  });

  it("CSV escaping works correctly for special characters", () => {
    const specialCases = [
      { note: 'has "quotes"', name: 'O"Brien, James' },
      { note: "has, comma", name: "Smith, Jane" },
      { note: "has\nnewline", name: "Alice" },
      { note: 'all ",\n"', name: 'Tricky "N", Jr.' },
    ];

    for (const { note, name } of specialCases) {
      const record = makeRecord({
        userId: "u1", loginTime: 1736899200, logoutTime: 1736928000,
        totalHours: 8, breakMinutes: 30, outputNote: note,
      });
      const rows = parseCsv(exportAttendanceCsv([record], { u1: name }));
      expect(rows[1][1]).toBe(name);
      expect(rows[1][6]).toBe(note);
    }
  });

  it("round-trip: parse CSV back and verify data matches input records", () => {
    fc.assert(
      fc.property(
        fc.tuple(
          fc.array(recordArb, { minLength: 1, maxLength: 3 }),
          fc.array(nameArb, { minLength: 3, maxLength: 3 }),
        ),
        ([records, names]) => {
          const userNames: Record<string, string> = { u1: names[0], u2: names[1], u3: names[2] };
          const csv = exportAttendanceCsv(records, userNames);
          const rows = parseCsv(csv);

          expect(rows[0]).toEqual(HEADER);

          for (let i = 0; i < records.length; i++) {
            const r = records[i];
            const row = rows[i + 1];

            expect(row[0]).toBe(r.date);
            expect(row[1]).toBe(userNames[r.userId]);
            expect(row[2]).toBe(r.loginTime !== null ? fmtTs(r.loginTime) : "");
            expect(row[3]).toBe(r.logoutTime !== null ? fmtTs(r.logoutTime) : "");
            expect(parseFloat(row[4])).toBeCloseTo(r.totalHours, 2);
            expect(parseInt(row[5], 10)).toBe(Math.round(r.breakMinutes));
            expect(row[6]).toBe(r.outputNote ?? "");
          }
        },
      ),
      { numRuns: 50 },
    );
  });
});

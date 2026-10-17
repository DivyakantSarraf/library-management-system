/**
 * Library Management System - Fine Calculation Test Suite
 * Step 7.5 Verification
 */

const assert = require('assert');
const IssueModel = require('./models/issueModel');

console.log('--- RUNNING FINE CALCULATION TESTS (Step 7.5) ---');

const tests = [
    { due: '2026-10-10', ref: '2026-10-08', expectedDays: 0, expectedFine: 0, label: 'Returned 2 days early' },
    { due: '2026-10-10', ref: '2026-10-10', expectedDays: 0, expectedFine: 0, label: 'Returned on due date' },
    { due: '2026-10-10', ref: '2026-10-11', expectedDays: 1, expectedFine: 5, label: 'Returned 1 day late (₹5/day)' },
    { due: '2026-10-10', ref: '2026-10-15', expectedDays: 5, expectedFine: 25, label: 'Returned 5 days late (₹25)' },
    { due: '2026-09-01', ref: '2026-10-01', expectedDays: 30, expectedFine: 150, label: 'Returned 30 days late across months (₹150)' },
    { due: '2026-10-20', ref: '2026-10-01', expectedDays: 0, expectedFine: 0, label: 'No negative fines on early return' }
];

let passed = 0;
tests.forEach(t => {
    const result = IssueModel.calculateFine(t.due, t.ref);
    const pass = result.lateDays === t.expectedDays && result.fineAmount === t.expectedFine;
    if (pass) {
        passed++;
        console.log(`✓ PASS: ${t.label} -> lateDays: ${result.lateDays}, fine: ₹${result.fineAmount}`);
    } else {
        console.error(`✗ FAIL: ${t.label} -> Got ${JSON.stringify(result)}, expected ${JSON.stringify({ lateDays: t.expectedDays, fineAmount: t.expectedFine })}`);
    }
});

// Test midnight boundaries and Date objects
const d1 = new Date(2026, 9, 10, 23, 59, 59);
const d2 = new Date(2026, 9, 11, 0, 0, 1);
const boundaryResult = IssueModel.calculateFine(d1, d2);
if (boundaryResult.lateDays === 1 && boundaryResult.fineAmount === 5) {
    passed++;
    console.log('✓ PASS: Midnight boundary test (23:59:59 to 00:00:01) -> lateDays: 1, fine: ₹5');
} else {
    console.error('✗ FAIL: Midnight boundary test -> Got', boundaryResult);
}

// Test return-date local formatting
const earlyMorning = new Date(2026, 9, 17, 1, 30, 0);
const localStr = IssueModel.getLocalDateString(earlyMorning);
if (localStr === '2026-10-17') {
    passed++;
    console.log('✓ PASS: getLocalDateString produces local calendar date (2026-10-17) during early morning');
} else {
    console.error('✗ FAIL: getLocalDateString early morning -> Got', localStr);
}

console.log(`\nResults: ${passed} / ${tests.length + 2} tests passed.`);
if (passed !== tests.length + 2) process.exit(1);

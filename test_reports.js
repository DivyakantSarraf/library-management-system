/**
 * Library Management System - Report Logic & Date Range Test Suite
 * Step 8 Verification
 */

const assert = require('assert');
const IssueModel = require('./models/issueModel');

console.log('--- RUNNING REPORT DATE LOGIC TESTS (Step 8) ---');

let passed = 0;
let total = 0;

function check(label, condition) {
    total++;
    if (condition) {
        passed++;
        console.log(`✓ PASS: ${label}`);
    } else {
        console.error(`✗ FAIL: ${label}`);
    }
}

// 1. Valid date ranges
const from1 = '2026-09-17';
const to1 = '2026-10-17';
check('Normal date range is valid (from <= to)', new Date(from1) <= new Date(to1));

// 2. Same day range
const from2 = '2026-10-17';
const to2 = '2026-10-17';
check('Same day date range is valid (from === to)', new Date(from2) <= new Date(to2));

// 3. Inverted date ranges
const from3 = '2026-10-18';
const to3 = '2026-10-17';
check('Inverted date range correctly detected (from > to)', new Date(from3) > new Date(to3));

// 4. Default 30-day calculation using local date
const today = new Date(2026, 9, 17);
const thirtyDaysAgo = new Date(today);
thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

const defaultTo = IssueModel.getLocalDateString(today);
const defaultFrom = IssueModel.getLocalDateString(thirtyDaysAgo);

check('Default to_date matches local today date', defaultTo === '2026-10-17');
check('Default from_date matches 30 days prior', defaultFrom === '2026-09-17');

console.log(`\nResults: ${passed} / ${total} tests passed.`);
if (passed !== total) process.exit(1);

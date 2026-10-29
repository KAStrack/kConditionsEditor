/*
 * no-overlaps.js, for the editor's own kSelect: the same rules, rows and
 * scans, with kSelect on the page standing in for the field select. A script
 * of its own only so that each stays inside the runner's time per script.
 *
 *   node tests/browser/run.js no-overlaps
 */
process.env.KCE_OVERLAPS = 'kselect';
require('./no-overlaps.js');

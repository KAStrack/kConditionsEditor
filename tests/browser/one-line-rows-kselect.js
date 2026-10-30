/*
 * one-line-rows.js, for the editor's own kSelect: the same rows, widths and
 * control modes, with kSelect standing in for the field and value selects.
 * A script of its own only so that each stays inside the runner's time per
 * script.
 *
 *   node tests/browser/run.js one-line-rows
 */
process.env.KCE_ONE_LINE = 'kselect';
require('./one-line-rows.js');

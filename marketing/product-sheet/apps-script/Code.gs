/**
 * Product Metafields sheet - optional "plain values" refresher.
 *
 * Paste this into Extensions > Apps Script of the Google Sheet, run setupDailyTrigger() once
 * (authorise when asked). It then pulls the CSV chunks from the product-sheet-data branch every
 * day at 05:00 IST into a tab called "Products (values)" as plain, editable, sortable values.
 * The IMPORTDATA tab keeps working independently; use whichever you prefer.
 */
const BASE = 'https://raw.githubusercontent.com/preciouscaratsopsteam-code/precious-carat/product-sheet-data/marketing/product-sheet/data/';
const CHUNKS = 8;
const TAB = 'Products (values)';

function refreshProducts() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let rows = [];
  for (let i = 1; i <= CHUNKS; i++) {
    const res = UrlFetchApp.fetch(BASE + 'products-' + i + '.csv?t=' + Date.now(), { muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) throw new Error('chunk ' + i + ': HTTP ' + res.getResponseCode());
    rows = rows.concat(Utilities.parseCsv(res.getContentText('UTF-8')));
  }
  const width = rows[0].length;
  rows = rows.map(r => {
    const out = r.slice(0, width);
    while (out.length < width) out.push('');
    return out.map(v => (typeof v === 'string' && v.startsWith('=')) ? "'" + v : v); // never run cell text as a formula
  });
  const sh = ss.getSheetByName(TAB) || ss.insertSheet(TAB);
  sh.clearContents();
  sh.getRange(1, 1, rows.length, width).setValues(rows);
  sh.setFrozenRows(1);
  sh.getRange('A1').setNote('Refreshed ' + new Date().toISOString() + ' from ' + BASE);
}

function setupDailyTrigger() {
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === 'refreshProducts') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('refreshProducts').timeBased().everyDays(1).atHour(5).inTimezone('Asia/Kolkata').create();
  refreshProducts();
}

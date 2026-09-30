/**
 * Faculty Attendance -> Google Sheet + Google Drive backend.
 * Is script ko usi Google Sheet se open karo: Extensions -> Apps Script.
 */

// >>> Isko apna khud ka lamba random text bana ke badlo. Netlify me APPS_SCRIPT_SECRET me bhi yahi daalna hai.
const SECRET = 'CHANGE_ME_TO_A_LONG_RANDOM_SECRET';

const SHEET_NAME = 'Attendance';
const PHOTO_FOLDER_NAME = 'Faculty Attendance Photos';
const HEADERS = [
  'Client UUID', 'Faculty', 'Campus', 'Batch', 'Class', 'Subject',
  'Check-in Time', 'Photo Time', 'Sync Time', 'Photo URL', 'Photo File ID',
];

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    if (body.secret !== SECRET) return out_({ error: 'unauthorized' });
    if (body.action === 'add') return out_(addRecord_(body));
    if (body.action === 'list') return out_({ rows: listRecords_() });
    return out_({ error: 'unknown_action' });
  } catch (err) {
    return out_({ error: 'server_error', message: String(err) });
  }
}

function out_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function getSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.appendRow(HEADERS);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, HEADERS.length).setFontWeight('bold');
  }
  // Time columns ko plain text rakho taaki Sheets unhe auto-convert na kare
  sheet.getRange('A:A').setNumberFormat('@');
  sheet.getRange('G:I').setNumberFormat('@');
  return sheet;
}

function getFolder_() {
  const props = PropertiesService.getScriptProperties();
  const savedId = props.getProperty('PHOTO_FOLDER_ID');
  if (savedId) {
    try { return DriveApp.getFolderById(savedId); } catch (err) { /* recreate below */ }
  }
  const it = DriveApp.getFoldersByName(PHOTO_FOLDER_NAME);
  const folder = it.hasNext() ? it.next() : DriveApp.createFolder(PHOTO_FOLDER_NAME);
  props.setProperty('PHOTO_FOLDER_ID', folder.getId());
  return folder;
}

function addRecord_(b) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const sheet = getSheet_();

    // Duplicate check (same clientUuid dobara sync ho to naya row nahi banega)
    const last = sheet.getLastRow();
    if (last > 1) {
      const found = sheet.getRange(2, 1, last - 1, 1)
        .createTextFinder(b.clientUuid).matchEntireCell(true).findNext();
      if (found) {
        return { ok: true, id: b.clientUuid, syncTime: String(sheet.getRange(found.getRow(), 9).getValue()), alreadySynced: true };
      }
    }

    const blob = Utilities.newBlob(Utilities.base64Decode(b.photoBase64), b.contentType || 'image/jpeg', b.clientUuid + '.jpg');
    const file = getFolder_().createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    const fileId = file.getId();
    const photoUrl = 'https://drive.google.com/thumbnail?id=' + fileId + '&sz=w400';

    const syncTime = new Date().toISOString();
    sheet.appendRow([
      b.clientUuid, b.facultyName, b.campus || '', b.batch || '', b.className || '', b.subject || '',
      b.checkinTime, b.photoCaptureTime, syncTime, photoUrl, fileId,
    ]);
    return { ok: true, id: b.clientUuid, syncTime: syncTime };
  } finally {
    lock.releaseLock();
  }
}

function listRecords_() {
  const sheet = getSheet_();
  const values = sheet.getDataRange().getValues();
  const rows = [];
  for (let i = 1; i < values.length; i++) {
    const r = values[i];
    if (!r[0]) continue;
    rows.push({
      id: String(r[0]),
      facultyName: String(r[1]),
      campus: String(r[2]),
      batch: String(r[3]),
      className: String(r[4]),
      subject: String(r[5]),
      checkinTime: String(r[6]),
      photoCaptureTime: String(r[7]),
      syncTime: String(r[8]),
      photoUrl: String(r[9]),
    });
  }
  return rows;
}

// Sirf ek baar editor me run karo (Run -> authorizeOnce) taaki Sheet + Drive ki permission mil jaye.
function authorizeOnce() {
  getSheet_();
  getFolder_();
}

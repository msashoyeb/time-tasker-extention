/*
 * zip.js — tiny, dependency-free ZIP writer + minimal XLSX builder.
 *
 * Produces a genuine, Excel-openable .xlsx (which is just a ZIP of XML parts).
 * Entries are STORED (uncompressed) with a correct CRC32, so no compression
 * library is required. This keeps the extension CSP-safe (Manifest V3 blocks
 * remote scripts) while still emitting real spreadsheet files.
 *
 * Exposes:
 *   window.TTExport.xlsxBytes(headers, rows) -> Uint8Array  (.xlsx file bytes)
 */
(function () {
  "use strict";

  const enc = new TextEncoder();

  // --- CRC32 --------------------------------------------------------------
  const crcTable = (function () {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) {
        c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      }
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(bytes) {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) {
      c = crcTable[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    }
    return (c ^ 0xffffffff) >>> 0;
  }

  // --- ZIP writer (store method) -----------------------------------------
  // files: [{ name: string, data: string | Uint8Array }]
  function zip(files) {
    const chunks = [];
    const centrals = [];
    let offset = 0;

    files.forEach(function (f) {
      const nameBytes = enc.encode(f.name);
      const data = typeof f.data === "string" ? enc.encode(f.data) : f.data;
      const crc = crc32(data);

      // Local file header
      const local = new Uint8Array(30 + nameBytes.length);
      const dv = new DataView(local.buffer);
      dv.setUint32(0, 0x04034b50, true); // signature
      dv.setUint16(4, 20, true); // version needed
      dv.setUint16(6, 0, true); // flags
      dv.setUint16(8, 0, true); // compression = store
      dv.setUint16(10, 0, true); // mod time
      dv.setUint16(12, 0, true); // mod date
      dv.setUint32(14, crc, true);
      dv.setUint32(18, data.length, true); // compressed size
      dv.setUint32(22, data.length, true); // uncompressed size
      dv.setUint16(26, nameBytes.length, true);
      dv.setUint16(28, 0, true); // extra length
      local.set(nameBytes, 30);
      chunks.push(local, data);

      // Central directory header
      const central = new Uint8Array(46 + nameBytes.length);
      const cv = new DataView(central.buffer);
      cv.setUint32(0, 0x02014b50, true);
      cv.setUint16(4, 20, true); // version made by
      cv.setUint16(6, 20, true); // version needed
      cv.setUint16(8, 0, true);
      cv.setUint16(10, 0, true);
      cv.setUint16(12, 0, true);
      cv.setUint16(14, 0, true);
      cv.setUint32(16, crc, true);
      cv.setUint32(20, data.length, true);
      cv.setUint32(24, data.length, true);
      cv.setUint16(28, nameBytes.length, true);
      cv.setUint16(30, 0, true);
      cv.setUint16(32, 0, true);
      cv.setUint16(34, 0, true);
      cv.setUint16(36, 0, true);
      cv.setUint32(38, 0, true);
      cv.setUint32(42, offset, true); // local header offset
      central.set(nameBytes, 46);
      centrals.push(central);

      offset += local.length + data.length;
    });

    const centralOffset = offset;
    let centralSize = 0;
    centrals.forEach(function (c) {
      chunks.push(c);
      centralSize += c.length;
    });

    // End of central directory
    const end = new Uint8Array(22);
    const ev = new DataView(end.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(4, 0, true);
    ev.setUint16(6, 0, true);
    ev.setUint16(8, files.length, true);
    ev.setUint16(10, files.length, true);
    ev.setUint32(12, centralSize, true);
    ev.setUint32(16, centralOffset, true);
    ev.setUint16(20, 0, true);
    chunks.push(end);

    let total = 0;
    chunks.forEach(function (c) { total += c.length; });
    const out = new Uint8Array(total);
    let p = 0;
    chunks.forEach(function (c) { out.set(c, p); p += c.length; });
    return out;
  }

  // --- XLSX builder -------------------------------------------------------
  function xmlEsc(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function colLetter(index) {
    let s = "";
    let n = index;
    do {
      s = String.fromCharCode(65 + (n % 26)) + s;
      n = Math.floor(n / 26) - 1;
    } while (n >= 0);
    return s;
  }

  function sheetXml(rows) {
    let body = "";
    rows.forEach(function (row, ri) {
      body += '<row r="' + (ri + 1) + '">';
      row.forEach(function (cell, ci) {
        const ref = colLetter(ci) + (ri + 1);
        body +=
          '<c r="' + ref + '" t="inlineStr"><is><t xml:space="preserve">' +
          xmlEsc(cell) +
          "</t></is></c>";
      });
      body += "</row>";
    });
    return (
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      "<sheetData>" + body + "</sheetData></worksheet>"
    );
  }

  function xlsxBytes(headers, rows) {
    const allRows = [headers].concat(rows);

    const contentTypes =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
      "</Types>";

    const rootRels =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
      "</Relationships>";

    const workbook =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
      'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      '<sheets><sheet name="Sessions" sheetId="1" r:id="rId1"/></sheets></workbook>';

    const workbookRels =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
      "</Relationships>";

    return zip([
      { name: "[Content_Types].xml", data: contentTypes },
      { name: "_rels/.rels", data: rootRels },
      { name: "xl/workbook.xml", data: workbook },
      { name: "xl/_rels/workbook.xml.rels", data: workbookRels },
      { name: "xl/worksheets/sheet1.xml", data: sheetXml(allRows) },
    ]);
  }

  window.TTExport = { xlsxBytes: xlsxBytes, zip: zip };
})();

// Fast CSV reader that reproduces csv-reader 1.0.0's answers exactly.
//
// Strategy: most records are plain (no quote, no stray CR on the line), so a
// record-level fast path finds the line end with indexOf, checks the line for
// '"' / '\r' via two monotonically cached indexOf cursors, and splits the
// line on ','. Records that contain a quote or a CR go through a full
// field-by-field scanner that implements the reference semantics: quoted
// fields with "" escapes and CR/CRLF folded to LF, junk after a closing
// quote, stray CRs dropped with an error, and unterminated quotes re-read
// as unquoted text starting from a literal '"'.

export function run(input) {
  const s = String(input.text);
  const header = input.header === true;
  const n = s.length;

  const errors = [];
  const rows = [];
  let columns = header ? [] : null;
  let haveFirst = false;
  let width = 0;

  let pos = 0;
  if (n > 0 && s.charCodeAt(0) === 0xfeff) pos = 1;
  let line = 1;

  // First '"' / '\r' at or after the last refresh point; -1 means none left.
  let nq = s.indexOf('"', pos);
  let nr = s.indexOf('\r', pos);

  function emitRecord(fields, startLine) {
    if (!haveFirst) {
      haveFirst = true;
      width = fields.length;
      if (header) columns = fields;
      else rows.push(fields);
      return;
    }
    const rowIdx = rows.length;
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: startLine, row: rowIdx, fields: fields.length });
      for (let k = fields.length; k < width; k++) fields.push('');
    } else if (fields.length > width) {
      const extra = fields.slice(width);
      fields.length = width;
      errors.push({ code: 'long_row', line: startLine, row: rowIdx, extra });
    }
    rows.push(fields);
  }

  // Fast-path emit: the overwhelmingly common record already has exactly
  // `width` fields and just joins rows; only the first record and ragged
  // records need the full emitRecord treatment.
  function emitFast(fields, startLine) {
    if (!haveFirst) {
      emitRecord(fields, startLine);
      return;
    }
    if (fields.length === width) {
      rows.push(fields);
      return;
    }
    emitRecord(fields, startLine);
  }

  // Scan one unquoted field starting at p. `parts` is null for a plain field
  // or an array of leading chunks (a '"' prefix, or a quoted value that junk
  // is appended to). Returns [value, term, next] with term 0=EOF, 1=comma,
  // 2=line break. Stray CRs are dropped and reported as they are met.
  function scanUnquoted(p, parts, errLine, errRow) {
    let segStart = p;
    let j = p;
    for (;;) {
      let k = j;
      while (k < n) {
        const c = s.charCodeAt(k);
        if (c === 44 || c === 10 || c === 13) break;
        k++;
      }
      if (k >= n) {
        const v = parts === null ? s.slice(segStart, n) : (parts.push(s.slice(segStart, n)), parts.join(''));
        return [v, 0, n];
      }
      const c = s.charCodeAt(k);
      if (c === 44) {
        const v = parts === null ? s.slice(segStart, k) : (parts.push(s.slice(segStart, k)), parts.join(''));
        return [v, 1, k + 1];
      }
      if (c === 10) {
        const v = parts === null ? s.slice(segStart, k) : (parts.push(s.slice(segStart, k)), parts.join(''));
        return [v, 2, k + 1];
      }
      if (s.charCodeAt(k + 1) === 10) {
        const v = parts === null ? s.slice(segStart, k) : (parts.push(s.slice(segStart, k)), parts.join(''));
        return [v, 2, k + 2];
      }
      // Lone CR outside quotes: dropped, one stray_cr error, field goes on.
      errors.push({ code: 'stray_cr', line: errLine, row: errRow });
      if (parts === null) parts = [];
      parts.push(s.slice(segStart, k));
      segStart = k + 1;
      j = k + 1;
    }
  }

  while (pos < n) {
    const startLine = line;
    if (nq !== -1 && nq < pos) nq = s.indexOf('"', pos);
    if (nr !== -1 && nr < pos) nr = s.indexOf('\r', pos);

    let lineEnd = s.indexOf('\n', pos);
    const hasLF = lineEnd !== -1;
    if (!hasLF) lineEnd = n;

    const quoteInLine = nq !== -1 && nq < lineEnd;
    const crInLine = nr !== -1 && nr < lineEnd && !(hasLF && nr === lineEnd - 1);

    if (!quoteInLine && !crInLine) {
      // Fast path: the whole record is this one line, split on commas.
      const contentEnd = hasLF && nr !== -1 && nr === lineEnd - 1 ? lineEnd - 1 : lineEnd;
      if (contentEnd === pos) {
        // Blank line: no record, but the line still counts.
        pos = hasLF ? lineEnd + 1 : n;
        if (hasLF) line++;
        continue;
      }
      const fields = s.slice(pos, contentEnd).split(',');
      pos = hasLF ? lineEnd + 1 : n;
      if (hasLF) line++;
      emitFast(fields, startLine);
      continue;
    }

    // Slow path: parse the record field by field from pos.
    const rowIdx = header && !haveFirst ? null : rows.length;
    const fields = [];
    let firstQuoted = false;
    let p = pos;

    for (;;) {
      let value;
      let quoted = false;
      let term;
      let nextP;

      if (p < n && s.charCodeAt(p) === 34) {
        // Field opens with a quote: look for its closing quote.
        let parts = null;
        let segStart = p + 1;
        let j = p + 1;
        let closedAt = -1;
        let val = '';
        for (;;) {
          const q = s.indexOf('"', j);
          const r = s.indexOf('\r', j);
          if (r !== -1 && (q === -1 || r < q)) {
            // CR inside quotes folds to one LF (CRLF counts once).
            if (parts === null) parts = [];
            parts.push(s.slice(segStart, r), '\n');
            j = s.charCodeAt(r + 1) === 10 ? r + 2 : r + 1;
            segStart = j;
            continue;
          }
          if (q === -1) break;
          if (s.charCodeAt(q + 1) === 34) {
            if (parts === null) parts = [];
            parts.push(s.slice(segStart, q), '"');
            segStart = q + 2;
            j = q + 2;
            continue;
          }
          closedAt = q;
          val = parts === null ? s.slice(segStart, q) : (parts.push(s.slice(segStart, q)), parts.join(''));
          break;
        }

        if (closedAt === -1) {
          // Never closes: the quote is literal and the rest of the field is
          // re-read as unquoted text. Line was not advanced while scanning,
          // so it is still the line at the opening quote.
          errors.push({ code: 'unterminated_quote', line: startLine, row: rowIdx });
          const res = scanUnquoted(p + 1, ['"'], startLine, rowIdx);
          value = res[0];
          term = res[1];
          nextP = res[2];
        } else {
          quoted = true;
          value = val;
          // Every line break inside the quotes became one '\n' in val.
          let li = val.indexOf('\n');
          if (li !== -1) {
            let cnt = 0;
            while (li !== -1) {
              cnt++;
              li = val.indexOf('\n', li + 1);
            }
            line += cnt;
          }
          p = closedAt + 1;
          if (p >= n) {
            term = 0;
            nextP = n;
          } else {
            const c = s.charCodeAt(p);
            if (c === 44) {
              term = 1;
              nextP = p + 1;
            } else if (c === 10) {
              term = 2;
              nextP = p + 1;
            } else if (c === 13 && s.charCodeAt(p + 1) === 10) {
              term = 2;
              nextP = p + 2;
            } else {
              // Junk after the closing quote: appended as unquoted text.
              const before = value.length;
              const res = scanUnquoted(p, [value], startLine, rowIdx);
              value = res[0];
              term = res[1];
              nextP = res[2];
              if (value.length > before) {
                errors.push({ code: 'quote_junk', line: startLine, row: rowIdx });
              }
            }
          }
        }
      } else {
        const res = scanUnquoted(p, null, startLine, rowIdx);
        value = res[0];
        term = res[1];
        nextP = res[2];
      }

      if (fields.length === 0) firstQuoted = quoted;
      fields.push(value);
      p = nextP;
      if (term === 1) continue;
      if (term === 2) line++;
      break;
    }

    pos = p;
    // A record that is a single empty unquoted field is not a record.
    if (!(fields.length === 1 && fields[0] === '' && !firstQuoted)) {
      emitRecord(fields, startLine);
    }
  }

  return { columns, rows, errors };
}

[![csv-reader-speed-01-run-20261121 on make.fun](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/nguyentran113/csv-reader-speed-01/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/nguyentran113/csv-reader-speed-01/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)

# csv-reader-speed-01

A fast drop-in replacement for csv-reader 1.0.0: `solve.js` exports
`run(input)`, which reads `{text, header}` and returns exactly the
`{columns, rows, errors}` value csv-reader returns, broken rows and all —
stray CRs, junk after closing quotes, unterminated quotes re-read as
unquoted text, and short/long rows padded or cut to the first record's
width, each with its error in encounter order.

Most records in practice contain no quote and no stray CR, so the parser
takes a record-level fast path: it locates the line end with `indexOf`,
confirms the line is plain using two monotonically advancing `indexOf`
cursors for `"` and `\r` (so the checks stay linear over the whole file),
and splits the line on commas. Only records that actually contain a quote
or a CR fall back to a field-by-field scanner that handles quoted fields,
`""` escapes, CR/CRLF folding inside quotes, quote junk, and unterminated
quotes. Field text is taken with `slice`, and error objects are only
allocated when an error really occurs.

`main.ts` is the harness driver: it disables V8 incremental marking,
reads `/input/cases.json` (overridable with `MAKEFUN_INPUT_DIR`), runs
each case, and writes the answers array to `/output/answers.json`
(`MAKEFUN_OUTPUT_DIR`).

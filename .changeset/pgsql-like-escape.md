---
'@ez4/pgsql': patch
---

Match the text given to `contains` and `startsWith` literally, with or without `insensitive`: `%`, `_` and `\` in it no longer work as LIKE wildcards or escapes, so `contains: 'a_b'` stops matching `axb` and `startsWith: '50%'` stops matching `500 units`. The rendered condition now ends with `ESCAPE '\'`. A raw value or a column reference still goes into the pattern as written, and `contains` on an array or object column is unchanged.

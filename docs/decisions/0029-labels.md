# 0029 Barcode labels and scanner test

- Each label encodes the item's stored `barcode` (the item ID, `CODE128_INTERNAL`) with `jsbarcode` as an SVG, plus the readable ID, name and base unit. These are internal labels, not UPC/GTIN claims.
- The print stylesheet hides navigation, controls and (on the label sheet) the app header, prints 4 labels across and never splits a label between pages.
- The scanner test field accepts keyboard-wedge input (the code followed by Enter), matches it case-insensitively, and names the item; ingredient codes are marked "not sellable at the POS", consistent with the POS rule.

# 0010 Receiving in packs or in verified units

- Each receipt line gives **either** a number of packs **or** a quantity plus a unit.
- **Packs:** base quantity = packs × the pack size snapshotted on the PO line. The `pack_conversions_verified` gate must be confirmed for that supplier item.
- **Quantity + unit:** goes through `private.convert_to_base`. Same-dimension physical conversions (kg→g) are allowed; anything else needs an item-specific verified conversion (ADR 0002, AC04). Pack equivalents are still recorded, so PO progress stays comparable.
- **Cost:** the actual net unit cost is the actual pack cost (or the PO's snapshotted pack cost) ÷ pack size, rounded to 8 decimals. It is snapshotted on the receipt line and fed into the weighted average (D11).
- **Two passes.** Receipts are immutable, so a receipt validates and costs every line, and detects over-receipt, *before* it writes anything.
- **Packing slips:** unique per supplier after trim/case normalization. A new request key cannot re-post the same slip.

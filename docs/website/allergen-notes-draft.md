# Allergen notes: DRAFT for owner review

**Status: draft, not approved. Not for publication.** Every website item shows "Allergen information: please ask staff" until the owner approves its note (`web_menu_content.allergen_reviewed_by/at`, BUILD_PLAN §3).

**How this was drafted (2026-11-26).** Notes cover **dairy, nuts and wheat**, as requested. They were derived automatically from the **ingredient names** in the ERP recipes (`data/source/source_master_data.json`, version-1 BOM). Ingredient names don't show what is inside packaged products, so each "verify" line needs the real product label. Kitchen cross-contact (shared fryer, surfaces, utensils) is not covered by recipe data.

Key: **Contains** = an ingredient named in the recipe is, or normally contains, the allergen. **Verify** = possible depending on the brand; check the label. **Not in recipe** = no recipe ingredient suggests it.

---

## FG-001 Brazilian Chicken Strogonoff

| Allergen | Draft | From |
|---|---|---|
| Dairy | **Contains** | ING-018 Heavy cream |
| Wheat | Verify | ING-011 Shoestring potatoes (batata palha): some brands are fried in shared facilities. ING-016 Ketchup and ING-017 Mustard are normally wheat-free. |
| Nuts | Not in recipe | Verify ING-029 Vegetable oil is not a peanut or tree-nut oil |

Draft customer note: *Contains dairy (cream). No wheat or nut ingredients in the recipe. Shoestring potatoes and oil: ask staff.*

## FG-002 Tacos al Pastor (3 tacos)

| Allergen | Draft | From |
|---|---|---|
| Dairy | Not in recipe | — |
| Wheat | Verify | ING-012 Corn tortillas (some blends add wheat flour); ING-031 Achiote paste (some brands contain flour) |
| Nuts | Not in recipe | Verify ING-029 Vegetable oil |

Draft customer note: *No dairy, wheat or nut ingredients in the recipe. Tortilla and achiote-paste brands vary: ask staff if you avoid wheat.*

## FG-003 Korean Fried Chicken with Rice

| Allergen | Draft | From |
|---|---|---|
| Dairy | Not in recipe | — |
| Wheat | **Contains** | ING-028 All-purpose flour; ING-024 Soy sauce (traditionally brewed with wheat); ING-023 Gochujang (commonly contains wheat or barley) |
| Nuts | Not in recipe | Verify ING-029 Vegetable oil (30 ml, used for frying) |

Draft customer note: *Contains wheat (flour, soy sauce, gochujang). No dairy or nut ingredients in the recipe.*

**Outside the three requested allergens, but worth showing:** this dish also contains **sesame** (ING-037) and **soy** (ING-024 soy sauce). Both are major U.S. food allergens. Recommend adding them to the note.

## FG-004 Beef Bourguignon with Potatoes

| Allergen | Draft | From |
|---|---|---|
| Dairy | **Contains** | ING-022 Butter |
| Wheat | **Contains** | ING-028 All-purpose flour. Also verify ING-020 Beef broth (some contain wheat). |
| Nuts | Not in recipe | Verify ING-029 Vegetable oil |

Draft customer note: *Contains dairy (butter) and wheat (flour). No nut ingredients in the recipe. Made with red grape juice, no wine.*

## FG-005 Mongolian Khorkhog

| Allergen | Draft | From |
|---|---|---|
| Dairy | Not in recipe | — |
| Wheat | Not in recipe | — |
| Nuts | Not in recipe | — |

Draft customer note: *No dairy, wheat or nut ingredients in the recipe (lamb, potatoes, carrots, onion, garlic, salt, pepper).*

## RET-001 / RET-002 retail sauces (demo only)

These are synthetic demo products with no ingredient list. **No allergen note can be drafted.** Show "Allergen information: see the bottle label or ask staff". Real pilot sauces need their label allergens entered.

---

## Owner checklist
- [ ] Check the label for each **Verify** ingredient and change it to Contains or Not in recipe.
- [ ] Confirm which oil is used (ING-029) and whether the fryer is shared with flour-coated items.
- [ ] Decide whether to add sesame and soy (FG-003), and a general cross-contact statement such as *"Our kitchen handles dairy, wheat, soy and sesame; we can't guarantee any dish is allergen-free."*
- [ ] Approve each note in Settings → Website (built in W4). Approval records who and when.

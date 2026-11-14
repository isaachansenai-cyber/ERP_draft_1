# 0024 Forecast method, history range and same-day netting

- The history window counts only open days (D9) between the location's **first** completed sale and the day before the as-of date. Days before a location started operating are not zero-sales days; without any prior sale the method is `manager_required` and nothing is assumed.
- For the demo history source, the window also stops at the last date of the synthetic history, so days after it are not counted as zero sales. That source is refused in the pilot.
- Method: the same-weekday mean over the previous 8 complete weeks when at least 2 instances exist; otherwise the trailing 28-day mean over observed open days. Each value reports its method, observations and window.
- Manager overrides are append-only rows; the latest one for a location, item and date wins. Overrides are allowed from today to 60 days ahead.
- Netting happens on the current business date only (orders are same-day). The residual forecast = forecast − fulfilled − in preparation − accepted. Those orders' ingredients are already consumed or reserved, so the ingredient projection never counts them twice. Refunds do not reduce demand; cancelled orders are excluded.
- Retail units are forecast per item and require themselves; they never pass through a dish recipe.

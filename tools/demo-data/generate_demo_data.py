from pathlib import Path
from decimal import Decimal, ROUND_HALF_UP
from datetime import date, timedelta
import json, csv, random, math
from collections import defaultdict, Counter
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment
from openpyxl.utils import get_column_letter

ROOT=Path(__file__).resolve().parents[1]
DATA=ROOT/'data'
src=json.loads((DATA/'source_master_data.json').read_text())
D=lambda x: Decimal(str(x))
def money(x): return int((D(x)*100).quantize(D(1),rounding=ROUND_HALF_UP))
def rounded(x,n=6): return float(D(x).quantize(D(10)**-n,rounding=ROUND_HALF_UP))
# Synthetic packs and prices, not supplier quotations. Base units match the supplied catalog.
pack_data=[(10000,52),(10000,42),(10000,95),(5000,78),(10000,16),(1000,6),(10000,14),(20000,22),(2500,17.5),(20000,28),(1000,12),(200,18),(5000,14),(500,3.5),(100,20),(3000,7.5),(3000,6),(4000,22),(3000,9),(12000,18),(6000,15),(2000,13),(3000,19.5),(6000,12),(5000,32.5),(4000,5),(5000,9),(25000,24),(20000,32),(1000,14),(1000,9),(500,4.5),(1000,8),(1000,12),(10000,14),(10000,12),(1000,7),(1000,4),(250,5),(500,6)]
prices={'FG-001':1599,'FG-002':1399,'FG-003':1549,'FG-004':1999,'FG-005':2299}
items=[]
for x in src['items']:
 r=dict(x)
 r['barcode']=r['item_id']
 r['barcode_type']='CODE128_INTERNAL'
 r['is_sellable']=r['item_type']=='finished_dish'
 r['value_provenance']={'name_units_ids_recipes':'uploaded source','barcode':'demo internal code generated from source ID','cost_price_pack_settings':'synthetic_demo_assumption','lead_times':'source_estimate_not_supplier_quote'}
 if r['item_type']=='ingredient':
  qty,price=pack_data[int(r['item_id'][-3:])-1]
  r.update(purchase_pack_base_qty=qty,purchase_pack_cost_cents=money(price),demo_unit_cost=rounded(D(price)/D(qty),8),demo_reference_price_per_base=rounded(D(price)*D('1.4')/D(qty),8),sale_price_cents=None)
 else:
  r.update(purchase_pack_base_qty=None,purchase_pack_cost_cents=None,sale_price_cents=prices[r['item_id']],demo_unit_cost=None,demo_reference_price_per_base=prices[r['item_id']]/100)
 items.append(r)
lookup={r['item_id']:r for r in items}
for r in items:
 if r['item_type']=='finished_dish':
  cost=sum(D(x['quantity_per_serving'])*D(lookup[x['component_item_id']]['demo_unit_cost']) for x in src['recipes'] if x['parent_item_id']==r['item_id'])
  r['demo_unit_cost']=rounded(cost,8)
  r['cost_basis']='sum of supplied per-serving BOM quantities times synthetic ingredient unit costs'
# Retail items are purchased finished products, not ingredients removed from the supplied BOMs.
for item_id,name,cost,price in [('RET-001','Demo bottled barbecue sauce 250 mL',250,699),('RET-002','Demo bottled chili sauce 250 mL',300,799)]:
 r={'item_id':item_id,'name':name,'item_type':'retail','category':'Sealed shelf stable retail sauce','base_unit':'each','barcode':item_id,'barcode_type':'CODE128_INTERNAL','is_sellable':True,'primary_supplier_id':'SUP-01','procurement_lead_days':2,'prep_lead_days':None,'lead_time_basis':'Synthetic demo assumption','lead_time_note':'Demo assortment only; availability not verified with supplier','storage_note':'Demo shelf-stable unopened product; actual vendor instructions required for pilot','source_note':'Added with user authorization for return/exchange demonstration','source':'generated_demo_fixture','purchase_pack_base_qty':12,'purchase_pack_cost_cents':cost*12,'demo_unit_cost':cost/100,'demo_reference_price_per_base':price/100,'sale_price_cents':price,'value_provenance':{'all_fields':'synthetic_demo_assumption; supplier relationship not verified'}}
 items.append(r)
lookup={r['item_id']:r for r in items}
locations=[{'location_id':'LOC-PRO','name':'Provo','city':'Provo','timezone':'America/Denver','demo_tax_rate':'0.0725','tax_provenance':'synthetic; not a verified Utah rate','source':"Rosie's To-do list.docx"},{'location_id':'LOC-SFO','name':'Spanish Fork','city':'Spanish Fork','timezone':'America/Denver','demo_tax_rate':'0.0725','tax_provenance':'synthetic; not a verified Utah rate','source':"Rosie's To-do list.docx"},{'location_id':'LOC-SLC','name':'Salt Lake City','city':'Salt Lake City','timezone':'America/Denver','demo_tax_rate':'0.0725','tax_provenance':'synthetic; not a verified Utah rate','source':"Rosie's To-do list.docx"}]
suppliers=[]
for r in src['suppliers']:
 v=dict(r)
 v['demo_payment_terms_days']=0 if v['supplier_id'] in ['SUP-17','SUP-19'] else 14 if v['supplier_id'] in ['SUP-08','SUP-16'] else 30
 v['demo_contact_email']=v['supplier_id'].lower()+'@example.invalid'
 v['payment_terms_provenance']='synthetic_demo_assumption_not_negotiated'
 v['missing_phone']=not bool(v['phone'])
 v['pilot_verified']=False
 suppliers.append(v)
customers=[{'customer_id':f'DEMO-CUST-{i:02d}','display_name':f'Demo Customer {i:02d}','email':f'customer{i:02d}@example.invalid','phone':None,'provenance':'synthetic_demo_fixture'} for i in range(1,11)]
# Demand-derived setup examples. They are not confirmed operating parameters.
mix={'FG-001':.23,'FG-002':.28,'FG-003':.25,'FG-004':.14,'FG-005':.10}
settings=[]; opening=[]
for loc,servings in zip(locations,[32,24,42]):
 daily=defaultdict(float)
 for r in src['recipes']:
  daily[r['component_item_id']]+=servings*mix[r['parent_item_id']]*float(r['quantity_per_serving'])
 for r in items:
  if r['item_type']=='finished_dish':
   settings.append({'location_id':loc['location_id'],'item_id':r['item_id'],'daily_demand_example':round(servings*mix[r['item_id']],3),'reorder_point_base':0,'safety_stock_base':0,'ordering_cost_cents':0,'annual_holding_cost_per_base':0,'reorder_applicable':False,'provenance':'synthetic_setup_example; made to order has no finished stock'})
   continue
  demand=daily[r['item_id']] if r['item_type']=='ingredient' else 1.5
  safety=round(demand*2,3)
  rop=round(demand*r['procurement_lead_days']+safety,3)
  pack=r['purchase_pack_base_qty']
  qty=math.ceil((rop+demand*3)/pack)*pack
  annual=rounded(D(r['demo_unit_cost'])*D('.25'),8)
  settings.append({'location_id':loc['location_id'],'item_id':r['item_id'],'daily_demand_example':round(demand,3),'reorder_point_base':rop,'safety_stock_base':safety,'ordering_cost_cents':1200,'annual_holding_cost_per_base':annual,'reorder_applicable':True,'provenance':'synthetic_demo_assumption; ordering cost per item replenishment, holding cost per base unit per year'})
  opening.append({'location_id':loc['location_id'],'item_id':r['item_id'],'quantity_base':qty,'unit_cost':r['demo_unit_cost'],'internal_lot_id':f"DEMO-OPEN-{loc['location_id']}-{r['item_id']}",'as_of_date':'2026-11-01','use_by_date':None,'provenance':'synthetic_demo_opening; use-by must be entered before pilot use; no receipt/expiry claim'})
staff=[{'employee_id':'DEMO-OWNER','display_name':'Demo Owner','role':'owner','location_id':None,'provenance':'synthetic; not an auth user or credentials'}]
for loc in locations:
 for role,n in [('manager',1),('employee',2)]:
  for i in range(1,n+1):
   staff.append({'employee_id':f"DEMO-{loc['location_id']}-{role[:3].upper()}-{i}",'display_name':f"Demo {loc['name']} {role} {i}",'role':role,'location_id':loc['location_id'],'provenance':'synthetic; create Auth identities securely, no shared credentials'})
seed={'dataset_id':'demo-2026-v1','dataset_class':'synthetic_demo_only','demo_as_of_date':'2026-11-01','history_start':'2026-05-01','history_end':'2026-10-31','currency':'USD','production_mode':'simplified_made_to_order','items':items,'recipes':src['recipes'],'suppliers':suppliers,'locations':locations,'customers':customers,'employees':staff,'location_item_settings':settings,'opening_inventory':opening,'pilot_import_rule':'Do not import demo opening inventory, history, customers or staff into a pilot project. Import verified source master data separately; confirm recipe yields, prices, packs, taxes and physical opening counts first.','source_status':'Source records preserved; recipes are illustrative, contacts not independently verified, ingredient lead times are benchmarks or assumptions.'}
(DATA/'demo_seed.json').write_text(json.dumps(seed,ensure_ascii=False,indent=2))
(DATA/'source_master_data.json').write_text(json.dumps(src,ensure_ascii=False,indent=2))
# Six complete calendar months. Historical snapshots never post to operational stock/payment ledgers.
rng=random.Random(401)
orders=[]; lines=[]
start=date(2026,5,1); end=date(2026,10,31)
month_factors={5:.94,6:1.03,7:1.10,8:1.04,9:1.00,10:1.08}
weekday_factors=[.78,.82,.90,1.00,1.25,1.52,1.12]
products=['FG-001','FG-002','FG-003','FG-004','FG-005','RET-001','RET-002']
weights=[.22,.27,.24,.13,.10,.025,.015]
for offset in range((end-start).days+1):
 day=start+timedelta(days=offset)
 holiday=.76 if day.isoformat() in ['2026-05-25','2026-07-04','2026-09-07'] else 1.0
 event=1.20 if '2026-09-15'<=day.isoformat()<='2026-09-21' else 1.0
 growth=1+.0008*offset
 for loc,baseline in zip(locations,[19,15,25]):
  count=max(4,round(baseline*weekday_factors[day.weekday()]*month_factors[day.month]*holiday*event*growth*rng.uniform(.90,1.10)))
  for n in range(1,count+1):
   oid=f"H-{day:%Y%m%d}-{loc['location_id']}-{n:03d}"
   cid=customers[rng.randrange(10)]['customer_id'] if rng.random()<.60 else ''
   local_time=f"{day.isoformat()}T{rng.choices([11,12,13,17,18,19,20],[1,3,2,2,4,3,1])[0]:02d}:{rng.randrange(60):02d}:00"
   basket=rng.choices([1,2,3],[.68,.27,.05])[0]
   chosen=rng.choices(products,weights=weights,k=basket)
   counts=Counter(chosen)
   total_net=total_tax=total_cogs=refund_net=refund_tax=0
   for li,(pid,qty0) in enumerate(counts.items(),1):
    qty=qty0+(1 if rng.random()<.10 else 0)
    unit=lookup[pid]['sale_price_cents']
    gross=qty*unit
    promo=0.1 if event>1 and pid=='FG-003' else .05 if rng.random()<.045 else 0
    discount=int((D(gross)*D(promo)).quantize(D(1),rounding=ROUND_HALF_UP))
    net=gross-discount
    tax=int((D(net)*D('.0725')).quantize(D(1),rounding=ROUND_HALF_UP))
    cogs=money(D(lookup[pid]['demo_unit_cost'])*qty)
    rn=rt=0
    if rng.random()<.016:
     rn=int((D(net)/qty).quantize(D(1),rounding=ROUND_HALF_UP))
     rt=int((D(tax)/qty).quantize(D(1),rounding=ROUND_HALF_UP))
    lines.append({'dataset_id':seed['dataset_id'],'historical_order_id':oid,'line_no':li,'business_date':day.isoformat(),'location_id':loc['location_id'],'customer_id':cid,'item_id':pid,'quantity_fulfilled':qty,'unit_price_cents':unit,'discount_cents':discount,'net_before_refund_cents':net,'tax_before_refund_cents':tax,'refund_net_cents':rn,'refund_tax_cents':rt,'historical_cogs_cents':cogs,'payment_mode':'SIMULATED','provenance':'synthetic_history_snapshot; no inventory posting'})
    total_net+=net; total_tax+=tax; total_cogs+=cogs; refund_net+=rn; refund_tax+=rt
   orders.append({'dataset_id':seed['dataset_id'],'historical_order_id':oid,'business_date':day.isoformat(),'created_at_local':local_time,'timezone':'America/Denver','location_id':loc['location_id'],'customer_id':cid,'status':'completed','net_before_refund_cents':total_net,'tax_before_refund_cents':total_tax,'refund_net_cents':refund_net,'refund_tax_cents':refund_tax,'historical_cogs_cents':total_cogs,'payment_mode':'SIMULATED','provenance':'synthetic_history_snapshot; not an operational order'})
def csv_write(path,rows):
 with path.open('w',newline='') as f:
  w=csv.DictWriter(f,fieldnames=list(rows[0]));w.writeheader();w.writerows(rows)
csv_write(DATA/'historical_orders_demo.csv',orders)
csv_write(DATA/'historical_order_lines_demo.csv',lines)
method={'seed':401,'date_range':['2026-05-01','2026-10-31'],'demo_as_of_date':'2026-11-01','order_count':len(orders),'order_line_count':len(lines),'location_count':3,'daily_location_rows':184*3,'generation_factors':{'weekday':weekday_factors,'month':month_factors,'location_order_baselines':[19,15,25],'daily_growth':.0008,'bounded_daily_variation':[.90,1.10],'illustrative_holidays':['2026-05-25','2026-07-04','2026-09-07'],'illustrative_promotion':['2026-09-15','2026-09-21']},'interpretation':'Every factor and transaction is synthetic, not evidence of observed restaurant demand. History is a read-only demand/reporting source, never replayed into operational inventory, AP, payments or timecards. Cost estimates use demo ingredient costs.','forecast_scope':'Demo forecasts may use this history. Pilot forecasts use only real pilot records or explicitly entered manager estimates.'}
(DATA/'history_method.json').write_text(json.dumps(method,indent=2))
# Human review workbook. Full historical transactions are in CSVs, daily totals are here.
wb=Workbook();wb.remove(wb.active)
def add_sheet(name,rows):
 ws=wb.create_sheet(name)
 cols=list(rows[0])
 ws.append(cols)
 for r in rows:
  ws.append([json.dumps(r.get(k),ensure_ascii=False) if isinstance(r.get(k),(dict,list)) else r.get(k) for k in cols])
 ws.freeze_panes='A2';ws.auto_filter.ref=ws.dimensions
 for c in ws[1]: c.fill=PatternFill('solid',fgColor='183C4A');c.font=Font(color='FFFFFF',bold=True);c.alignment=Alignment(wrap_text=True,vertical='top')
 ws.row_dimensions[1].height=32
 for col in ws.columns:
  m=max(len(str(c.value or '')) for c in list(col)[:80]); ws.column_dimensions[col[0].column_letter].width=min(52,max(14,m+2))
 for row in ws.iter_rows(min_row=2):
  for c in row:
   c.alignment=Alignment(vertical='top',wrap_text=True)
   if isinstance(c.value,(int,float)):
    c.number_format='0.########'
 return ws
add_sheet('Read me',[{'topic':'Purpose','detail':'Review source records and editable synthetic setup values before giving this package to a build agent.'},{'topic':'Dataset separation','detail':'DEMO ONLY. Never import generated staff, customers, opening balances or history into the real pilot project.'},{'topic':'Preserved source','detail':'40 ingredients, 5 parent dishes, 66 BOM lines, 15 suppliers. Source IDs, units and recipe quantities preserved.'},{'topic':'Added demo data','detail':'Two retail sauces, 10 customers, 10 employee role fixtures, synthetic prices/packs/terms, 141 location item settings and 126 opening quantities.'},{'topic':'History','detail':f"{len(orders):,} synthetic orders and {len(lines):,} lines from May 1 to October 31 2026. Full CSVs in data folder."},{'topic':'Missing verification','detail':'Contacts, supplier quotations, pack sizes, recipes/yields, taxes and opening counts must be verified for pilot use.'},{'topic':'Phone gaps','detail':'SUP-06, SUP-08, SUP-15, SUP-16, SUP-17 have no supplied phone. Demo emails use example.invalid and cannot be used as real contacts.'},{'topic':'Rubric','detail':'Exact 12 requirements were not supplied. Coverage of the documented requirements is mapped in the PRD; exact rubric coverage remains unverified.'}])
flatitems=[]
for r in items:
 flatitems.append({k:v for k,v in r.items() if k!='value_provenance'})
add_sheet('Items',flatitems)
add_sheet('Recipe BOM',src['recipes'])
add_sheet('Suppliers',suppliers)
add_sheet('Locations',locations)
add_sheet('Customers demo',customers)
add_sheet('Staff demo',staff)
add_sheet('Reorder EOQ demo',settings)
add_sheet('Opening stock demo',opening)
daily=defaultdict(lambda:Counter())
for r in orders:
 d=daily[(r['business_date'],r['location_id'])]
 d['orders']+=1;d['net_sales_cents']+=r['net_before_refund_cents']-r['refund_net_cents'];d['tax_cents']+=r['tax_before_refund_cents']-r['refund_tax_cents'];d['estimated_cogs_cents']+=r['historical_cogs_cents']
add_sheet('Daily sales demo',[{'business_date':k[0],'location_id':k[1],**v,'provenance':'synthetic; operational inventory unaffected'} for k,v in sorted(daily.items())])
add_sheet('Pilot readiness',[{'gate':g,'status':'NOT CONFIRMED','required_action':a} for g,a in [('Scope and rubric','Confirm any additional grading requirements separately.'),('Physical opening counts','Count real stock by location and lot; do not reuse demo quantities.'),('Catalog and purchasing','Confirm source supplier contacts, pack conversions, actual costs, payment terms and lead times.'),('Menu and recipes','Confirm portions, yields, prices, allowed discounts and the simplified production model against actual workflow.'),('Tax and returns','Enter verified location tax settings and operator-approved return/restock policy.'),('Staff and access','Invite actual users securely; verify roles and location memberships; never import demo identities as real staff.'),('Security and restore','Pass API/RLS/concurrency tests and demonstrate database backup/restore before real data entry.'),('Offline handling','Confirm reliable internet and the manual fallback process; automated offline operation is excluded.')]])
wb.save(ROOT/'ERP_Seed_and_Setup.xlsx')
summary={'items':len(items),'ingredients':40,'finished_dishes':5,'retail_items':2,'bom_lines':len(src['recipes']),'suppliers':len(suppliers),'locations':len(locations),'customers':len(customers),'employee_fixtures':len(staff),'location_item_settings':len(settings),'opening_balances':len(opening),'historical_orders':len(orders),'historical_lines':len(lines),'history_days':184,'historical_net_sales_cents':sum(r['net_before_refund_cents']-r['refund_net_cents'] for r in orders),'dish_unit_costs':{r['item_id']:r['demo_unit_cost'] for r in items if r['item_type']=='finished_dish'}}
(DATA/'seed_summary.json').write_text(json.dumps(summary,indent=2))
print(json.dumps(summary,indent=2))

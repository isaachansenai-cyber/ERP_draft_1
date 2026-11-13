
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "graphql_public": {
          Tables: {
            [_ in never]: never
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "graphql":
{ Args: { "extensions"?: Json,"operationName"?: string,"query"?: string,"variables"?: Json }; Returns: Json
                           }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        },"public": {
          Tables: {
            "app_settings": {
                  Row: {
                    "business_timezone": string,"company_name": string,"currency": string,"data_mode": string,"dataset_id": string | null,"mode_changed_at": string,"posting_enabled": boolean,"posting_enabled_at": string | null,"posting_enabled_by": string | null,"singleton": boolean
                  }
                  ComputedFields: never
                  Insert: {
                    "business_timezone"?: string,"company_name"?: string,"currency"?: string,"data_mode": string,"dataset_id"?: string | null,"mode_changed_at"?: string,"posting_enabled"?: boolean,"posting_enabled_at"?: string | null,"posting_enabled_by"?: string | null,"singleton"?: boolean
                  }
                  Update: {
                    "business_timezone"?: string,"company_name"?: string,"currency"?: string,"data_mode"?: string,"dataset_id"?: string | null,"mode_changed_at"?: string,"posting_enabled"?: boolean,"posting_enabled_at"?: string | null,"posting_enabled_by"?: string | null,"singleton"?: boolean
                  }
                  Relationships: [
                    
                  ]
                },"audit_log": {
                  Row: {
                    "action": string,"actor_employee_id": string | null,"actor_kind": string,"after_data": Json | null,"approver_employee_id": string | null,"audit_id": number,"before_data": Json | null,"location_id": string | null,"note": string | null,"object_id": string | null,"object_type": string,"occurred_at": string,"request_key": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "action": string,"actor_employee_id"?: string | null,"actor_kind"?: string,"after_data"?: Json | null,"approver_employee_id"?: string | null,"audit_id"?: never,"before_data"?: Json | null,"location_id"?: string | null,"note"?: string | null,"object_id"?: string | null,"object_type": string,"occurred_at"?: string,"request_key"?: string | null
                  }
                  Update: {
                    "action"?: string,"actor_employee_id"?: string | null,"actor_kind"?: string,"after_data"?: Json | null,"approver_employee_id"?: string | null,"audit_id"?: never,"before_data"?: Json | null,"location_id"?: string | null,"note"?: string | null,"object_id"?: string | null,"object_type"?: string,"occurred_at"?: string,"request_key"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "audit_log_actor_employee_id_fkey"
      columns: ["actor_employee_id"]
isOneToOne: false
      referencedRelation: "employees"
      referencedColumns: ["employee_id"]
    },{
      foreignKeyName: "audit_log_approver_employee_id_fkey"
      columns: ["approver_employee_id"]
isOneToOne: false
      referencedRelation: "employees"
      referencedColumns: ["employee_id"]
    },{
      foreignKeyName: "audit_log_location_id_fkey"
      columns: ["location_id"]
isOneToOne: false
      referencedRelation: "locations"
      referencedColumns: ["location_id"]
    }
                  ]
                },"cogs_reversals": {
                  Row: {
                    "business_date": string,"cost": number,"custody_id": string,"location_id": string,"order_id": string,"recorded_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "business_date"?: string,"cost": number,"custody_id": string,"location_id": string,"order_id": string,"recorded_at"?: string
                  }
                  Update: {
                    "business_date"?: string,"cost"?: number,"custody_id"?: string,"location_id"?: string,"order_id"?: string,"recorded_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "cogs_reversals_custody_id_fkey"
      columns: ["custody_id"]
isOneToOne: true
      referencedRelation: "return_custody"
      referencedColumns: ["custody_id"]
    },{
      foreignKeyName: "cogs_reversals_location_id_fkey"
      columns: ["location_id"]
isOneToOne: false
      referencedRelation: "locations"
      referencedColumns: ["location_id"]
    },{
      foreignKeyName: "cogs_reversals_order_id_fkey"
      columns: ["order_id"]
isOneToOne: false
      referencedRelation: "orders"
      referencedColumns: ["order_id"]
    }
                  ]
                },"customers": {
                  Row: {
                    "archived_at": string | null,"created_at": string,"created_by": string | null,"created_location_id": string | null,"customer_id": string,"display_name": string,"email": string | null,"phone": string | null,"provenance": string
                  }
                  ComputedFields: never
                  Insert: {
                    "archived_at"?: string | null,"created_at"?: string,"created_by"?: string | null,"created_location_id"?: string | null,"customer_id": string,"display_name": string,"email"?: string | null,"phone"?: string | null,"provenance": string
                  }
                  Update: {
                    "archived_at"?: string | null,"created_at"?: string,"created_by"?: string | null,"created_location_id"?: string | null,"customer_id"?: string,"display_name"?: string,"email"?: string | null,"phone"?: string | null,"provenance"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "customers_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "employees"
      referencedColumns: ["employee_id"]
    },{
      foreignKeyName: "customers_created_location_id_fkey"
      columns: ["created_location_id"]
isOneToOne: false
      referencedRelation: "locations"
      referencedColumns: ["location_id"]
    }
                  ]
                },"employees": {
                  Row: {
                    "active": boolean,"auth_user_id": string | null,"created_at": string,"display_name": string,"employee_id": string,"provenance": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "active"?: boolean,"auth_user_id"?: string | null,"created_at"?: string,"display_name": string,"employee_id": string,"provenance"?: string,"updated_at"?: string
                  }
                  Update: {
                    "active"?: boolean,"auth_user_id"?: string | null,"created_at"?: string,"display_name"?: string,"employee_id"?: string,"provenance"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"exchanges": {
                  Row: {
                    "amount_due_cents": number,"applied_cents": number,"created_at": string,"created_by": string,"credit_cents": number,"exchange_id": string,"new_order_id": string,"original_order_id": string,"refunded_excess_cents": number,"return_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "amount_due_cents": number,"applied_cents": number,"created_at"?: string,"created_by": string,"credit_cents": number,"exchange_id"?: string,"new_order_id": string,"original_order_id": string,"refunded_excess_cents": number,"return_id": string
                  }
                  Update: {
                    "amount_due_cents"?: number,"applied_cents"?: number,"created_at"?: string,"created_by"?: string,"credit_cents"?: number,"exchange_id"?: string,"new_order_id"?: string,"original_order_id"?: string,"refunded_excess_cents"?: number,"return_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "exchanges_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "employees"
      referencedColumns: ["employee_id"]
    },{
      foreignKeyName: "exchanges_new_order_id_fkey"
      columns: ["new_order_id"]
isOneToOne: true
      referencedRelation: "orders"
      referencedColumns: ["order_id"]
    },{
      foreignKeyName: "exchanges_original_order_id_fkey"
      columns: ["original_order_id"]
isOneToOne: false
      referencedRelation: "orders"
      referencedColumns: ["order_id"]
    },{
      foreignKeyName: "exchanges_return_id_fkey"
      columns: ["return_id"]
isOneToOne: true
      referencedRelation: "returns"
      referencedColumns: ["return_id"]
    }
                  ]
                },"historical_sales_lines": {
                  Row: {
                    "business_date": string,"customer_id": string | null,"dataset_id": string,"discount_cents": number,"historical_cogs_cents": number,"historical_order_id": string,"imported_at": string,"is_sellable": boolean,"item_id": string,"line_no": number,"location_id": string,"net_before_refund_cents": number,"payment_mode": string,"provenance": string,"quantity_fulfilled": number,"refund_net_cents": number,"refund_tax_cents": number,"tax_before_refund_cents": number,"unit_price_cents": number
                  }
                  ComputedFields: never
                  Insert: {
                    "business_date": string,"customer_id"?: string | null,"dataset_id": string,"discount_cents": number,"historical_cogs_cents": number,"historical_order_id": string,"imported_at"?: string,"is_sellable"?: boolean,"item_id": string,"line_no": number,"location_id": string,"net_before_refund_cents": number,"payment_mode": string,"provenance": string,"quantity_fulfilled": number,"refund_net_cents": number,"refund_tax_cents": number,"tax_before_refund_cents": number,"unit_price_cents": number
                  }
                  Update: {
                    "business_date"?: string,"customer_id"?: string | null,"dataset_id"?: string,"discount_cents"?: number,"historical_cogs_cents"?: number,"historical_order_id"?: string,"imported_at"?: string,"is_sellable"?: boolean,"item_id"?: string,"line_no"?: number,"location_id"?: string,"net_before_refund_cents"?: number,"payment_mode"?: string,"provenance"?: string,"quantity_fulfilled"?: number,"refund_net_cents"?: number,"refund_tax_cents"?: number,"tax_before_refund_cents"?: number,"unit_price_cents"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "historical_sales_lines_customer_id_fkey"
      columns: ["customer_id"]
isOneToOne: false
      referencedRelation: "customers"
      referencedColumns: ["customer_id"]
    },{
      foreignKeyName: "historical_sales_lines_dataset_id_historical_order_id_fkey"
      columns: ["dataset_id","historical_order_id"]
isOneToOne: false
      referencedRelation: "historical_sales_orders"
      referencedColumns: ["dataset_id","historical_order_id"]
    },{
      foreignKeyName: "historical_sales_lines_item_id_is_sellable_fkey"
      columns: ["item_id","is_sellable"]
isOneToOne: false
      referencedRelation: "items"
      referencedColumns: ["item_id","is_sellable"]
    },{
      foreignKeyName: "historical_sales_lines_location_id_fkey"
      columns: ["location_id"]
isOneToOne: false
      referencedRelation: "locations"
      referencedColumns: ["location_id"]
    }
                  ]
                },"historical_sales_orders": {
                  Row: {
                    "business_date": string,"created_at": string | null,"created_at_local": string,"customer_id": string | null,"dataset_id": string,"historical_cogs_cents": number,"historical_order_id": string,"imported_at": string,"location_id": string,"net_before_refund_cents": number,"payment_mode": string,"provenance": string,"refund_net_cents": number,"refund_tax_cents": number,"status": string,"tax_before_refund_cents": number,"timezone": string
                  }
                  ComputedFields: never
                  Insert: {
                    "business_date": string,"created_at"?: never,"created_at_local": string,"customer_id"?: string | null,"dataset_id": string,"historical_cogs_cents": number,"historical_order_id": string,"imported_at"?: string,"location_id": string,"net_before_refund_cents": number,"payment_mode": string,"provenance": string,"refund_net_cents": number,"refund_tax_cents": number,"status": string,"tax_before_refund_cents": number,"timezone": string
                  }
                  Update: {
                    "business_date"?: string,"created_at"?: never,"created_at_local"?: string,"customer_id"?: string | null,"dataset_id"?: string,"historical_cogs_cents"?: number,"historical_order_id"?: string,"imported_at"?: string,"location_id"?: string,"net_before_refund_cents"?: number,"payment_mode"?: string,"provenance"?: string,"refund_net_cents"?: number,"refund_tax_cents"?: number,"status"?: string,"tax_before_refund_cents"?: number,"timezone"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "historical_sales_orders_customer_id_fkey"
      columns: ["customer_id"]
isOneToOne: false
      referencedRelation: "customers"
      referencedColumns: ["customer_id"]
    },{
      foreignKeyName: "historical_sales_orders_location_id_fkey"
      columns: ["location_id"]
isOneToOne: false
      referencedRelation: "locations"
      referencedColumns: ["location_id"]
    }
                  ]
                },"inventory_movements": {
                  Row: {
                    "actor_employee_id": string | null,"approver_employee_id": string | null,"business_date": string,"condition": string,"extended_cost": number | null,"item_id": string,"location_id": string,"lot_id": string,"movement_id": string,"movement_no": number,"movement_type": string,"occurred_at": string,"provenance": string,"quantity": number,"reason_code": string | null,"request_key": string | null,"reverses_movement_id": string | null,"source_id": string | null,"source_line_id": string | null,"source_type": string,"unit_cost": number
                  }
                  ComputedFields: never
                  Insert: {
                    "actor_employee_id"?: string | null,"approver_employee_id"?: string | null,"business_date"?: string,"condition": string,"extended_cost"?: never,"item_id": string,"location_id": string,"lot_id": string,"movement_id"?: string,"movement_no"?: never,"movement_type": string,"occurred_at"?: string,"provenance"?: string,"quantity": number,"reason_code"?: string | null,"request_key"?: string | null,"reverses_movement_id"?: string | null,"source_id"?: string | null,"source_line_id"?: string | null,"source_type": string,"unit_cost": number
                  }
                  Update: {
                    "actor_employee_id"?: string | null,"approver_employee_id"?: string | null,"business_date"?: string,"condition"?: string,"extended_cost"?: never,"item_id"?: string,"location_id"?: string,"lot_id"?: string,"movement_id"?: string,"movement_no"?: never,"movement_type"?: string,"occurred_at"?: string,"provenance"?: string,"quantity"?: number,"reason_code"?: string | null,"request_key"?: string | null,"reverses_movement_id"?: string | null,"source_id"?: string | null,"source_line_id"?: string | null,"source_type"?: string,"unit_cost"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "inventory_movements_actor_employee_id_fkey"
      columns: ["actor_employee_id"]
isOneToOne: false
      referencedRelation: "employees"
      referencedColumns: ["employee_id"]
    },{
      foreignKeyName: "inventory_movements_approver_employee_id_fkey"
      columns: ["approver_employee_id"]
isOneToOne: false
      referencedRelation: "employees"
      referencedColumns: ["employee_id"]
    },{
      foreignKeyName: "inventory_movements_item_id_fkey"
      columns: ["item_id"]
isOneToOne: false
      referencedRelation: "items"
      referencedColumns: ["item_id"]
    },{
      foreignKeyName: "inventory_movements_location_id_fkey"
      columns: ["location_id"]
isOneToOne: false
      referencedRelation: "locations"
      referencedColumns: ["location_id"]
    },{
      foreignKeyName: "inventory_movements_lot_id_fkey"
      columns: ["lot_id"]
isOneToOne: false
      referencedRelation: "lots"
      referencedColumns: ["lot_id"]
    },{
      foreignKeyName: "inventory_movements_reason_code_fkey"
      columns: ["reason_code"]
isOneToOne: false
      referencedRelation: "reason_codes"
      referencedColumns: ["code"]
    },{
      foreignKeyName: "inventory_movements_reverses_movement_id_fkey"
      columns: ["reverses_movement_id"]
isOneToOne: false
      referencedRelation: "inventory_movements"
      referencedColumns: ["movement_id"]
    }
                  ]
                },"item_standard_costs": {
                  Row: {
                    "cost_basis": string,"item_id": string,"provenance": string,"reference_price_per_base": number | null,"standard_unit_cost": number | null,"updated_at": string,"updated_by": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "cost_basis": string,"item_id": string,"provenance": string,"reference_price_per_base"?: number | null,"standard_unit_cost"?: number | null,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Update: {
                    "cost_basis"?: string,"item_id"?: string,"provenance"?: string,"reference_price_per_base"?: number | null,"standard_unit_cost"?: number | null,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "item_standard_costs_item_id_fkey"
      columns: ["item_id"]
isOneToOne: true
      referencedRelation: "items"
      referencedColumns: ["item_id"]
    },{
      foreignKeyName: "item_standard_costs_updated_by_fkey"
      columns: ["updated_by"]
isOneToOne: false
      referencedRelation: "employees"
      referencedColumns: ["employee_id"]
    }
                  ]
                },"item_unit_conversions": {
                  Row: {
                    "base_qty_per_unit": number,"evidence_note": string,"from_unit": string,"item_id": string,"verified_at": string,"verified_by": string
                  }
                  ComputedFields: never
                  Insert: {
                    "base_qty_per_unit": number,"evidence_note": string,"from_unit": string,"item_id": string,"verified_at"?: string,"verified_by": string
                  }
                  Update: {
                    "base_qty_per_unit"?: number,"evidence_note"?: string,"from_unit"?: string,"item_id"?: string,"verified_at"?: string,"verified_by"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "item_unit_conversions_from_unit_fkey"
      columns: ["from_unit"]
isOneToOne: false
      referencedRelation: "units"
      referencedColumns: ["unit"]
    },{
      foreignKeyName: "item_unit_conversions_item_id_fkey"
      columns: ["item_id"]
isOneToOne: false
      referencedRelation: "items"
      referencedColumns: ["item_id"]
    },{
      foreignKeyName: "item_unit_conversions_verified_by_fkey"
      columns: ["verified_by"]
isOneToOne: false
      referencedRelation: "employees"
      referencedColumns: ["employee_id"]
    }
                  ]
                },"item_valuation": {
                  Row: {
                    "avg_unit_cost": number,"item_id": string,"location_id": string,"updated_at": string,"valued_qty": number
                  }
                  ComputedFields: never
                  Insert: {
                    "avg_unit_cost"?: number,"item_id": string,"location_id": string,"updated_at"?: string,"valued_qty"?: number
                  }
                  Update: {
                    "avg_unit_cost"?: number,"item_id"?: string,"location_id"?: string,"updated_at"?: string,"valued_qty"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "item_valuation_item_id_fkey"
      columns: ["item_id"]
isOneToOne: false
      referencedRelation: "items"
      referencedColumns: ["item_id"]
    },{
      foreignKeyName: "item_valuation_location_id_fkey"
      columns: ["location_id"]
isOneToOne: false
      referencedRelation: "locations"
      referencedColumns: ["location_id"]
    }
                  ]
                },"items": {
                  Row: {
                    "archived_at": string | null,"barcode": string,"barcode_type": string,"base_unit": string,"category": string,"created_at": string,"is_purchasable": boolean | null,"is_sellable": boolean,"item_id": string,"item_type": string,"lead_time_basis": string | null,"lead_time_note": string | null,"name": string,"prep_lead_days": number | null,"primary_supplier_id": string | null,"procurement_lead_days": number | null,"provenance": string,"provenance_detail": NonNullable<Json>,"requires_use_by": boolean,"requires_use_by_basis": string,"source": string,"source_note": string | null,"storage_note": string | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "archived_at"?: string | null,"barcode": string,"barcode_type"?: string,"base_unit": string,"category": string,"created_at"?: string,"is_purchasable"?: never,"is_sellable": boolean,"item_id": string,"item_type": string,"lead_time_basis"?: string | null,"lead_time_note"?: string | null,"name": string,"prep_lead_days"?: number | null,"primary_supplier_id"?: string | null,"procurement_lead_days"?: number | null,"provenance": string,"provenance_detail"?: NonNullable<Json>,"requires_use_by"?: boolean,"requires_use_by_basis"?: string,"source": string,"source_note"?: string | null,"storage_note"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "archived_at"?: string | null,"barcode"?: string,"barcode_type"?: string,"base_unit"?: string,"category"?: string,"created_at"?: string,"is_purchasable"?: never,"is_sellable"?: boolean,"item_id"?: string,"item_type"?: string,"lead_time_basis"?: string | null,"lead_time_note"?: string | null,"name"?: string,"prep_lead_days"?: number | null,"primary_supplier_id"?: string | null,"procurement_lead_days"?: number | null,"provenance"?: string,"provenance_detail"?: NonNullable<Json>,"requires_use_by"?: boolean,"requires_use_by_basis"?: string,"source"?: string,"source_note"?: string | null,"storage_note"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "items_base_unit_fkey"
      columns: ["base_unit"]
isOneToOne: false
      referencedRelation: "units"
      referencedColumns: ["unit"]
    },{
      foreignKeyName: "items_primary_supplier_id_fkey"
      columns: ["primary_supplier_id"]
isOneToOne: false
      referencedRelation: "suppliers"
      referencedColumns: ["supplier_id"]
    }
                  ]
                },"location_closures": {
                  Row: {
                    "business_date": string,"created_at": string,"created_by": string | null,"location_id": string,"reason": string
                  }
                  ComputedFields: never
                  Insert: {
                    "business_date": string,"created_at"?: string,"created_by"?: string | null,"location_id": string,"reason": string
                  }
                  Update: {
                    "business_date"?: string,"created_at"?: string,"created_by"?: string | null,"location_id"?: string,"reason"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "location_closures_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "employees"
      referencedColumns: ["employee_id"]
    },{
      foreignKeyName: "location_closures_location_id_fkey"
      columns: ["location_id"]
isOneToOne: false
      referencedRelation: "locations"
      referencedColumns: ["location_id"]
    }
                  ]
                },"location_item_availability": {
                  Row: {
                    "is_available": boolean,"is_sellable": boolean,"item_id": string,"location_id": string,"reason": string | null,"updated_at": string,"updated_by": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "is_available": boolean,"is_sellable"?: boolean,"item_id": string,"location_id": string,"reason"?: string | null,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Update: {
                    "is_available"?: boolean,"is_sellable"?: boolean,"item_id"?: string,"location_id"?: string,"reason"?: string | null,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "location_item_availability_item_id_is_sellable_fkey"
      columns: ["item_id","is_sellable"]
isOneToOne: false
      referencedRelation: "items"
      referencedColumns: ["item_id","is_sellable"]
    },{
      foreignKeyName: "location_item_availability_location_id_fkey"
      columns: ["location_id"]
isOneToOne: false
      referencedRelation: "locations"
      referencedColumns: ["location_id"]
    },{
      foreignKeyName: "location_item_availability_updated_by_fkey"
      columns: ["updated_by"]
isOneToOne: false
      referencedRelation: "employees"
      referencedColumns: ["employee_id"]
    }
                  ]
                },"location_item_prices": {
                  Row: {
                    "created_at": string,"created_by": string | null,"effective_from": string,"is_sellable": boolean,"item_id": string,"location_id": string,"price_cents": number,"provenance": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"created_by"?: string | null,"effective_from": string,"is_sellable"?: boolean,"item_id": string,"location_id": string,"price_cents": number,"provenance": string
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string | null,"effective_from"?: string,"is_sellable"?: boolean,"item_id"?: string,"location_id"?: string,"price_cents"?: number,"provenance"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "location_item_prices_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "employees"
      referencedColumns: ["employee_id"]
    },{
      foreignKeyName: "location_item_prices_item_id_is_sellable_fkey"
      columns: ["item_id","is_sellable"]
isOneToOne: false
      referencedRelation: "items"
      referencedColumns: ["item_id","is_sellable"]
    },{
      foreignKeyName: "location_item_prices_location_id_fkey"
      columns: ["location_id"]
isOneToOne: false
      referencedRelation: "locations"
      referencedColumns: ["location_id"]
    }
                  ]
                },"location_item_settings": {
                  Row: {
                    "annual_holding_cost_per_base": number | null,"approved_at": string | null,"approved_by": string | null,"daily_demand_example_base": number | null,"holding_cost_unit": string,"item_id": string,"location_id": string,"max_cover_days": number | null,"ordering_cost_cents": number | null,"ordering_cost_unit": string,"provenance": string,"quantity_unit_basis": string,"reorder_applicable": boolean,"reorder_point_base": number | null,"safety_stock_base": number | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "annual_holding_cost_per_base"?: number | null,"approved_at"?: string | null,"approved_by"?: string | null,"daily_demand_example_base"?: number | null,"holding_cost_unit"?: string,"item_id": string,"location_id": string,"max_cover_days"?: number | null,"ordering_cost_cents"?: number | null,"ordering_cost_unit"?: string,"provenance": string,"quantity_unit_basis"?: string,"reorder_applicable": boolean,"reorder_point_base"?: number | null,"safety_stock_base"?: number | null,"updated_at"?: string
                  }
                  Update: {
                    "annual_holding_cost_per_base"?: number | null,"approved_at"?: string | null,"approved_by"?: string | null,"daily_demand_example_base"?: number | null,"holding_cost_unit"?: string,"item_id"?: string,"location_id"?: string,"max_cover_days"?: number | null,"ordering_cost_cents"?: number | null,"ordering_cost_unit"?: string,"provenance"?: string,"quantity_unit_basis"?: string,"reorder_applicable"?: boolean,"reorder_point_base"?: number | null,"safety_stock_base"?: number | null,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "location_item_settings_approved_by_fkey"
      columns: ["approved_by"]
isOneToOne: false
      referencedRelation: "employees"
      referencedColumns: ["employee_id"]
    },{
      foreignKeyName: "location_item_settings_item_id_fkey"
      columns: ["item_id"]
isOneToOne: false
      referencedRelation: "items"
      referencedColumns: ["item_id"]
    },{
      foreignKeyName: "location_item_settings_location_id_fkey"
      columns: ["location_id"]
isOneToOne: false
      referencedRelation: "locations"
      referencedColumns: ["location_id"]
    }
                  ]
                },"location_tax_rates": {
                  Row: {
                    "confirmed_at": string | null,"confirmed_by": string | null,"created_at": string,"effective_from": string,"location_id": string,"provenance": string,"rate": number
                  }
                  ComputedFields: never
                  Insert: {
                    "confirmed_at"?: string | null,"confirmed_by"?: string | null,"created_at"?: string,"effective_from": string,"location_id": string,"provenance": string,"rate": number
                  }
                  Update: {
                    "confirmed_at"?: string | null,"confirmed_by"?: string | null,"created_at"?: string,"effective_from"?: string,"location_id"?: string,"provenance"?: string,"rate"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "location_tax_rates_confirmed_by_fkey"
      columns: ["confirmed_by"]
isOneToOne: false
      referencedRelation: "employees"
      referencedColumns: ["employee_id"]
    },{
      foreignKeyName: "location_tax_rates_location_id_fkey"
      columns: ["location_id"]
isOneToOne: false
      referencedRelation: "locations"
      referencedColumns: ["location_id"]
    }
                  ]
                },"locations": {
                  Row: {
                    "archived_at": string | null,"city": string,"created_at": string,"location_id": string,"name": string,"short_code": string,"source": string,"timezone": string
                  }
                  ComputedFields: never
                  Insert: {
                    "archived_at"?: string | null,"city": string,"created_at"?: string,"location_id": string,"name": string,"short_code": string,"source": string,"timezone"?: string
                  }
                  Update: {
                    "archived_at"?: string | null,"city"?: string,"created_at"?: string,"location_id"?: string,"name"?: string,"short_code"?: string,"source"?: string,"timezone"?: string
                  }
                  Relationships: [
                    
                  ]
                },"lots": {
                  Row: {
                    "created_by": string | null,"is_purchasable": boolean,"item_id": string,"location_id": string,"lot_code": string,"lot_id": string,"provenance": string,"received_at": string,"source_id": string | null,"source_type": string,"supplier_lot": string | null,"use_by_date": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "created_by"?: string | null,"is_purchasable"?: boolean,"item_id": string,"location_id": string,"lot_code": string,"lot_id"?: string,"provenance"?: string,"received_at"?: string,"source_id"?: string | null,"source_type": string,"supplier_lot"?: string | null,"use_by_date"?: string | null
                  }
                  Update: {
                    "created_by"?: string | null,"is_purchasable"?: boolean,"item_id"?: string,"location_id"?: string,"lot_code"?: string,"lot_id"?: string,"provenance"?: string,"received_at"?: string,"source_id"?: string | null,"source_type"?: string,"supplier_lot"?: string | null,"use_by_date"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "lots_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "employees"
      referencedColumns: ["employee_id"]
    },{
      foreignKeyName: "lots_item_id_is_purchasable_fkey"
      columns: ["item_id","is_purchasable"]
isOneToOne: false
      referencedRelation: "items"
      referencedColumns: ["item_id","is_purchasable"]
    },{
      foreignKeyName: "lots_location_id_fkey"
      columns: ["location_id"]
isOneToOne: false
      referencedRelation: "locations"
      referencedColumns: ["location_id"]
    }
                  ]
                },"memberships": {
                  Row: {
                    "active": boolean,"created_at": string,"created_by": string | null,"employee_id": string,"location_id": string | null,"membership_id": string,"provenance": string,"revoke_reason": string | null,"revoked_at": string | null,"revoked_by": string | null,"role": string
                  }
                  ComputedFields: never
                  Insert: {
                    "active"?: boolean,"created_at"?: string,"created_by"?: string | null,"employee_id": string,"location_id"?: string | null,"membership_id"?: string,"provenance"?: string,"revoke_reason"?: string | null,"revoked_at"?: string | null,"revoked_by"?: string | null,"role": string
                  }
                  Update: {
                    "active"?: boolean,"created_at"?: string,"created_by"?: string | null,"employee_id"?: string,"location_id"?: string | null,"membership_id"?: string,"provenance"?: string,"revoke_reason"?: string | null,"revoked_at"?: string | null,"revoked_by"?: string | null,"role"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "memberships_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "employees"
      referencedColumns: ["employee_id"]
    },{
      foreignKeyName: "memberships_employee_id_fkey"
      columns: ["employee_id"]
isOneToOne: false
      referencedRelation: "employees"
      referencedColumns: ["employee_id"]
    },{
      foreignKeyName: "memberships_location_id_fkey"
      columns: ["location_id"]
isOneToOne: false
      referencedRelation: "locations"
      referencedColumns: ["location_id"]
    },{
      foreignKeyName: "memberships_revoked_by_fkey"
      columns: ["revoked_by"]
isOneToOne: false
      referencedRelation: "employees"
      referencedColumns: ["employee_id"]
    }
                  ]
                },"opening_count_lines": {
                  Row: {
                    "item_id": string,"line_no": number,"lot_id": string,"opening_count_id": string,"quantity_base": number,"unit_cost": number,"use_by_date": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "item_id": string,"line_no": number,"lot_id": string,"opening_count_id": string,"quantity_base": number,"unit_cost": number,"use_by_date"?: string | null
                  }
                  Update: {
                    "item_id"?: string,"line_no"?: number,"lot_id"?: string,"opening_count_id"?: string,"quantity_base"?: number,"unit_cost"?: number,"use_by_date"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "opening_count_lines_item_id_fkey"
      columns: ["item_id"]
isOneToOne: false
      referencedRelation: "items"
      referencedColumns: ["item_id"]
    },{
      foreignKeyName: "opening_count_lines_lot_id_fkey"
      columns: ["lot_id"]
isOneToOne: false
      referencedRelation: "lots"
      referencedColumns: ["lot_id"]
    },{
      foreignKeyName: "opening_count_lines_opening_count_id_fkey"
      columns: ["opening_count_id"]
isOneToOne: false
      referencedRelation: "opening_counts"
      referencedColumns: ["opening_count_id"]
    }
                  ]
                },"opening_counts": {
                  Row: {
                    "line_count": number,"location_id": string,"note": string | null,"opening_count_id": string,"posted_at": string,"posted_by": string | null,"provenance": string
                  }
                  ComputedFields: never
                  Insert: {
                    "line_count": number,"location_id": string,"note"?: string | null,"opening_count_id"?: string,"posted_at"?: string,"posted_by"?: string | null,"provenance": string
                  }
                  Update: {
                    "line_count"?: number,"location_id"?: string,"note"?: string | null,"opening_count_id"?: string,"posted_at"?: string,"posted_by"?: string | null,"provenance"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "opening_counts_location_id_fkey"
      columns: ["location_id"]
isOneToOne: true
      referencedRelation: "locations"
      referencedColumns: ["location_id"]
    },{
      foreignKeyName: "opening_counts_posted_by_fkey"
      columns: ["posted_by"]
isOneToOne: false
      referencedRelation: "employees"
      referencedColumns: ["employee_id"]
    }
                  ]
                },"order_cancellation_waste": {
                  Row: {
                    "approved_by": string,"business_date": string,"issued_cost": number,"location_id": string,"note": string | null,"order_id": string,"reason_code": string,"recorded_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "approved_by": string,"business_date": string,"issued_cost": number,"location_id": string,"note"?: string | null,"order_id": string,"reason_code": string,"recorded_at"?: string
                  }
                  Update: {
                    "approved_by"?: string,"business_date"?: string,"issued_cost"?: number,"location_id"?: string,"note"?: string | null,"order_id"?: string,"reason_code"?: string,"recorded_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "order_cancellation_waste_approved_by_fkey"
      columns: ["approved_by"]
isOneToOne: false
      referencedRelation: "employees"
      referencedColumns: ["employee_id"]
    },{
      foreignKeyName: "order_cancellation_waste_location_id_fkey"
      columns: ["location_id"]
isOneToOne: false
      referencedRelation: "locations"
      referencedColumns: ["location_id"]
    },{
      foreignKeyName: "order_cancellation_waste_order_id_fkey"
      columns: ["order_id"]
isOneToOne: true
      referencedRelation: "orders"
      referencedColumns: ["order_id"]
    },{
      foreignKeyName: "order_cancellation_waste_reason_code_fkey"
      columns: ["reason_code"]
isOneToOne: false
      referencedRelation: "reason_codes"
      referencedColumns: ["code"]
    }
                  ]
                },"order_issue_costs": {
                  Row: {
                    "issued_at": string,"issued_cost": number,"issued_qty": number,"item_id": string,"order_id": string,"purpose": string
                  }
                  ComputedFields: never
                  Insert: {
                    "issued_at"?: string,"issued_cost": number,"issued_qty": number,"item_id": string,"order_id": string,"purpose": string
                  }
                  Update: {
                    "issued_at"?: string,"issued_cost"?: number,"issued_qty"?: number,"item_id"?: string,"order_id"?: string,"purpose"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "order_issue_costs_item_id_fkey"
      columns: ["item_id"]
isOneToOne: false
      referencedRelation: "items"
      referencedColumns: ["item_id"]
    },{
      foreignKeyName: "order_issue_costs_order_id_fkey"
      columns: ["order_id"]
isOneToOne: false
      referencedRelation: "orders"
      referencedColumns: ["order_id"]
    }
                  ]
                },"order_line_requirements": {
                  Row: {
                    "component_item_id": string,"order_line_id": string,"quantity_per_serving": number,"required_qty": number
                  }
                  ComputedFields: never
                  Insert: {
                    "component_item_id": string,"order_line_id": string,"quantity_per_serving": number,"required_qty": number
                  }
                  Update: {
                    "component_item_id"?: string,"order_line_id"?: string,"quantity_per_serving"?: number,"required_qty"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "order_line_requirements_component_item_id_fkey"
      columns: ["component_item_id"]
isOneToOne: false
      referencedRelation: "items"
      referencedColumns: ["item_id"]
    },{
      foreignKeyName: "order_line_requirements_order_line_id_fkey"
      columns: ["order_line_id"]
isOneToOne: false
      referencedRelation: "order_lines"
      referencedColumns: ["order_line_id"]
    }
                  ]
                },"order_lines": {
                  Row: {
                    "discount_cents": number,"gross_cents": number,"is_sellable": boolean,"item_id": string,"item_type": string,"line_no": number,"net_cents": number,"order_id": string,"order_line_id": string,"price_effective_from": string,"quantity": number,"recipe_version_id": string | null,"revision": number,"tax_cents": number,"unit_price_cents": number
                  }
                  ComputedFields: never
                  Insert: {
                    "discount_cents"?: number,"gross_cents": number,"is_sellable"?: boolean,"item_id": string,"item_type": string,"line_no": number,"net_cents": number,"order_id": string,"order_line_id"?: string,"price_effective_from": string,"quantity": number,"recipe_version_id"?: string | null,"revision": number,"tax_cents"?: number,"unit_price_cents": number
                  }
                  Update: {
                    "discount_cents"?: number,"gross_cents"?: number,"is_sellable"?: boolean,"item_id"?: string,"item_type"?: string,"line_no"?: number,"net_cents"?: number,"order_id"?: string,"order_line_id"?: string,"price_effective_from"?: string,"quantity"?: number,"recipe_version_id"?: string | null,"revision"?: number,"tax_cents"?: number,"unit_price_cents"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "order_lines_item_id_is_sellable_fkey"
      columns: ["item_id","is_sellable"]
isOneToOne: false
      referencedRelation: "items"
      referencedColumns: ["item_id","is_sellable"]
    },{
      foreignKeyName: "order_lines_order_id_fkey"
      columns: ["order_id"]
isOneToOne: false
      referencedRelation: "orders"
      referencedColumns: ["order_id"]
    },{
      foreignKeyName: "order_lines_recipe_version_id_fkey"
      columns: ["recipe_version_id"]
isOneToOne: false
      referencedRelation: "recipe_versions"
      referencedColumns: ["recipe_version_id"]
    }
                  ]
                },"order_state_events": {
                  Row: {
                    "actor_employee_id": string,"approver_employee_id": string | null,"event_id": number,"from_status": string | null,"note": string | null,"occurred_at": string,"order_id": string,"request_key": string | null,"to_status": string,"version": number
                  }
                  ComputedFields: never
                  Insert: {
                    "actor_employee_id": string,"approver_employee_id"?: string | null,"event_id"?: never,"from_status"?: string | null,"note"?: string | null,"occurred_at"?: string,"order_id": string,"request_key"?: string | null,"to_status": string,"version": number
                  }
                  Update: {
                    "actor_employee_id"?: string,"approver_employee_id"?: string | null,"event_id"?: never,"from_status"?: string | null,"note"?: string | null,"occurred_at"?: string,"order_id"?: string,"request_key"?: string | null,"to_status"?: string,"version"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "order_state_events_actor_employee_id_fkey"
      columns: ["actor_employee_id"]
isOneToOne: false
      referencedRelation: "employees"
      referencedColumns: ["employee_id"]
    },{
      foreignKeyName: "order_state_events_approver_employee_id_fkey"
      columns: ["approver_employee_id"]
isOneToOne: false
      referencedRelation: "employees"
      referencedColumns: ["employee_id"]
    },{
      foreignKeyName: "order_state_events_order_id_fkey"
      columns: ["order_id"]
isOneToOne: false
      referencedRelation: "orders"
      referencedColumns: ["order_id"]
    }
                  ]
                },"orders": {
                  Row: {
                    "accepted_at": string,"accepted_by": string,"business_date": string,"cancel_approved_by": string | null,"cancel_note": string | null,"cancel_reason_code": string | null,"cancelled_at": string | null,"cancelled_by": string | null,"completed_at": string | null,"completed_business_date": string | null,"completed_by": string | null,"customer_id": string | null,"discount_approved_by": string | null,"discount_cents": number,"discount_percent": number,"discount_reason": string | null,"estimated_ready_at": string | null,"gross_cents": number,"has_kitchen_items": boolean,"location_id": string,"net_cents": number,"note": string | null,"order_id": string,"order_number": string,"pickup_code": string,"pickup_name": string | null,"provenance": string,"ready_at": string | null,"revision": number,"started_at": string | null,"started_by": string | null,"status": string,"tax_cents": number,"tax_rate": number,"tender_mode": string,"total_cents": number,"version": number
                  }
                  ComputedFields: never
                  Insert: {
                    "accepted_at"?: string,"accepted_by": string,"business_date": string,"cancel_approved_by"?: string | null,"cancel_note"?: string | null,"cancel_reason_code"?: string | null,"cancelled_at"?: string | null,"cancelled_by"?: string | null,"completed_at"?: string | null,"completed_business_date"?: string | null,"completed_by"?: string | null,"customer_id"?: string | null,"discount_approved_by"?: string | null,"discount_cents"?: number,"discount_percent"?: number,"discount_reason"?: string | null,"estimated_ready_at"?: string | null,"gross_cents"?: number,"has_kitchen_items"?: boolean,"location_id": string,"net_cents"?: number,"note"?: string | null,"order_id"?: string,"order_number": string,"pickup_code": string,"pickup_name"?: string | null,"provenance"?: string,"ready_at"?: string | null,"revision"?: number,"started_at"?: string | null,"started_by"?: string | null,"status": string,"tax_cents"?: number,"tax_rate": number,"tender_mode": string,"total_cents"?: number,"version"?: number
                  }
                  Update: {
                    "accepted_at"?: string,"accepted_by"?: string,"business_date"?: string,"cancel_approved_by"?: string | null,"cancel_note"?: string | null,"cancel_reason_code"?: string | null,"cancelled_at"?: string | null,"cancelled_by"?: string | null,"completed_at"?: string | null,"completed_business_date"?: string | null,"completed_by"?: string | null,"customer_id"?: string | null,"discount_approved_by"?: string | null,"discount_cents"?: number,"discount_percent"?: number,"discount_reason"?: string | null,"estimated_ready_at"?: string | null,"gross_cents"?: number,"has_kitchen_items"?: boolean,"location_id"?: string,"net_cents"?: number,"note"?: string | null,"order_id"?: string,"order_number"?: string,"pickup_code"?: string,"pickup_name"?: string | null,"provenance"?: string,"ready_at"?: string | null,"revision"?: number,"started_at"?: string | null,"started_by"?: string | null,"status"?: string,"tax_cents"?: number,"tax_rate"?: number,"tender_mode"?: string,"total_cents"?: number,"version"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "orders_accepted_by_fkey"
      columns: ["accepted_by"]
isOneToOne: false
      referencedRelation: "employees"
      referencedColumns: ["employee_id"]
    },{
      foreignKeyName: "orders_cancel_approved_by_fkey"
      columns: ["cancel_approved_by"]
isOneToOne: false
      referencedRelation: "employees"
      referencedColumns: ["employee_id"]
    },{
      foreignKeyName: "orders_cancel_reason_code_fkey"
      columns: ["cancel_reason_code"]
isOneToOne: false
      referencedRelation: "reason_codes"
      referencedColumns: ["code"]
    },{
      foreignKeyName: "orders_cancelled_by_fkey"
      columns: ["cancelled_by"]
isOneToOne: false
      referencedRelation: "employees"
      referencedColumns: ["employee_id"]
    },{
      foreignKeyName: "orders_completed_by_fkey"
      columns: ["completed_by"]
isOneToOne: false
      referencedRelation: "employees"
      referencedColumns: ["employee_id"]
    },{
      foreignKeyName: "orders_customer_id_fkey"
      columns: ["customer_id"]
isOneToOne: false
      referencedRelation: "customers"
      referencedColumns: ["customer_id"]
    },{
      foreignKeyName: "orders_discount_approved_by_fkey"
      columns: ["discount_approved_by"]
isOneToOne: false
      referencedRelation: "employees"
      referencedColumns: ["employee_id"]
    },{
      foreignKeyName: "orders_location_id_fkey"
      columns: ["location_id"]
isOneToOne: false
      referencedRelation: "locations"
      referencedColumns: ["location_id"]
    },{
      foreignKeyName: "orders_started_by_fkey"
      columns: ["started_by"]
isOneToOne: false
      referencedRelation: "employees"
      referencedColumns: ["employee_id"]
    }
                  ]
                },"pilot_setup_gates": {
                  Row: {
                    "confirmed_at": string | null,"confirmed_by": string | null,"created_at": string,"evidence_note": string | null,"gate_id": string,"gate_key": string,"provenance": string,"scope_id": string | null,"scope_type": string,"status": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "confirmed_at"?: string | null,"confirmed_by"?: string | null,"created_at"?: string,"evidence_note"?: string | null,"gate_id"?: string,"gate_key": string,"provenance"?: string,"scope_id"?: string | null,"scope_type": string,"status"?: string,"updated_at"?: string
                  }
                  Update: {
                    "confirmed_at"?: string | null,"confirmed_by"?: string | null,"created_at"?: string,"evidence_note"?: string | null,"gate_id"?: string,"gate_key"?: string,"provenance"?: string,"scope_id"?: string | null,"scope_type"?: string,"status"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "pilot_setup_gates_confirmed_by_fkey"
      columns: ["confirmed_by"]
isOneToOne: false
      referencedRelation: "employees"
      referencedColumns: ["employee_id"]
    }
                  ]
                },"purchase_order_lines": {
                  Row: {
                    "cancelled_packs": number,"item_id": string,"line_no": number,"ordered_packs": number,"pack_base_qty": number,"pack_cost_cents": number,"po_id": string,"po_line_id": string,"received_packs": number,"supplier_item_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "cancelled_packs"?: number,"item_id": string,"line_no": number,"ordered_packs": number,"pack_base_qty": number,"pack_cost_cents": number,"po_id": string,"po_line_id"?: string,"received_packs"?: number,"supplier_item_id": string
                  }
                  Update: {
                    "cancelled_packs"?: number,"item_id"?: string,"line_no"?: number,"ordered_packs"?: number,"pack_base_qty"?: number,"pack_cost_cents"?: number,"po_id"?: string,"po_line_id"?: string,"received_packs"?: number,"supplier_item_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "purchase_order_lines_item_id_fkey"
      columns: ["item_id"]
isOneToOne: false
      referencedRelation: "items"
      referencedColumns: ["item_id"]
    },{
      foreignKeyName: "purchase_order_lines_po_id_fkey"
      columns: ["po_id"]
isOneToOne: false
      referencedRelation: "purchase_orders"
      referencedColumns: ["po_id"]
    },{
      foreignKeyName: "purchase_order_lines_supplier_item_id_fkey"
      columns: ["supplier_item_id"]
isOneToOne: false
      referencedRelation: "supplier_items"
      referencedColumns: ["supplier_item_id"]
    }
                  ]
                },"purchase_orders": {
                  Row: {
                    "close_reason": string | null,"closed_at": string | null,"created_at": string,"created_by": string | null,"expected_date": string | null,"location_id": string,"note": string | null,"po_id": string,"po_number": string,"provenance": string,"status": string,"submitted_at": string | null,"submitted_by": string | null,"supplier_id": string,"version": number
                  }
                  ComputedFields: never
                  Insert: {
                    "close_reason"?: string | null,"closed_at"?: string | null,"created_at"?: string,"created_by"?: string | null,"expected_date"?: string | null,"location_id": string,"note"?: string | null,"po_id"?: string,"po_number": string,"provenance"?: string,"status"?: string,"submitted_at"?: string | null,"submitted_by"?: string | null,"supplier_id": string,"version"?: number
                  }
                  Update: {
                    "close_reason"?: string | null,"closed_at"?: string | null,"created_at"?: string,"created_by"?: string | null,"expected_date"?: string | null,"location_id"?: string,"note"?: string | null,"po_id"?: string,"po_number"?: string,"provenance"?: string,"status"?: string,"submitted_at"?: string | null,"submitted_by"?: string | null,"supplier_id"?: string,"version"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "purchase_orders_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "employees"
      referencedColumns: ["employee_id"]
    },{
      foreignKeyName: "purchase_orders_location_id_fkey"
      columns: ["location_id"]
isOneToOne: false
      referencedRelation: "locations"
      referencedColumns: ["location_id"]
    },{
      foreignKeyName: "purchase_orders_submitted_by_fkey"
      columns: ["submitted_by"]
isOneToOne: false
      referencedRelation: "employees"
      referencedColumns: ["employee_id"]
    },{
      foreignKeyName: "purchase_orders_supplier_id_fkey"
      columns: ["supplier_id"]
isOneToOne: false
      referencedRelation: "suppliers"
      referencedColumns: ["supplier_id"]
    }
                  ]
                },"reason_codes": {
                  Row: {
                    "active": boolean,"applies_to": (string)[],"code": string,"description": string,"requires_note": boolean
                  }
                  ComputedFields: never
                  Insert: {
                    "active"?: boolean,"applies_to": (string)[],"code": string,"description": string,"requires_note"?: boolean
                  }
                  Update: {
                    "active"?: boolean,"applies_to"?: (string)[],"code"?: string,"description"?: string,"requires_note"?: boolean
                  }
                  Relationships: [
                    
                  ]
                },"receipt_lines": {
                  Row: {
                    "base_quantity": number,"entered_quantity": number,"entered_unit": string,"item_id": string,"line_no": number,"lot_id": string,"movement_id": string,"over_receipt": boolean,"pack_base_qty_snapshot": number | null,"packs_equivalent": number | null,"po_line_id": string | null,"receipt_id": string,"receipt_line_id": string,"supplier_lot": string | null,"unit_cost": number,"use_by_date": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "base_quantity": number,"entered_quantity": number,"entered_unit": string,"item_id": string,"line_no": number,"lot_id": string,"movement_id": string,"over_receipt"?: boolean,"pack_base_qty_snapshot"?: number | null,"packs_equivalent"?: number | null,"po_line_id"?: string | null,"receipt_id": string,"receipt_line_id"?: string,"supplier_lot"?: string | null,"unit_cost": number,"use_by_date"?: string | null
                  }
                  Update: {
                    "base_quantity"?: number,"entered_quantity"?: number,"entered_unit"?: string,"item_id"?: string,"line_no"?: number,"lot_id"?: string,"movement_id"?: string,"over_receipt"?: boolean,"pack_base_qty_snapshot"?: number | null,"packs_equivalent"?: number | null,"po_line_id"?: string | null,"receipt_id"?: string,"receipt_line_id"?: string,"supplier_lot"?: string | null,"unit_cost"?: number,"use_by_date"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "receipt_lines_item_id_fkey"
      columns: ["item_id"]
isOneToOne: false
      referencedRelation: "items"
      referencedColumns: ["item_id"]
    },{
      foreignKeyName: "receipt_lines_lot_id_fkey"
      columns: ["lot_id"]
isOneToOne: false
      referencedRelation: "lots"
      referencedColumns: ["lot_id"]
    },{
      foreignKeyName: "receipt_lines_movement_id_fkey"
      columns: ["movement_id"]
isOneToOne: false
      referencedRelation: "inventory_movements"
      referencedColumns: ["movement_id"]
    },{
      foreignKeyName: "receipt_lines_po_line_id_fkey"
      columns: ["po_line_id"]
isOneToOne: false
      referencedRelation: "purchase_order_lines"
      referencedColumns: ["po_line_id"]
    },{
      foreignKeyName: "receipt_lines_receipt_id_fkey"
      columns: ["receipt_id"]
isOneToOne: false
      referencedRelation: "receipts"
      referencedColumns: ["receipt_id"]
    }
                  ]
                },"receipts": {
                  Row: {
                    "business_date": string,"location_id": string,"note": string | null,"over_receipt_acknowledged_by": string | null,"packing_slip_ref": string | null,"po_id": string | null,"provenance": string,"receipt_id": string,"receipt_number": string,"received_at": string,"received_by": string,"request_key": string | null,"supplier_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "business_date"?: string,"location_id": string,"note"?: string | null,"over_receipt_acknowledged_by"?: string | null,"packing_slip_ref"?: string | null,"po_id"?: string | null,"provenance"?: string,"receipt_id"?: string,"receipt_number": string,"received_at"?: string,"received_by": string,"request_key"?: string | null,"supplier_id": string
                  }
                  Update: {
                    "business_date"?: string,"location_id"?: string,"note"?: string | null,"over_receipt_acknowledged_by"?: string | null,"packing_slip_ref"?: string | null,"po_id"?: string | null,"provenance"?: string,"receipt_id"?: string,"receipt_number"?: string,"received_at"?: string,"received_by"?: string,"request_key"?: string | null,"supplier_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "receipts_location_id_fkey"
      columns: ["location_id"]
isOneToOne: false
      referencedRelation: "locations"
      referencedColumns: ["location_id"]
    },{
      foreignKeyName: "receipts_over_receipt_acknowledged_by_fkey"
      columns: ["over_receipt_acknowledged_by"]
isOneToOne: false
      referencedRelation: "employees"
      referencedColumns: ["employee_id"]
    },{
      foreignKeyName: "receipts_po_id_fkey"
      columns: ["po_id"]
isOneToOne: false
      referencedRelation: "purchase_orders"
      referencedColumns: ["po_id"]
    },{
      foreignKeyName: "receipts_received_by_fkey"
      columns: ["received_by"]
isOneToOne: false
      referencedRelation: "employees"
      referencedColumns: ["employee_id"]
    },{
      foreignKeyName: "receipts_supplier_id_fkey"
      columns: ["supplier_id"]
isOneToOne: false
      referencedRelation: "suppliers"
      referencedColumns: ["supplier_id"]
    }
                  ]
                },"recipe_components": {
                  Row: {
                    "basis": string,"component_item_id": string,"component_item_type": string,"line_no": number,"quantity_per_serving": number,"recipe_version_id": string,"source": string,"unit": string
                  }
                  ComputedFields: never
                  Insert: {
                    "basis": string,"component_item_id": string,"component_item_type"?: string,"line_no": number,"quantity_per_serving": number,"recipe_version_id": string,"source": string,"unit": string
                  }
                  Update: {
                    "basis"?: string,"component_item_id"?: string,"component_item_type"?: string,"line_no"?: number,"quantity_per_serving"?: number,"recipe_version_id"?: string,"source"?: string,"unit"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "recipe_components_component_item_id_component_item_type_un_fkey"
      columns: ["component_item_id","component_item_type","unit"]
isOneToOne: false
      referencedRelation: "items"
      referencedColumns: ["item_id","item_type","base_unit"]
    },{
      foreignKeyName: "recipe_components_recipe_version_id_fkey"
      columns: ["recipe_version_id"]
isOneToOne: false
      referencedRelation: "recipe_versions"
      referencedColumns: ["recipe_version_id"]
    }
                  ]
                },"recipe_versions": {
                  Row: {
                    "activated_at": string | null,"basis": string,"created_at": string,"created_by": string | null,"parent_base_unit": string,"parent_item_id": string,"parent_item_type": string,"provenance": string,"recipe_version_id": string,"source": string,"status": string,"superseded_at": string | null,"version_no": number
                  }
                  ComputedFields: never
                  Insert: {
                    "activated_at"?: string | null,"basis": string,"created_at"?: string,"created_by"?: string | null,"parent_base_unit"?: string,"parent_item_id": string,"parent_item_type"?: string,"provenance": string,"recipe_version_id"?: string,"source": string,"status"?: string,"superseded_at"?: string | null,"version_no": number
                  }
                  Update: {
                    "activated_at"?: string | null,"basis"?: string,"created_at"?: string,"created_by"?: string | null,"parent_base_unit"?: string,"parent_item_id"?: string,"parent_item_type"?: string,"provenance"?: string,"recipe_version_id"?: string,"source"?: string,"status"?: string,"superseded_at"?: string | null,"version_no"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "recipe_versions_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "employees"
      referencedColumns: ["employee_id"]
    },{
      foreignKeyName: "recipe_versions_parent_item_id_parent_item_type_parent_bas_fkey"
      columns: ["parent_item_id","parent_item_type","parent_base_unit"]
isOneToOne: false
      referencedRelation: "items"
      referencedColumns: ["item_id","item_type","base_unit"]
    }
                  ]
                },"refund_lines": {
                  Row: {
                    "net_cents": number,"order_line_id": string,"quantity": number | null,"refund_id": string,"tax_cents": number
                  }
                  ComputedFields: never
                  Insert: {
                    "net_cents": number,"order_line_id": string,"quantity"?: number | null,"refund_id": string,"tax_cents": number
                  }
                  Update: {
                    "net_cents"?: number,"order_line_id"?: string,"quantity"?: number | null,"refund_id"?: string,"tax_cents"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "refund_lines_order_line_id_fkey"
      columns: ["order_line_id"]
isOneToOne: false
      referencedRelation: "order_lines"
      referencedColumns: ["order_line_id"]
    },{
      foreignKeyName: "refund_lines_refund_id_fkey"
      columns: ["refund_id"]
isOneToOne: false
      referencedRelation: "refunds"
      referencedColumns: ["refund_id"]
    }
                  ]
                },"refunds": {
                  Row: {
                    "amount_cents": number,"approved_by": string,"business_date": string,"external_reference": string | null,"kind": string,"location_id": string,"method": string,"net_cents": number,"note": string | null,"order_id": string,"paid_out_cents": number,"paid_out_method": string | null,"reason_code": string,"recorded_at": string,"recorded_by": string,"refund_id": string,"refund_mode": string,"refund_number": string,"request_key": string | null,"return_id": string | null,"tax_cents": number
                  }
                  ComputedFields: never
                  Insert: {
                    "amount_cents": number,"approved_by": string,"business_date"?: string,"external_reference"?: string | null,"kind": string,"location_id": string,"method": string,"net_cents": number,"note"?: string | null,"order_id": string,"paid_out_cents": number,"paid_out_method"?: string | null,"reason_code": string,"recorded_at"?: string,"recorded_by": string,"refund_id"?: string,"refund_mode": string,"refund_number": string,"request_key"?: string | null,"return_id"?: string | null,"tax_cents": number
                  }
                  Update: {
                    "amount_cents"?: number,"approved_by"?: string,"business_date"?: string,"external_reference"?: string | null,"kind"?: string,"location_id"?: string,"method"?: string,"net_cents"?: number,"note"?: string | null,"order_id"?: string,"paid_out_cents"?: number,"paid_out_method"?: string | null,"reason_code"?: string,"recorded_at"?: string,"recorded_by"?: string,"refund_id"?: string,"refund_mode"?: string,"refund_number"?: string,"request_key"?: string | null,"return_id"?: string | null,"tax_cents"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "refunds_approved_by_fkey"
      columns: ["approved_by"]
isOneToOne: false
      referencedRelation: "employees"
      referencedColumns: ["employee_id"]
    },{
      foreignKeyName: "refunds_location_id_fkey"
      columns: ["location_id"]
isOneToOne: false
      referencedRelation: "locations"
      referencedColumns: ["location_id"]
    },{
      foreignKeyName: "refunds_order_id_fkey"
      columns: ["order_id"]
isOneToOne: false
      referencedRelation: "orders"
      referencedColumns: ["order_id"]
    },{
      foreignKeyName: "refunds_reason_code_fkey"
      columns: ["reason_code"]
isOneToOne: false
      referencedRelation: "reason_codes"
      referencedColumns: ["code"]
    },{
      foreignKeyName: "refunds_recorded_by_fkey"
      columns: ["recorded_by"]
isOneToOne: false
      referencedRelation: "employees"
      referencedColumns: ["employee_id"]
    },{
      foreignKeyName: "refunds_return_fk"
      columns: ["return_id"]
isOneToOne: false
      referencedRelation: "returns"
      referencedColumns: ["return_id"]
    }
                  ]
                },"reservation_allocations": {
                  Row: {
                    "allocation_id": string,"closed_at": string | null,"consumed_movement_id": string | null,"created_at": string,"item_id": string,"location_id": string,"lot_id": string,"order_id": string,"purpose": string,"quantity": number,"status": string
                  }
                  ComputedFields: never
                  Insert: {
                    "allocation_id"?: string,"closed_at"?: string | null,"consumed_movement_id"?: string | null,"created_at"?: string,"item_id": string,"location_id": string,"lot_id": string,"order_id": string,"purpose": string,"quantity": number,"status"?: string
                  }
                  Update: {
                    "allocation_id"?: string,"closed_at"?: string | null,"consumed_movement_id"?: string | null,"created_at"?: string,"item_id"?: string,"location_id"?: string,"lot_id"?: string,"order_id"?: string,"purpose"?: string,"quantity"?: number,"status"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "reservation_allocations_consumed_movement_id_fkey"
      columns: ["consumed_movement_id"]
isOneToOne: false
      referencedRelation: "inventory_movements"
      referencedColumns: ["movement_id"]
    },{
      foreignKeyName: "reservation_allocations_item_id_fkey"
      columns: ["item_id"]
isOneToOne: false
      referencedRelation: "items"
      referencedColumns: ["item_id"]
    },{
      foreignKeyName: "reservation_allocations_location_id_fkey"
      columns: ["location_id"]
isOneToOne: false
      referencedRelation: "locations"
      referencedColumns: ["location_id"]
    },{
      foreignKeyName: "reservation_allocations_lot_id_fkey"
      columns: ["lot_id"]
isOneToOne: false
      referencedRelation: "lots"
      referencedColumns: ["lot_id"]
    },{
      foreignKeyName: "reservation_allocations_order_fk"
      columns: ["order_id"]
isOneToOne: false
      referencedRelation: "orders"
      referencedColumns: ["order_id"]
    }
                  ]
                },"return_custody": {
                  Row: {
                    "custody_id": string,"decided_at": string | null,"decided_by": string | null,"decision_note": string | null,"item_id": string,"location_id": string,"quantity": number,"restock_lot_id": string | null,"restock_movement_id": string | null,"return_line_id": string,"status": string,"unit_issue_cost": number
                  }
                  ComputedFields: never
                  Insert: {
                    "custody_id"?: string,"decided_at"?: string | null,"decided_by"?: string | null,"decision_note"?: string | null,"item_id": string,"location_id": string,"quantity": number,"restock_lot_id"?: string | null,"restock_movement_id"?: string | null,"return_line_id": string,"status"?: string,"unit_issue_cost": number
                  }
                  Update: {
                    "custody_id"?: string,"decided_at"?: string | null,"decided_by"?: string | null,"decision_note"?: string | null,"item_id"?: string,"location_id"?: string,"quantity"?: number,"restock_lot_id"?: string | null,"restock_movement_id"?: string | null,"return_line_id"?: string,"status"?: string,"unit_issue_cost"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "return_custody_decided_by_fkey"
      columns: ["decided_by"]
isOneToOne: false
      referencedRelation: "employees"
      referencedColumns: ["employee_id"]
    },{
      foreignKeyName: "return_custody_item_id_fkey"
      columns: ["item_id"]
isOneToOne: false
      referencedRelation: "items"
      referencedColumns: ["item_id"]
    },{
      foreignKeyName: "return_custody_location_id_fkey"
      columns: ["location_id"]
isOneToOne: false
      referencedRelation: "locations"
      referencedColumns: ["location_id"]
    },{
      foreignKeyName: "return_custody_restock_lot_id_fkey"
      columns: ["restock_lot_id"]
isOneToOne: false
      referencedRelation: "lots"
      referencedColumns: ["lot_id"]
    },{
      foreignKeyName: "return_custody_restock_movement_id_fkey"
      columns: ["restock_movement_id"]
isOneToOne: false
      referencedRelation: "inventory_movements"
      referencedColumns: ["movement_id"]
    },{
      foreignKeyName: "return_custody_return_line_id_fkey"
      columns: ["return_line_id"]
isOneToOne: true
      referencedRelation: "return_lines"
      referencedColumns: ["return_line_id"]
    }
                  ]
                },"return_lines": {
                  Row: {
                    "condition": string,"item_id": string,"order_line_id": string,"quantity": number,"return_id": string,"return_line_id": string,"stock_returned": boolean,"unit_issue_cost": number
                  }
                  ComputedFields: never
                  Insert: {
                    "condition": string,"item_id": string,"order_line_id": string,"quantity": number,"return_id": string,"return_line_id"?: string,"stock_returned": boolean,"unit_issue_cost": number
                  }
                  Update: {
                    "condition"?: string,"item_id"?: string,"order_line_id"?: string,"quantity"?: number,"return_id"?: string,"return_line_id"?: string,"stock_returned"?: boolean,"unit_issue_cost"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "return_lines_item_id_fkey"
      columns: ["item_id"]
isOneToOne: false
      referencedRelation: "items"
      referencedColumns: ["item_id"]
    },{
      foreignKeyName: "return_lines_order_line_id_fkey"
      columns: ["order_line_id"]
isOneToOne: false
      referencedRelation: "order_lines"
      referencedColumns: ["order_line_id"]
    },{
      foreignKeyName: "return_lines_return_id_fkey"
      columns: ["return_id"]
isOneToOne: false
      referencedRelation: "returns"
      referencedColumns: ["return_id"]
    }
                  ]
                },"return_policy": {
                  Row: {
                    "allow_customer_restock": boolean,"configured_at": string,"configured_by": string | null,"provenance": string,"singleton": boolean,"window_days": number
                  }
                  ComputedFields: never
                  Insert: {
                    "allow_customer_restock"?: boolean,"configured_at"?: string,"configured_by"?: string | null,"provenance": string,"singleton"?: boolean,"window_days": number
                  }
                  Update: {
                    "allow_customer_restock"?: boolean,"configured_at"?: string,"configured_by"?: string | null,"provenance"?: string,"singleton"?: boolean,"window_days"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "return_policy_configured_by_fkey"
      columns: ["configured_by"]
isOneToOne: false
      referencedRelation: "employees"
      referencedColumns: ["employee_id"]
    }
                  ]
                },"returns": {
                  Row: {
                    "approved_by": string,"business_date": string,"location_id": string,"note": string | null,"order_id": string,"processed_at": string,"processed_by": string,"reason_code": string,"request_key": string | null,"return_id": string,"return_number": string
                  }
                  ComputedFields: never
                  Insert: {
                    "approved_by": string,"business_date"?: string,"location_id": string,"note"?: string | null,"order_id": string,"processed_at"?: string,"processed_by": string,"reason_code": string,"request_key"?: string | null,"return_id"?: string,"return_number": string
                  }
                  Update: {
                    "approved_by"?: string,"business_date"?: string,"location_id"?: string,"note"?: string | null,"order_id"?: string,"processed_at"?: string,"processed_by"?: string,"reason_code"?: string,"request_key"?: string | null,"return_id"?: string,"return_number"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "returns_approved_by_fkey"
      columns: ["approved_by"]
isOneToOne: false
      referencedRelation: "employees"
      referencedColumns: ["employee_id"]
    },{
      foreignKeyName: "returns_location_id_fkey"
      columns: ["location_id"]
isOneToOne: false
      referencedRelation: "locations"
      referencedColumns: ["location_id"]
    },{
      foreignKeyName: "returns_order_id_fkey"
      columns: ["order_id"]
isOneToOne: false
      referencedRelation: "orders"
      referencedColumns: ["order_id"]
    },{
      foreignKeyName: "returns_processed_by_fkey"
      columns: ["processed_by"]
isOneToOne: false
      referencedRelation: "employees"
      referencedColumns: ["employee_id"]
    },{
      foreignKeyName: "returns_reason_code_fkey"
      columns: ["reason_code"]
isOneToOne: false
      referencedRelation: "reason_codes"
      referencedColumns: ["code"]
    }
                  ]
                },"stock_balances": {
                  Row: {
                    "condition": string,"item_id": string,"location_id": string,"lot_id": string,"on_hand": number,"reserved": number,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "condition": string,"item_id": string,"location_id": string,"lot_id": string,"on_hand"?: number,"reserved"?: number,"updated_at"?: string
                  }
                  Update: {
                    "condition"?: string,"item_id"?: string,"location_id"?: string,"lot_id"?: string,"on_hand"?: number,"reserved"?: number,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "stock_balances_item_id_fkey"
      columns: ["item_id"]
isOneToOne: false
      referencedRelation: "items"
      referencedColumns: ["item_id"]
    },{
      foreignKeyName: "stock_balances_location_id_fkey"
      columns: ["location_id"]
isOneToOne: false
      referencedRelation: "locations"
      referencedColumns: ["location_id"]
    },{
      foreignKeyName: "stock_balances_lot_id_fkey"
      columns: ["lot_id"]
isOneToOne: false
      referencedRelation: "lots"
      referencedColumns: ["lot_id"]
    }
                  ]
                },"stock_count_lines": {
                  Row: {
                    "condition": string,"count_id": string,"counted_qty": number | null,"expected_qty": number,"item_id": string,"lot_id": string,"movement_id": string | null,"unit_cost": number | null,"variance": number | null
                  }
                  ComputedFields: never
                  Insert: {
                    "condition": string,"count_id": string,"counted_qty"?: number | null,"expected_qty": number,"item_id": string,"lot_id": string,"movement_id"?: string | null,"unit_cost"?: number | null,"variance"?: never
                  }
                  Update: {
                    "condition"?: string,"count_id"?: string,"counted_qty"?: number | null,"expected_qty"?: number,"item_id"?: string,"lot_id"?: string,"movement_id"?: string | null,"unit_cost"?: number | null,"variance"?: never
                  }
                  Relationships: [
                    {
      foreignKeyName: "stock_count_lines_count_id_fkey"
      columns: ["count_id"]
isOneToOne: false
      referencedRelation: "stock_counts"
      referencedColumns: ["count_id"]
    },{
      foreignKeyName: "stock_count_lines_item_id_fkey"
      columns: ["item_id"]
isOneToOne: false
      referencedRelation: "items"
      referencedColumns: ["item_id"]
    },{
      foreignKeyName: "stock_count_lines_lot_id_fkey"
      columns: ["lot_id"]
isOneToOne: false
      referencedRelation: "lots"
      referencedColumns: ["lot_id"]
    },{
      foreignKeyName: "stock_count_lines_movement_id_fkey"
      columns: ["movement_id"]
isOneToOne: false
      referencedRelation: "inventory_movements"
      referencedColumns: ["movement_id"]
    }
                  ]
                },"stock_counts": {
                  Row: {
                    "cancelled_at": string | null,"count_id": string,"count_number": string,"created_at": string,"created_by": string,"item_ids": (string)[],"location_id": string,"note": string | null,"posted_at": string | null,"posted_by": string | null,"reason_code": string | null,"snapshot_movement_no": number,"status": string,"version": number
                  }
                  ComputedFields: never
                  Insert: {
                    "cancelled_at"?: string | null,"count_id"?: string,"count_number": string,"created_at"?: string,"created_by": string,"item_ids": (string)[],"location_id": string,"note"?: string | null,"posted_at"?: string | null,"posted_by"?: string | null,"reason_code"?: string | null,"snapshot_movement_no": number,"status"?: string,"version"?: number
                  }
                  Update: {
                    "cancelled_at"?: string | null,"count_id"?: string,"count_number"?: string,"created_at"?: string,"created_by"?: string,"item_ids"?: (string)[],"location_id"?: string,"note"?: string | null,"posted_at"?: string | null,"posted_by"?: string | null,"reason_code"?: string | null,"snapshot_movement_no"?: number,"status"?: string,"version"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "stock_counts_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "employees"
      referencedColumns: ["employee_id"]
    },{
      foreignKeyName: "stock_counts_location_id_fkey"
      columns: ["location_id"]
isOneToOne: false
      referencedRelation: "locations"
      referencedColumns: ["location_id"]
    },{
      foreignKeyName: "stock_counts_posted_by_fkey"
      columns: ["posted_by"]
isOneToOne: false
      referencedRelation: "employees"
      referencedColumns: ["employee_id"]
    },{
      foreignKeyName: "stock_counts_reason_code_fkey"
      columns: ["reason_code"]
isOneToOne: false
      referencedRelation: "reason_codes"
      referencedColumns: ["code"]
    }
                  ]
                },"supplier_credit_reversals": {
                  Row: {
                    "credit_id": string,"reason": string,"request_key": string | null,"reversed_at": string,"reversed_by": string
                  }
                  ComputedFields: never
                  Insert: {
                    "credit_id": string,"reason": string,"request_key"?: string | null,"reversed_at"?: string,"reversed_by": string
                  }
                  Update: {
                    "credit_id"?: string,"reason"?: string,"request_key"?: string | null,"reversed_at"?: string,"reversed_by"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "supplier_credit_reversals_credit_id_fkey"
      columns: ["credit_id"]
isOneToOne: true
      referencedRelation: "supplier_credits"
      referencedColumns: ["credit_id"]
    },{
      foreignKeyName: "supplier_credit_reversals_reversed_by_fkey"
      columns: ["reversed_by"]
isOneToOne: false
      referencedRelation: "employees"
      referencedColumns: ["employee_id"]
    }
                  ]
                },"supplier_credits": {
                  Row: {
                    "amount_cents": number,"credit_id": string,"credit_memo_ref": string | null,"credit_number": string,"credited_on": string,"invoice_id": string,"location_id": string,"reason": string,"recorded_at": string,"recorded_by": string,"request_key": string | null,"supplier_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "amount_cents": number,"credit_id"?: string,"credit_memo_ref"?: string | null,"credit_number": string,"credited_on": string,"invoice_id": string,"location_id": string,"reason": string,"recorded_at"?: string,"recorded_by": string,"request_key"?: string | null,"supplier_id": string
                  }
                  Update: {
                    "amount_cents"?: number,"credit_id"?: string,"credit_memo_ref"?: string | null,"credit_number"?: string,"credited_on"?: string,"invoice_id"?: string,"location_id"?: string,"reason"?: string,"recorded_at"?: string,"recorded_by"?: string,"request_key"?: string | null,"supplier_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "supplier_credits_invoice_id_fkey"
      columns: ["invoice_id"]
isOneToOne: false
      referencedRelation: "supplier_invoices"
      referencedColumns: ["invoice_id"]
    },{
      foreignKeyName: "supplier_credits_location_id_fkey"
      columns: ["location_id"]
isOneToOne: false
      referencedRelation: "locations"
      referencedColumns: ["location_id"]
    },{
      foreignKeyName: "supplier_credits_recorded_by_fkey"
      columns: ["recorded_by"]
isOneToOne: false
      referencedRelation: "employees"
      referencedColumns: ["employee_id"]
    },{
      foreignKeyName: "supplier_credits_supplier_id_fkey"
      columns: ["supplier_id"]
isOneToOne: false
      referencedRelation: "suppliers"
      referencedColumns: ["supplier_id"]
    }
                  ]
                },"supplier_invoice_lines": {
                  Row: {
                    "description": string | null,"discrepancy": string | null,"invoice_id": string,"invoice_line_id": string,"item_id": string | null,"line_cents": number,"line_no": number,"price_variance_cents": number | null,"qty_variance": number | null,"quantity": number,"receipt_line_id": string | null,"receipt_unit_cost": number | null,"received_qty": number | null,"revision": number,"unit_price": number
                  }
                  ComputedFields: never
                  Insert: {
                    "description"?: string | null,"discrepancy"?: string | null,"invoice_id": string,"invoice_line_id"?: string,"item_id"?: string | null,"line_cents": number,"line_no": number,"price_variance_cents"?: number | null,"qty_variance"?: number | null,"quantity": number,"receipt_line_id"?: string | null,"receipt_unit_cost"?: number | null,"received_qty"?: number | null,"revision": number,"unit_price": number
                  }
                  Update: {
                    "description"?: string | null,"discrepancy"?: string | null,"invoice_id"?: string,"invoice_line_id"?: string,"item_id"?: string | null,"line_cents"?: number,"line_no"?: number,"price_variance_cents"?: number | null,"qty_variance"?: number | null,"quantity"?: number,"receipt_line_id"?: string | null,"receipt_unit_cost"?: number | null,"received_qty"?: number | null,"revision"?: number,"unit_price"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "supplier_invoice_lines_invoice_id_fkey"
      columns: ["invoice_id"]
isOneToOne: false
      referencedRelation: "supplier_invoices"
      referencedColumns: ["invoice_id"]
    },{
      foreignKeyName: "supplier_invoice_lines_item_id_fkey"
      columns: ["item_id"]
isOneToOne: false
      referencedRelation: "items"
      referencedColumns: ["item_id"]
    },{
      foreignKeyName: "supplier_invoice_lines_receipt_line_id_fkey"
      columns: ["receipt_line_id"]
isOneToOne: false
      referencedRelation: "receipt_lines"
      referencedColumns: ["receipt_line_id"]
    }
                  ]
                },"supplier_invoices": {
                  Row: {
                    "created_at": string,"created_by": string,"discrepancy_accepted_at": string | null,"discrepancy_accepted_by": string | null,"discrepancy_accepted_revision": number | null,"discrepancy_note": string | null,"due_date": string,"due_date_source": string,"has_discrepancy": boolean,"invoice_date": string,"invoice_id": string,"invoice_number": string,"lines_cents": number,"location_id": string,"note": string | null,"other_cents": number,"provenance": string,"record_mode": string,"revision": number,"status": string,"supplier_id": string,"tax_cents": number,"terms_days_snapshot": number | null,"total_cents": number,"version": number,"void_reason": string | null,"voided_at": string | null,"voided_by": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"created_by": string,"discrepancy_accepted_at"?: string | null,"discrepancy_accepted_by"?: string | null,"discrepancy_accepted_revision"?: number | null,"discrepancy_note"?: string | null,"due_date": string,"due_date_source": string,"has_discrepancy": boolean,"invoice_date": string,"invoice_id"?: string,"invoice_number": string,"lines_cents": number,"location_id": string,"note"?: string | null,"other_cents"?: number,"provenance"?: string,"record_mode": string,"revision"?: number,"status"?: string,"supplier_id": string,"tax_cents"?: number,"terms_days_snapshot"?: number | null,"total_cents": number,"version"?: number,"void_reason"?: string | null,"voided_at"?: string | null,"voided_by"?: string | null
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string,"discrepancy_accepted_at"?: string | null,"discrepancy_accepted_by"?: string | null,"discrepancy_accepted_revision"?: number | null,"discrepancy_note"?: string | null,"due_date"?: string,"due_date_source"?: string,"has_discrepancy"?: boolean,"invoice_date"?: string,"invoice_id"?: string,"invoice_number"?: string,"lines_cents"?: number,"location_id"?: string,"note"?: string | null,"other_cents"?: number,"provenance"?: string,"record_mode"?: string,"revision"?: number,"status"?: string,"supplier_id"?: string,"tax_cents"?: number,"terms_days_snapshot"?: number | null,"total_cents"?: number,"version"?: number,"void_reason"?: string | null,"voided_at"?: string | null,"voided_by"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "supplier_invoices_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "employees"
      referencedColumns: ["employee_id"]
    },{
      foreignKeyName: "supplier_invoices_discrepancy_accepted_by_fkey"
      columns: ["discrepancy_accepted_by"]
isOneToOne: false
      referencedRelation: "employees"
      referencedColumns: ["employee_id"]
    },{
      foreignKeyName: "supplier_invoices_location_id_fkey"
      columns: ["location_id"]
isOneToOne: false
      referencedRelation: "locations"
      referencedColumns: ["location_id"]
    },{
      foreignKeyName: "supplier_invoices_supplier_id_fkey"
      columns: ["supplier_id"]
isOneToOne: false
      referencedRelation: "suppliers"
      referencedColumns: ["supplier_id"]
    },{
      foreignKeyName: "supplier_invoices_voided_by_fkey"
      columns: ["voided_by"]
isOneToOne: false
      referencedRelation: "employees"
      referencedColumns: ["employee_id"]
    }
                  ]
                },"supplier_items": {
                  Row: {
                    "archived_at": string | null,"cost_basis": string | null,"created_at": string,"effective_date": string | null,"is_primary": boolean,"is_purchasable": boolean,"item_id": string,"lead_time_basis": string | null,"pack_base_qty": number | null,"pack_cost_cents": number | null,"pack_description": string | null,"procurement_lead_days": number | null,"provenance": string,"source": string,"supplier_id": string,"supplier_item_id": string,"unit_cost": number | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "archived_at"?: string | null,"cost_basis"?: string | null,"created_at"?: string,"effective_date"?: string | null,"is_primary"?: boolean,"is_purchasable"?: boolean,"item_id": string,"lead_time_basis"?: string | null,"pack_base_qty"?: number | null,"pack_cost_cents"?: number | null,"pack_description"?: string | null,"procurement_lead_days"?: number | null,"provenance": string,"source": string,"supplier_id": string,"supplier_item_id"?: string,"unit_cost"?: number | null,"updated_at"?: string
                  }
                  Update: {
                    "archived_at"?: string | null,"cost_basis"?: string | null,"created_at"?: string,"effective_date"?: string | null,"is_primary"?: boolean,"is_purchasable"?: boolean,"item_id"?: string,"lead_time_basis"?: string | null,"pack_base_qty"?: number | null,"pack_cost_cents"?: number | null,"pack_description"?: string | null,"procurement_lead_days"?: number | null,"provenance"?: string,"source"?: string,"supplier_id"?: string,"supplier_item_id"?: string,"unit_cost"?: number | null,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "supplier_items_item_id_is_purchasable_fkey"
      columns: ["item_id","is_purchasable"]
isOneToOne: false
      referencedRelation: "items"
      referencedColumns: ["item_id","is_purchasable"]
    },{
      foreignKeyName: "supplier_items_supplier_id_fkey"
      columns: ["supplier_id"]
isOneToOne: false
      referencedRelation: "suppliers"
      referencedColumns: ["supplier_id"]
    }
                  ]
                },"supplier_payment_reversals": {
                  Row: {
                    "payment_id": string,"reason": string,"request_key": string | null,"reversed_at": string,"reversed_by": string
                  }
                  ComputedFields: never
                  Insert: {
                    "payment_id": string,"reason": string,"request_key"?: string | null,"reversed_at"?: string,"reversed_by": string
                  }
                  Update: {
                    "payment_id"?: string,"reason"?: string,"request_key"?: string | null,"reversed_at"?: string,"reversed_by"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "supplier_payment_reversals_payment_id_fkey"
      columns: ["payment_id"]
isOneToOne: true
      referencedRelation: "supplier_payments"
      referencedColumns: ["payment_id"]
    },{
      foreignKeyName: "supplier_payment_reversals_reversed_by_fkey"
      columns: ["reversed_by"]
isOneToOne: false
      referencedRelation: "employees"
      referencedColumns: ["employee_id"]
    }
                  ]
                },"supplier_payments": {
                  Row: {
                    "amount_cents": number,"external_reference": string | null,"invoice_id": string,"location_id": string,"method": string,"note": string | null,"paid_on": string,"payment_id": string,"payment_number": string,"record_mode": string,"recorded_at": string,"recorded_by": string,"request_key": string | null,"supplier_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "amount_cents": number,"external_reference"?: string | null,"invoice_id": string,"location_id": string,"method": string,"note"?: string | null,"paid_on": string,"payment_id"?: string,"payment_number": string,"record_mode": string,"recorded_at"?: string,"recorded_by": string,"request_key"?: string | null,"supplier_id": string
                  }
                  Update: {
                    "amount_cents"?: number,"external_reference"?: string | null,"invoice_id"?: string,"location_id"?: string,"method"?: string,"note"?: string | null,"paid_on"?: string,"payment_id"?: string,"payment_number"?: string,"record_mode"?: string,"recorded_at"?: string,"recorded_by"?: string,"request_key"?: string | null,"supplier_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "supplier_payments_invoice_id_fkey"
      columns: ["invoice_id"]
isOneToOne: false
      referencedRelation: "supplier_invoices"
      referencedColumns: ["invoice_id"]
    },{
      foreignKeyName: "supplier_payments_location_id_fkey"
      columns: ["location_id"]
isOneToOne: false
      referencedRelation: "locations"
      referencedColumns: ["location_id"]
    },{
      foreignKeyName: "supplier_payments_recorded_by_fkey"
      columns: ["recorded_by"]
isOneToOne: false
      referencedRelation: "employees"
      referencedColumns: ["employee_id"]
    },{
      foreignKeyName: "supplier_payments_supplier_id_fkey"
      columns: ["supplier_id"]
isOneToOne: false
      referencedRelation: "suppliers"
      referencedColumns: ["supplier_id"]
    }
                  ]
                },"suppliers": {
                  Row: {
                    "address": string | null,"archived_at": string | null,"based_in": string | null,"contact_email": string | null,"contact_email_provenance": string | null,"contact_verification": string,"created_at": string,"name": string,"payment_terms_days": number | null,"payment_terms_provenance": string | null,"phone": string | null,"provenance": string,"source": string,"source_note": string | null,"supplier_id": string,"supplier_type": string | null,"updated_at": string,"what_we_buy": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "address"?: string | null,"archived_at"?: string | null,"based_in"?: string | null,"contact_email"?: string | null,"contact_email_provenance"?: string | null,"contact_verification"?: string,"created_at"?: string,"name": string,"payment_terms_days"?: number | null,"payment_terms_provenance"?: string | null,"phone"?: string | null,"provenance": string,"source": string,"source_note"?: string | null,"supplier_id": string,"supplier_type"?: string | null,"updated_at"?: string,"what_we_buy"?: string | null
                  }
                  Update: {
                    "address"?: string | null,"archived_at"?: string | null,"based_in"?: string | null,"contact_email"?: string | null,"contact_email_provenance"?: string | null,"contact_verification"?: string,"created_at"?: string,"name"?: string,"payment_terms_days"?: number | null,"payment_terms_provenance"?: string | null,"phone"?: string | null,"provenance"?: string,"source"?: string,"source_note"?: string | null,"supplier_id"?: string,"supplier_type"?: string | null,"updated_at"?: string,"what_we_buy"?: string | null
                  }
                  Relationships: [
                    
                  ]
                },"tenders": {
                  Row: {
                    "amount_cents": number,"business_date": string,"external_reference": string | null,"location_id": string,"method": string,"order_id": string,"recorded_at": string,"recorded_by": string,"request_key": string | null,"tender_id": string,"tender_type": string
                  }
                  ComputedFields: never
                  Insert: {
                    "amount_cents": number,"business_date"?: string,"external_reference"?: string | null,"location_id": string,"method": string,"order_id": string,"recorded_at"?: string,"recorded_by": string,"request_key"?: string | null,"tender_id"?: string,"tender_type": string
                  }
                  Update: {
                    "amount_cents"?: number,"business_date"?: string,"external_reference"?: string | null,"location_id"?: string,"method"?: string,"order_id"?: string,"recorded_at"?: string,"recorded_by"?: string,"request_key"?: string | null,"tender_id"?: string,"tender_type"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "tenders_location_id_fkey"
      columns: ["location_id"]
isOneToOne: false
      referencedRelation: "locations"
      referencedColumns: ["location_id"]
    },{
      foreignKeyName: "tenders_order_id_fkey"
      columns: ["order_id"]
isOneToOne: false
      referencedRelation: "orders"
      referencedColumns: ["order_id"]
    },{
      foreignKeyName: "tenders_recorded_by_fkey"
      columns: ["recorded_by"]
isOneToOne: false
      referencedRelation: "employees"
      referencedColumns: ["employee_id"]
    }
                  ]
                },"transfer_lines": {
                  Row: {
                    "dispatch_movement_id": string,"dispatched_qty": number,"in_transit_qty": number | null,"item_id": string,"lost_qty": number,"received_qty": number,"source_lot_id": string,"transfer_id": string,"transfer_line_id": string,"unit_cost": number,"use_by_date": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "dispatch_movement_id": string,"dispatched_qty": number,"in_transit_qty"?: never,"item_id": string,"lost_qty"?: number,"received_qty"?: number,"source_lot_id": string,"transfer_id": string,"transfer_line_id"?: string,"unit_cost": number,"use_by_date"?: string | null
                  }
                  Update: {
                    "dispatch_movement_id"?: string,"dispatched_qty"?: number,"in_transit_qty"?: never,"item_id"?: string,"lost_qty"?: number,"received_qty"?: number,"source_lot_id"?: string,"transfer_id"?: string,"transfer_line_id"?: string,"unit_cost"?: number,"use_by_date"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "transfer_lines_dispatch_movement_id_fkey"
      columns: ["dispatch_movement_id"]
isOneToOne: false
      referencedRelation: "inventory_movements"
      referencedColumns: ["movement_id"]
    },{
      foreignKeyName: "transfer_lines_item_id_fkey"
      columns: ["item_id"]
isOneToOne: false
      referencedRelation: "items"
      referencedColumns: ["item_id"]
    },{
      foreignKeyName: "transfer_lines_source_lot_id_fkey"
      columns: ["source_lot_id"]
isOneToOne: false
      referencedRelation: "lots"
      referencedColumns: ["lot_id"]
    },{
      foreignKeyName: "transfer_lines_transfer_id_fkey"
      columns: ["transfer_id"]
isOneToOne: false
      referencedRelation: "transfers"
      referencedColumns: ["transfer_id"]
    }
                  ]
                },"transfer_receipts": {
                  Row: {
                    "business_date": string,"condition": string,"dest_lot_id": string | null,"loss_reason_code": string | null,"lost_cost": number,"lost_qty": number,"movement_id": string | null,"note": string | null,"received_at": string,"received_by": string,"received_cost": number,"received_qty": number,"request_key": string | null,"transfer_line_id": string,"transfer_receipt_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "business_date"?: string,"condition": string,"dest_lot_id"?: string | null,"loss_reason_code"?: string | null,"lost_cost": number,"lost_qty": number,"movement_id"?: string | null,"note"?: string | null,"received_at"?: string,"received_by": string,"received_cost": number,"received_qty": number,"request_key"?: string | null,"transfer_line_id": string,"transfer_receipt_id"?: string
                  }
                  Update: {
                    "business_date"?: string,"condition"?: string,"dest_lot_id"?: string | null,"loss_reason_code"?: string | null,"lost_cost"?: number,"lost_qty"?: number,"movement_id"?: string | null,"note"?: string | null,"received_at"?: string,"received_by"?: string,"received_cost"?: number,"received_qty"?: number,"request_key"?: string | null,"transfer_line_id"?: string,"transfer_receipt_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "transfer_receipts_dest_lot_id_fkey"
      columns: ["dest_lot_id"]
isOneToOne: false
      referencedRelation: "lots"
      referencedColumns: ["lot_id"]
    },{
      foreignKeyName: "transfer_receipts_loss_reason_code_fkey"
      columns: ["loss_reason_code"]
isOneToOne: false
      referencedRelation: "reason_codes"
      referencedColumns: ["code"]
    },{
      foreignKeyName: "transfer_receipts_movement_id_fkey"
      columns: ["movement_id"]
isOneToOne: false
      referencedRelation: "inventory_movements"
      referencedColumns: ["movement_id"]
    },{
      foreignKeyName: "transfer_receipts_received_by_fkey"
      columns: ["received_by"]
isOneToOne: false
      referencedRelation: "employees"
      referencedColumns: ["employee_id"]
    },{
      foreignKeyName: "transfer_receipts_transfer_line_id_fkey"
      columns: ["transfer_line_id"]
isOneToOne: false
      referencedRelation: "transfer_lines"
      referencedColumns: ["transfer_line_id"]
    }
                  ]
                },"transfer_requests": {
                  Row: {
                    "is_purchasable": boolean,"item_id": string,"quantity": number,"transfer_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "is_purchasable"?: boolean,"item_id": string,"quantity": number,"transfer_id": string
                  }
                  Update: {
                    "is_purchasable"?: boolean,"item_id"?: string,"quantity"?: number,"transfer_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "transfer_requests_item_id_is_purchasable_fkey"
      columns: ["item_id","is_purchasable"]
isOneToOne: false
      referencedRelation: "items"
      referencedColumns: ["item_id","is_purchasable"]
    },{
      foreignKeyName: "transfer_requests_transfer_id_fkey"
      columns: ["transfer_id"]
isOneToOne: false
      referencedRelation: "transfers"
      referencedColumns: ["transfer_id"]
    }
                  ]
                },"transfers": {
                  Row: {
                    "closed_at": string | null,"created_at": string,"created_by": string,"dispatched_at": string | null,"dispatched_by": string | null,"from_location_id": string,"note": string | null,"status": string,"to_location_id": string,"transfer_id": string,"transfer_number": string,"version": number
                  }
                  ComputedFields: never
                  Insert: {
                    "closed_at"?: string | null,"created_at"?: string,"created_by": string,"dispatched_at"?: string | null,"dispatched_by"?: string | null,"from_location_id": string,"note"?: string | null,"status"?: string,"to_location_id": string,"transfer_id"?: string,"transfer_number": string,"version"?: number
                  }
                  Update: {
                    "closed_at"?: string | null,"created_at"?: string,"created_by"?: string,"dispatched_at"?: string | null,"dispatched_by"?: string | null,"from_location_id"?: string,"note"?: string | null,"status"?: string,"to_location_id"?: string,"transfer_id"?: string,"transfer_number"?: string,"version"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "transfers_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "employees"
      referencedColumns: ["employee_id"]
    },{
      foreignKeyName: "transfers_dispatched_by_fkey"
      columns: ["dispatched_by"]
isOneToOne: false
      referencedRelation: "employees"
      referencedColumns: ["employee_id"]
    },{
      foreignKeyName: "transfers_from_location_id_fkey"
      columns: ["from_location_id"]
isOneToOne: false
      referencedRelation: "locations"
      referencedColumns: ["location_id"]
    },{
      foreignKeyName: "transfers_to_location_id_fkey"
      columns: ["to_location_id"]
isOneToOne: false
      referencedRelation: "locations"
      referencedColumns: ["location_id"]
    }
                  ]
                },"units": {
                  Row: {
                    "description": string,"dimension": string,"factor_to_dimension_base": number,"is_base": boolean,"unit": string
                  }
                  ComputedFields: never
                  Insert: {
                    "description": string,"dimension": string,"factor_to_dimension_base": number,"is_base"?: boolean,"unit": string
                  }
                  Update: {
                    "description"?: string,"dimension"?: string,"factor_to_dimension_base"?: number,"is_base"?: boolean,"unit"?: string
                  }
                  Relationships: [
                    
                  ]
                },"waste_report_lines": {
                  Row: {
                    "is_purchasable": boolean,"item_id": string,"line_no": number,"lot_id": string | null,"posted_cost": number | null,"quantity": number,"waste_report_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "is_purchasable"?: boolean,"item_id": string,"line_no": number,"lot_id"?: string | null,"posted_cost"?: number | null,"quantity": number,"waste_report_id": string
                  }
                  Update: {
                    "is_purchasable"?: boolean,"item_id"?: string,"line_no"?: number,"lot_id"?: string | null,"posted_cost"?: number | null,"quantity"?: number,"waste_report_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "waste_report_lines_item_id_is_purchasable_fkey"
      columns: ["item_id","is_purchasable"]
isOneToOne: false
      referencedRelation: "items"
      referencedColumns: ["item_id","is_purchasable"]
    },{
      foreignKeyName: "waste_report_lines_lot_id_fkey"
      columns: ["lot_id"]
isOneToOne: false
      referencedRelation: "lots"
      referencedColumns: ["lot_id"]
    },{
      foreignKeyName: "waste_report_lines_waste_report_id_fkey"
      columns: ["waste_report_id"]
isOneToOne: false
      referencedRelation: "waste_reports"
      referencedColumns: ["waste_report_id"]
    }
                  ]
                },"waste_reports": {
                  Row: {
                    "business_date": string | null,"decided_at": string | null,"decided_by": string | null,"decision_note": string | null,"location_id": string,"note": string | null,"reason_code": string,"report_number": string,"status": string,"submitted_at": string,"submitted_by": string,"total_cost": number | null,"version": number,"waste_report_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "business_date"?: string | null,"decided_at"?: string | null,"decided_by"?: string | null,"decision_note"?: string | null,"location_id": string,"note"?: string | null,"reason_code": string,"report_number": string,"status"?: string,"submitted_at"?: string,"submitted_by": string,"total_cost"?: number | null,"version"?: number,"waste_report_id"?: string
                  }
                  Update: {
                    "business_date"?: string | null,"decided_at"?: string | null,"decided_by"?: string | null,"decision_note"?: string | null,"location_id"?: string,"note"?: string | null,"reason_code"?: string,"report_number"?: string,"status"?: string,"submitted_at"?: string,"submitted_by"?: string,"total_cost"?: number | null,"version"?: number,"waste_report_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "waste_reports_decided_by_fkey"
      columns: ["decided_by"]
isOneToOne: false
      referencedRelation: "employees"
      referencedColumns: ["employee_id"]
    },{
      foreignKeyName: "waste_reports_location_id_fkey"
      columns: ["location_id"]
isOneToOne: false
      referencedRelation: "locations"
      referencedColumns: ["location_id"]
    },{
      foreignKeyName: "waste_reports_reason_code_fkey"
      columns: ["reason_code"]
isOneToOne: false
      referencedRelation: "reason_codes"
      referencedColumns: ["code"]
    },{
      foreignKeyName: "waste_reports_submitted_by_fkey"
      columns: ["submitted_by"]
isOneToOne: false
      referencedRelation: "employees"
      referencedColumns: ["employee_id"]
    }
                  ]
                }
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "accept_invoice_discrepancy":
{ Args: { "p_approver_employee_id"?: string,"p_expected_version": number,"p_invoice_id": string,"p_note": string,"p_pin"?: string,"p_request_key": string }; Returns: Json
                           },
"accept_order":
{ Args: { "p_approver_employee_id"?: string,"p_customer_id"?: string,"p_discount_percent"?: number,"p_discount_reason"?: string,"p_lines": Json,"p_location_id": string,"p_note"?: string,"p_pickup_name"?: string,"p_pin"?: string,"p_request_key": string }; Returns: Json
                           },
"cancel_order":
{ Args: { "p_approver_employee_id"?: string,"p_expected_version": number,"p_external_reference"?: string,"p_note"?: string,"p_order_id": string,"p_pin"?: string,"p_reason_code": string,"p_refund_method"?: string,"p_request_key": string }; Returns: Json
                           },
"cancel_purchase_order_balance":
{ Args: { "p_expected_version": number,"p_po_id": string,"p_reason": string,"p_request_key": string }; Returns: Json
                           },
"cancel_stock_count":
{ Args: { "p_count_id": string,"p_expected_version": number,"p_request_key": string }; Returns: Json
                           },
"cancel_transfer":
{ Args: { "p_expected_version": number,"p_request_key": string,"p_transfer_id": string }; Returns: Json
                           },
"change_stock_condition":
{ Args: { "p_lot_id": string,"p_note"?: string,"p_quantity": number,"p_reason_code"?: string,"p_request_key": string,"p_to_condition": string }; Returns: Json
                           },
"complete_order_pickup":
{ Args: { "p_expected_version": number,"p_order_id": string,"p_request_key": string }; Returns: Json
                           },
"confirm_setup_gate":
{ Args: { "p_evidence_note": string,"p_gate_id": string,"p_request_key": string }; Returns: Json
                           },
"create_customer":
{ Args: { "p_display_name": string,"p_email"?: string,"p_location_id": string,"p_phone"?: string,"p_request_key": string }; Returns: Json
                           },
"create_employee":
{ Args: { "p_display_name": string,"p_request_key": string }; Returns: Json
                           },
"create_purchase_order":
{ Args: { "p_expected_date": string,"p_lines": Json,"p_location_id": string,"p_note"?: string,"p_request_key": string,"p_supplier_id": string }; Returns: Json
                           },
"create_supplier_invoice":
{ Args: { "p_due_date"?: string,"p_invoice_date": string,"p_invoice_number": string,"p_lines": Json,"p_location_id": string,"p_note"?: string,"p_other_cents"?: number,"p_request_key": string,"p_supplier_id": string,"p_tax_cents"?: number }; Returns: Json
                           },
"create_transfer":
{ Args: { "p_from_location_id": string,"p_lines": Json,"p_note"?: string,"p_request_key": string,"p_to_location_id": string }; Returns: Json
                           },
"decide_return_custody":
{ Args: { "p_custody_id": string,"p_decision": string,"p_note"?: string,"p_request_key": string }; Returns: Json
                           },
"decide_waste_report":
{ Args: { "p_decision": string,"p_expected_version": number,"p_note"?: string,"p_request_key": string,"p_waste_report_id": string }; Returns: Json
                           },
"dispatch_transfer":
{ Args: { "p_expected_version": number,"p_request_key": string,"p_transfer_id": string }; Returns: Json
                           },
"edit_accepted_order":
{ Args: { "p_approver_employee_id"?: string,"p_discount_percent"?: number,"p_discount_reason"?: string,"p_expected_version": number,"p_lines": Json,"p_order_id": string,"p_pin"?: string,"p_request_key": string }; Returns: Json
                           },
"enable_posting":
{ Args: { "p_evidence_note": string,"p_request_key": string }; Returns: Json
                           },
"get_matchable_receipt_lines":
{ Args: { "p_location_id": string,"p_supplier_id": string }; Returns: Json
                           },
"get_my_context":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"get_order_for_return":
{ Args: { "p_location_id": string,"p_lookup": string }; Returns: Json
                           },
"get_pos_menu":
{ Args: { "p_location_id": string }; Returns: Json
                           },
"get_public_app_mode":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"get_request_result":
{ Args: { "p_request_key": string }; Returns: Json
                           },
"get_sales_summary":
{ Args: { "p_from": string,"p_location_ids"?: (string)[],"p_source"?: string,"p_to": string }; Returns: Json
                           },
"get_stock_overview":
{ Args: { "p_location_id": string }; Returns: Json
                           },
"get_supplier_invoice":
{ Args: { "p_invoice_id": string }; Returns: Json
                           },
"get_supplier_invoices":
{ Args: { "p_location_ids"?: (string)[],"p_status"?: string }; Returns: Json
                           },
"grant_membership":
{ Args: { "p_employee_id": string,"p_location_id": string,"p_request_key": string,"p_role": string }; Returns: Json
                           },
"link_employee_auth_user":
{ Args: { "p_email": string,"p_employee_id": string,"p_request_key": string }; Returns: Json
                           },
"list_location_approvers":
{ Args: { "p_location_id": string }; Returns: Json
                           },
"list_return_custody":
{ Args: { "p_location_id": string }; Returns: Json
                           },
"list_staff_access":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"list_waste_reports":
{ Args: { "p_location_id": string,"p_status"?: string }; Returns: Json
                           },
"mark_order_ready":
{ Args: { "p_expected_version": number,"p_order_id": string,"p_request_key": string }; Returns: Json
                           },
"post_opening_count":
{ Args: { "p_lines": Json,"p_location_id": string,"p_note"?: string,"p_request_key": string }; Returns: Json
                           },
"post_stock_count":
{ Args: { "p_count_id": string,"p_counts": Json,"p_expected_version": number,"p_note"?: string,"p_reason_code"?: string,"p_request_key": string }; Returns: Json
                           },
"process_exchange":
{ Args: { "p_approver_employee_id"?: string,"p_excess_refund_method"?: string,"p_new_lines": Json,"p_note"?: string,"p_order_id": string,"p_pin"?: string,"p_reason_code": string,"p_request_key": string,"p_return_lines": Json }; Returns: Json
                           },
"process_return":
{ Args: { "p_approver_employee_id"?: string,"p_external_reference"?: string,"p_lines": Json,"p_note"?: string,"p_order_id": string,"p_pin"?: string,"p_reason_code": string,"p_refund_method"?: string,"p_request_key": string }; Returns: Json
                           },
"receive_purchase_order":
{ Args: { "p_acknowledge_over_receipt"?: boolean,"p_expected_version": number,"p_lines": Json,"p_note"?: string,"p_packing_slip_ref": string,"p_po_id": string,"p_request_key": string }; Returns: Json
                           },
"receive_transfer":
{ Args: { "p_expected_version": number,"p_lines": Json,"p_request_key": string,"p_transfer_id": string }; Returns: Json
                           },
"record_refund":
{ Args: { "p_approver_employee_id"?: string,"p_external_reference"?: string,"p_lines": Json,"p_method": string,"p_note"?: string,"p_order_id": string,"p_pin"?: string,"p_reason_code": string,"p_request_key": string }; Returns: Json
                           },
"record_supplier_credit":
{ Args: { "p_amount_cents": number,"p_credit_memo_ref"?: string,"p_credited_on"?: string,"p_invoice_id": string,"p_reason": string,"p_request_key": string }; Returns: Json
                           },
"record_supplier_payment":
{ Args: { "p_amount_cents": number,"p_external_reference"?: string,"p_invoice_id": string,"p_method": string,"p_note"?: string,"p_paid_on"?: string,"p_request_key": string }; Returns: Json
                           },
"record_tender":
{ Args: { "p_amount_cents": number,"p_external_reference"?: string,"p_method": string,"p_order_id": string,"p_request_key": string }; Returns: Json
                           },
"reopen_setup_gate":
{ Args: { "p_gate_id": string,"p_reason": string,"p_request_key": string }; Returns: Json
                           },
"reverse_supplier_credit":
{ Args: { "p_credit_id": string,"p_reason": string,"p_request_key": string }; Returns: Json
                           },
"reverse_supplier_payment":
{ Args: { "p_payment_id": string,"p_reason": string,"p_request_key": string }; Returns: Json
                           },
"revise_supplier_invoice":
{ Args: { "p_expected_version": number,"p_invoice_id": string,"p_lines": Json,"p_note"?: string,"p_other_cents"?: number,"p_request_key": string,"p_tax_cents"?: number }; Returns: Json
                           },
"revoke_membership":
{ Args: { "p_membership_id": string,"p_reason": string,"p_request_key": string }; Returns: Json
                           },
"search_customers":
{ Args: { "p_location_id": string,"p_query": string }; Returns: Json
                           },
"set_employee_active":
{ Args: { "p_active": boolean,"p_employee_id": string,"p_reason": string,"p_request_key": string }; Returns: Json
                           },
"set_location_item_price":
{ Args: { "p_effective_from": string,"p_item_id": string,"p_location_id": string,"p_price_cents": number,"p_request_key": string }; Returns: Json
                           },
"set_location_tax_rate":
{ Args: { "p_effective_from": string,"p_location_id": string,"p_rate": number,"p_request_key": string }; Returns: Json
                           },
"set_manager_pin":
{ Args: { "p_new_pin": string,"p_request_key": string }; Returns: Json
                           },
"set_menu_availability":
{ Args: { "p_available": boolean,"p_item_id": string,"p_location_id": string,"p_reason"?: string,"p_request_key": string }; Returns: Json
                           },
"set_return_policy":
{ Args: { "p_allow_customer_restock": boolean,"p_request_key": string,"p_window_days": number }; Returns: Json
                           },
"set_supplier_item_pack":
{ Args: { "p_cost_basis": string,"p_pack_base_qty": number,"p_pack_cost_cents": number,"p_pack_description": string,"p_request_key": string,"p_supplier_item_id": string }; Returns: Json
                           },
"set_supplier_terms":
{ Args: { "p_payment_terms_days": number,"p_request_key": string,"p_supplier_id": string }; Returns: Json
                           },
"start_order_preparation":
{ Args: { "p_estimated_ready_at"?: string,"p_expected_version": number,"p_order_id": string,"p_request_key": string }; Returns: Json
                           },
"start_stock_count":
{ Args: { "p_item_ids"?: (string)[],"p_location_id": string,"p_request_key": string }; Returns: Json
                           },
"submit_purchase_order":
{ Args: { "p_expected_version": number,"p_po_id": string,"p_request_key": string }; Returns: Json
                           },
"submit_waste_report":
{ Args: { "p_lines": Json,"p_location_id": string,"p_note"?: string,"p_reason_code": string,"p_request_key": string }; Returns: Json
                           },
"void_supplier_invoice":
{ Args: { "p_expected_version": number,"p_invoice_id": string,"p_reason": string,"p_request_key": string }; Returns: Json
                           }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
      Row: infer R
    }
    ? R
    : never
  : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Insert: infer I
    }
    ? I
    : never
  : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Update: infer U
    }
    ? U
    : never
  : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
  ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
  : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "graphql_public": {
          Enums: {
            
          }
        },"public": {
          Enums: {
            
          }
        }
} as const


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
                }
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "confirm_setup_gate":
{ Args: { "p_evidence_note": string,"p_gate_id": string,"p_request_key": string }; Returns: Json
                           },
"create_employee":
{ Args: { "p_display_name": string,"p_request_key": string }; Returns: Json
                           },
"enable_posting":
{ Args: { "p_evidence_note": string,"p_request_key": string }; Returns: Json
                           },
"get_my_context":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"get_public_app_mode":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"get_request_result":
{ Args: { "p_request_key": string }; Returns: Json
                           },
"grant_membership":
{ Args: { "p_employee_id": string,"p_location_id": string,"p_request_key": string,"p_role": string }; Returns: Json
                           },
"link_employee_auth_user":
{ Args: { "p_email": string,"p_employee_id": string,"p_request_key": string }; Returns: Json
                           },
"list_staff_access":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"reopen_setup_gate":
{ Args: { "p_gate_id": string,"p_reason": string,"p_request_key": string }; Returns: Json
                           },
"revoke_membership":
{ Args: { "p_membership_id": string,"p_reason": string,"p_request_key": string }; Returns: Json
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

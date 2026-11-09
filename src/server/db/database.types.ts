
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
            "branches": {
                  Row: {
                    "created_at": string,"id": string,"name": string,"org_id": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id"?: string,"name": string,"org_id": string,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"name"?: string,"org_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "branches_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"campaigns": {
                  Row: {
                    "body": string,"branch_id": string | null,"client_request_id": string | null,"completed_at": string | null,"created_at": string,"created_by": string | null,"delivered_count": number,"estimated_cost": number,"failed_count": number,"id": string,"is_ad": boolean,"is_real_demo": boolean,"kind": Database["public"]['Enums']["campaign_kind"],"org_id": string,"recipient_count": number,"rejected_reason": string | null,"requested_at": string | null,"retry_of_campaign_id": string | null,"reviewed_at": string | null,"reviewed_by": string | null,"scheduled_at": string | null,"sender_phone": string | null,"sent_count": number,"started_at": string | null,"status": Database["public"]['Enums']["campaign_status"],"unit_price": number,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "body"?: string,"branch_id"?: string | null,"client_request_id"?: string | null,"completed_at"?: string | null,"created_at"?: string,"created_by"?: string | null,"delivered_count"?: number,"estimated_cost"?: number,"failed_count"?: number,"id"?: string,"is_ad"?: boolean,"is_real_demo"?: boolean,"kind"?: Database["public"]['Enums']["campaign_kind"],"org_id": string,"recipient_count"?: number,"rejected_reason"?: string | null,"requested_at"?: string | null,"retry_of_campaign_id"?: string | null,"reviewed_at"?: string | null,"reviewed_by"?: string | null,"scheduled_at"?: string | null,"sender_phone"?: string | null,"sent_count"?: number,"started_at"?: string | null,"status"?: Database["public"]['Enums']["campaign_status"],"unit_price"?: number,"updated_at"?: string
                  }
                  Update: {
                    "body"?: string,"branch_id"?: string | null,"client_request_id"?: string | null,"completed_at"?: string | null,"created_at"?: string,"created_by"?: string | null,"delivered_count"?: number,"estimated_cost"?: number,"failed_count"?: number,"id"?: string,"is_ad"?: boolean,"is_real_demo"?: boolean,"kind"?: Database["public"]['Enums']["campaign_kind"],"org_id"?: string,"recipient_count"?: number,"rejected_reason"?: string | null,"requested_at"?: string | null,"retry_of_campaign_id"?: string | null,"reviewed_at"?: string | null,"reviewed_by"?: string | null,"scheduled_at"?: string | null,"sender_phone"?: string | null,"sent_count"?: number,"started_at"?: string | null,"status"?: Database["public"]['Enums']["campaign_status"],"unit_price"?: number,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "campaigns_branch_id_org_id_fkey"
      columns: ["branch_id","org_id"]
isOneToOne: false
      referencedRelation: "branches"
      referencedColumns: ["id","org_id"]
    },{
      foreignKeyName: "campaigns_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "campaigns_retry_of_campaign_id_org_id_fkey"
      columns: ["retry_of_campaign_id","org_id"]
isOneToOne: false
      referencedRelation: "campaigns"
      referencedColumns: ["id","org_id"]
    }
                  ]
                },"contact_group_members": {
                  Row: {
                    "branch_id": string,"contact_id": string,"created_at": string,"group_id": string,"org_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "branch_id": string,"contact_id": string,"created_at"?: string,"group_id": string,"org_id": string
                  }
                  Update: {
                    "branch_id"?: string,"contact_id"?: string,"created_at"?: string,"group_id"?: string,"org_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "contact_group_members_contact_id_org_id_branch_id_fkey"
      columns: ["contact_id","org_id","branch_id"]
isOneToOne: false
      referencedRelation: "contacts"
      referencedColumns: ["id","org_id","branch_id"]
    },{
      foreignKeyName: "contact_group_members_group_id_org_id_branch_id_fkey"
      columns: ["group_id","org_id","branch_id"]
isOneToOne: false
      referencedRelation: "contact_groups"
      referencedColumns: ["id","org_id","branch_id"]
    }
                  ]
                },"contact_groups": {
                  Row: {
                    "branch_id": string,"created_at": string,"id": string,"name": string,"org_id": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "branch_id": string,"created_at"?: string,"id"?: string,"name": string,"org_id": string,"updated_at"?: string
                  }
                  Update: {
                    "branch_id"?: string,"created_at"?: string,"id"?: string,"name"?: string,"org_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "contact_groups_branch_id_org_id_fkey"
      columns: ["branch_id","org_id"]
isOneToOne: false
      referencedRelation: "branches"
      referencedColumns: ["id","org_id"]
    },{
      foreignKeyName: "contact_groups_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"contacts": {
                  Row: {
                    "branch_id": string,"consent_at": string | null,"created_at": string,"id": string,"memo": string | null,"name": string | null,"org_id": string,"phone": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "branch_id": string,"consent_at"?: string | null,"created_at"?: string,"id"?: string,"memo"?: string | null,"name"?: string | null,"org_id": string,"phone": string,"updated_at"?: string
                  }
                  Update: {
                    "branch_id"?: string,"consent_at"?: string | null,"created_at"?: string,"id"?: string,"memo"?: string | null,"name"?: string | null,"org_id"?: string,"phone"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "contacts_branch_id_org_id_fkey"
      columns: ["branch_id","org_id"]
isOneToOne: false
      referencedRelation: "branches"
      referencedColumns: ["id","org_id"]
    },{
      foreignKeyName: "contacts_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"demo_sends": {
                  Row: {
                    "created_at": string,"phone_hash": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"phone_hash": string,"user_id": string
                  }
                  Update: {
                    "created_at"?: string,"phone_hash"?: string,"user_id"?: string
                  }
                  Relationships: [
                    
                  ]
                },"ledger_entries": {
                  Row: {
                    "amount": number,"branch_id": string | null,"campaign_id": string | null,"created_at": string,"id": number,"idempotency_key": string,"kind": Database["public"]['Enums']["ledger_kind"],"org_id": string,"payment_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "amount": number,"branch_id"?: string | null,"campaign_id"?: string | null,"created_at"?: string,"id"?: never,"idempotency_key": string,"kind": Database["public"]['Enums']["ledger_kind"],"org_id": string,"payment_id"?: string | null
                  }
                  Update: {
                    "amount"?: number,"branch_id"?: string | null,"campaign_id"?: string | null,"created_at"?: string,"id"?: never,"idempotency_key"?: string,"kind"?: Database["public"]['Enums']["ledger_kind"],"org_id"?: string,"payment_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "ledger_entries_branch_id_org_id_fkey"
      columns: ["branch_id","org_id"]
isOneToOne: false
      referencedRelation: "branches"
      referencedColumns: ["id","org_id"]
    },{
      foreignKeyName: "ledger_entries_campaign_id_org_id_fkey"
      columns: ["campaign_id","org_id"]
isOneToOne: false
      referencedRelation: "campaigns"
      referencedColumns: ["id","org_id"]
    },{
      foreignKeyName: "ledger_entries_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "ledger_entries_payment_id_org_id_fkey"
      columns: ["payment_id","org_id"]
isOneToOne: false
      referencedRelation: "payments"
      referencedColumns: ["id","org_id"]
    }
                  ]
                },"members": {
                  Row: {
                    "branch_id": string | null,"created_at": string,"display_name": string,"org_id": string,"role": Database["public"]['Enums']["member_role"],"updated_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "branch_id"?: string | null,"created_at"?: string,"display_name": string,"org_id": string,"role": Database["public"]['Enums']["member_role"],"updated_at"?: string,"user_id": string
                  }
                  Update: {
                    "branch_id"?: string | null,"created_at"?: string,"display_name"?: string,"org_id"?: string,"role"?: Database["public"]['Enums']["member_role"],"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "members_branch_id_org_id_fkey"
      columns: ["branch_id","org_id"]
isOneToOne: false
      referencedRelation: "branches"
      referencedColumns: ["id","org_id"]
    },{
      foreignKeyName: "members_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"message_events": {
                  Row: {
                    "branch_id": string | null,"fail_code": string | null,"id": number,"kind": string,"message_id": number,"occurred_at": string,"org_id": string,"outcome": string,"received_at": string,"source": string
                  }
                  ComputedFields: never
                  Insert: {
                    "branch_id"?: string | null,"fail_code"?: string | null,"id"?: never,"kind": string,"message_id": number,"occurred_at": string,"org_id": string,"outcome": string,"received_at"?: string,"source": string
                  }
                  Update: {
                    "branch_id"?: string | null,"fail_code"?: string | null,"id"?: never,"kind"?: string,"message_id"?: number,"occurred_at"?: string,"org_id"?: string,"outcome"?: string,"received_at"?: string,"source"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "message_events_message_id_fkey"
      columns: ["message_id"]
isOneToOne: false
      referencedRelation: "messages"
      referencedColumns: ["id"]
    }
                  ]
                },"messages": {
                  Row: {
                    "attempt_count": number,"branch_id": string | null,"campaign_id": string,"created_at": string,"fail_code": string | null,"finalized_at": string | null,"id": number,"idempotency_key": string,"next_attempt_at": string,"org_id": string,"phone": string,"provider": string | null,"provider_message_id": string | null,"recipient_name": string | null,"sent_at": string | null,"status": Database["public"]['Enums']["message_status"]
                  }
                  ComputedFields: never
                  Insert: {
                    "attempt_count"?: number,"branch_id"?: string | null,"campaign_id": string,"created_at"?: string,"fail_code"?: string | null,"finalized_at"?: string | null,"id"?: never,"idempotency_key"?: string,"next_attempt_at"?: string,"org_id": string,"phone": string,"provider"?: string | null,"provider_message_id"?: string | null,"recipient_name"?: string | null,"sent_at"?: string | null,"status"?: Database["public"]['Enums']["message_status"]
                  }
                  Update: {
                    "attempt_count"?: number,"branch_id"?: string | null,"campaign_id"?: string,"created_at"?: string,"fail_code"?: string | null,"finalized_at"?: string | null,"id"?: never,"idempotency_key"?: string,"next_attempt_at"?: string,"org_id"?: string,"phone"?: string,"provider"?: string | null,"provider_message_id"?: string | null,"recipient_name"?: string | null,"sent_at"?: string | null,"status"?: Database["public"]['Enums']["message_status"]
                  }
                  Relationships: [
                    {
      foreignKeyName: "messages_campaign_id_fkey"
      columns: ["campaign_id"]
isOneToOne: false
      referencedRelation: "campaigns"
      referencedColumns: ["id"]
    }
                  ]
                },"opt_outs": {
                  Row: {
                    "created_at": string,"created_by": string | null,"id": string,"org_id": string,"phone": string,"reason": string | null,"source": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"created_by"?: string | null,"id"?: string,"org_id": string,"phone": string,"reason"?: string | null,"source": string
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string | null,"id"?: string,"org_id"?: string,"phone"?: string,"reason"?: string | null,"source"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "opt_outs_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"organizations": {
                  Row: {
                    "created_at": string,"id": string,"name": string,"trial_expires_at": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id"?: string,"name": string,"trial_expires_at"?: string | null
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"name"?: string,"trial_expires_at"?: string | null
                  }
                  Relationships: [
                    
                  ]
                },"payments": {
                  Row: {
                    "amount": number,"approved_at": string | null,"branch_id": string | null,"created_at": string,"id": string,"order_id": string,"org_id": string,"payment_key": string | null,"requested_by": string | null,"status": Database["public"]['Enums']["payment_status"],"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "amount": number,"approved_at"?: string | null,"branch_id"?: string | null,"created_at"?: string,"id"?: string,"order_id": string,"org_id": string,"payment_key"?: string | null,"requested_by"?: string | null,"status"?: Database["public"]['Enums']["payment_status"],"updated_at"?: string
                  }
                  Update: {
                    "amount"?: number,"approved_at"?: string | null,"branch_id"?: string | null,"created_at"?: string,"id"?: string,"order_id"?: string,"org_id"?: string,"payment_key"?: string | null,"requested_by"?: string | null,"status"?: Database["public"]['Enums']["payment_status"],"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "payments_branch_id_org_id_fkey"
      columns: ["branch_id","org_id"]
isOneToOne: false
      referencedRelation: "branches"
      referencedColumns: ["id","org_id"]
    },{
      foreignKeyName: "payments_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"real_send_counters": {
                  Row: {
                    "day": string,"sent": number
                  }
                  ComputedFields: never
                  Insert: {
                    "day": string,"sent"?: number
                  }
                  Update: {
                    "day"?: string,"sent"?: number
                  }
                  Relationships: [
                    
                  ]
                },"sender_numbers": {
                  Row: {
                    "branch_id": string | null,"created_at": string,"id": string,"is_default": boolean,"label": string,"number": string,"org_id": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "branch_id"?: string | null,"created_at"?: string,"id"?: string,"is_default"?: boolean,"label": string,"number": string,"org_id": string,"updated_at"?: string
                  }
                  Update: {
                    "branch_id"?: string | null,"created_at"?: string,"id"?: string,"is_default"?: boolean,"label"?: string,"number"?: string,"org_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "sender_numbers_branch_id_org_id_fkey"
      columns: ["branch_id","org_id"]
isOneToOne: false
      referencedRelation: "branches"
      referencedColumns: ["id","org_id"]
    },{
      foreignKeyName: "sender_numbers_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"webhook_events": {
                  Row: {
                    "error": string | null,"id": number,"process_result": string | null,"processed_at": string | null,"provider": string,"raw_body": string,"received_at": string,"signature_valid": boolean
                  }
                  ComputedFields: never
                  Insert: {
                    "error"?: string | null,"id"?: never,"process_result"?: string | null,"processed_at"?: string | null,"provider": string,"raw_body": string,"received_at"?: string,"signature_valid": boolean
                  }
                  Update: {
                    "error"?: string | null,"id"?: never,"process_result"?: string | null,"processed_at"?: string | null,"provider"?: string,"raw_body"?: string,"received_at"?: string,"signature_valid"?: boolean
                  }
                  Relationships: [
                    
                  ]
                }
          }
          Views: {
            "account_balances": {
                  Row: {
                    "balance": number | null,"branch_id": string | null,"org_id": string
                  }
                  ComputedFields: never
                  Relationships: [
                    {
      foreignKeyName: "ledger_entries_branch_id_org_id_fkey"
      columns: ["branch_id","org_id"]
isOneToOne: false
      referencedRelation: "branches"
      referencedColumns: ["id","org_id"]
    },{
      foreignKeyName: "ledger_entries_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                }
          }
          Functions: {
            "apply_message_updates":
{ Args: { "p_updates": Json }; Returns: number[]
                           },
"approve_campaign":
{ Args: { "p_campaign_id": string,"p_org_id": string,"p_reviewer": string }; Returns: undefined
                           },
"campaign_receipt":
{ Args: { "p_campaign_id": string }; Returns: {
              "accepted_late": number,"awaiting": number,"carrier_failed": number,"completed_at": string,"delivered": number,"first_accepted_at": string,"first_delivered_at": string,"first_result_at": string,"queued": number,"started_at": string,"vendor_failed": number,"webhook_count": number,"webhook_ignored": number
            }[]
                           },
"cancel_campaign":
{ Args: { "p_branch_id": string,"p_campaign_id": string,"p_org_id": string }; Returns: undefined
                           },
"claim_messages":
{ Args: { "p_lease_seconds": number,"p_limit": number }; Returns: {
              "attempt_count": number,"body": string,"campaign_id": string,"campaign_status": Database["public"]['Enums']["campaign_status"],"id": number,"idempotency_key": string,"is_ad": boolean,"is_real_demo": boolean,"is_trial": boolean,"kind": Database["public"]['Enums']["campaign_kind"],"phone": string,"sender_phone": string
            }[]
                           },
"complete_campaign":
{ Args: { "p_campaign_id": string }; Returns: boolean
                           },
"confirm_payment":
{ Args: { "p_amount": number,"p_approved_at": string,"p_order_id": string,"p_payment_key": string }; Returns: string
                           },
"contact_page":
{ Args: { "p_branch_id": string,"p_group_id": string,"p_limit": number,"p_offset": number,"p_query": string,"p_status": string }; Returns: {
              "branch_id": string,"branch_name": string,"consent_at": string,"created_at": string,"group_ids": (string)[],"id": string,"memo": string,"name": string,"phone": string,"receive_status": string,"total_count": number
            }[]
                           },
"create_trial_org":
{ Args: { "p_user_id": string }; Returns: string
                           },
"create_trial_org_base":
{ Args: { "p_user_id": string }; Returns: string
                           },
"create_trial_org_before_consent":
{ Args: { "p_user_id": string }; Returns: string
                           },
"create_trial_org_before_events":
{ Args: { "p_user_id": string }; Returns: string
                           },
"create_trial_org_before_links":
{ Args: { "p_user_id": string }; Returns: string
                           },
"create_trial_org_before_review":
{ Args: { "p_user_id": string }; Returns: string
                           },
"create_trial_org_with_contacts":
{ Args: { "p_user_id": string }; Returns: string
                           },
"delete_expired_trials":
{ Args: Record<PropertyKey, never>; Returns: number
                           },
"link_trial_messages":
{ Args: { "p_org_id": string }; Returns: undefined
                           },
"preview_retry":
{ Args: { "p_hopeless_codes": (string)[],"p_message_ids": (number)[],"p_org_id": string,"p_source_id": string }; Returns: {
              "balance": number,"failed_count": number,"hopeless_count": number,"kind": Database["public"]['Enums']["campaign_kind"],"target_count": number,"unit_price": number
            }[]
                           },
"record_message_events":
{ Args: { "p_events": Json }; Returns: undefined
                           },
"reject_campaign":
{ Args: { "p_campaign_id": string,"p_org_id": string,"p_reason": string,"p_reviewer": string }; Returns: undefined
                           },
"reserve_balance":
{ Args: { "p_amount": number,"p_branch_id": string,"p_campaign_id": string,"p_idempotency_key": string,"p_org_id": string }; Returns: number
                           },
"reserve_real_sends":
{ Args: { "p_count": number,"p_limit": number }; Returns: number
                           },
"retry_failed_messages":
{ Args: { "p_created_by": string,"p_message_ids": (number)[],"p_org_id": string,"p_source_id": string }; Returns: string
                           },
"seed_public_sample":
{ Args: Record<PropertyKey, never>; Returns: number
                           },
"seed_sample_message_events":
{ Args: { "p_org_id": string }; Returns: undefined
                           },
"start_demo_send":
{ Args: { "p_body": string,"p_branch_id": string,"p_daily_limit": number,"p_org_id": string,"p_phone": string,"p_sender_phone": unknown,"p_unit_price": number,"p_user_id": string }; Returns: string
                           },
"submit_campaign":
{ Args: { "p_body": string,"p_branch_id": string,"p_client_request_id": string,"p_created_by": string,"p_is_ad": boolean,"p_kind": Database["public"]['Enums']["campaign_kind"],"p_org_id": string,"p_recipients": Json,"p_scheduled_at": string,"p_sender_phone": unknown,"p_status": Database["public"]['Enums']["campaign_status"],"p_unit_price": number }; Returns: string
                           },
"switch_trial_role":
{ Args: { "p_branch_id": string,"p_user_id": string }; Returns: undefined
                           },
"today_campaign_summary":
{ Args: { "p_from": string }; Returns: {
              "campaign_count": number,"delivered": number,"failed": number,"pending": number,"recipient_count": number
            }[]
                           }
          }
          Enums: {
            "campaign_kind": "sms"|"lms","campaign_status": "draft"|"pending_approval"|"rejected"|"scheduled"|"sending"|"completed"|"canceled","ledger_kind": "charge"|"reserve"|"release"|"refund","member_role": "hq"|"branch","message_status": "queued"|"sent"|"delivered"|"failed","payment_status": "ready"|"done"|"canceled"|"failed"
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
            "campaign_kind": ["sms", "lms"],"campaign_status": ["draft", "pending_approval", "rejected", "scheduled", "sending", "completed", "canceled"],"ledger_kind": ["charge", "reserve", "release", "refund"],"member_role": ["hq", "branch"],"message_status": ["queued", "sent", "delivered", "failed"],"payment_status": ["ready", "done", "canceled", "failed"]
          }
        }
} as const

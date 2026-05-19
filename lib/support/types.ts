export type SupportStatus =
  | "ai_active"
  | "escalated"
  | "agent_active"
  | "resolved"
  | "closed";

export type SupportSender = "user" | "ai" | "agent" | "system";

export type SupportEscalationReason =
  | "user_request"
  | "low_confidence"
  | "sentiment_negative"
  | "specific_intent"
  | "ai_disabled"
  | "agent_manual";

export type SupportConversation = {
  id: string;
  user_id: string | null;
  anonymous_id: string | null;
  status: SupportStatus;
  subject: string | null;
  assigned_agent_id: string | null;
  assigned_agent_name: string | null;
  escalation_reason: SupportEscalationReason | null;
  escalated_at: string | null;
  resolved_at: string | null;
  resolved_by: string | null;
  last_message_at: string;
  last_message_sender: SupportSender | null;
  user_unread_count: number;
  agent_unread_count: number;
  ai_message_count: number;
  agent_message_count: number;
  user_message_count: number;
  metadata: Record<string, any>;
  created_at: string;
  updated_at: string;
};

export type SupportMessage = {
  id: string;
  conversation_id: string;
  sender: SupportSender;
  sender_id: string | null;
  sender_name: string | null;
  body: string;
  ai_suggested: boolean;
  ai_model: string | null;
  ai_tokens_in: number | null;
  ai_tokens_out: number | null;
  ai_confidence: number | null;
  ai_should_escalate: boolean | null;
  attachments: any;
  read_at: string | null;
  created_at: string;
};

export type AgentIdentity = {
  id: string;
  role: "admin" | "super_admin" | "support_agent";
  name: string | null;
  phone: string | null;
};

export type AIResponse = {
  reply: string;
  confidence: number;
  shouldEscalate: boolean;
  escalationReason?: SupportEscalationReason;
  model: string;
  tokensIn: number;
  tokensOut: number;
};

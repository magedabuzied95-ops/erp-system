export type Urgency = "Low" | "Medium" | "High" | "Critical";
export type Priority = "Low" | "Medium" | "High" | "Critical";
export type SalesStage = "New Lead" | "Interested" | "Comparing" | "Negotiating" | "Ready To Buy" | "Purchased" | "Returning Customer" | "Support" | "Lost";
export type CustomerMood = "Happy" | "Neutral" | "Confused" | "Urgent" | "Angry" | "Excited" | "Price Sensitive";
export type AssignmentTeam = "Sales" | "Support" | "Accounting" | "Warehouse" | "Manager";

export interface ConversationMessage { id?: string | number; text?: string; message?: string; content?: string; role?: string; sender_type?: string; direction?: string; created_at?: string; sent_at?: string; timestamp?: string; channel?: string; }
export interface ConversationCustomer { id?: string | number; name?: string; phone?: string; email?: string; city?: string; status?: string; last_active_at?: string; }
export interface ConversationOrder { id?: string | number; status?: string; total?: number; amount?: number; total_amount?: number; created_at?: string; payment_method?: string; items?: Array<{ product_id?: string | number; name?: string; brand?: string; category?: string; color?: string; size?: string; }>; }
export interface ConversationProduct { id?: string | number; product_id?: string | number; name?: string; title?: string; brand?: string; category?: string; color?: string; size?: string; stock?: number; available_stock?: number; price?: number; viewed?: boolean; purchased?: boolean; }
export interface CRMIntelligenceInput { score?: { score?: number; grade?: string }; health?: { label?: string }; purchase?: { probability?: number }; preferences?: { favoriteBrand?: string; favoriteCategory?: string; favoriteColor?: string; favoriteSize?: string; budgetRange?: string; }; }
export interface CurrentAgent { id?: string | number; name?: string; team?: string; skills?: string[]; available?: boolean; }
export interface ConversationAnalysisInput { conversation: ConversationMessage[]; customer?: ConversationCustomer; orders?: ConversationOrder[]; products?: ConversationProduct[]; crmIntelligence?: CRMIntelligenceInput; currentAgent?: CurrentAgent; currentChannel?: string; }
export interface ProductRecommendation { product: ConversationProduct; score: number; reasons: string[]; }
export interface ReplyRecommendation { title: string; reason: string; tone: string; replyStrategy: string; }
export interface ActionRecommendation { title: string; reason: string; priority: Priority; }
export interface AssignmentRecommendation { team: AssignmentTeam; reason: string; retainCurrentAgent: boolean; }
export interface FollowUpRecommendation { recommendedAfter: string; reason: string; channel: string; }
export interface ConversationIntelligence { intent: string[]; salesStage: SalesStage; leadScore: number; customerMood: CustomerMood; urgency: Urgency; buyingSignals: string[]; objections: string[]; recommendedProducts: ProductRecommendation[]; nextBestReply: ReplyRecommendation; nextBestAction: ActionRecommendation; priority: Priority; autoLabels: string[]; autoAssignment: AssignmentRecommendation; followUpRecommendation: FollowUpRecommendation; confidence: number; summary: string[]; }

